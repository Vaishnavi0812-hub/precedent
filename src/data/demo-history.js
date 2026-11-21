/**
 * Demo history for "Lumen Market", a fictional e-commerce company.
 * Seeded into a judge's empty site so Precedent works the moment it is installed.
 * Every incident becomes a JSM incident + a Confluence postmortem; decisions become ADR pages.
 */

export const DEMO_COMPANY = 'Lumen Market';

export const INCIDENTS = [
  {
    ref: 'INC-101',
    title: 'Checkout outage: cache stampede after catalog TTL reduction',
    date: '2026-03-14',
    severity: 'SEV1',
    durationMin: 47,
    components: ['catalog-service', 'redis-cache', 'checkout'],
    impact: 'Checkout unavailable for 47 minutes during the spring sale. ~18,400 failed orders, estimated $310k in lost revenue.',
    trigger: 'Product catalog cache TTL was reduced from 10 minutes to 30 seconds in a single config change so that price updates would appear faster.',
    rootCause: 'All catalog keys expired at almost the same moment and thousands of requests missed the Redis cache simultaneously (cache stampede). The catalog Postgres database was never load-tested for uncached traffic and saturated its CPU, which cascaded into checkout timeouts.',
    guardrails: [
      'Any cache TTL change must be rolled out gradually (10% → 50% → 100%) with TTL jitter enabled.',
      'Warm the cache before lowering TTLs and enable request coalescing (single-flight) on the catalog client.',
      'Load-test the origin database at 3x peak with the cache disabled before changing cache behaviour.',
    ],
    tags: ['cache', 'ttl', 'config-change', 'stampede'],
  },
  {
    ref: 'INC-102',
    title: 'Order writes blocked by table-locking schema migration',
    date: '2026-01-22',
    severity: 'SEV1',
    durationMin: 22,
    components: ['orders-db', 'orders-service'],
    impact: 'All order creation failed for 22 minutes. Mobile and web checkout returned errors.',
    trigger: 'A migration added a NOT NULL column with a default value to the 40M-row orders table during business hours.',
    rootCause: 'On our Postgres version the ALTER TABLE rewrote the whole table under an ACCESS EXCLUSIVE lock. The migration was reviewed for correctness but nobody checked its locking behaviour or table size.',
    guardrails: [
      'Use expand/contract migrations: add the column as nullable, backfill in batches, then add the constraint.',
      'No table-rewriting DDL on tables over 1M rows during business hours; use the online schema change tool.',
      'Migration PRs must state the target table size and lock level.',
    ],
    tags: ['database', 'migration', 'schema', 'locking'],
  },
  {
    ref: 'INC-103',
    title: 'Mobile app crash loop after removing legacy checkout feature flag',
    date: '2026-05-06',
    severity: 'SEV2',
    durationMin: 190,
    components: ['feature-flags', 'mobile-app', 'checkout'],
    impact: '23% of iOS users (app versions ≤ 4.2) crashed on launch for over 3 hours until a server-side shim was deployed.',
    trigger: 'The legacy_checkout feature flag was deleted from the flag service as part of tech-debt cleanup.',
    rootCause: 'Web had stopped evaluating the flag, but older mobile app versions still read it and crashed on a missing value. Flag usage was checked only in the web codebase.',
    guardrails: [
      'Before deleting a feature flag, confirm zero evaluations for 30 days across ALL clients, including old mobile versions.',
      'Archive flags (serve a default) instead of deleting them; delete only after the archive period.',
    ],
    tags: ['feature-flag', 'cleanup', 'mobile', 'tech-debt'],
  },
  {
    ref: 'INC-104',
    title: 'Missed payment confirmations: expired TLS certificate on webhook endpoint',
    date: '2025-11-30',
    severity: 'SEV1',
    durationMin: 185,
    components: ['payments-webhooks', 'payments-service'],
    impact: '3 hours of payment confirmations dropped; 6,200 orders stuck in "pending payment" and needed manual reconciliation.',
    trigger: 'The TLS certificate on the payments webhook endpoint expired over a weekend.',
    rootCause: 'The certificate was issued manually two years earlier and was not part of automated renewal. No expiry monitoring existed for this endpoint.',
    guardrails: [
      'All certificates must use automated renewal; manually issued certificates are not allowed in production.',
      'Certificate expiry alerts at 30, 14 and 3 days for every public endpoint.',
    ],
    tags: ['certificate', 'tls', 'payments', 'expiry'],
  },
  {
    ref: 'INC-105',
    title: 'Retry storm amplified payment gateway degradation',
    date: '2026-02-09',
    severity: 'SEV1',
    durationMin: 64,
    components: ['payments-service', 'payment-gateway-client'],
    impact: 'A 5-minute partial gateway blip turned into a 64-minute payment outage; the provider rate-limited our account.',
    trigger: 'The payment gateway client retry count was increased from 1 to 5 to "make payments more reliable".',
    rootCause: 'Retries were immediate with no exponential backoff, no jitter and no circuit breaker, multiplying load on an already degraded dependency by 5x.',
    guardrails: [
      'Retries must use exponential backoff with jitter and a retry budget (ADR-007).',
      'Every client of an external dependency must have a circuit breaker.',
      'Changing retry counts requires a failure-mode review of the downstream dependency.',
    ],
    tags: ['retry', 'resilience', 'external-dependency', 'payments'],
  },
  {
    ref: 'INC-106',
    title: 'Promotion went live an hour early after daylight saving change',
    date: '2026-03-29',
    severity: 'SEV3',
    durationMin: 60,
    components: ['promotions-scheduler', 'pricing'],
    impact: 'A 40%-off promotion started an hour early in the EU; ~$42k in unplanned discounts.',
    trigger: 'A promotion was scheduled with a cron expression interpreted in server local time.',
    rootCause: 'The scheduler host switched to daylight saving time; schedule times were not stored with an explicit timezone.',
    guardrails: [
      'All schedules and timestamps are stored and evaluated in UTC with an explicit timezone (ADR-019).',
      'Scheduling changes need a test case that crosses a DST boundary.',
    ],
    tags: ['timezone', 'dst', 'cron', 'scheduling'],
  },
  {
    ref: 'INC-107',
    title: 'Search outage: disk filled by debug logging left on in production',
    date: '2026-04-17',
    severity: 'SEV2',
    durationMin: 38,
    components: ['search-service', 'logging'],
    impact: 'Product search returned errors for 38 minutes; conversion dropped 31% in that window.',
    trigger: 'Debug log level was enabled in production on search-service to investigate a ranking bug and never turned off.',
    rootCause: 'Debug logging produced 40x normal log volume and filled the node disks within 9 hours. There was no alert on log volume or disk usage for search nodes.',
    guardrails: [
      'Debug logging in production must be time-boxed via a flag with automatic expiry (max 2 hours).',
      'Alert on log volume anomalies and disk usage above 80% for every service.',
    ],
    tags: ['logging', 'debug', 'disk', 'observability'],
  },
  {
    ref: 'INC-108',
    title: 'Largest partner integration broken by lowered public API rate limit',
    date: '2026-06-03',
    severity: 'SEV2',
    durationMin: 300,
    components: ['public-api', 'api-gateway'],
    impact: 'Our biggest marketplace partner could not sync inventory for 5 hours; listings went stale and they escalated to our CEO.',
    trigger: 'The public API rate limit was lowered from 1000 to 200 requests per minute per key to reduce infrastructure cost.',
    rootCause: 'Nobody analysed per-consumer traffic before the change. The partner\'s normal sync bursts reached 750 requests per minute.',
    guardrails: [
      'Before lowering rate limits, review the p99 request rate of the top 20 API consumers.',
      'Give partners 14 days notice of rate-limit reductions and roll out with per-key overrides.',
    ],
    tags: ['rate-limit', 'api', 'partners', 'cost'],
  },
  {
    ref: 'INC-109',
    title: 'Analytics pipeline broken by serialization library upgrade',
    date: '2026-07-11',
    severity: 'SEV3',
    durationMin: 2880,
    components: ['orders-service', 'analytics-pipeline'],
    impact: 'Two days of revenue dashboards were wrong; finance month-end close was delayed.',
    trigger: 'A routine dependency upgrade bumped the JSON serialization library by a major version.',
    rootCause: 'The new version changed the default date format in event payloads. Downstream consumers parsed the old format and silently dropped events. There were no contract tests on the event schema.',
    guardrails: [
      'Major dependency upgrades on services that publish events require contract tests against the published schema.',
      'Event schemas are versioned; consumers must reject unknown formats loudly rather than drop silently.',
    ],
    tags: ['dependency-upgrade', 'serialization', 'contract', 'events'],
  },
  {
    ref: 'INC-110',
    title: 'Black Friday OOMKills after container memory limits were reduced',
    date: '2025-11-28',
    severity: 'SEV1',
    durationMin: 52,
    components: ['checkout', 'kubernetes'],
    impact: 'Intermittent checkout failures for 52 minutes on Black Friday at peak traffic.',
    trigger: 'Checkout pod memory limits were lowered from 2Gi to 1Gi in a cost-optimisation sweep the week before Black Friday.',
    rootCause: 'Limits were sized from average usage, not peak. Under peak traffic the pods were OOMKilled in a loop and the autoscaler could not keep up.',
    guardrails: [
      'Resource limit changes require a load test at the peak traffic profile.',
      'No resource or capacity changes during the change freeze (2 weeks before peak events).',
    ],
    tags: ['kubernetes', 'memory-limit', 'cost', 'peak-traffic'],
  },
  {
    ref: 'INC-111',
    title: 'Database refused connections after API connection pool increase',
    date: '2026-08-19',
    severity: 'SEV1',
    durationMin: 29,
    components: ['orders-db', 'api-service'],
    impact: 'API returned 500s for 29 minutes; all clients affected.',
    trigger: 'The API database connection pool size was raised from 20 to 60 per pod to fix slow requests.',
    rootCause: 'With the autoscaler at 12 replicas, 60 × 12 = 720 connections exceeded Postgres max_connections (500). The database rejected new connections, including from other services.',
    guardrails: [
      'Pool size × max autoscaler replicas must stay below 80% of database max_connections; document the calculation in the PR.',
      'Use a connection proxy (PgBouncer) for services that autoscale.',
    ],
    tags: ['database', 'connection-pool', 'autoscaling', 'capacity'],
  },
  {
    ref: 'INC-112',
    title: 'Workers failed after database password rotation',
    date: '2026-09-02',
    severity: 'SEV2',
    durationMin: 95,
    components: ['background-workers', 'secrets'],
    impact: 'Order confirmation emails and refunds were delayed by up to 95 minutes.',
    trigger: 'The orders database password was rotated and the old credential revoked immediately.',
    rootCause: 'Background workers cached the credential at startup and were not restarted. Rotation used a single credential instead of a dual-credential overlap.',
    guardrails: [
      'Credential rotation must use dual credentials: create new, roll out, verify, then revoke old.',
      'Services must reload secrets without restart or be restarted as part of the rotation runbook.',
    ],
    tags: ['secrets', 'rotation', 'credentials'],
  },
  {
    ref: 'INC-113',
    title: 'Customers received four duplicate order emails after job retry',
    date: '2026-10-08',
    severity: 'SEV3',
    durationMin: 120,
    components: ['background-workers', 'notifications'],
    impact: '41,000 customers received 2–4 copies of their order confirmation; support tickets spiked 6x.',
    trigger: 'Automatic job retries were enabled for the notification worker after a queue timeout.',
    rootCause: 'The email job had no idempotency key, so every retry re-sent the email even when the first attempt had succeeded.',
    guardrails: [
      'Every job with external side effects (email, payment, webhook) must use an idempotency key before retries are enabled.',
    ],
    tags: ['idempotency', 'retry', 'notifications', 'jobs'],
  },
  {
    ref: 'INC-114',
    title: 'Search latency spike from full reindex during peak hours',
    date: '2026-10-21',
    severity: 'SEV3',
    durationMin: 75,
    components: ['search-service', 'elasticsearch'],
    impact: 'Search p95 latency rose from 180ms to 4.2s for 75 minutes during the evening peak.',
    trigger: 'A full reindex of the product index was started at 7pm after a mapping change.',
    rootCause: 'Reindexing in place competed with live queries for cluster resources. The reindex was not run against a new index with an alias swap.',
    guardrails: [
      'Reindex into a new index and swap the alias; never reindex the live index in place.',
      'Heavy search maintenance runs only off-peak (02:00–06:00 UTC).',
    ],
    tags: ['search', 'reindex', 'elasticsearch', 'peak-traffic'],
  },
];

