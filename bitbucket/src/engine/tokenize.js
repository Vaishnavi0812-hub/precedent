/**
 * Text normalisation for Precedent's matching engine.
 *
 * Deterministic by design: no paid LLM calls, same input -> same output,
 * which keeps the issue panel fast, free and predictable for judges.
 */

const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does doing done for from had has have
   having he her here hers him his how i if in into is it its itself just let me more most my no nor
   not now of off on once only or other our ours out over own same she should so some such than that
   the their theirs them then there these they this those through to too under until up very was we
   were what when where which while who whom why will with would you your yours also via per eg ie etc
   we'll it's don't can't won't need needs needed want wants make makes made get gets got use used using
   new add adds added update updates updated change changes changed should ticket task story issue please
   team so that able allow allows service services within minute minutes second seconds request requests fix user users
   currently around instead without because`.split(/\s+/).filter(Boolean)
);

/**
 * Domain synonyms. Each raw token also emits its canonical concept, so
 * "redis TTL" and "cache expiry" land on the same terms.
 */
const SYNONYMS = {
  ttl: 'expiry', expiration: 'expiry', expire: 'expiry', expires: 'expiry', expiring: 'expiry', expired: 'expiry',
  redis: 'cache', memcached: 'cache', cdn: 'cache', caching: 'cache', cached: 'cache',
  db: 'database', postgres: 'database', postgresql: 'database', mysql: 'database', rds: 'database', sql: 'database',
  k8s: 'kubernetes', pod: 'kubernetes', pods: 'kubernetes', helm: 'kubernetes',
  deploy: 'release', deploys: 'release', deployment: 'release', deployed: 'release', rollout: 'release',
  retries: 'retry', retrying: 'retry', retried: 'retry', backoff: 'retry',
  oom: 'memory', oomkill: 'memory', oomkilled: 'memory', ram: 'memory', heap: 'memory',
  cert: 'certificate', certs: 'certificate', tls: 'certificate', ssl: 'certificate',
  flag: 'featureflag', flags: 'featureflag', toggle: 'featureflag', toggles: 'featureflag', launchdarkly: 'featureflag',
  dst: 'timezone', tz: 'timezone', utc: 'timezone', cron: 'schedule', scheduled: 'schedule', scheduler: 'schedule',
  ratelimit: 'ratelimit', throttle: 'ratelimit', throttling: 'ratelimit', quota: 'ratelimit',
  pool: 'connectionpool', pooling: 'connectionpool', connections: 'connection',
  password: 'secret', credential: 'secret', credentials: 'secret', apikey: 'secret', token: 'secret', rotate: 'rotation', rotating: 'rotation',
  reindex: 'index', reindexing: 'index', elasticsearch: 'search', opensearch: 'search',
  upgrade: 'dependency', bump: 'dependency', library: 'dependency', lib: 'dependency', sdk: 'dependency',
  logging: 'log', logs: 'log', verbose: 'log', debug: 'log',
  migration: 'migrate', migrations: 'migrate', schema: 'migrate', ddl: 'migrate', alter: 'migrate', column: 'migrate',
  email: 'notification', emails: 'notification', sms: 'notification', push: 'notification',
  duplicate: 'idempotency', duplicates: 'idempotency', idempotent: 'idempotency', dedupe: 'idempotency',
};

/** Phrases collapsed to a single token before splitting. */
const PHRASES = [
  [/rate[\s-]+limit(s|ing|ed)?/g, 'ratelimit'],
  [/feature[\s-]+flag(s)?/g, 'featureflag'],
  [/connection[\s-]+pool(s|ing)?/g, 'connectionpool'],
  [/not[\s-]+null/g, 'notnull'],
  [/time[\s-]?zone(s)?/g, 'timezone'],
  [/daylight[\s-]+saving(s)?/g, 'timezone'],
  [/circuit[\s-]+breaker(s)?/g, 'circuitbreaker'],
  [/max[_\s-]?connections/g, 'maxconnections'],
  [/memory[\s-]+limit(s)?/g, 'memorylimit'],
  [/web[\s-]?hook(s)?/g, 'webhook'],
  [/black[\s-]+friday/g, 'peaktraffic'],
  [/peak[\s-]+(traffic|load|hours?)/g, 'peaktraffic'],
  [/load[\s-]+test(s|ing)?/g, 'loadtest'],
  [/time[\s-]+to[\s-]+live/g, 'ttl'],
  [/(api|access|secret)[\s-]+keys?/g, 'apikey'],
];

/** Light, predictable suffix stemmer (Porter-lite). */
export function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  const rules = [
    [/ational$/, 'ate'], [/izations?$/, 'ize'], [/ations?$/, 'ate'],
    [/ies$/, 'y'], [/ied$/, 'y'],
    [/(ch|sh|x|ss)es$/, '$1'],
    [/ing$/, ''], [/ed$/, ''],
    [/([^su])s$/, '$1'],
  ];
  for (const [re, rep] of rules) {
    if (re.test(w)) {
      const next = w.replace(re, rep);
      if (next.length >= 3) { w = next; break; }
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/**
 * Tokenise text into stemmed terms.
 * @returns {{ terms: string[], surface: Map<string,string> }} surface maps a term back
 *   to the first human-readable word that produced it (for "why it matched" chips).
 */
export function analyze(text) {
  const terms = [];
  const surface = new Map();
  if (!text) return { terms, surface };
  let t = String(text).toLowerCase();
  for (const [re, rep] of PHRASES) t = t.replace(re, ` ${rep} `);
  const raw = t.split(/[^a-z0-9_]+/).filter(Boolean);
  for (const word of raw) {
    if (word.length < 2 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    const emit = (w, display) => {
      const s = stem(w);
      if (!s || STOPWORDS.has(s)) return;
      terms.push(s);
      if (!surface.has(s)) surface.set(s, display);
    };
    emit(word, word);
    const syn = SYNONYMS[word] || SYNONYMS[stem(word)];
    if (syn && syn !== word) emit(syn, word);
  }
  return { terms, surface };
}

export function tokenize(text) {
  return analyze(text).terms;
}

/** Normalise a component / service name for exact overlap checks. */
export function normalizeComponent(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
