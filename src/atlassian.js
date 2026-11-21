/**
 * Thin wrappers over Jira + Confluence REST APIs.
 * `as` is 'app' (triggers, background sync) or 'user' (panel reads, respects permissions).
 */
import api, { route } from '@forge/api';

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

export async function listProjects() {
  const res = await jira('app', route`/rest/api/3/project/search?maxResults=100&expand=description`, {}, 'list projects');
  return (res.values || []).map((p) => ({ id: p.id, key: p.key, name: p.name, type: p.projectTypeKey }));
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

/** CQL search returning pages with storage body and labels. */
export async function searchPages(cql, { max = 200 } = {}) {
  const pages = [];
  let start = 0;
  let base = '';
  while (pages.length < max) {
    const res = await confluence('app',
      route`/wiki/rest/api/content/search?cql=${cql}&expand=body.storage,metadata.labels,version&limit=50&start=${start}`,
      {}, 'search pages');
    base = res._links?.base || base;
    const results = res.results || [];
    pages.push(...results.map((p) => ({ ...p, labels: p.metadata?.labels?.results || [] })));
    if (results.length < 50) break;
    start += 50;
  }
  return { pages, base };
}

export function getPage(id) {
  return confluence('app', route`/wiki/rest/api/content/${id}?expand=body.storage,metadata.labels,version,space`, {}, 'get page');
}

export async function ensureSpace(key, name, description) {
  try {
    return await confluence('app', route`/wiki/rest/api/space/${key}`, {}, 'get space');
  } catch (e) {
    if (e.status !== 404) throw e;
    return confluence('app', route`/wiki/rest/api/space`, {
      method: 'POST',
      body: JSON.stringify({ key, name, description: { plain: { value: description, representation: 'plain' } } }),
    }, 'create space');
  }
}

export async function findPageByTitle(spaceKey, title) {
  const res = await confluence('app', route`/wiki/rest/api/content?spaceKey=${spaceKey}&title=${title}&expand=version`, {}, 'find page');
  return res.results?.[0];
}

export function createPage({ spaceKey, title, storage, parentId }) {
  return confluence('app', route`/wiki/rest/api/content`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'page', title, space: { key: spaceKey },
      ...(parentId ? { ancestors: [{ id: parentId }] } : {}),
      body: { storage: { value: storage, representation: 'storage' } },
    }),
  }, `create page "${title}"`);
}

export function addPageLabels(pageId, labels) {
  return confluence('app', route`/wiki/rest/api/content/${pageId}/label`, {
    method: 'POST', body: JSON.stringify(labels.map((name) => ({ prefix: 'global', name }))),
  }, 'add page labels');
}
