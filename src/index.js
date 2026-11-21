/**
 * Precedent — Forge entry points.
 */
import Resolver from '@forge/resolver';
import { Queue } from '@forge/events';
import { checkIssue, applyGuardrail, dismiss, autoFlag } from './services/precedent.js';
import { syncAll, getLastSync, ingestPage, ingestIncident, isIncidentIssue } from './services/ingest.js';
import { runSeed, getSeedProgress, resetSeedProgress } from './services/seed.js';
import { getConfig, setConfig, getStats, listLessons, clearLessons } from './store.js';
import { listProjects, getIssue } from './atlassian.js';

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

resolver.define('dismiss', async ({ payload, context }) => {
  await dismiss(context.extension.issue.key, payload.lessonId, context.accountId);
  return { ok: true };
});

/* ---------------- Admin page ---------------- */

resolver.define('getAdminState', async () => {
  const [config, lastSync, seed, stats, lessons, projects] = await Promise.all([
    getConfig(), getLastSync(), getSeedProgress(), getStats(), listLessons(), listProjects().catch(() => []),
  ]);
  return {
    config, lastSync, seed, stats, projects,
    lessons: lessons
      .map((l) => ({ id: l.id, title: l.title, sourceType: l.sourceType, url: l.url, quality: l.quality, date: l.date, severity: l.severity, guardrails: (l.guardrails || []).length }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  };
});

resolver.define('startSeed', async ({ payload, context }) => {
  await resetSeedProgress(context.accountId);
  await jobs.push({ body: { type: 'seed', incidentProjectKey: payload?.incidentProjectKey, workProjectKey: payload?.workProjectKey } });
  return { ok: true };
});

resolver.define('getSeedProgress', async () => getSeedProgress());

resolver.define('syncNow', async () => syncAll());

resolver.define('saveConfig', async ({ payload }) => setConfig(payload));

resolver.define('clearLessons', async () => ({ removed: await clearLessons() }));

export const handler = resolver.getDefinitions();

/* ---------------- Async jobs ---------------- */

export async function jobConsumer(event) {
  const body = event.body || event.payload || {};
  if (body.type === 'seed') return runSeed(body);
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
      if (resolved) await ingestIncident(key);
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
