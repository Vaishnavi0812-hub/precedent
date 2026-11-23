/**
 * Postmortem Quality Coach + impact metrics.
 *
 * Precedent is only as good as the postmortems it learns from. The coach scores
 * every postmortem/decision page for actionability (does it say what changed, why
 * it broke, what we'll do differently, and where?) and shows how many later
 * changes the page has already protected.
 */
import { getPage, confluenceBaseUrl } from '../atlassian.js';
import { lessonFromConfluencePage, classifyPage } from '../engine/extract.js';
import { lessonIfLearnable } from './ingest.js';
import { listLessons, getHits, getAllHits, getConfig, saveLesson } from '../store.js';

const CHECKS = [
  { field: 'trigger', label: 'What changed (the trigger)', heading: 'Trigger', why: 'Precedent matches new work on the kind of change that caused the incident.' },
  { field: 'rootCause', label: 'Why it broke (root cause)', heading: 'Root cause', why: 'Shown to engineers so they understand the risk, not just the rule.' },
  { field: 'guardrails', label: 'What we will do differently (guardrails)', heading: 'Guardrails', why: 'Turned into one-click sub-tasks on future work.' },
  { field: 'components', label: 'Where it happened (affected components)', heading: 'Affected components', why: 'Component overlap is the strongest matching signal.' },
];

function present(lesson, hits) {
  const checks = CHECKS.map((c) => {
    const v = lesson[c.field];
    const ok = Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
    return { ...c, ok };
  });
  const flagged = hits.filter((h) => h.kind === 'flagged');
  const guarded = hits.filter((h) => h.kind === 'guarded');
  return {
    id: lesson.id,
    title: lesson.title,
    sourceType: lesson.sourceType,
    quality: lesson.quality ?? 0,
    checks,
    guardrails: lesson.guardrails || [],
    components: lesson.components || [],
    protectedChanges: [...new Map(flagged.map((h) => [h.issueKey, h])).values()].map((h) => ({ issueKey: h.issueKey, summary: h.summary, at: h.at })),
    guardrailsAdopted: guarded.length,
  };
}

/** Coach view for a Confluence page (works for unlabelled pages too, as a preview). */
export async function coachPage(pageId) {
  const config = await getConfig();
  const page = await getPage(pageId);
  const base = await confluenceBaseUrl();
  const learnable = lessonIfLearnable(page, config, base);
  const tracked = Boolean(learnable);
  const lesson = learnable || lessonFromConfluencePage(page, base);
  if (tracked) await saveLesson(lesson); // keep the stored lesson fresh when someone looks at the page
  const hits = await getHits(lesson.id);
  return {
    tracked,
    discovered: Boolean(learnable?.discovered),
    looksLikePostmortem: Boolean(classifyPage(page)),
    suggestedLabel: lesson.sourceType === 'decision' ? 'decision' : 'postmortem',
    ...present(lesson, hits),
  };
}

/** Short byline title, e.g. "Precedent · 85% actionable · protected 3". */
export async function bylineTitle(pageId) {
  try {
    const lessons = await listLessons();
    const lesson = lessons.find((l) => l.id === `cf:${pageId}`);
    if (!lesson) return 'Precedent';
    const hits = await getHits(lesson.id);
    const protectedCount = new Set(hits.filter((h) => h.kind === 'flagged').map((h) => h.issueKey)).size;
    const q = Math.round((lesson.quality ?? 0) * 100);
    return `Precedent · ${q}% actionable${protectedCount ? ` · protected ${protectedCount}` : ''}`;
  } catch (e) {
    console.warn('bylineTitle', e.message);
    return 'Precedent';
  }
}

/**
 * Organisation-level impact: near-misses caught, the outage minutes those same
 * mistakes cost last time, guardrails adopted, and the lessons doing the work.
 */
export async function computeImpact() {
  const [lessons, hitsByLesson] = await Promise.all([listLessons(), getAllHits()]);
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const issues = new Map(); // issueKey -> { summary, lessons:Set, guarded }
  let guardrailsAdopted = 0;
  for (const [lessonId, hits] of Object.entries(hitsByLesson)) {
    for (const h of hits) {
      const e = issues.get(h.issueKey) || { issueKey: h.issueKey, summary: h.summary, lessons: new Set(), guarded: false };
      e.lessons.add(lessonId);
      if (h.kind === 'guarded') { e.guarded = true; guardrailsAdopted += 1; }
      issues.set(h.issueKey, e);
    }
  }
  const isOutage = (l) => l && (l.severity === 'SEV1' || l.severity === 'SEV2');
  // Decisions carry no outage of their own, but most were born from one ("After INC-105, ...").
  // Credit a decision with the incident that caused it.
  const originOf = (l) => {
    if (!l || l.sourceType !== 'decision') return null;
    const ref = String(l.summary || '').match(/\b(?:INC|PIR)-\d+\b/i)?.[0]?.toUpperCase();
    return ref ? lessons.find((x) => x.sourceType !== 'decision' && (x.title || '').toUpperCase().includes(ref)) : null;
  };
  let minutesAtRisk = 0;
  let sev1Repeats = 0;
  const nearMisses = [];
  for (const e of issues.values()) {
    const direct = [...e.lessons].map((id) => byId.get(id)).filter(Boolean);
    const origins = direct.map(originOf).filter(Boolean);
    const worst = [...direct, ...origins].filter(isOutage).sort((a, b) => (b.durationMin || 0) - (a.durationMin || 0))[0];
    if (worst) minutesAtRisk += worst.durationMin || 0;
    if ([...direct, ...origins].some((l) => l.severity === 'SEV1')) sev1Repeats += 1;
    const shown = direct.find((l) => l === worst) || direct[0];
    const via = worst && !direct.includes(worst) ? (worst.title.match(/\b(?:INC|PIR)-\d+\b/i)?.[0] || worst.title) : null;
    nearMisses.push({
      issueKey: e.issueKey, summary: e.summary, guarded: e.guarded,
      precedent: via ? `${shown?.title} (after ${via})` : shown?.title,
      severity: worst?.severity || shown?.severity, minutes: worst?.durationMin || 0,
    });
  }
  const topLessons = Object.entries(hitsByLesson)
    .map(([id, hits]) => ({ id, title: byId.get(id)?.title, url: byId.get(id)?.url, protectedChanges: new Set(hits.filter((h) => h.kind === 'flagged').map((h) => h.issueKey)).size }))
    .filter((x) => x.title && x.protectedChanges)
    .sort((a, b) => b.protectedChanges - a.protectedChanges)
    .slice(0, 5);
  const scored = lessons.filter((l) => l.sourceType !== 'incident');
  return {
    nearMisses: nearMisses.sort((a, b) => b.minutes - a.minutes),
    nearMissCount: nearMisses.length,
    guardedCount: nearMisses.filter((n) => n.guarded).length,
    guardrailsAdopted,
    minutesAtRisk,
    sev1Repeats,
    topLessons,
    avgQuality: scored.length ? Math.round((scored.reduce((s, l) => s + (l.quality || 0), 0) / scored.length) * 100) : 0,
    weakPostmortems: scored.filter((l) => (l.quality ?? 1) < 0.7).map((l) => ({ title: l.title, url: l.url, quality: Math.round((l.quality || 0) * 100) })),
  };
}
