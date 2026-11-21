/**
 * One-click demo history. Creates a realistic incident history for a fictional
 * company so Precedent is useful the moment a judge installs it on an empty site.
 *
 * Runs on an async queue consumer (long timeout) and reports progress to KVS,
 * which the admin page polls.
 */
import { kvs } from '@forge/kvs';
import { route } from '@forge/api';
import {
  ensureSpace, findPageByTitle, createPage, addPageLabels,
  listProjects, createIssue, searchIssues, jira, myself,
} from '../atlassian.js';
import {
  DEMO_COMPANY, INCIDENTS, DECISIONS, DEMO_CHANGES,
  renderPostmortemStorage, renderDecisionStorage, renderIncidentAdf,
} from '../data/demo-history.js';
import { syncAll } from './ingest.js';
import { setConfig } from '../store.js';

export const SPACE_KEY = 'LUMEN';
const PROGRESS_KEY = 'seed:progress';

async function progress(patch) {
  const cur = (await kvs.get(PROGRESS_KEY)) || {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  if (patch.log) next.log = [...(cur.log || []), patch.log].slice(-40);
  await kvs.set(PROGRESS_KEY, next);
}

export const getSeedProgress = () => kvs.get(PROGRESS_KEY);
export const resetSeedProgress = (accountId) =>
  kvs.set(PROGRESS_KEY, { status: 'queued', done: 0, total: 0, log: [], startedBy: accountId, updatedAt: new Date().toISOString() });

const adfPara = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Pick projects: a service desk for incidents, a software project for upcoming work. */
async function chooseProjects({ incidentProjectKey, workProjectKey }) {
  const projects = await listProjects();
  const byKey = (k) => projects.find((p) => p.key === k);
  const incident = byKey(incidentProjectKey) || projects.find((p) => p.type === 'service_desk') || null;
  const work = byKey(workProjectKey) || projects.find((p) => p.type === 'software') || projects.find((p) => p.type !== 'service_desk') || incident;
  return { incident, work, projects };
}

async function issueTypeFor(projectKey, preferred) {
  const res = await jira('app', route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, {}, 'issue types');
  const types = (res.issueTypes || res.values || []).filter((t) => !t.subtask);
  return (preferred.map((n) => types.find((t) => t.name.toLowerCase() === n)).find(Boolean) || types[0])?.id;
}

/** Components make matching sharper, but team-managed projects don't support them. */
async function ensureComponents(project, names) {
  const ok = new Set();
  try {
    const existing = await jira('app', route`/rest/api/3/project/${project.key}/components`, {}, 'components');
    for (const c of existing) ok.add(c.name);
    for (const name of names) {
      if (ok.has(name)) continue;
      await jira('app', route`/rest/api/3/component`, { method: 'POST', body: JSON.stringify({ name, project: project.key }) }, 'create component');
      ok.add(name);
    }
  } catch (e) {
    console.warn(`components unavailable on ${project.key}: ${e.message.slice(0, 120)}`);
  }
  return ok;
}

function fieldsWithComponents(base, names, available) {
  const comps = names.filter((n) => available.has(n));
  const leftover = names.filter((n) => !available.has(n));
  return {
    ...base,
    ...(comps.length ? { components: comps.map((name) => ({ name })) } : {}),
    labels: [...(base.labels || []), ...leftover],
  };
}

async function existingDemoIssues(label) {
  const issues = await searchIssues(`labels = "${label}"`, { fields: ['summary'], max: 100 }).catch(() => []);
  return new Map(issues.map((i) => [i.fields.summary, i.key]));
}

export async function runSeed({ incidentProjectKey, workProjectKey } = {}) {
  const total = INCIDENTS.length * 2 + DECISIONS.length + DEMO_CHANGES.length + 3;
  await progress({ status: 'running', done: 0, total, log: 'Starting demo history for Lumen Market…' });
  let done = 0;
  const step = async (log) => { done += 1; await progress({ done, log }); };

  try {
    const { incident, work } = await chooseProjects({ incidentProjectKey, workProjectKey });
    if (!work) throw new Error('No Jira project found. Create any Jira project (Scrum or Kanban) and run setup again.');

    // 1. Incidents in JSM (or a fallback project, labelled so we still find them).
    const incidentKeys = {};
    if (incident) {
      const incType = await issueTypeFor(incident.key, ['incident', 'problem', 'bug', 'task']);
      const incComponents = await ensureComponents(incident, [...new Set(INCIDENTS.flatMap((i) => i.components))]);
      const existing = await existingDemoIssues('precedent-demo-incident');
      for (const inc of INCIDENTS) {
        const summary = `${inc.ref}: ${inc.title}`;
        if (existing.has(summary)) { incidentKeys[inc.ref] = existing.get(summary); await step(`Incident exists: ${summary}`); continue; }
        const created = await createIssue(fieldsWithComponents({
          project: { key: incident.key },
          issuetype: { id: incType },
          summary,
          description: renderIncidentAdf(inc),
          labels: ['precedent-demo-incident', 'incident'],
        }, inc.components, incComponents)).catch(async (e) => {
          await progress({ log: `⚠️ Could not create incident ${inc.ref}: ${e.message.slice(0, 140)}` });
          return null;
        });
        if (created) incidentKeys[inc.ref] = created.key;
        await step(`Incident ${created?.key || '(skipped)'} — ${inc.title}`);
      }
      await setConfig({ incidentProjectKeys: [incident.key] });
    } else {
      done += INCIDENTS.length;
      await progress({ done, log: 'No Jira Service Management project found — postmortems will carry the incident history.' });
    }

    // 2. Confluence space + postmortems + decisions.
    await ensureSpace(SPACE_KEY, `${DEMO_COMPANY} Engineering`, 'Postmortems and architecture decisions (Precedent demo).');
    await step(`Confluence space ${SPACE_KEY} ready`);
    const pmParent = (await findPageByTitle(SPACE_KEY, 'Incident Postmortems'))
      || await createPage({ spaceKey: SPACE_KEY, title: 'Incident Postmortems', storage: '<p>Every SEV1–SEV3 incident gets a blameless postmortem here.</p>' });
    const adrParent = (await findPageByTitle(SPACE_KEY, 'Architecture Decision Records'))
      || await createPage({ spaceKey: SPACE_KEY, title: 'Architecture Decision Records', storage: '<p>Decisions we have made and why.</p>' });
    await step('Parent pages ready');

    for (const inc of INCIDENTS) {
      const title = `Postmortem: ${inc.ref} — ${inc.title}`;
      if (await findPageByTitle(SPACE_KEY, title)) { await step(`Postmortem exists: ${inc.ref}`); continue; }
      const page = await createPage({ spaceKey: SPACE_KEY, title, parentId: pmParent.id, storage: renderPostmortemStorage(inc, incidentKeys[inc.ref]) });
      await addPageLabels(page.id, ['postmortem', ...inc.tags.map((t) => t.toLowerCase())]);
      await step(`Postmortem written — ${inc.ref}`);
    }
    for (const adr of DECISIONS) {
      if (await findPageByTitle(SPACE_KEY, adr.title)) { await step(`Decision exists: ${adr.ref}`); continue; }
      const page = await createPage({ spaceKey: SPACE_KEY, title: adr.title, parentId: adrParent.id, storage: renderDecisionStorage(adr) });
      await addPageLabels(page.id, ['decision', 'adr', ...adr.tags]);
      await step(`Decision recorded — ${adr.ref}`);
    }

    // 3. Learn from everything we just wrote, BEFORE creating new work so auto-flag can fire.
    const summary = await syncAll();
    await step(`Learned ${summary.total} lessons (${summary.postmortems} postmortems, ${summary.decisions} decisions)`);

    // 4. Upcoming work that quietly repeats past mistakes.
    const taskType = await issueTypeFor(work.key, ['story', 'task']);
    const workComponents = await ensureComponents(work, [...new Set(DEMO_CHANGES.flatMap((c) => c.components))]);
    const existing = await existingDemoIssues('precedent-demo');
    const createdWork = [];
    for (const change of DEMO_CHANGES) {
      if (existing.has(change.summary)) { createdWork.push(existing.get(change.summary)); await step(`Work item exists: ${change.summary}`); continue; }
      const created = await createIssue(fieldsWithComponents({
        project: { key: work.key },
        issuetype: { id: taskType },
        summary: change.summary,
        description: adfPara(change.description),
        labels: ['precedent-demo'],
      }, change.components, workComponents));
      createdWork.push(created.key);
      await step(`Work item ${created.key} — ${change.summary}`);
    }

    const me = await myself('app').catch(() => null);
    await progress({
      status: 'done', done: total,
      result: { space: SPACE_KEY, incidentProject: incident?.key || null, workProject: work.key, workItems: createdWork, by: me?.displayName },
      log: `✅ Done. Open ${createdWork[0]} to see Precedent in action.`,
    });
  } catch (e) {
    console.error('seed failed', e);
    await progress({ status: 'error', error: e.message, log: `❌ ${e.message}` });
  }
}
