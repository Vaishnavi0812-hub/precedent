/**
 * Rovo agent actions. The agent reasons in natural language; these actions give
 * it grounded, deterministic access to the team's institutional memory.
 */
import { checkText, checkIssue, applyGuardrail } from './services/precedent.js';
import { listLessons } from './store.js';
import { LEVELS } from './engine/match.js';

const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** Rovo passes inputs at the top level of the payload, plus a `context` object. */
function issueKeyFrom(payload) {
  const explicit = String(payload.issueKey || '').toUpperCase().match(ISSUE_KEY)?.[0];
  return explicit || payload.context?.jira?.issueKey || null;
}

function forAgent(m) {
  return {
    ref: m.title,
    type: m.sourceType,
    link: m.url,
    when: m.date,
    severity: m.severity,
    outageMinutes: m.durationMin,
    impact: m.impact,
    whatChanged: m.trigger,
    whatWentWrong: m.rootCause,
    decision: m.sourceType === 'decision' ? m.summary : undefined,
    guardrails: m.guardrails,
    matchStrength: m.level,
    confidence: m.confidence,
    matchedOn: [...(m.componentHits || []), ...(m.matchedTerms || [])],
    lessonId: m.id,
  };
}

const wrap = (fn) => async (payload, ctx) => {
  try {
    return await fn(payload || {}, ctx);
  } catch (e) {
    console.error('rovo action failed', e);
    return { error: `Precedent could not complete this action: ${e.message}` };
  }
};

/** Search institutional memory for anything resembling a described change. */
export const searchPrecedents = wrap(async (payload) => {
  const text = [payload.change, payload.components].filter(Boolean).join('. ');
  if (!text.trim()) return { error: 'Describe the change you are planning.' };
  const components = String(payload.components || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const matches = await checkText({ text, components, limit: 5, minConfidence: LEVELS.low });
  const strong = matches.filter((m) => m.level !== 'low');
  return {
    verdict: strong.some((m) => m.level === 'high') ? 'STRONG_PRECEDENT' : strong.length ? 'POSSIBLE_PRECEDENT' : 'NO_PRECEDENT',
    precedents: strong.map(forAgent),
    weakSignals: matches.filter((m) => m.level === 'low').map((m) => m.title),
  };
});

/** Check a Jira issue against institutional memory. */
export const checkIssueAction = wrap(async (payload) => {
  const key = issueKeyFrom(payload);
  if (!key) return { error: 'Which Jira issue? Give me a key like LUMEN-3.' };
  const res = await checkIssue(key, { as: 'app' });
  const strong = res.matches.filter((m) => m.level !== 'low');
  return {
    issue: res.issue,
    verdict: strong.some((m) => m.level === 'high') ? 'STRONG_PRECEDENT' : strong.length ? 'POSSIBLE_PRECEDENT' : 'NO_PRECEDENT',
    precedents: strong.map(forAgent),
    guardrailsAlreadyAdded: res.applied.map((a) => ({ guardrail: a.guardrail, subtask: a.key })),
    lessonsSearched: res.lessonCount,
  };
});

/** Full detail for one lesson, by reference (INC-105, ADR-007) or keywords. */
export const getLesson = wrap(async (payload) => {
  const q = String(payload.reference || '').trim();
  if (!q) return { error: 'Which incident or decision? e.g. INC-105 or ADR-007.' };
  const lessons = await listLessons();
  const needle = q.toUpperCase();
  let hits = lessons.filter((l) => (l.title || '').toUpperCase().includes(needle) || l.sourceKey === q || l.incidentKey === needle);
  if (!hits.length) {
    hits = (await checkText({ text: q, limit: 3, minConfidence: 0 })).map((m) => lessons.find((l) => l.id === m.id)).filter(Boolean);
  }
  if (!hits.length) return { error: `No lesson found for "${q}".` };
  return {
    lessons: hits.slice(0, 3).map((l) => ({
      title: l.title, type: l.sourceType, link: l.url, incidentLink: l.incidentUrl, when: l.date,
      severity: l.severity, outageMinutes: l.durationMin, impact: l.impact, whatChanged: l.trigger,
      whatWentWrong: l.rootCause, decisionContext: l.summary, guardrails: l.guardrails,
      components: l.components, postmortemQuality: l.quality,
    })),
  };
});

/** Aggregate view: where does the organisation keep getting hurt? */
export const riskHotspots = wrap(async () => {
  const lessons = (await listLessons()).filter((l) => l.sourceType !== 'decision');
  const byComponent = new Map();
  const byTheme = new Map();
  for (const l of lessons) {
    for (const c of l.components || []) {
      const e = byComponent.get(c) || { component: c, incidents: 0, outageMinutes: 0, sev1: 0, examples: [] };
      e.incidents += 1;
      e.outageMinutes += l.durationMin || 0;
      if (l.severity === 'SEV1') e.sev1 += 1;
      if (e.examples.length < 3) e.examples.push(l.title);
      byComponent.set(c, e);
    }
    for (const t of l.tags || []) byTheme.set(t, (byTheme.get(t) || 0) + 1);
  }
  const weak = lessons.filter((l) => (l.quality ?? 1) < 0.7).map((l) => ({ title: l.title, quality: l.quality, link: l.url }));
  return {
    incidentsAnalysed: lessons.length,
    totalOutageMinutes: lessons.reduce((s, l) => s + (l.durationMin || 0), 0),
    hotspots: [...byComponent.values()].sort((a, b) => b.incidents - a.incidents || b.outageMinutes - a.outageMinutes).slice(0, 6),
    recurringThemes: [...byTheme.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([theme, count]) => ({ theme, count })),
    postmortemsNeedingWork: weak,
  };
});

/** Turn a guardrail into tracked work on an issue. */
export const addGuardrail = wrap(async (payload) => {
  const key = issueKeyFrom(payload);
  if (!key) return { error: 'Which Jira issue should get the guardrail?' };
  const guardrail = String(payload.guardrail || '').trim();
  if (!guardrail) return { error: 'What guardrail should I add?' };
  // Resolve the lesson the guardrail came from, so the sub-task links back to it.
  const res = await checkIssue(key, { as: 'app', includeDismissed: true });
  const lesson = res.matches.find((m) => m.guardrails.some((g) => g.toLowerCase() === guardrail.toLowerCase()))
    || res.matches.find((m) => m.guardrails.some((g) => g.toLowerCase().includes(guardrail.toLowerCase().slice(0, 40))));
  const exact = lesson?.guardrails.find((g) => g.toLowerCase().includes(guardrail.toLowerCase().slice(0, 40))) || guardrail;
  const out = await applyGuardrail(key, lesson?.id || 'rovo', exact);
  return { added: true, issue: key, guardrail: exact, subtask: out.subtaskKey, link: out.url, fromLesson: lesson?.title };
});
