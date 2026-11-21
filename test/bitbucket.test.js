import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgedRefs, pathsToText, componentsFromPaths } from '../bitbucket/src/pr.js';
import { buildIndex, matchChange } from '../src/engine/match.js';
import { lessonFromConfluencePage } from '../src/engine/extract.js';
import { INCIDENTS, renderPostmortemStorage } from '../src/data/demo-history.js';

test('Precedent-Ack lines are parsed from PR descriptions', () => {
  assert.deepEqual([...acknowledgedRefs('Fixes retries.\n\nPrecedent-Ack: INC-105, adr-007')], ['INC-105', 'ADR-007']);
  assert.equal(acknowledgedRefs('no ack here').size, 0);
});

test('components are inferred from changed file paths', () => {
  assert.deepEqual(componentsFromPaths(['services/catalog-service/config/cache.yaml', 'README.md']), ['catalog-service']);
});

test('a PR identified only by branch and files still finds its precedent', () => {
  const lessons = INCIDENTS.map((inc, i) => lessonFromConfluencePage({
    id: String(i), title: `Postmortem: ${inc.ref} — ${inc.title}`,
    body: { storage: { value: renderPostmortemStorage(inc) } }, labels: [{ name: 'postmortem' }],
  }));
  const paths = ['services/payment-gateway-client/src/retry_policy.ts', 'services/payment-gateway-client/config/retries.yaml'];
  const [top] = matchChange(buildIndex(lessons), {
    text: `Bump payment gateway retries. feature payment retries. ${pathsToText(paths)}`,
    components: componentsFromPaths(paths),
  });
  assert.match(top.lesson.title, /INC-105/);
  assert.equal(top.level, 'high');
});