export const DECISIONS = [
  {
    ref: 'ADR-007',
    title: 'ADR-007: Shared resilience library for all outbound HTTP calls',
    date: '2026-02-20',
    status: 'Accepted',
    components: ['payments-service', 'payment-gateway-client', 'shipping-rates-client'],
    context: 'After INC-105, a retry storm amplified a payment gateway blip into an hour-long outage. Teams were implementing retries ad hoc.',
    decision: 'All outbound HTTP clients must use the shared resilience library, which provides exponential backoff with jitter, retry budgets, timeouts and circuit breakers. Hand-rolled retry loops are not allowed.',
    consequences: 'New external integrations take slightly longer to set up; retry behaviour is consistent and observable.',
    tags: ['retry', 'resilience', 'circuit-breaker', 'http-client'],
  },
  {
    ref: 'ADR-012',
    title: 'ADR-012: Expand/contract schema migrations',
    date: '2026-02-01',
    status: 'Accepted',
    components: ['orders-db', 'customers-db'],
    context: 'INC-102 showed that a single blocking DDL statement can take checkout down.',
    decision: 'Schema changes follow expand/contract: add nullable columns, backfill in batches, add constraints after backfill, and remove old columns only after all readers have migrated. Table-rewriting DDL on large tables requires the online schema change tool.',
    consequences: 'Migrations take more steps but never block writes.',
    tags: ['migration', 'schema', 'database'],
  },
  {
    ref: 'ADR-015',
    title: 'ADR-015: Feature flag lifecycle — owners, expiry and archival',
    date: '2026-05-20',
    status: 'Accepted',
    components: ['feature-flags'],
    context: 'INC-103: deleting a flag still read by old mobile clients caused a crash loop.',
    decision: 'Every flag has an owner and an expiry date. Flags are archived (serving a safe default) for 60 days before deletion, and deletion requires zero evaluations across all clients for 30 days.',
    consequences: 'Flag cleanup is slower but safe for long-lived mobile clients.',
    tags: ['feature-flag', 'mobile', 'lifecycle'],
  },
  {
    ref: 'ADR-019',
    title: 'ADR-019: UTC everywhere for schedules and timestamps',
    date: '2026-04-05',
    status: 'Accepted',
    components: ['promotions-scheduler', 'pricing', 'background-workers'],
    context: 'INC-106: a promotion started early after a DST transition.',
    decision: 'All timestamps are stored in UTC. Schedules are stored as UTC plus an explicit IANA timezone for display. Server local time must never be used for business logic.',
    consequences: 'UI layers convert for display; schedules are unambiguous.',
    tags: ['timezone', 'utc', 'scheduling'],
  },
];

