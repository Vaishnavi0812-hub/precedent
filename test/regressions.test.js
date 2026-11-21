import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, lessonFromConfluencePage } from '../src/engine/extract.js';
import { mergeLessons } from '../src/services/ingest.js';

test('named and numeric HTML entities decode (Confluence stores arrows as &rarr;)', () => {
  assert.equal(decodeEntities('10% &rarr; 50% &rarr; 100%'), '10% → 50% → 100%');
  assert.equal(decodeEntities('a&#8594;b &#x2192; c &amp; d'), 'a→b → c & d');
  assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;');
});

test('guardrails containing entities are not split into fragments', () => {
  const lesson = lessonFromConfluencePage({
    id: '1', title: 'Postmortem: INC-101 test',
    body: { storage: { value: '<h2>Guardrails</h2><ul><li>Roll out gradually (10% &rarr; 50% &rarr; 100%) with jitter.</li><li>Warm the cache first.</li></ul>' } },
    labels: [{ name: 'postmortem' }],
  });
  assert.deepEqual(lesson.guardrails, ['Roll out gradually (10% → 50% → 100%) with jitter.', 'Warm the cache first.']);
});

test('incident merges into its postmortem by shared INC reference', () => {
  const pm = { id: 'cf:1', sourceType: 'postmortem', title: 'Postmortem: INC-101 — Checkout outage', components: ['checkout'] };
  const inc = { id: 'jira:LOPS-9', sourceType: 'incident', sourceKey: 'LOPS-9', title: 'INC-101: Checkout outage', url: 'u', components: ['redis-cache'] };
  const other = { id: 'jira:LOPS-10', sourceType: 'incident', sourceKey: 'LOPS-10', title: 'Unrelated outage' };
  const merged = mergeLessons([pm], [inc, other]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].incidentKey, 'LOPS-9');
  assert.deepEqual(merged[0].components, ['checkout', 'redis-cache']);
});
