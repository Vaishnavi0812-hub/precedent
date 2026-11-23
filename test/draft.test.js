import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDraftStorage } from '../src/services/draft.js';
import { lessonIfLearnable } from '../src/services/ingest.js';

const config = { postmortemLabels: ['postmortem'], decisionLabels: ['decision'] };
const issue = {
  key: 'LOPS-42',
  fields: {
    summary: 'Payment gateway timeouts after retry change',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Checkout errors spiked to 30% <for> 40 minutes.' }] }] },
    components: [{ name: 'payment-gateway-client' }],
    priority: { name: 'Highest' },
    created: '2026-11-20T10:00:00.000Z',
    resolutiondate: '2026-11-20T10:45:00.000Z',
  },
};
const similar = [{ title: 'Postmortem: INC-105 — Retry storm', url: 'https://x/wiki/1', severity: 'SEV1', durationMin: 64 }];

test('postmortem draft carries incident metadata and the sections Precedent learns from', () => {
  const html = renderDraftStorage({ issue, issueUrl: 'https://x/browse/LOPS-42', similar });
  for (const h of ['Summary', 'Trigger', 'Root cause', 'Guardrails', 'Affected components', 'Has this happened before?']) assert.match(html, new RegExp(`<h2>${h.replace('?', '\\?')}</h2>`));
  assert.match(html, /Severity: SEV1/);
  assert.match(html, /Duration: 45m/);
  assert.match(html, /&lt;for&gt;/); // escaped
  assert.match(html, /Postmortem: INC-105/);
});

test('an untouched draft teaches nothing; a filled-in draft is learned with its incident link', () => {
  const html = renderDraftStorage({ issue, issueUrl: 'https://x/browse/LOPS-42', similar: [] });
  const page = (body) => ({ id: '77', title: 'Postmortem: LOPS-42 — Payment gateway timeouts after retry change', body: { storage: { value: body } }, labels: [] });
  assert.equal(lessonIfLearnable(page(html), config, ''), null);

  const filled = html
    .replace(/<h2>Trigger<\/h2>\n<p><ac:placeholder>[\s\S]*?<\/ac:placeholder><\/p>/, '<h2>Trigger</h2><p>Raised payment client retries from 2 to 6 with no backoff.</p>')
    .replace(/<h2>Guardrails<\/h2>\n<p><ac:placeholder>[\s\S]*?<\/ac:placeholder><\/p>/, '<h2>Guardrails</h2><ul><li>Retries need backoff with jitter.</li></ul>');
  const lesson = lessonIfLearnable(page(filled), config, '');
  assert.ok(lesson?.discovered);
  assert.equal(lesson.incidentKey, 'LOPS-42');
  assert.equal(lesson.severity, 'SEV1');
  assert.deepEqual(lesson.guardrails, ['Retries need backoff with jitter.']);
  assert.equal(lesson.rootCause, ''); // still a placeholder
  assert.deepEqual(lesson.components, ['payment-gateway-client']);
});
