/**
 * Precedent matching engine: BM25 over structured lessons with field weighting,
 * component overlap boost and explainable "why it matched" terms.
 */
import { analyze, normalizeComponent } from './tokenize.js';

const K1 = 1.2;
const B = 0.75;

/** How much each lesson field counts. Triggers and components matter most:
 *  they describe *the kind of change* that caused the incident. */
const FIELD_WEIGHTS = {
  title: 2,
  trigger: 3,
  components: 3,
  tags: 2,
  rootCause: 2,
  guardrails: 1,
  impact: 0.5,
  summary: 1,
};

/** Levels for UI and auto-flagging. Tuned against the demo corpus + unit tests. */
export const LEVELS = { high: 0.62, medium: 0.4, low: 0.25 };

function lessonFieldText(lesson, field) {
  const v = lesson[field];
  if (Array.isArray(v)) return v.join(' . ');
  return v || '';
}

/** Build an in-memory BM25 index from lessons. Cheap enough to rebuild per request for O(1000) lessons. */
export function buildIndex(lessons) {
  const docs = [];
  const df = new Map();
  let totalLen = 0;
  for (const lesson of lessons) {
    const tf = new Map();
    let len = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const { terms } = analyze(lessonFieldText(lesson, field));
      for (const term of terms) {
        tf.set(term, (tf.get(term) || 0) + weight);
        len += weight;
      }
    }
    for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
    totalLen += len;
    docs.push({
      lesson,
      tf,
      len,
      components: new Set((lesson.components || []).map(normalizeComponent)),
    });
  }
  return { docs, df, N: docs.length, avgLen: docs.length ? totalLen / docs.length : 0 };
}

function idf(index, term) {
  const n = index.df.get(term) || 0;
  return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
}

/**
 * Score a "change" (Jira issue, PR, free text) against the index.
 * @param {object} index from buildIndex
 * @param {{ text: string, components?: string[], labels?: string[] }} change
 * @param {{ limit?: number, minConfidence?: number, excludeIds?: string[] }} opts
 */
/** Confidence multiplier by number of corroborating words (index = word count, capped). */
const EVIDENCE = [0, 0.45, 0.6, 0.85, 1];

export function matchChange(index, change, opts = {}) {
  const { limit = 3, minConfidence = LEVELS.low, excludeIds = [] } = opts;
  if (!index.N) return [];
  const queryText = [change.text, ...(change.labels || [])].join(' ');
  const { terms, surface } = analyze(queryText);
  const qTerms = [...new Set(terms)];
  if (!qTerms.length) return [];
  const qComponents = new Set((change.components || []).map(normalizeComponent));
  const excluded = new Set(excludeIds);

  // Upper bound for normalisation: a doc that contains every query term at a typical rate.
  const idealScore = qTerms.reduce((s, t) => s + idf(index, t), 0) || 1;

  const results = [];
  for (const doc of index.docs) {
    if (excluded.has(doc.lesson.id)) continue;
    let score = 0;
    const contributions = [];
    for (const term of qTerms) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const termIdf = idf(index, term);
      const s = termIdf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.len) / index.avgLen)));
      score += s;
      contributions.push({ term, score: s });
    }
    const componentHits = [...qComponents].filter((c) => doc.components.has(c));
    if (!contributions.length && !componentHits.length) continue;

    // Coverage: fraction of the query's information (idf mass) the lesson explains.
    const covered = contributions.reduce((s, c) => s + idf(index, c.term), 0);
    const coverage = covered / idealScore;
    // Strength: saturating transform of raw BM25.
    const strength = 1 - Math.exp(-score / 9);
    let confidence = 0.55 * strength + 0.45 * Math.min(1, coverage * 1.6);
    if (componentHits.length) confidence = Math.min(1, confidence + 0.15);
    // Evidence: how many distinct words of the change agree with the lesson. Synonym
    // expansion turns one word ("password") into several index terms, so count the
    // user's words, not ours. A precedent needs corroboration: one or two shared
    // words in a short title ("Alter logo", "Version upgrade notes") is coincidence.
    // A component overlap counts as two words of evidence.
    const words = new Set(contributions.map((c) => surface.get(c.term) || c.term)).size + 2 * componentHits.length;
    confidence *= EVIDENCE[Math.min(words, EVIDENCE.length - 1)];

    if (confidence < minConfidence) continue;
    contributions.sort((a, b) => b.score - a.score);
    results.push({
      lesson: doc.lesson,
      score: Number(score.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      level: levelFor(confidence),
      matchedTerms: dedupeSurface(contributions.slice(0, 6).map((c) => surface.get(c.term) || c.term)),
      componentHits,
    });
  }
  results.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
  return results.slice(0, limit);
}

export function levelFor(confidence) {
  if (confidence >= LEVELS.high) return 'high';
  if (confidence >= LEVELS.medium) return 'medium';
  return 'low';
}

function dedupeSurface(words) {
  const seen = new Set();
  return words.filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
}

/** Convenience: turn a Jira issue (REST v3 shape, description already flattened) into a change. */
export function changeFromIssue({ summary, descriptionText, components = [], labels = [] }) {
  return {
    // Summary is the strongest signal of intent; repeat it to weight it.
    text: `${summary || ''}. ${summary || ''}. ${descriptionText || ''}`,
    components: components.map((c) => (typeof c === 'string' ? c : c.name)),
    labels,
  };
}
