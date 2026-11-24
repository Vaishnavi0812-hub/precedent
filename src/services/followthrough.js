/**
 * Guardrail follow-through. Adding a guardrail is a promise; this checks it was kept.
 *
 * - A Precedent guardrail sub-task is completed → recorded as "completed".
 * - The parent work is marked done while guardrails are still open → one comment
 *   on the issue naming them and the incident they came from, recorded as "skipped".
 */
import { searchIssues, addComment, jiraBaseUrl } from '../atlassian.js';
import { getIssueState, updateIssueState, recordHit, listLessons, bumpStat } from '../store.js';

const isDone = (issue) => issue.fields.status?.statusCategory?.key === 'done';
const isGuardrail = (issue) => Boolean(issue.fields.issuetype?.subtask) && (issue.fields.labels || []).includes('precedent-guardrail');

/** Called when an issue's status changes. */
export async function onStatusChange(issue) {
  if (!isDone(issue)) return null;
  if (isGuardrail(issue)) return guardrailCompleted(issue);
  if (issue.fields.issuetype?.subtask) return null;
  return parentDone(issue);
}

async function guardrailCompleted(subtask) {
  const parentKey = subtask.fields.parent?.key;
  if (!parentKey) return null;
  const state = await getIssueState(parentKey);
  const entry = state.applied.find((a) => a.key === subtask.key);
  if (!entry || entry.completedAt) return null;
  await updateIssueState(parentKey, (s) => ({
    ...s, applied: s.applied.map((a) => (a.key === subtask.key ? { ...a, completedAt: new Date().toISOString() } : a)),
  }));
  // Keyed by sub-task so several guardrails on one issue each count.
  await recordHit(entry.lessonId, subtask.key, 'completed', { parent: parentKey, guardrail: entry.guardrail });
  await bumpStat('guardrailsCompleted');
  return { completed: subtask.key };
}

async function parentDone(issue) {
  const state = await getIssueState(issue.key);
  const tracked = state.applied.filter((a) => a.key);
  if (!tracked.length || state.followThroughWarnedAt) return null;

  const subtasks = await searchIssues(`parent = "${issue.key}" AND labels = precedent-guardrail`, { max: 50 }).catch(() => []);
  const open = subtasks.filter((s) => !isDone(s));
  if (!open.length) return null;

  const lessons = await listLessons();
  const base = await jiraBaseUrl();
  const items = open.map((s) => {
    const entry = tracked.find((a) => a.key === s.key);
    const lesson = lessons.find((l) => l.id === entry?.lessonId);
    return { key: s.key, summary: s.fields.summary, entry, lesson };
  });
  const sources = [...new Map(items.filter((i) => i.lesson).map((i) => [i.lesson.id, i.lesson])).values()];
  const cost = (l) => [l.severity, l.durationMin ? `${l.durationMin} min outage` : null].filter(Boolean).join(', ');
  const link = (text, href) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });

  await addComment(issue.key, {
    type: 'doc', version: 1, content: [{
      type: 'panel', attrs: { panelType: 'warning' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: `Precedent: this work was marked done while ${open.length === 1 ? '1 guardrail is' : `${open.length} guardrails are`} still open.`, marks: [{ type: 'strong' }] }] },
        { type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [link(i.key, `${base}/browse/${i.key}`), { type: 'text', text: ` ${i.summary}` }] }] })) },
        ...(sources.length ? [{ type: 'paragraph', content: [
          { type: 'text', text: 'They came from ' },
          ...sources.flatMap((l, n) => [
            ...(n ? [{ type: 'text', text: ', ' }] : []),
            l.url ? link(l.title, l.url) : { type: 'text', text: l.title },
            ...(cost(l) ? [{ type: 'text', text: ` (${cost(l)})` }] : []),
          ]),
          { type: 'text', text: '.' },
        ] }] : []),
        { type: 'paragraph', content: [{ type: 'text', text: 'If a guardrail no longer applies, close it with a note, so the team knows it was a decision and not an oversight.' }] },
      ],
    }],
  });
  await updateIssueState(issue.key, (s) => ({ ...s, followThroughWarnedAt: new Date().toISOString() }));
  for (const i of items) if (i.entry) await recordHit(i.entry.lessonId, i.key, 'skipped', { parent: issue.key, guardrail: i.entry.guardrail });
  await bumpStat('guardrailsSkipped');
  return { skipped: items.map((i) => i.key) };
}