/**
 * "Upcoming work" issues created in the demo Jira project. Each one quietly
 * repeats a past mistake — this is what Precedent should catch on camera.
 */
export const DEMO_CHANGES = [
  {
    summary: 'Lower product catalog cache TTL to 30s so price changes show up faster',
    description: 'Merchandising wants price updates live within a minute. Proposal: change the Redis TTL for catalog entries from 10 minutes to 30 seconds in the catalog-service config.',
    components: ['catalog-service'],
    expect: 'INC-101',
  },
  {
    summary: 'Add retries to the shipping rates client',
    description: 'The shipping rates provider occasionally times out. Add 3 retries in the shipping rates HTTP client so checkout does not fail.',
    components: ['shipping-rates-client'],
    expect: 'ADR-007',
  },
  {
    summary: 'Remove the legacy_checkout feature flag',
    description: 'Web no longer uses the legacy checkout path. Delete the flag from the flag service and remove dead code.',
    components: ['feature-flags'],
    expect: 'INC-103',
  },
  {
    summary: 'Add loyalty_tier NOT NULL column to customers table',
    description: 'Loyalty program launch needs a loyalty_tier column with default "bronze" on the customers table (~25M rows). Write the migration.',
    components: ['customers-db'],
    expect: 'INC-102',
  },
  {
    summary: 'Increase database connection pool to 50 for the API service',
    description: 'We see requests waiting for a connection under load. Raise the pool size from 20 to 50 per pod.',
    components: ['api-service'],
    expect: 'INC-111',
  },
  {
    summary: 'Update onboarding copy on the account settings page',
    description: 'Marketing provided new wording for the account settings onboarding banner.',
    components: ['web-frontend'],
    expect: null,
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/** Render a postmortem in Confluence storage format, following a standard template. */
export function renderPostmortemStorage(inc, incidentKey) {
  return [
    `<p><strong>Severity:</strong> ${inc.severity} &nbsp; <strong>Date:</strong> ${inc.date} &nbsp; <strong>Duration:</strong> ${fmtDuration(inc.durationMin)}${incidentKey ? ` &nbsp; <strong>Incident:</strong> ${incidentKey}` : ''}</p>`,
    `<h2>Summary</h2><p>${esc(inc.title)}.</p>`,
    `<h2>Impact</h2><p>${esc(inc.impact)}</p>`,
    `<h2>Trigger</h2><p>${esc(inc.trigger)}</p>`,
    `<h2>Root cause</h2><p>${esc(inc.rootCause)}</p>`,
    `<h2>Affected components</h2><p>${inc.components.map(esc).join(', ')}</p>`,
    `<h2>Guardrails</h2><ul>${inc.guardrails.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`,
  ].join('\n');
}

/** Render an ADR in Confluence storage format. */
export function renderDecisionStorage(adr) {
  return [
    `<p><strong>Status:</strong> ${adr.status} &nbsp; <strong>Date:</strong> ${adr.date}</p>`,
    `<h2>Context</h2><p>${esc(adr.context)}</p>`,
    `<h2>Decision</h2><p>${esc(adr.decision)}</p>`,
    `<h2>Consequences</h2><p>${esc(adr.consequences)}</p>`,
    `<h2>Affected components</h2><p>${adr.components.map(esc).join(', ')}</p>`,
  ].join('\n');
}

/** Render an incident description as ADF for JSM. */
export function renderIncidentAdf(inc) {
  const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const h = (text) => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] });
  return {
    type: 'doc',
    version: 1,
    content: [
      p(`Severity: ${inc.severity} · Duration: ${fmtDuration(inc.durationMin)}`),
      h('Impact'), p(inc.impact),
      h('Trigger'), p(inc.trigger),
      h('Root cause'), p(inc.rootCause),
    ],
  };
}
