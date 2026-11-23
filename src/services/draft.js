/**
 * Closing the loop: when an incident is resolved, Precedent drafts a structured
 * postmortem in Confluence, pre-filled from the incident, and tells the incident
 * whether this has happened before.
 *
 * The draft uses the exact sections Precedent learns from (trigger, root cause,
 * guardrails, components). Prompts are Confluence placeholders, so an untouched
 * draft teaches Precedent nothing; once the team fills it in, auto-discovery
 * learns it and future look-alike work gets warned.
 */
import { kvs } from '@forge/kvs';
import { route } from '@forge/api';
import {
  getIssue, addComment, jiraBaseUrl, createPage, findPageByTitle, confluence, confluenceBaseUrl,
} from '../atlassian.js';
import { adfToText } from '../engine/extract.js';
import { matchChange, LEVELS } from '../engine/match.js';
import { getIndex, listLessons, getConfig, bumpStat } from '../store.js';
import { issueToChange, presentMatch } from './precedent.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const placeholder = (text) => `<p><ac:placeholder>${esc(text)}</ac:placeholder></p>`;

function severityOf(issue) {
  const p = issue.fields.priority?.name || '';
  if (/highest|critical|blocker|p1/i.test(p)) return 'SEV1';
  if (/high|major|p2/i.test(p)) return 'SEV2';
  if (/medium|p3/i.test(p)) return 'SEV3';
  return null;
}

