import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPage } from '../src/engine/extract.js';
import { lessonIfLearnable } from '../src/services/ingest.js';

const config = { postmortemLabels: ['postmortem'], decisionLabels: ['decision'] };
const page = (title, html, labels = []) => ({ id: '9', title, body: { storage: { value: html } }, labels: labels.map((name) => ({ name })) });

const RCA = '<h2>What happened</h2><p>We raised the connection pool to 200.</p><h2>Root cause</h2><p>Database max_connections exceeded.</p><h2>Action items</h2><ul><li>Size pools against max_connections.</li></ul>';

test('unlabelled postmortems are recognised by title', () => {
  for (const t of ['Post-mortem: checkout outage', 'Incident review 2026-03-02', 'RCA - login failures', 'PIR-42 search latency', 'Correction of Errors: billing']) {
    assert.equal(classifyPage(page(t, '')), 'postmortem', t);
  }
  assert.equal(classifyPage(page('ADR-12: Use Postgres', '')), 'decision');
  assert.equal(classifyPage(page('Architecture decision: queues', '')), 'decision');
});

test('unlabelled pages are recognised by structure, ordinary pages are not', () => {
  assert.equal(classifyPage(page('Checkout DB meltdown, March', RCA)), 'postmortem');
  assert.equal(classifyPage(page('Team offsite agenda', '<h2>Agenda</h2><p>Lunch</p>')), null);
  // A postmortem that mentions an ADR is still a postmortem.
  assert.equal(classifyPage(page('Postmortem: retry storm (see ADR-007)', '')), 'postmortem');
});

test('auto-discovered lessons must have substance; labelled ones are always kept', () => {
  const found = lessonIfLearnable(page('Checkout DB meltdown, March', RCA), config, '');
  assert.ok(found?.discovered);
  assert.equal(found.rootCause, 'Database max_connections exceeded.');
  assert.equal(lessonIfLearnable(page('Postmortem: TBD', '<p>To be written</p>'), config, ''), null);
  assert.ok(lessonIfLearnable(page('Postmortem: TBD', '<p>To be written</p>', ['postmortem']), config, ''));
  assert.equal(lessonIfLearnable(page('Checkout DB meltdown, March', RCA), { ...config, autoDiscover: false }, ''), null);
});
