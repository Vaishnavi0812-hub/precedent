/**
 * Core use-cases: check a change against institutional memory, apply guardrails,
 * auto-flag risky issues.
 */
import { getIssue, addComment, addLabels, getSubtaskTypeId, createIssue, setIssueProperty, jiraBaseUrl } from '../atlassian.js';
import { adfToText } from '../engine/extract.js';
import { matchChange, changeFromIssue, LEVELS } from '../engine/match.js';
import { getIndex, getIssueState, updateIssueState, getConfig, bumpStat, listLessons, recordHit } from '../store.js';
import { isIncidentIssue } from './ingest.js';
import { whoHasBeenHere } from './graph.js';

export function issueToChange(issue) {
  const f = issue.fields || {};
  return changeFromIssue({
    summary: f.summary,
    descriptionText: adfToText(f.description),
    components: f.components || [],
    labels: (f.labels || []).filter((l) => !l.startsWith('precedent')),
  });
}

/** Shape a match for the UI / Rovo / MCP — no internal scoring noise. */
export function presentMatch(m) {
  const l = m.lesson;
  return {
    id: l.id,
    sourceType: l.sourceType,
    title: l.title,
    url: l.url,
    incidentUrl: l.incidentUrl,
    date: l.date,
    severity: l.severity,
    durationMin: l.durationMin,
    impact: l.impact,
    trigger: l.trigger,
    rootCause: l.rootCause,
    summary: l.sourceType === 'decision' ? l.summary : undefined,
    guardrails: l.guardrails || [],
    components: l.components || [],
    confidence: m.confidence,
    level: m.level,
    matchedTerms: m.matchedTerms,
    componentHits: m.componentHits,
  };
}

/** Check free text (Rovo / MCP / PR) against memory. */
export async function checkText({ text, components = [], labels = [], limit = 3, minConfidence = LEVELS.low }) {
  const index = await getIndex();
  return matchChange(index, { text, components, labels }, { limit, minConfidence }).map(presentMatch);
}

/** Check a Jira issue. Excludes the issue's own lesson (when the issue *is* an incident). */
export async function checkIssue(issueKey, { as = 'user', includeDismissed = false } = {}) {
  const [issue, index, state] = await Promise.all([getIssue(issueKey, as), getIndex(), getIssueState(issueKey)]);
  const matches = matchChange(index, issueToChange(issue), {
    limit: 4,
    excludeIds: [`jira:${issueKey}`, ...(includeDismissed ? [] : state.dismissed)],
  }).map(presentMatch);
  return {
    issue: {
      key: issue.key,
      summary: issue.fields.summary,
      projectKey: issue.fields.project?.key,
      isIncident: isIncidentIssue(issue),
      isSubtask: Boolean(issue.fields.issuetype?.subtask),
    },
    matches,
    applied: state.applied,
    dismissedCount: state.dismissed.length,
    lessonCount: index.N,
  };
}

export async function dismiss(issueKey, lessonId, accountId) {
  await updateIssueState(issueKey, (s) => ({ ...s, dismissed: [...new Set([...s.dismissed, lessonId])], dismissedBy: accountId }));
  await bumpStat('dismissed');
}

/**
 * Turn a guardrail into tracked work: a sub-task when possible, otherwise a
 * checklist comment. Either way it is recorded so the panel shows it as done.
 */
export async function applyGuardrail(issueKey, lessonId, guardrail) {
  const lessons = await listLessons();
  const lesson = lessons.find((l) => l.id === lessonId);
  const issue = await getIssue(issueKey);
  const projectKey = issue.fields.project.key;
  const source = lesson ? `${lesson.title}${lesson.url ? ` (${lesson.url})` : ''}` : 'a past incident';
  let created = null;

  if (!issue.fields.issuetype?.subtask) {
    const subtaskTypeId = await getSubtaskTypeId(projectKey).catch(() => null);
    if (subtaskTypeId) {
      created = await createIssue({
        project: { key: projectKey },
        parent: { key: issueKey },
        issuetype: { id: subtaskTypeId },
        summary: `Guardrail: ${guardrail}`.slice(0, 250),
        labels: ['precedent-guardrail'],
        description: adf([
          para(`Added by Precedent. This guardrail comes from ${source}.`),
          ...(lesson?.rootCause ? [para(`What went wrong last time: ${lesson.rootCause}`)] : []),
        ]),
      }).catch((e) => { console.warn('subtask create failed, falling back to comment', e.message); return null; });
    }
  }
  if (!created) {
    await addComment(issueKey, adf([
      para(`🛡️ Precedent guardrail added from ${source}:`),
      { type: 'taskList', attrs: { localId: `pg-${Date.now()}` }, content: [{ type: 'taskItem', attrs: { localId: `pgi-${Date.now()}`, state: 'TODO' }, content: [{ type: 'text', text: guardrail }] }] },
    ]));
  }
  await addLabels(issueKey, ['precedent-guarded']).catch(() => {});
  await updateIssueState(issueKey, (s) => ({ ...s, applied: [...s.applied, { lessonId, guardrail, key: created?.key, at: new Date().toISOString() }] }));
  await recordHit(lessonId, issueKey, 'guarded', { summary: issue.fields.summary, guardrail, subtask: created?.key });
  await bumpStat('guardrailsApplied');
  return { subtaskKey: created?.key || null, url: created?.key ? `${await jiraBaseUrl()}/browse/${created.key}` : null };
}

