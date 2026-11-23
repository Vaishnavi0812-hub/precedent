/**
 * Thin wrappers over Jira + Confluence REST APIs.
 * `as` is 'app' (triggers, background sync) or 'user' (panel reads, respects permissions).
 */
import api, { route } from '@forge/api';

/** The user hasn't granted the app permission to act as them yet. Must propagate
 *  out of the resolver so Forge shows the "Allow access" consent prompt. */
export function isAuthError(e) {
  return e?.name === 'NeedsAuthenticationError' || e?.constructor?.name === 'NeedsAuthenticationError' || e?.message === 'Authentication Required';
}

const client = (as) => (as === 'user' ? api.asUser() : api.asApp());

async function json(res, what) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${what} failed: ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

/* ---------------- Jira ---------------- */

export async function jira(as, r, init = {}, what = 'Jira request') {
  const res = await client(as).requestJira(r, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return json(res, what);
}

let jiraBase;
export async function jiraBaseUrl() {
  if (!jiraBase) jiraBase = (await jira('app', route`/rest/api/3/serverInfo`, {}, 'serverInfo')).baseUrl;
  return jiraBase;
}

export const ISSUE_FIELDS = ['summary', 'description', 'components', 'labels', 'issuetype', 'project', 'status', 'priority', 'resolutiondate', 'created', 'parent'];

export function getIssue(key, as = 'app') {
  return jira(as, route`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS.join(',')}`, {}, `get issue ${key}`);
}

/** JQL search using the enhanced search endpoint with token pagination. */
export async function searchIssues(jql, { fields = ISSUE_FIELDS, max = 200, as = 'app' } = {}) {
  const issues = [];
  let nextPageToken;
  do {
    const page = await jira(as, route`/rest/api/3/search/jql`, {
      method: 'POST',
      body: JSON.stringify({ jql, fields, maxResults: Math.min(100, max - issues.length), nextPageToken }),
    }, 'search issues');
    issues.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < max);
  return issues;
}

export function addComment(issueKey, adfBody) {
  return jira('app', route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST', body: JSON.stringify({ body: adfBody }),
  }, 'add comment');
}

export function addLabels(issueKey, labels) {
  return jira('app', route`/rest/api/3/issue/${issueKey}`, {
    method: 'PUT', body: JSON.stringify({ update: { labels: labels.map((add) => ({ add })) } }),
  }, 'add labels');
}

export function setIssueProperty(issueKey, propertyKey, value) {
  return jira('app', route`/rest/api/3/issue/${issueKey}/properties/${propertyKey}`, {
    method: 'PUT', body: JSON.stringify(value),
  }, 'set issue property');
}

export async function getSubtaskTypeId(projectKey) {
  const res = await jira('app', route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, {}, 'createmeta');
  const types = res.issueTypes || res.values || [];
  return types.find((t) => t.subtask)?.id;
}

export function createIssue(fields) {
  return jira('app', route`/rest/api/3/issue`, { method: 'POST', body: JSON.stringify({ fields }) }, 'create issue');
}

export async function listProjects(as = 'app') {
  const res = await jira(as, route`/rest/api/3/project/search?maxResults=100&expand=description`, {}, 'list projects');
  return (res.values || []).map((p) => ({ id: p.id, key: p.key, name: p.name, type: p.projectTypeKey, style: p.style }));
}

/** Create a company-managed project (supports components). Runs as the admin who clicked setup. */
export function createProject({ key, name, type, template, leadAccountId, description }, as = 'app') {
  return jira(as, route`/rest/api/3/project`, {
    method: 'POST',
    body: JSON.stringify({ key, name, projectTypeKey: type, projectTemplateKey: template, leadAccountId, description, assigneeType: 'UNASSIGNED' }),
  }, `create project ${key}`);
}

export function myself(as = 'user') {
  return jira(as, route`/rest/api/3/myself`, {}, 'myself');
}

/* ---------------- Confluence ---------------- */

