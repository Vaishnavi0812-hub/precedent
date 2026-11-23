/**
 * Reads postmortems and decision records from the team's Confluence site.
 *
 * A Bitbucket Forge app cannot share storage or product APIs with the Jira/Confluence
 * app (Forge keeps workspace and site apps separate), so the companion reads Confluence
 * over REST with credentials the workspace admin provides. The token is stored as a
 * Forge secret and never returned to the browser.
 */
import { fetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import { lessonFromConfluencePage, classifyPage } from './engine/extract.js';

const CONFIG_KEY = 'confluence:config';
const TOKEN_KEY = 'confluence:token';
const LESSONS_KEY = 'lessons';

export const DEFAULT_LABELS = ['postmortem', 'post-mortem', 'pir', 'incident-review', 'decision', 'adr', 'architecture-decision'];

export async function getConfig() {
  const cfg = (await kvs.get(CONFIG_KEY)) || {};
  const hasToken = Boolean(await kvs.getSecret(TOKEN_KEY));
  return { siteUrl: cfg.siteUrl || '', email: cfg.email || '', labels: cfg.labels || DEFAULT_LABELS, hasToken };
}

export async function saveConfig({ siteUrl, email, token }) {
  const clean = String(siteUrl || '').trim().replace(/\/+$/, '').replace(/\/wiki$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(clean)) {
    throw new Error('Site URL must look like https://your-site.atlassian.net');
  }
  await kvs.set(CONFIG_KEY, { siteUrl: clean, email: String(email || '').trim() });
  if (token) await kvs.setSecret(TOKEN_KEY, String(token).trim());
  return getConfig();
}

async function authHeader() {
  const cfg = (await kvs.get(CONFIG_KEY)) || {};
  const token = await kvs.getSecret(TOKEN_KEY);
  if (!cfg.siteUrl || !cfg.email || !token) throw new Error('Connect Precedent to your Confluence site first (workspace settings → Precedent).');
  return { base: cfg.siteUrl, auth: `Basic ${Buffer.from(`${cfg.email}:${token}`).toString('base64')}` };
}

async function get(path) {
  const { base, auth } = await authHeader();
  const res = await fetch(`${base}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' (check the email and API token)' : '';
    throw new Error(`Confluence ${res.status}${hint}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

/** Fetch every labelled postmortem/decision page and turn it into a lesson. */
export async function syncLessons() {
  const started = Date.now();
  const { labels } = await getConfig();
  const { base } = await authHeader();
  // Labelled pages, plus pages that look like postmortems/ADRs by title (most teams don't label).
  const discover = ['postmortem', 'post-mortem', 'incident review', 'incident report', 'root cause', 'RCA', 'PIR', 'ADR', 'architecture decision', 'decision record']
    .map((t) => `title ~ "${t}"`).join(' OR ');
  const cql = `type=page AND (label in (${labels.map((l) => `"${l}"`).join(',')}) OR ${discover})`;
  const ids = [];
  for (let start = 0; start < 300; start += 50) {
    const res = await get(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=50&start=${start}`);
    const results = res.results || [];
    ids.push(...results.filter((r) => r.content?.type === 'page').map((r) => r.content.id));
    if (results.length < 50) break;
  }
  const lessons = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map(async (id) => {
      try {
        const [page, lbl] = await Promise.all([
          get(`/wiki/api/v2/pages/${id}?body-format=storage`),
          get(`/wiki/api/v2/pages/${id}/labels?limit=100`),
        ]);
        const p = {
          id: page.id,
          title: page.title,
          body: { storage: { value: page.body?.storage?.value || '' } },
          labels: (lbl.results || []).map((l) => ({ name: l.name })),
          _links: { webui: page._links?.webui },
        };
        const labelled = p.labels.some((l) => labels.includes(l.name.toLowerCase()));
        if (!labelled && !classifyPage(p)) return null;
        const lesson = lessonFromConfluencePage(p, `${base}/wiki`);
        if (!labelled && !(lesson.trigger || lesson.rootCause || lesson.guardrails.length)) return null;
        return lesson;
      } catch (e) {
        console.warn(`page ${id}: ${e.message}`);
        return null;
      }
    }));
    lessons.push(...batch.filter(Boolean));
  }
  // Lessons are small; store them in chunks to stay under KVS value limits.
  const chunks = [];
  for (let i = 0; i < lessons.length; i += 40) chunks.push(lessons.slice(i, i + 40));
  for (let i = 0; i < chunks.length; i += 1) await kvs.set(`${LESSONS_KEY}:${i}`, chunks[i]);
  await kvs.set(`${LESSONS_KEY}:meta`, { chunks: chunks.length, total: lessons.length, at: new Date().toISOString(), tookMs: Date.now() - started });
  return { total: lessons.length, postmortems: lessons.filter((l) => l.sourceType === 'postmortem').length, decisions: lessons.filter((l) => l.sourceType === 'decision').length };
}

export async function loadLessons() {
  const meta = await kvs.get(`${LESSONS_KEY}:meta`);
  if (!meta) return { lessons: [], meta: null };
  const lessons = [];
  for (let i = 0; i < meta.chunks; i += 1) lessons.push(...((await kvs.get(`${LESSONS_KEY}:${i}`)) || []));
  return { lessons, meta };
}
