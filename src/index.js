/**
 * Precedent — Forge entry points.
 */
import ResolverModule from '@forge/resolver';
import { Queue } from '@forge/events';
import { checkIssue, applyGuardrail, dismiss, autoFlag, peopleForLesson } from './services/precedent.js';
import { syncAll, getLastSync, ingestPage, ingestIncident, isIncidentIssue } from './services/ingest.js';
import { draftPostmortem } from './services/draft.js';
import { startSeedJob, runSeedSlice, getSeedProgress, failSeed } from './services/seed.js';
import { getConfig, setConfig, getStats, listLessons, clearLessons } from './store.js';
import { listProjects, getIssue } from './atlassian.js';
import { probeGraph } from './services/graph.js';
import { coachPage, bylineTitle, computeImpact } from './services/coach.js';

// @forge/resolver is CommonJS; under "type": "module" the default import is the
// namespace object, so unwrap it to get the class.
const Resolver = ResolverModule.default ?? ResolverModule;
const jobs = new Queue({ key: 'precedent-jobs' });
const resolver = new Resolver();

/* ---------------- Issue panel ---------------- */

resolver.define('getPrecedents', async ({ context }) => {
  const issueKey = context.extension.issue.key;
  return checkIssue(issueKey, { as: 'user' });
});

resolver.define('applyGuardrail', async ({ payload, context }) => {
  return applyGuardrail(context.extension.issue.key, payload.lessonId, payload.guardrail);
});

resolver.define('getPeople', async ({ payload, context }) => {
  try {
    return await peopleForLesson(payload.lessonId, context.cloudId);
  } catch (e) {
    if (e?.name === 'NeedsAuthenticationError') throw e; // Forge shows the consent prompt
    console.error('getPeople failed', e);
    return { people: [], relatedPages: [], error: e.message };
  }
});

resolver.define('dismiss', async ({ payload, context }) => {
  await dismiss(context.extension.issue.key, payload.lessonId, context.accountId);
  return { ok: true };
});

/* ---------------- Admin page ---------------- */

resolver.define('getAdminState', async () => {
  const projects = await listProjects('app').catch(() => []);
  const [config, lastSync, seed, stats, lessons] = await Promise.all([
    getConfig(), getLastSync(), getSeedProgress(), getStats(), listLessons(),
  ]);
  return {
    config, lastSync, seed, stats, projects,
    lessons: lessons
      .map((l) => ({ id: l.id, title: l.title, sourceType: l.sourceType, url: l.url, quality: l.quality, date: l.date, severity: l.severity, guardrails: (l.guardrails || []).length }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  };
});

resolver.define('startSeed', async ({ payload, context }) => {
  // Fast path only: everything slow happens in short queued slices.
  try {
    await startSeedJob(jobs, { accountId: context.accountId, incidentProjectKey: payload?.incidentProjectKey, workProjectKey: payload?.workProjectKey });
    return { ok: true };
  } catch (e) {
    console.error('startSeed failed', e);
    await failSeed(e.message);
    return { ok: false, error: e.message };
  }
});

resolver.define('getSeedProgress', async () => getSeedProgress());

resolver.define('syncNow', async () => syncAll());

resolver.define('getImpact', async () => computeImpact());

/* ---------------- Confluence: Postmortem Quality Coach ---------------- */

resolver.define('coachPage', async ({ context }) => {
  const pageId = context.extension?.content?.id;
  if (!pageId) return { error: 'Open this from a Confluence page.' };
  return coachPage(pageId);
});

resolver.define('probeGraph', async () => {
  try {
    const summary = await probeGraph();
    return { ok: true, found: summary.found.map((f) => f.name), missing: summary.missing, fields: summary.totalQueryFields };
  } catch (e) {
    if (e?.name === 'NeedsAuthenticationError') throw e; // let Forge show the consent prompt
    console.error('probeGraph failed', e);
    return { ok: false, error: e.message };
  }
});

resolver.define('saveConfig', async ({ payload }) => setConfig(payload));

resolver.define('clearLessons', async () => ({ removed: await clearLessons() }));

export const handler = resolver.getDefinitions();

/** Byline title shows the page's score at a glance, e.g. "Precedent · 85% actionable · protected 3". */
export async function bylineProps(payload) {
  const pageId = payload?.extension?.content?.id || payload?.context?.extension?.content?.id || payload?.contentId;
  if (!pageId) console.log('bylineProps payload keys', Object.keys(payload || {}));
  return { title: pageId ? await bylineTitle(pageId) : 'Precedent', tooltip: 'How actionable this postmortem is, and the changes it has protected' };
}

/* ---------------- Async jobs ---------------- */

export async function jobConsumer(event) {
  const body = event.body || event.payload || {};
  if (body.type === 'seed-step') return runSeedSlice(jobs);
  if (body.type === 'sync') return syncAll();
  console.warn('unknown job', JSON.stringify(body));
}

/* ---------------- Learning loop + auto-flag triggers ---------------- */

export async function onIssueEvent(event) {
  const key = event.issue?.key;
  if (!key) return;
  // Avoid loops: ignore our own label/comment edits.
  const changed = (event.changelog?.items || []).map((i) => i.field);
  if (event.eventType === 'avi:jira:updated:issue' && changed.length && changed.every((f) => ['labels', 'Comment'].includes(f))) return;

  try {
    const issue = await getIssue(key);
    if (isIncidentIssue(issue)) {
      const resolved = issue.fields.status?.statusCategory?.key === 'done' || Boolean(issue.fields.resolutiondate);
      if (resolved) {
        await ingestIncident(key);
        await draftPostmortem(key).catch((e) => console.error(`draftPostmortem ${key}`, e.message));
      }
      return;
    }
    const relevantUpdate = event.eventType === 'avi:jira:created:issue'
      || changed.some((f) => ['summary', 'description', 'Component', 'components'].includes(f));
    if (relevantUpdate) await autoFlag(key);
  } catch (e) {
    console.error(`onIssueEvent ${key}`, e.message);
  }
}

export async function onPageEvent(event) {
  const id = event.content?.id || event.page?.id;
  if (!id) return;
  try {
    await ingestPage(id);
  } catch (e) {
    console.error(`onPageEvent ${id}`, e.message);
  }
}

export async function scheduledSync() {
  await jobs.push({ body: { type: 'sync' } });
}

/* ---------------- Rovo agent actions ---------------- */

export {
  searchPrecedents as rovoSearch,
  checkIssueAction as rovoCheckIssue,
  getLesson as rovoGetLesson,
  riskHotspots as rovoHotspots,
  addGuardrail as rovoAddGuardrail,
  whoKnows as rovoWhoKnows,
} from './rovo.js';