function durationOf(issue) {
  const start = Date.parse(issue.fields.created);
  const end = Date.parse(issue.fields.resolutiondate || '');
  if (!start || !end || end <= start) return null;
  const mins = Math.round((end - start) / 60000);
  if (mins > 7 * 24 * 60) return null; // tickets left open for days don't measure the outage
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Storage-format body of the draft. Exported for tests. */
export function renderDraftStorage({ issue, issueUrl, similar }) {
  const f = issue.fields;
  const description = adfToText(f.description).trim();
  const components = (f.components || []).map((c) => c.name);
  const meta = [
    `Incident: <a href="${esc(issueUrl)}">${esc(issue.key)}</a>`,
    severityOf(issue) ? `Severity: ${severityOf(issue)}` : null,
    durationOf(issue) ? `Duration: ${durationOf(issue)}` : null,
    `Date: ${(f.resolutiondate || f.created || '').slice(0, 10)}`,
  ].filter(Boolean).join(' · ');
  const similarHtml = similar.length
    ? `<h2>Has this happened before?</h2><p>Precedent found earlier incidents that look like this one. If the same guardrails failed again, say why below.</p><ul>${
      similar.map((m) => `<li><a href="${esc(m.url)}">${esc(m.title)}</a>${m.severity ? ` (${esc(m.severity)}${m.durationMin ? `, ${m.durationMin} min` : ''})` : ''}</li>`).join('')}</ul>`
    : '';
  return [
    `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Drafted by Precedent when ${esc(issue.key)} was resolved. Fill in <strong>Trigger</strong>, <strong>Root cause</strong> and <strong>Guardrails</strong>: Precedent learns from this page automatically and will warn future work that looks like this incident.</p></ac:rich-text-body></ac:structured-macro>`,
    `<p>${meta}</p>`,
    '<h2>Summary</h2>',
    description ? description.split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('') : `<p>${esc(f.summary)}</p>`,
    '<h2>Trigger</h2>',
    placeholder('What change set this off? A deploy, config change, migration, flag flip, traffic spike… Be specific: Precedent matches future work on this.'),
    '<h2>Root cause</h2>',
    placeholder('Why did that change cause an outage? What was missing that would have stopped it?'),
    '<h2>Impact</h2>',
    placeholder('Who was affected, for how long, and how badly?'),
    '<h2>Guardrails</h2>',
    placeholder('One rule per bullet: what must be true before anyone makes a change like this again. Each becomes a one-click sub-task on future look-alike work.'),
    '<h2>Affected components</h2>',
    components.length ? `<p>${components.map(esc).join(', ')}</p>` : placeholder('Services, libraries or configs involved, comma-separated.'),
    similarHtml,
  ].filter(Boolean).join('\n');
}

/** The space where the team already keeps postmortems, else any space. */
async function postmortemSpace() {
  const lessons = await listLessons();
  const counts = new Map();
  for (const l of lessons) {
    const key = l.sourceType === 'postmortem' && String(l.url || '').match(/\/spaces\/([^/]+)\//)?.[1];
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best;
  const spaces = await confluence('app', route`/wiki/api/v2/spaces?type=global&limit=1`, {}, 'list spaces').catch(() => ({ results: [] }));
  return spaces.results?.[0]?.key || null;
}

/** "2 similar incidents and 1 decision" */
export function describeSimilar(similar) {
  const n = (count, word) => (count ? `${count} ${word}${count === 1 ? '' : 's'}` : null);
  const decisions = similar.filter((m) => m.sourceType === 'decision').length;
  return [n(similar.length - decisions, 'similar incident'), n(decisions, 'related decision')].filter(Boolean).join(' and ');
}

function adfLink(text, href) {
  return { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] };
}

/**
 * Draft a postmortem for a resolved incident. Idempotent per incident.
 * @returns {Promise<{pageUrl:string, similar:object[]}|null>}
 */
export async function draftPostmortem(issueKey) {
  const config = await getConfig();
  if (config.draftPostmortems === false) return null;
  const marker = `draft:${issueKey}`;
  if (await kvs.get(marker)) return null;

  // A postmortem already exists for this incident? Nothing to draft.
  const lessons = await listLessons();
  if (lessons.some((l) => l.sourceType === 'postmortem' && (l.incidentKey === issueKey || (l.title || '').includes(issueKey)))) {
    await kvs.set(marker, { skipped: 'exists', at: new Date().toISOString() });
    return null;
  }

  const issue = await getIssue(issueKey);
  // Service desks also resolve password resets; only real incidents get a postmortem.
  const isIncident = /incident/i.test(issue.fields.issuetype?.name || '')
    || (issue.fields.labels || []).some((l) => /^(incident|precedent-demo-incident)$/i.test(l));
  if (!isIncident) return null;
  const issueUrl = `${await jiraBaseUrl()}/browse/${issueKey}`;
  const index = await getIndex();
  const similar = index.N
    ? matchChange(index, issueToChange(issue), { limit: 3, minConfidence: LEVELS.medium, excludeIds: [`jira:${issueKey}`] }).map(presentMatch)
    : [];

  const spaceKey = await postmortemSpace();
  if (!spaceKey) { console.warn('draftPostmortem: no Confluence space available'); return null; }
  const title = `Postmortem: ${issueKey} — ${issue.fields.summary}`.slice(0, 250);
  const existing = await findPageByTitle(spaceKey, title);
  let page = existing;
  if (!page) {
    const parent = await findPageByTitle(spaceKey, 'Incident Postmortems').catch(() => null);
    page = await createPage({ spaceKey, title, parentId: parent?.id, storage: renderDraftStorage({ issue, issueUrl, similar }) });
  }
  const pageUrl = page._links?.webui ? `${await confluenceBaseUrl()}${page._links.webui}` : `${await confluenceBaseUrl()}/pages/viewpage.action?pageId=${page.id}`;
  await kvs.set(marker, { pageId: page.id, pageUrl, at: new Date().toISOString() });

  const content = [
    { type: 'paragraph', content: [{ type: 'text', text: '📝 Precedent drafted the postmortem: ', marks: [{ type: 'strong' }] }, adfLink(title, pageUrl)] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Fill in Trigger, Root cause and Guardrails. Precedent learns from it automatically and will warn future work that looks like this incident.' }] },
  ];
  if (similar.length) {
    content.push(
      { type: 'paragraph', content: [{ type: 'text', text: `This has happened before (${describeSimilar(similar)}):`, marks: [{ type: 'strong' }] }] },
      { type: 'bulletList', content: similar.map((m) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [m.url ? adfLink(m.title, m.url) : { type: 'text', text: m.title }] }] })) },
    );
  }
  await addComment(issueKey, { type: 'doc', version: 1, content: [{ type: 'panel', attrs: { panelType: similar.length ? 'warning' : 'info' }, content }] });
  await bumpStat('postmortemsDrafted');
  return { pageUrl, similar };
}
