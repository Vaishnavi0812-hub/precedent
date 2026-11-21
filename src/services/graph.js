/**
 * Teamwork Graph access. Precedent uses the graph to answer "who has been here
 * before?": the people connected to a past incident's postmortem (creator,
 * owners, contributors) and the teams they belong to.
 *
 * Teamwork Graph is called as the current user (the platform only supports
 * asUser for it), so results respect that user's permissions.
 */
import api from '@forge/api';

/** Run a Teamwork Graph GraphQL operation. Throws on GraphQL errors (which arrive with HTTP 200). */
export async function twg(query, variables = {}, operationName) {
  const res = await api.asUser().requestTeamworkGraph(query, variables, operationName);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Teamwork Graph returned non-JSON (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok || (body.errors?.length && !body.data)) {
    const msg = body.errors?.map((e) => e.message).join('; ') || text.slice(0, 300);
    const err = new Error(`Teamwork Graph ${res.status}: ${msg}`);
    err.graphErrors = body.errors;
    throw err;
  }
  if (body.errors?.length) console.warn('Teamwork Graph partial errors', JSON.stringify(body.errors).slice(0, 500));
  return body.data;
}

/* ---------------- "Who has been here before?" ---------------- */

export const pageAri = (cloudId, pageId) => `ari:cloud:confluence:${cloudId}:page/${pageId}`;
export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;

const USER_FIELDS = '... on AtlassianUser { accountId name }';
const nodes = (conn) => (conn?.edges || []).map((e) => e?.node).filter(Boolean);

/** App/bot accounts (including Precedent itself, which writes the demo pages) are not "people to ask". */
function isHuman(u, appNames = []) {
  if (!u?.accountId || !u.name) return false;
  return !/\b(bot|automation for jira|system|atlassian assist)\b/i.test(u.name)
    && !appNames.some((n) => u.name.toLowerCase() === n.toLowerCase());
}

/**
 * People connected to a postmortem/decision page, the teams they are in, and the
 * pages it links to — one graph round trip for the page, one per person for teams.
 */
export async function whoHasBeenHere(cloudId, pageId, { appNames = ['precedent', 'Precedent'] } = {}) {
  const id = pageAri(cloudId, pageId);
  const data = await twg(
    `query precedent_pagePeople($id: ID!) {
      creator: confluencePageCreator(id: $id, first: 5) { edges { node { ${USER_FIELDS} } } }
      owners: confluencePageOwners(id: $id, first: 5) { edges { node { ${USER_FIELDS} } } }
      contributors: confluencePageContributors(id: $id, first: 10) { edges { node { ${USER_FIELDS} } } }
      linked: confluencePageLinkedConfluencePages(id: $id, first: 10) {
        edges { node { ... on ConfluencePage { pageId title webUrl } } }
      }
    }`,
    { id },
    'precedent_pagePeople',
  );

  const people = new Map();
  const add = (u, role) => {
    if (!isHuman(u, appNames)) return;
    const p = people.get(u.accountId) || { accountId: u.accountId, name: u.name, roles: [], teams: [] };
    if (!p.roles.includes(role)) p.roles.push(role);
    people.set(u.accountId, p);
  };
  nodes(data?.creator).forEach((u) => add(u, 'wrote the postmortem'));
  nodes(data?.owners).forEach((u) => add(u, 'owns the page'));
  nodes(data?.contributors).forEach((u) => add(u, 'contributed'));

  // Teams for up to 4 people (each is one graph call).
  const list = [...people.values()].slice(0, 4);
  await Promise.all(list.map(async (p) => {
    try {
      const t = await twg(
        `query precedent_userTeams($userId: ID!) {
          atlassianUserInTeams(userId: $userId, first: 5) { edges { node { ... on AtlassianTeam { displayName profileUrl } } } }
        }`,
        { userId: userAri(p.accountId) },
        'precedent_userTeams',
      );
      p.teams = nodes(t?.atlassianUserInTeams).map((x) => ({ name: x.displayName, url: x.profileUrl })).filter((x) => x.name);
    } catch (e) {
      console.warn('teams lookup failed', e.message);
    }
  }));

  return {
    people: list,
    relatedPages: nodes(data?.linked).filter((p) => p.title).map((p) => ({ title: p.title, url: p.webUrl, pageId: p.pageId })),
    source: 'teamwork-graph',
  };
}

const TYPE_REF = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';

/** Introspect the curated fields Precedent relies on, so queries match the live schema. */
export async function probeGraph() {
  const wanted = [
    'confluencePageCreator', 'confluencePageOwners', 'confluencePageContributors',
    'atlassianUserInTeams', 'jiraWorkItemComments', 'confluencePageLinkedConfluencePages',
  ];
  const data = await twg(
    `query precedent_probeSchema {
      __schema { queryType { name fields { name args { name type { ${TYPE_REF} } } type { ${TYPE_REF} } } } }
    }`,
    {},
    'precedent_probeSchema',
  );
  const fields = data?.__schema?.queryType?.fields || [];
  const found = fields.filter((f) => wanted.includes(f.name));
  const unwrap = (t) => { let x = t; while (x?.ofType) x = x.ofType; return x?.name; };
  const typeNames = [...new Set(found.map((f) => unwrap(f.type)).filter(Boolean))];
  const types = {};
  for (const name of typeNames) types[name] = await describeType(name, 3);
  const summary = {
    queryType: data?.__schema?.queryType?.name,
    totalQueryFields: fields.length,
    found: found.map((f) => ({ name: f.name, args: f.args.map((a) => `${a.name}:${unwrap(a.type)}`), returns: unwrap(f.type) })),
    missing: wanted.filter((w) => !found.some((f) => f.name === w)),
    types,
  };
  console.log('TWG_PROBE', JSON.stringify(summary));
  return summary;
}

/** Describe a type's fields (and nested object/union types) to a limited depth. */
async function describeType(name, depth, seen = new Set()) {
  if (!name || depth < 0 || seen.has(name)) return { name };
  seen.add(name);
  const data = await twg(
    `query precedent_probeType($name: String!) {
      __type(name: $name) { name kind fields { name type { ${TYPE_REF} } } possibleTypes { name } }
    }`,
    { name },
    'precedent_probeType',
  );
  const t = data?.__type;
  if (!t) return { name };
  const unwrap = (x) => { let y = x; while (y?.ofType) y = y.ofType; return { name: y?.name, kind: y?.kind }; };
  const out = { name: t.name, kind: t.kind };
  if (t.possibleTypes?.length) {
    out.possibleTypes = {};
    for (const p of t.possibleTypes.slice(0, 6)) out.possibleTypes[p.name] = await describeType(p.name, depth - 1, seen);
  }
  if (t.fields) {
    out.fields = {};
    for (const f of t.fields) {
      const u = unwrap(f.type);
      out.fields[f.name] = (u.kind === 'OBJECT' || u.kind === 'UNION' || u.kind === 'INTERFACE') && depth > 0
        ? await describeType(u.name, depth - 1, seen)
        : u.name;
    }
  }
  return out;
}
