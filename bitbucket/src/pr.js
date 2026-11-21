/**
 * Pull request analysis: what is this PR changing, and has that hurt us before?
 */
import api, { route } from '@forge/api';
import { buildIndex, matchChange, LEVELS } from './engine/match.js';
import { loadLessons } from './confluence.js';

/** "Precedent-Ack: INC-105" in the PR description acknowledges a precedent. */
const ACK = /precedent[-\s]?ack(?:nowledged)?\s*[:=]\s*([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)/gi;

async function bb(path) {
  const res = await api.asApp().requestBitbucket(path, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bitbucket ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Changed file paths say a lot about intent: services/catalog-service/config/cache.yaml. */
export function pathsToText(paths) {
  return paths
    .map((p) => p.replace(/\.[a-z0-9]+$/i, '').split(/[/_.]+/).join(' '))
    .join('. ');
}

/** Component guesses from paths, e.g. "services/catalog-service/..." -> "catalog-service". */
export function componentsFromPaths(paths) {
  const comps = new Set();
  for (const p of paths) {
    for (const seg of p.split('/')) if (/^[a-z0-9]+(-[a-z0-9]+)+$/i.test(seg)) comps.add(seg.toLowerCase());
  }
  return [...comps];
}

export async function getPullRequest(workspaceUuid, repoUuid, prId) {
  const pr = await bb(route`/2.0/repositories/${workspaceUuid}/${repoUuid}/pullrequests/${prId}`);
  let paths = [];
  try {
    const diff = await bb(route`/2.0/repositories/${workspaceUuid}/${repoUuid}/pullrequests/${prId}/diffstat?pagelen=100`);
    paths = (diff.values || []).map((v) => v.new?.path || v.old?.path).filter(Boolean);
  } catch (e) {
    console.warn('diffstat unavailable', e.message);
  }
  return {
    id: pr.id,
    title: pr.title || '',
    description: pr.description || pr.summary?.raw || '',
    branch: pr.source?.branch?.name || '',
    paths,
  };
}

export function acknowledgedRefs(description) {
  const refs = new Set();
  for (const m of String(description || '').matchAll(ACK)) {
    for (const r of m[1].split(',')) refs.add(r.trim().toUpperCase());
  }
  return refs;
}

const refOf = (title) => (String(title || '').match(/\b(?:INC|ADR|PIR)-\d+\b/i) || [])[0]?.toUpperCase() || null;

/** Check a PR. Returns matches plus which ones are still unacknowledged. */
export async function checkPullRequest(workspaceUuid, repoUuid, prId) {
  const [pr, { lessons, meta }] = await Promise.all([getPullRequest(workspaceUuid, repoUuid, prId), loadLessons()]);
  if (!lessons.length) return { pr, matches: [], unacknowledged: [], lessonCount: 0, syncedAt: meta?.at };
  const index = buildIndex(lessons);
  const branchText = pr.branch.replace(/[/_-]+/g, ' ');
  const change = {
    text: `${pr.title}. ${pr.title}. ${branchText}. ${pr.description}. ${pathsToText(pr.paths)}`,
    components: componentsFromPaths(pr.paths),
  };
  const acks = acknowledgedRefs(pr.description);
  const matches = matchChange(index, change, { limit: 3, minConfidence: LEVELS.medium }).map((m) => ({
    id: m.lesson.id,
    ref: refOf(m.lesson.title),
    title: m.lesson.title,
    url: m.lesson.url,
    sourceType: m.lesson.sourceType,
    date: m.lesson.date,
    severity: m.lesson.severity,
    durationMin: m.lesson.durationMin,
    rootCause: m.lesson.rootCause,
    summary: m.lesson.summary,
    guardrails: m.lesson.guardrails || [],
    level: m.level,
    confidence: m.confidence,
    matchedTerms: [...m.componentHits, ...m.matchedTerms].slice(0, 6),
    acknowledged: Boolean(refOf(m.lesson.title) && acks.has(refOf(m.lesson.title))),
  }));
  return {
    pr,
    matches,
    unacknowledged: matches.filter((m) => m.level === 'high' && !m.acknowledged),
    lessonCount: lessons.length,
    syncedAt: meta?.at,
  };
}
