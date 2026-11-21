/**
 * One-click demo history. Creates a realistic incident history for a fictional
 * company so Precedent is useful the moment a judge installs it on an empty site.
 *
 * Runs as a chain of short async-queue invocations (each well under Forge's time
 * limits) and reports progress to KVS, which the admin page polls.
 */
import { kvs } from '@forge/kvs';
import { route } from '@forge/api';
import {
  ensureSpace, findPageByTitle, createPage, addPageLabels,
  listProjects, createProject, createIssue, searchIssues, jira, confluence,
} from '../atlassian.js';
import {
  DEMO_COMPANY, INCIDENTS, DECISIONS, DEMO_CHANGES,
  renderPostmortemStorage, renderDecisionStorage, renderIncidentAdf,
} from '../data/demo-history.js';
import { syncAll } from './ingest.js';
import { setConfig } from '../store.js';

export const SPACE_KEY = 'LUMEN';
const PROGRESS_KEY = 'seed:progress';
const STATE_KEY = 'seed:state';
const BUDGET_MS = 15_000;
const STALE_MS = 3 * 60 * 1000;

/* ---------------- progress ---------------- */

async function progress(patch) {
  const cur = (await kvs.get(PROGRESS_KEY)) || {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  next.log = patch.log ? [...(cur.log || []), patch.log].slice(-40) : cur.log || [];
  await kvs.set(PROGRESS_KEY, next);
}

/** Progress, with stalled jobs (no update for 3 min) reported as errors so the UI never hangs. */
export async function getSeedProgress() {
  const p = await kvs.get(PROGRESS_KEY);
  if (p && ['queued', 'running'].includes(p.status) && Date.now() - new Date(p.updatedAt).getTime() > STALE_MS) {
    const stalled = { ...p, status: 'error', error: 'The previous setup stopped responding. Click "Load demo history" to try again.' };
    await kvs.set(PROGRESS_KEY, stalled);
    return stalled;
  }
  return p;
}

export const failSeed = (error, notes = []) =>
  kvs.set(PROGRESS_KEY, { status: 'error', error, done: 0, total: 0, log: [...notes, `❌ ${error}`], updatedAt: new Date().toISOString() });

/* ---------------- projects ---------------- */

const WORK_PROJECT_OPTIONS = [
  { key: 'LUMEN', name: 'Lumen Checkout', type: 'software', template: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic' },
  { key: 'LUMEN', name: 'Lumen Checkout', type: 'software', template: 'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic' },
  { key: 'LUMEN', name: 'Lumen Checkout', type: 'business', template: 'com.atlassian.jira-core-project-templates:jira-core-simplified-task-tracking' },
];
const OPS_PROJECT_OPTIONS = [
  { key: 'LOPS', name: 'Lumen Ops Incidents', type: 'service_desk', template: 'com.atlassian.servicedesk:itil-v2-service-desk-project' },
  { key: 'LOPS', name: 'Lumen Ops Incidents', type: 'service_desk', template: 'com.atlassian.servicedesk:simplified-it-service-management' },
];

/** Try each template as the app. Returns { key, created } or { error }. */
async function tryCreate(options, accountId) {
  const errors = [];
  for (const opt of options) {
    try {
      await createProject({ ...opt, leadAccountId: accountId, description: 'Created by Precedent for the demo.' }, 'app');
      return { key: opt.key, created: opt };
    } catch (e) {
      if (/already|exists|in use/i.test(e.message)) return { key: opt.key };
      errors.push(`${opt.template.split(':').pop()}: ${e.message.slice(0, 200)}`);
    }
  }
  console.warn('project creation failed:', JSON.stringify(errors));
  return { error: errors.join(' | ') };
}

/** Reuse existing projects; create demo projects if missing (fresh sites often have none). */
export async function ensureDemoProjects({ accountId, incidentProjectKey, workProjectKey }) {
  const notes = [];
  const projects = await listProjects('app').catch(() => []);
  const has = (k) => projects.some((p) => p.key === k);

  let work = workProjectKey || (has('LUMEN') ? 'LUMEN' : null);
  let workError;
  if (!work) {
    const r = await tryCreate(WORK_PROJECT_OPTIONS, accountId);
    if (r.key) { work = r.key; if (r.created) notes.push(`Created Jira project ${r.created.name} (${r.key}).`); }
    workError = r.error;
  }
  if (!work) work = projects.find((p) => p.type !== 'service_desk')?.key || null;

  let incident = incidentProjectKey || (has('LOPS') ? 'LOPS' : null);
  if (!incident) {
    const r = await tryCreate(OPS_PROJECT_OPTIONS, accountId);
    if (r.key) { incident = r.key; if (r.created) notes.push(`Created service project ${r.created.name} (${r.key}).`); }
  }
  if (!incident) incident = projects.find((p) => p.type === 'service_desk')?.key || null;
  if (!incident) notes.push('No service project available; incidents will live in the work project.');

  console.log('ensureDemoProjects ->', JSON.stringify({ work, incident, notes, workError }));
  return { incidentProjectKey: incident, workProjectKey: work, notes, workError };
}

/* ---------------- helpers ---------------- */

async function anyExistingSpaceKey() {
  const spaces = await confluence('app', route`/wiki/api/v2/spaces?type=global&limit=5`, {}, 'list spaces').catch(() => ({ results: [] }));
  return spaces.results?.[0]?.key || null;
}

const adfPara = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function issueTypeFor(projectKey, preferred) {
  const res = await jira('app', route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, {}, 'issue types');
  const types = (res.issueTypes || res.values || []).filter((t) => !t.subtask);
  return (preferred.map((n) => types.find((t) => t.name.toLowerCase() === n)).find(Boolean) || types[0])?.id;
}

/** Components make matching sharper, but team-managed projects don't support them. */
async function ensureComponents(projectKey, names) {
  const ok = new Set();
  try {
    const existing = await jira('app', route`/rest/api/3/project/${projectKey}/components`, {}, 'components');
    for (const c of existing) ok.add(c.name);
    for (const name of names) {
      if (ok.has(name)) continue;
      await jira('app', route`/rest/api/3/component`, { method: 'POST', body: JSON.stringify({ name, project: projectKey }) }, 'create component');
      ok.add(name);
    }
  } catch (e) {
    console.warn(`components unavailable on ${projectKey}: ${e.message.slice(0, 120)}`);
  }
  return [...ok];
}

function fieldsWithComponents(base, names, available) {
  const avail = new Set(available || []);
  const comps = names.filter((n) => avail.has(n));
  const leftover = names.filter((n) => !avail.has(n));
  return {
    ...base,
    ...(comps.length ? { components: comps.map((name) => ({ name })) } : {}),
    labels: [...(base.labels || []), ...leftover],
  };
}

async function existingDemoIssues(label) {
  const issues = await searchIssues(`labels = "${label}"`, { fields: ['summary'], max: 100 }).catch(() => []);
  return Object.fromEntries(issues.map((i) => [i.fields.summary, i.key]));
}

/* ------------------------------------------------------------------------- *
 * Resumable seeding: a fixed list of small idempotent tasks. Each queue
 * invocation runs tasks for ~15s, saves its cursor, and re-queues itself.
 * ------------------------------------------------------------------------- */

export function seedTasks() {
  return [
    { id: 'projects' },
    { id: 'incident-setup' },
    ...INCIDENTS.map((inc) => ({ id: 'incident', ref: inc.ref })),
    { id: 'space' },
    ...INCIDENTS.map((inc) => ({ id: 'postmortem', ref: inc.ref })),
    ...DECISIONS.map((d) => ({ id: 'decision', ref: d.ref })),
    { id: 'learn' },
    { id: 'work-setup' },
    ...DEMO_CHANGES.map((_, i) => ({ id: 'work', index: i })),
    { id: 'finish' },
  ];
}

export async function startSeedJob(queue, { accountId, incidentProjectKey, workProjectKey }) {
  const tasks = seedTasks();
  await kvs.set(STATE_KEY, { cursor: 0, accountId, incidentProjectKey, workProjectKey, incidentKeys: {}, createdWork: [] });
  await kvs.set(PROGRESS_KEY, {
    status: 'running', done: 0, total: tasks.length, log: ['Starting demo history for Lumen Market…'],
    startedBy: accountId, updatedAt: new Date().toISOString(),
  });
  await queue.push({ body: { type: 'seed-step' } });
}

/** One queue invocation: run tasks until the time budget is used, then re-queue. */
export async function runSeedSlice(queue) {
  const started = Date.now();
  const tasks = seedTasks();
  const state = await kvs.get(STATE_KEY);
  if (!state || state.cursor >= tasks.length) return;
  try {
    while (state.cursor < tasks.length && Date.now() - started < BUDGET_MS) {
      const log = await runTask(tasks[state.cursor], state);
      if (state.failed) { await kvs.set(STATE_KEY, state); return; }
      state.cursor += 1;
      await kvs.set(STATE_KEY, state);
      if (tasks[state.cursor - 1].id !== 'finish') await progress({ done: state.cursor, total: tasks.length, ...(log ? { log } : {}) });
    }
    if (state.cursor < tasks.length) await queue.push({ body: { type: 'seed-step' } });
  } catch (e) {
    console.error('seed task failed', JSON.stringify(tasks[state.cursor]), e);
    await progress({ status: 'error', error: String(e.message).slice(0, 400), log: `❌ ${String(e.message).slice(0, 300)}` });
  }
}

async function runTask(task, state) {
  switch (task.id) {
    case 'projects': {
      const r = await ensureDemoProjects(state);
      state.workProjectKey = r.workProjectKey;
      state.incidentProjectKey = r.incidentProjectKey || r.workProjectKey;
      if (!state.workProjectKey) {
        state.failed = true;
        const error = 'Precedent could not create a Jira project on this site. Create any Jira space (for example a Kanban space) from the Jira sidebar, then click "Load demo history" again.';
        await progress({ status: 'error', error, log: `❌ ${error}` });
        return null;
      }
      return r.notes.join(' ') || `Using projects ${state.workProjectKey} and ${state.incidentProjectKey}.`;
    }
    case 'incident-setup': {
      const key = state.incidentProjectKey;
      state.incidentType = await issueTypeFor(key, ['incident', 'problem', 'bug', 'task']);
      state.incidentComponents = await ensureComponents(key, [...new Set(INCIDENTS.flatMap((i) => i.components))]);
      state.existingIncidents = await existingDemoIssues('precedent-demo-incident');
      await setConfig({ incidentProjectKeys: [key] });
      return `Incident project ${key} ready`;
    }
    case 'incident': {
      const inc = INCIDENTS.find((i) => i.ref === task.ref);
      const summary = `${inc.ref}: ${inc.title}`;
      if (state.existingIncidents?.[summary]) { state.incidentKeys[inc.ref] = state.existingIncidents[summary]; return null; }
      const created = await createIssue(fieldsWithComponents({
        project: { key: state.incidentProjectKey },
        issuetype: { id: state.incidentType },
        summary,
        description: renderIncidentAdf(inc),
        labels: ['precedent-demo-incident', 'incident'],
      }, inc.components, state.incidentComponents)).catch((e) => {
        console.warn(`incident ${inc.ref} failed: ${e.message}`);
        return null;
      });
      if (created) state.incidentKeys[inc.ref] = created.key;
      return created ? `Incident ${created.key}: ${inc.title}` : `Skipped incident ${inc.ref}`;
    }
    case 'space': {
      let note = '';
      try {
        await ensureSpace(SPACE_KEY, `${DEMO_COMPANY} Engineering`, 'Postmortems and architecture decisions (Precedent demo).');
        state.spaceKey = SPACE_KEY;
      } catch (e) {
        // App may lack "create space" permission: fall back to any existing space.
        console.warn('create space failed, falling back:', e.message);
        state.spaceKey = await anyExistingSpaceKey();
        if (!state.spaceKey) throw new Error(`Could not create or find a Confluence space: ${e.message.slice(0, 200)}`);
        note = ` (using existing space ${state.spaceKey})`;
      }
      const sk = state.spaceKey;
      state.pmParentId = ((await findPageByTitle(sk, 'Incident Postmortems'))
        || await createPage({ spaceKey: sk, title: 'Incident Postmortems', storage: '<p>Every SEV1–SEV3 incident gets a blameless postmortem here.</p>' })).id;
      state.adrParentId = ((await findPageByTitle(sk, 'Architecture Decision Records'))
        || await createPage({ spaceKey: sk, title: 'Architecture Decision Records', storage: '<p>Decisions we have made and why.</p>' })).id;
      return `Confluence space ready${note}`;
    }
    case 'postmortem': {
      const inc = INCIDENTS.find((i) => i.ref === task.ref);
      const title = `Postmortem: ${inc.ref} — ${inc.title}`;
      if (await findPageByTitle(state.spaceKey, title)) return null;
      const page = await createPage({ spaceKey: state.spaceKey, title, parentId: state.pmParentId, storage: renderPostmortemStorage(inc, state.incidentKeys[inc.ref]) });
      await addPageLabels(page.id, ['postmortem', ...inc.tags.map((t) => t.toLowerCase())]);
      return `Postmortem written: ${inc.ref}`;
    }
    case 'decision': {
      const adr = DECISIONS.find((d) => d.ref === task.ref);
      if (await findPageByTitle(state.spaceKey, adr.title)) return null;
      const page = await createPage({ spaceKey: state.spaceKey, title: adr.title, parentId: state.adrParentId, storage: renderDecisionStorage(adr) });
      await addPageLabels(page.id, ['decision', 'adr', ...adr.tags]);
      return `Decision recorded: ${adr.ref}`;
    }
    case 'learn': {
      const summary = await syncAll();
      return `Learned ${summary.total} lessons (${summary.postmortems} postmortems, ${summary.decisions} decisions, ${summary.incidents} incidents)`;
    }
    case 'work-setup': {
      const key = state.workProjectKey;
      state.workType = await issueTypeFor(key, ['story', 'task']);
      state.workComponents = await ensureComponents(key, [...new Set(DEMO_CHANGES.flatMap((c) => c.components))]);
      state.existingWork = await existingDemoIssues('precedent-demo');
      return `Work project ${key} ready`;
    }
    case 'work': {
      const change = DEMO_CHANGES[task.index];
      if (state.existingWork?.[change.summary]) { state.createdWork.push(state.existingWork[change.summary]); return null; }
      const created = await createIssue(fieldsWithComponents({
        project: { key: state.workProjectKey },
        issuetype: { id: state.workType },
        summary: change.summary,
        description: adfPara(change.description),
        labels: ['precedent-demo'],
      }, change.components, state.workComponents));
      state.createdWork.push(created.key);
      return `Work item ${created.key}: ${change.summary}`;
    }
    case 'finish': {
      await progress({
        status: 'done',
        done: seedTasks().length,
        result: { space: state.spaceKey, incidentProject: state.incidentProjectKey, workProject: state.workProjectKey, workItems: state.createdWork },
        log: `✅ Done. Open ${state.createdWork[0]} to see Precedent in action.`,
      });
      return null;
    }
    default:
      return null;
  }
}
