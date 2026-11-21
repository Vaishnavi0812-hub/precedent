import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stem, analyze } from '../src/engine/tokenize.js';
import { buildIndex, matchChange, changeFromIssue } from '../src/engine/match.js';
import { lessonFromConfluencePage, storageToSections, adfToSections, lessonFromIncidentIssue } from '../src/engine/extract.js';
import {
  INCIDENTS, DECISIONS, DEMO_CHANGES,
  renderPostmortemStorage, renderDecisionStorage, renderIncidentAdf,
} from '../src/data/demo-history.js';

function demoLessons() {
  const pm = INCIDENTS.map((inc, i) => lessonFromConfluencePage({
    id: String(1000 + i), title: `Postmortem: ${inc.ref} ${inc.title}`,
    body: { storage: { value: renderPostmortemStorage(inc, `OPS-${i + 1}`) } },
    labels: ['postmortem', ...inc.tags],
  }));
  const adr = DECISIONS.map((d, i) => lessonFromConfluencePage({
    id: String(2000 + i), title: d.title,
    body: { storage: { value: renderDecisionStorage(d) } },
    labels: ['decision', ...d.tags],
  }));
  return [...pm, ...adr];
}

test('stemmer conflates common variants', () => {
  assert.equal(stem('migration'), stem('migrate'));
  assert.equal(stem('migrating'), stem('migrate'));
  assert.equal(stem('retries'), 'retry');
  assert.equal(stem('caching'), stem('cache'));
});

test('synonyms bridge vocabulary', () => {
  const a = new Set(analyze('lower the redis ttl').terms);
  assert.ok(a.has(stem('cache')));
  assert.ok(a.has(stem('expiry')));
});

test('postmortem storage round-trips into a structured lesson', () => {
  const lesson = demoLessons()[0];
  assert.equal(lesson.sourceType, 'postmortem');
  assert.match(lesson.trigger, /TTL was reduced/);
  assert.match(lesson.rootCause, /stampede/);
  assert.equal(lesson.guardrails.length, 3);
  assert.deepEqual(lesson.components, ['catalog-service', 'redis-cache', 'checkout']);
  assert.equal(lesson.severity, 'SEV1');
  assert.equal(lesson.durationMin, 47);
  assert.equal(lesson.date, '2026-03-14');
  assert.equal(lesson.quality, 1);
});

test('decision records are classified and their decision becomes a guardrail', () => {
  const adr = demoLessons().find((l) => l.title.startsWith('ADR-007'));
  assert.equal(adr.sourceType, 'decision');
  assert.ok(adr.guardrails.some((g) => /resilience library/.test(g)));
});

test('ADF incident descriptions are parsed into sections', () => {
  const sections = adfToSections(renderIncidentAdf(INCIDENTS[1]));
  assert.ok(sections.find((s) => s.heading === 'Root cause'));
  const lesson = lessonFromIncidentIssue({
    key: 'OPS-2',
    fields: { summary: INCIDENTS[1].title, description: renderIncidentAdf(INCIDENTS[1]), components: [{ name: 'orders-db' }], labels: [] },
  }, 'https://x.atlassian.net');
  assert.match(lesson.rootCause, /ACCESS EXCLUSIVE/);
  assert.equal(lesson.url, 'https://x.atlassian.net/browse/OPS-2');
});

test('free-form pages without headings still produce a lesson', () => {
  const s = storageToSections('<p>We broke prod by changing the TTL.</p>');
  assert.equal(s.length, 1);
});

const index = buildIndex(demoLessons());
const refOf = (lesson) => (lesson.title.match(/(INC|ADR)-\d+/) || [])[0];

for (const change of DEMO_CHANGES) {
  test(`demo change "${change.summary}" -> ${change.expect ?? 'no precedent'}`, () => {
    const results = matchChange(index, changeFromIssue({
      summary: change.summary, descriptionText: change.description, components: change.components,
    }));
    if (change.expect === null) {
      assert.ok(results.every((r) => r.level === 'low'), `expected nothing above low, got ${results.map((r) => `${refOf(r.lesson)}:${r.confidence}`)}`);
      return;
    }
    assert.ok(results.length > 0, 'expected at least one match');
    const refs = results.map((r) => refOf(r.lesson));
    assert.ok(refs.slice(0, 2).includes(change.expect), `expected ${change.expect} in top 2, got ${results.map((r) => `${refOf(r.lesson)}:${r.confidence}`)}`);
    const hit = results.find((r) => refOf(r.lesson) === change.expect);
    assert.notEqual(hit.level, 'low', `expected medium/high for ${change.expect}, got ${hit.confidence}`);
    assert.ok(hit.matchedTerms.length > 0);
  });
}

test('top demo hit is high confidence (the on-camera moment)', () => {
  const [top] = matchChange(index, changeFromIssue({
    summary: DEMO_CHANGES[0].summary, descriptionText: DEMO_CHANGES[0].description, components: DEMO_CHANGES[0].components,
  }));
  assert.equal(refOf(top.lesson), 'INC-101');
  assert.equal(top.level, 'high');
});
