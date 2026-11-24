/**
 * Risk radar: the manager's view. Which open work, across the sprint or backlog,
 * repeats a past incident, and is it guarded yet?
 *
 * Auto-flag warns one issue at a time as it's created. The radar answers the
 * planning question: "what in our upcoming work could hurt us, and what's still
 * unprotected?"
 */
import { searchIssues } from '../atlassian.js';
import { matchChange, LEVELS } from '../engine/match.js';
import { getIndex, getIssueState, listLessons } from '../store.js';
import { issueToChange, presentMatch } from './precedent.js';
import { isIncidentIssue } from './ingest.js';

/** Decisions are usually born from an incident ("After INC-105, …"): find it. */
export function originIncident(decision, lessons) {
  const ref = String(decision?.summary || '').match(/\b(?:INC|PIR)-\d+\b/i)?.[0]?.toUpperCase();
  if (!ref) return null;
  const lesson = lessons.find((x) => x.sourceType !== 'decision' && (x.title || '').toUpperCase().includes(ref));
  return lesson ? { ref, lesson } : null;
}

const OPEN_WORK = 'statusCategory != Done AND issuetype not in subTaskIssueTypes() AND (labels is EMPTY OR labels not in (incident, precedent-demo-incident))';

/**
 * @param {object} opts
 * @param {string} [opts.projectKey]  limit to one project
 * @param {'sprint'|'open'} [opts.scope] 'open' = all open work; 'sprint' = active + future sprints (falls back to all open work)
 */
export async function riskRadar({ projectKey, scope = 'open', max = 100 } = {}) {
  const index = await getIndex();
  if (!index.N) return { scope, scanned: 0, items: [], atRisk: 0, unguarded: 0, minutesAtStake: 0, note: 'Precedent has not learned any incidents yet.' };

  const project = projectKey ? ` AND project = "${String(projectKey).replace(/"/g, '')}"` : '';
  let usedScope = scope;
  let issues;
  if (scope === 'sprint') {
    issues = await searchIssues(`${OPEN_WORK}${project} AND (sprint in openSprints() OR sprint in futureSprints()) ORDER BY rank`, { max }).catch(() => null);
    if (!issues?.length) usedScope = 'open'; // no sprints on this site/project: scan the open backlog instead
  }
  if (usedScope === 'open') issues = await searchIssues(`${OPEN_WORK}${project} ORDER BY updated DESC`, { max }).catch(() => []);
  issues = issues.filter((i) => !isIncidentIssue(i));

  const lessons = await listLessons();
  const items = [];
  await Promise.all(issues.map(async (issue) => {
    const state = await getIssueState(issue.key);
    const [top] = matchChange(index, issueToChange(issue), {
      // A manager's view must be trustworthy at a glance: strong matches only.
      limit: 1, minConfidence: LEVELS.high, excludeIds: [`jira:${issue.key}`, ...state.dismissed],
    });
    if (!top) return;
    const m = presentMatch(top);
    const origin = m.sourceType === 'decision' ? originIncident(top.lesson, lessons) : null;
    items.push({
      issueKey: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      precedent: origin ? `${m.title} (after ${origin.ref})` : m.title,
      precedentUrl: m.url,
      severity: m.severity || origin?.lesson.severity,
      minutes: m.durationMin || origin?.lesson.durationMin || 0,
      level: m.level,
      guarded: state.applied.length > 0,
      guardrailsAdded: state.applied.length,
      firstGuardrail: m.guardrails?.[0] || null,
    });
  }));

  const sevRank = (s) => ({ SEV1: 3, SEV2: 2, SEV3: 1 }[s] || 0);
  items.sort((a, b) => Number(a.guarded) - Number(b.guarded) || sevRank(b.severity) - sevRank(a.severity) || b.minutes - a.minutes);
  return {
    scope: usedScope,
    scanned: issues.length,
    items,
    atRisk: items.length,
    unguarded: items.filter((i) => !i.guarded).length,
    minutesAtStake: items.filter((i) => !i.guarded && ['SEV1', 'SEV2'].includes(i.severity)).reduce((s, i) => s + i.minutes, 0),
  };
}
