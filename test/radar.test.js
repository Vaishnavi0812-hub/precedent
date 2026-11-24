import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originIncident } from '../src/services/radar.js';

test('a decision is credited with the incident that created it', () => {
  const lessons = [
    { id: 'cf:1', sourceType: 'postmortem', title: 'Postmortem: INC-105 — Retry storm', severity: 'SEV1', durationMin: 64 },
    { id: 'cf:2', sourceType: 'decision', title: 'ADR-007: Shared resilience library', summary: 'After INC-105, a retry storm…' },
  ];
  const o = originIncident(lessons[1], lessons);
  assert.equal(o.ref, 'INC-105');
  assert.equal(o.lesson.durationMin, 64);
  assert.equal(originIncident({ summary: 'No incident here' }, lessons), null);
});
