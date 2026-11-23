/**
 * Persistence (Forge KVS). Lessons are stored one per key so the corpus can grow
 * without hitting value-size limits; an in-memory cache avoids re-reading the
 * corpus on every panel render within a warm invocation.
 */
import { kvs, WhereConditions } from '@forge/kvs';
import { buildIndex } from './engine/match.js';
import { getPageProperty, setPageProperty } from './atlassian.js';

const LESSON_PREFIX = 'lesson:';
const CACHE_TTL_MS = 30_000;
let cache = { at: 0, lessons: null, index: null };

const lessonKey = (id) => `${LESSON_PREFIX}${id}`.replace(/[^a-zA-Z0-9:._#\s-]/g, '_');

export async function saveLesson(lesson) {
  await kvs.set(lessonKey(lesson.id), { ...lesson, indexedAt: new Date().toISOString() });
  invalidate();
}

export async function saveLessons(lessons) {
  const now = new Date().toISOString();
  for (let i = 0; i < lessons.length; i += 20) {
    const res = await kvs.batchSet(lessons.slice(i, i + 20).map((l) => ({ key: lessonKey(l.id), value: { ...l, indexedAt: now } })));
    if (res?.failedKeys?.length) console.warn('saveLessons failed keys', JSON.stringify(res.failedKeys));
  }
  invalidate();
}

export async function deleteLesson(id) {
  await kvs.delete(lessonKey(id));
  invalidate();
}

export async function listLessons() {
  if (cache.lessons && Date.now() - cache.at < CACHE_TTL_MS) return cache.lessons;
  const lessons = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(LESSON_PREFIX)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    lessons.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  cache = { at: Date.now(), lessons, index: null };
  return lessons;
}

export async function getIndex() {
  const lessons = await listLessons();
  if (!cache.index) cache.index = buildIndex(lessons);
  return cache.index;
}

export function invalidate() {
  cache = { at: 0, lessons: null, index: null };
}

export async function clearLessons() {
  invalidate();
  const lessons = await listLessons();
  for (let i = 0; i < lessons.length; i += 20) {
    await kvs.batchDelete(lessons.slice(i, i + 20).map((l) => ({ key: lessonKey(l.id) })));
  }
  invalidate();
  return lessons.length;
}

/* ---------- config ---------- */

const DEFAULT_CONFIG = {
  incidentProjectKeys: [],   // JSM projects whose resolved incidents become lessons
  postmortemLabels: ['postmortem', 'post-mortem', 'pir', 'incident-review'],
  decisionLabels: ['decision', 'adr', 'architecture-decision'],
  autoFlag: true,            // comment + label on high-confidence matches
  autoFlagMinLevel: 'high',
  autoDiscover: true,        // learn from unlabelled pages that look like postmortems/ADRs
  draftPostmortems: true,    // draft a structured postmortem when an incident is resolved
};

export async function getConfig() {
  return { ...DEFAULT_CONFIG, ...((await kvs.get('config')) || {}) };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await kvs.set('config', next);
  return next;
}

/* ---------- per-issue state ---------- */

export async function getIssueState(issueKey) {
  return (await kvs.get(`issue:${issueKey}`)) || { dismissed: [], applied: [], flagged: [] };
}

export async function updateIssueState(issueKey, fn) {
  const next = fn(await getIssueState(issueKey));
  await kvs.set(`issue:${issueKey}`, next);
  return next;
}

/* ---------- stats (for the admin dashboard + video) ---------- */

export async function bumpStat(name, by = 1) {
  const stats = (await kvs.get('stats')) || {};
  stats[name] = (stats[name] || 0) + by;
  await kvs.set('stats', stats);
}

export async function getStats() {
  return (await kvs.get('stats')) || {};
}

/* ---------- impact tracking: which lesson protected which change ---------- */

const hitKey = (lessonId) => `hits:${lessonId}`.replace(/[^a-zA-Z0-9:._#\s-]/g, '_');

/**
 * Record that a lesson caught (flagged) or guarded (guardrail added) a change.
 * kind: 'flagged' | 'guarded'. Idempotent per issue + kind.
 */
export async function recordHit(lessonId, issueKey, kind, extra = {}) {
  if (!lessonId || !issueKey) return;
  const hits = (await kvs.get(hitKey(lessonId))) || [];
  if (hits.some((h) => h.issueKey === issueKey && h.kind === kind)) return;
  hits.push({ issueKey, kind, at: new Date().toISOString(), ...extra });
  await kvs.set(hitKey(lessonId), hits.slice(-200));
  const index = (await kvs.get('hits:index')) || [];
  if (!index.includes(lessonId)) await kvs.set('hits:index', [...index, lessonId].slice(-1000));
  // The Confluence side of the app can't read this storage; publish onto the page itself.
  if (lessonId.startsWith('cf:')) {
    await setPageProperty(lessonId.slice(3), PAGE_IMPACT_KEY, summariseHits(hits))
      .catch((e) => console.warn(`publish impact to page ${lessonId}: ${e.message}`));
  }
}

export const PAGE_IMPACT_KEY = 'precedent-impact';

/** Compact, page-sized summary of what a lesson has protected. */
export function summariseHits(hits) {
  const flagged = [...new Map(hits.filter((h) => h.kind === 'flagged').map((h) => [h.issueKey, h])).values()];
  return {
    protected: flagged.slice(-20).map((h) => ({ issueKey: h.issueKey, summary: String(h.summary || '').slice(0, 140), at: h.at })),
    protectedCount: flagged.length,
    guardrailsAdopted: hits.filter((h) => h.kind === 'guarded').length,
    updatedAt: new Date().toISOString(),
  };
}

/** Re-publish every page lesson's impact onto its page (backfill / repair). */
export async function publishAllPageImpact() {
  const index = (await kvs.get('hits:index')) || [];
  for (const id of index.filter((x) => x.startsWith('cf:'))) {
    await setPageProperty(id.slice(3), PAGE_IMPACT_KEY, summariseHits(await getHits(id)))
      .catch((e) => console.warn(`publish impact to page ${id}: ${e.message}`));
  }
}

/** Hits for a page lesson as seen from either product: local storage, else the page property. */
export async function getPageImpact(lessonId) {
  const local = await getHits(lessonId);
  if (local.length || !lessonId.startsWith('cf:')) return summariseHits(local);
  const prop = await getPageProperty(lessonId.slice(3), PAGE_IMPACT_KEY).catch(() => null);
  return prop?.value || summariseHits([]);
}

export async function getHits(lessonId) {
  return (await kvs.get(hitKey(lessonId))) || [];
}

export async function getAllHits() {
  const index = (await kvs.get('hits:index')) || [];
  const out = {};
  for (const id of index) out[id] = await getHits(id);
  return out;
}