/**
 * Trigger path: when an issue is created or its summary/description change,
 * flag high-confidence precedents with a single comment (never spam).
 */
export async function autoFlag(issueKey) {
  const config = await getConfig();
  if (!config.autoFlag) return null;
  const issue = await getIssue(issueKey);
  if (isIncidentIssue(issue) || issue.fields.issuetype?.subtask) return null;
  const index = await getIndex();
  if (!index.N) return null;
  const minConfidence = config.autoFlagMinLevel === 'medium' ? LEVELS.medium : LEVELS.high;
  const state = await getIssueState(issueKey);
  const all = matchChange(index, issueToChange(issue), {
    limit: 2, minConfidence, excludeIds: [`jira:${issueKey}`, ...state.dismissed],
  });
  // Already-flagged precedents: just make sure the impact record exists (idempotent), no new comment.
  for (const m of all.filter((x) => state.flagged.includes(x.lesson.id))) {
    await recordHit(m.lesson.id, issueKey, 'flagged', { summary: issue.fields.summary, level: m.level });
  }
  const matches = all.filter((x) => !state.flagged.includes(x.lesson.id));
  if (!matches.length) return null;

  const top = matches.map(presentMatch);
  await addComment(issueKey, flagCommentAdf(top));
  await addLabels(issueKey, ['precedent-flagged']).catch(() => {});
  await setIssueProperty(issueKey, 'precedent', { flagged: true, count: top.length, top: top[0].title, level: top[0].level }).catch(() => {});
  await updateIssueState(issueKey, (s) => ({ ...s, flagged: [...s.flagged, ...top.map((m) => m.id)] }));
  for (const m of top) await recordHit(m.id, issueKey, 'flagged', { summary: issue.fields.summary, level: m.level });
  await bumpStat('issuesFlagged');
  return top;
}

/* ---------- ADF helpers ---------- */

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const adf = (content) => ({ type: 'doc', version: 1, content });

function linkText(text, href) {
  return href ? { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text };
}

export function flagCommentAdf(matches) {
  const items = matches.map((m) => ({
    type: 'listItem',
    content: [{
      type: 'paragraph',
      content: [
        linkText(m.title, m.url),
        { type: 'text', text: [m.severity, m.durationMin ? `${m.durationMin} min` : null].filter(Boolean).length ? ` (${[m.severity, m.durationMin ? `${m.durationMin} min` : null].filter(Boolean).join(', ')})` : '' },
        { type: 'text', text: m.guardrails[0] ? ` — guardrail: ${m.guardrails[0]}` : '' },
      ].filter((n) => n.text),
    }],
  }));
  return adf([
    {
      type: 'panel', attrs: { panelType: 'warning' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '⚠️ Precedent: this change looks like something that has hurt us before.', marks: [{ type: 'strong' }] }] },
        { type: 'bulletList', content: items },
        para('Open the Precedent panel on this issue to review what went wrong and add the guardrails.'),
      ],
    },
  ]);
}

/**
 * "Who has been here before?" for a lesson: people connected to its postmortem or
 * decision page in Teamwork Graph, their teams, and related pages.
 */
export async function peopleForLesson(lessonId, cloudId) {
  const lessons = await listLessons();
  const lesson = lessons.find((l) => l.id === lessonId)
    || lessons.find((l) => (l.title || '').toUpperCase().includes(String(lessonId).toUpperCase()));
  if (!lesson) return { error: `No lesson found for "${lessonId}".` };
  if (!lesson.id.startsWith('cf:')) {
    return { lesson: lesson.title, people: [], relatedPages: [], note: 'This incident has no postmortem page yet, so there is no one to trace. Writing one would capture who knows about it.' };
  }
  if (!cloudId) return { lesson: lesson.title, people: [], relatedPages: [], note: 'Site context unavailable.' };
  const res = await whoHasBeenHere(cloudId, lesson.sourceKey);
  return { lesson: lesson.title, link: lesson.url, ...res };
}