export async function confluence(as, r, init = {}, what = 'Confluence request') {
  const res = await client(as).requestConfluence(r, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return json(res, what);
}

let wikiBase;
/** e.g. https://site.atlassian.net/wiki */
export async function confluenceBaseUrl() {
  if (!wikiBase) wikiBase = `${await jiraBaseUrl()}/wiki`;
  return wikiBase;
}

/** Normalise a v2 page (+ labels) into the shape the extractor expects. */
function normalizePage(page, labels) {
  return {
    id: page.id,
    title: page.title,
    spaceId: page.spaceId,
    body: { storage: { value: page.body?.storage?.value || '' } },
    labels: labels.map((l) => ({ name: l.name })),
    _links: { webui: page._links?.webui },
  };
}

async function pageLabels(id) {
  const res = await confluence('app', route`/wiki/api/v2/pages/${id}/labels?limit=100`, {}, 'page labels');
  return res.results || [];
}

/** Fetch one page (v2) with storage body and labels. */
export async function getPage(id) {
  const [page, labels] = await Promise.all([
    confluence('app', route`/wiki/api/v2/pages/${id}?body-format=storage`, {}, 'get page'),
    pageLabels(id),
  ]);
  return normalizePage(page, labels);
}

/**
 * Page properties: small JSON values stored on the page itself. Jira and
 * Confluence installs of a Forge app have separate storage, so anything both
 * sides need to see about a page lives here.
 */
export async function getPageProperty(pageId, key) {
  const res = await confluence('app', route`/wiki/api/v2/pages/${pageId}/properties?key=${key}`, {}, 'get page property');
  return res.results?.[0] || null;
}

export async function setPageProperty(pageId, key, value) {
  const cur = await getPageProperty(pageId, key);
  if (cur) {
    return confluence('app', route`/wiki/api/v2/pages/${pageId}/properties/${cur.id}`, {
      method: 'PUT', body: JSON.stringify({ key, value, version: { number: (cur.version?.number || 1) + 1 } }),
    }, 'update page property');
  }
  return confluence('app', route`/wiki/api/v2/pages/${pageId}/properties`, {
    method: 'POST', body: JSON.stringify({ key, value }),
  }, 'create page property');
}

/** CQL search (v1 search API, which has no v2 equivalent), then hydrate pages via v2. */
export async function searchPages(cql, { max = 200 } = {}) {
  const ids = [];
  let start = 0;
  while (ids.length < max) {
    const res = await confluence('app', route`/wiki/rest/api/search?cql=${cql}&limit=50&start=${start}`, {}, 'search pages');
    const results = (res.results || []).filter((r) => r.content?.type === 'page');
    ids.push(...results.map((r) => r.content.id));
    if ((res.results || []).length < 50) break;
    start += 50;
  }
  const pages = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map((id) => getPage(id).catch((e) => { console.warn(`page ${id}: ${e.message}`); return null; })));
    pages.push(...batch.filter(Boolean));
  }
  return { pages, base: await confluenceBaseUrl() };
}

const spaceIds = new Map();
export async function getSpaceId(key) {
  if (spaceIds.has(key)) return spaceIds.get(key);
  const res = await confluence('app', route`/wiki/api/v2/spaces?keys=${key}&limit=1`, {}, 'get space');
  const id = res.results?.[0]?.id;
  if (id) spaceIds.set(key, id);
  return id;
}

export async function ensureSpace(key, name, description) {
  const existing = await getSpaceId(key);
  if (existing) return { id: existing, key };
  const created = await confluence('app', route`/wiki/api/v2/spaces`, {
    method: 'POST',
    body: JSON.stringify({ key, name, description: { value: description, representation: 'plain' } }),
  }, 'create space');
  spaceIds.set(key, created.id);
  return created;
}

export async function findPageByTitle(spaceKey, title) {
  const spaceId = await getSpaceId(spaceKey);
  if (!spaceId) return undefined;
  const res = await confluence('app', route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&limit=1`, {}, 'find page');
  return res.results?.[0];
}

export async function createPage({ spaceKey, title, storage, parentId }) {
  const spaceId = await getSpaceId(spaceKey);
  return confluence('app', route`/wiki/api/v2/pages`, {
    method: 'POST',
    body: JSON.stringify({
      spaceId, status: 'current', title,
      ...(parentId ? { parentId } : {}),
      body: { representation: 'storage', value: storage },
    }),
  }, `create page "${title}"`);
}

/** Replace a page's storage body (v2), bumping the version. */
export async function updatePageBody(id, title, storage) {
  const cur = await confluence('app', route`/wiki/api/v2/pages/${id}`, {}, 'get page version');
  return confluence('app', route`/wiki/api/v2/pages/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      id, status: 'current', title,
      body: { representation: 'storage', value: storage },
      version: { number: (cur.version?.number || 1) + 1, message: 'Precedent: link follow-up decision' },
    }),
  }, `update page "${title}"`);
}

/** Adding labels has no v2 endpoint; the v1 label API is still supported. */
export function addPageLabels(pageId, labels) {
  return confluence('app', route`/wiki/rest/api/content/${pageId}/label`, {
    method: 'POST', body: JSON.stringify(labels.map((name) => ({ prefix: 'global', name }))),
  }, 'add page labels');
}
