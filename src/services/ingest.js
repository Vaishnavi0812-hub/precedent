/**
 * Ingestion: discover postmortems, decision records and resolved incidents,
 * turn them into lessons, and keep the store in sync.
 */
import { searchPages, getPage, searchIssues, getIssue, jiraBaseUrl, confluenceBaseUrl } from '../atlassian.js';
import { lessonFromConfluencePage, lessonFromIncidentIssue } from '../engine/extract.js';
import { saveLessons, saveLesson, listLessons, deleteLesson, getConfig, bumpStat } from '../store.js';
import { kvs } from '@forge/kvs';

const cqlList = (labels) => labels.map((l) => `"${l.replace(/"/g, '')}"`).join(',');

/**
 * @param extraPageIds pages known to be relevant (e.g. just created) that the
 *   search index may not have caught up with yet. Fetched directly by id.
 */
export async function fetchConfluenceLessons(config, extraPageIds = []) {
  const labels = [...config.postmortemLabels, ...config.decisionLabels];
  const { pages, base } = await searchPages(`type=page AND label in (${cqlList(labels)})`);
  const seen = new Set(pages.map((p) => String(p.id)));
  const missing = extraPageIds.map(String).filter((id) => !seen.has(id));
  for (let i = 0; i < missing.length; i += 6) {
    const batch = await Promise.all(missing.slice(i, i + 6).map((id) => getPage(id).catch(() => null)));
    pages.push(...batch.filter(Boolean));
  }
  return pages.map((p) => lessonFromConfluencePage(p, base));
}

export async function fetchIncidentLessons(config) {
  const projectClause = config.incidentProjectKeys?.length
    ? `project in (${config.incidentProjectKeys.map((k) => `"${k}"`).join(',')})`
    : 'projectType = service_desk';
  const jql = `${projectClause} AND (issuetype = Incident OR labels in (incident, precedent-demo-incident)) ORDER BY created DESC`;
  let issues = [];
  try {
    issues = await searchIssues(jql, { max: 300 });
  } catch (e) {
    // Sites without JSM / without an "Incident" type: fall back to label-only search.
    issues = await searchIssues('labels in (incident, precedent-demo-incident) ORDER BY created DESC', { max: 300 }).catch(() => []);
  }
  const base = await jiraBaseUrl();
  return issues.map((i) => lessonFromIncidentIssue(i, base));
}

/**
 * Postmortems usually reference their incident. When both exist, keep the richer
 * postmortem lesson and link the incident to it instead of storing a duplicate.
 */
export function mergeLessons(pageLessons, incidentLessons) {
  // Postmortems usually reference their incident by Jira key, and/or share a
  // human reference like "INC-101" in the title. Either link merges the two.
  const refs = (l) => new Set((l.title || '').match(/\b(?:INC|PIR)-\d+\b/gi)?.map((r) => r.toUpperCase()) || []);
  const byKey = new Map();
  const byRef = new Map();
  for (const l of pageLessons) {
    if (l.incidentKey) byKey.set(l.incidentKey, l);
    if (l.sourceType === 'postmortem') for (const r of refs(l)) byRef.set(r, l);
  }
  const merged = [...pageLessons];
  for (const inc of incidentLessons) {
    const pm = byKey.get(inc.sourceKey) || [...refs(inc)].map((r) => byRef.get(r)).find(Boolean);
    if (pm) {
      pm.incidentUrl = pm.incidentUrl || inc.url;
      pm.incidentKey = pm.incidentKey || inc.sourceKey;
      pm.components = [...new Set([...(pm.components || []), ...(inc.components || [])])];
      pm.severity = pm.severity || inc.severity;
    } else {
      merged.push(inc);
    }
  }
  return merged;
}

/** Full resync. Returns a summary for the admin page. */
export async function syncAll({ extraPageIds = [] } = {}) {
  const started = Date.now();
  const config = await getConfig();
  let confluenceOk = true;
  let jiraOk = true;
  const [pageLessons, incidentLessons] = await Promise.all([
    fetchConfluenceLessons(config, extraPageIds).catch((e) => { confluenceOk = false; console.error('confluence sync', e); return []; }),
    fetchIncidentLessons(config).catch((e) => { jiraOk = false; console.error('incident sync', e); return []; }),
  ]);
  const lessons = mergeLessons(pageLessons, incidentLessons);
  const existing = await listLessons();
  const keep = new Set(lessons.map((l) => l.id));
  // Only forget lessons whose source we actually read successfully: a failed
  // search must never wipe the team's memory.
  const sourceOk = (id) => (id.startsWith('cf:') ? confluenceOk : jiraOk);
  for (const old of existing) if (!keep.has(old.id) && sourceOk(old.id)) await deleteLesson(old.id);
  await saveLessons(lessons);
  const summary = {
    at: new Date().toISOString(),
    tookMs: Date.now() - started,
    total: lessons.length,
    postmortems: lessons.filter((l) => l.sourceType === 'postmortem').length,
    decisions: lessons.filter((l) => l.sourceType === 'decision').length,
    incidents: lessons.filter((l) => l.sourceType === 'incident').length,
    avgQuality: lessons.length ? Number((lessons.reduce((s, l) => s + (l.quality || 0), 0) / lessons.length).toFixed(2)) : 0,
  };
  await kvs.set('lastSync', summary);
  return summary;
}

export async function getLastSync() {
  return kvs.get('lastSync');
}

/** Learning loop: a single page was created/updated. */
export async function ingestPage(pageId) {
  const config = await getConfig();
  const page = await getPage(pageId);
  const labels = page.labels.map((l) => l.name.toLowerCase());
  const relevant = [...config.postmortemLabels, ...config.decisionLabels].some((l) => labels.includes(l));
  if (!relevant) return null;
  const lesson = lessonFromConfluencePage(page, await confluenceBaseUrl());
  await saveLesson(lesson);
  await bumpStat('lessonsLearned');
  return lesson;
}

/** Learning loop: an incident was resolved. */
export async function ingestIncident(issueKey) {
  const issue = await getIssue(issueKey);
  const lesson = lessonFromIncidentIssue(issue, await jiraBaseUrl());
  const existing = await listLessons();
  if (existing.some((l) => l.incidentKey === issueKey)) return null; // already covered by a postmortem
  await saveLesson(lesson);
  await bumpStat('lessonsLearned');
  return lesson;
}

export function isIncidentIssue(issue) {
  const f = issue?.fields || {};
  return f.project?.projectTypeKey === 'service_desk'
    || /incident/i.test(f.issuetype?.name || '')
    || (f.labels || []).some((l) => /^(incident|precedent-demo-incident)$/i.test(l));
}
