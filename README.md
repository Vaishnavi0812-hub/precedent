# Precedent

**Your team already knows how this breaks. Precedent makes sure it remembers.**

Precedent is an Atlassian Forge app built for Codegeist 2026. It reads your postmortems, incidents and architecture decisions, and warns your team when a new piece of work looks like something that has hurt you before. It flags the risk at the moment of change, before the code is written, and turns the lesson into a guardrail with one click.

> "Lower product catalog cache TTL to 30s" → ⚠️ *Déjà vu: INC-101 caused a 47 min checkout outage after exactly this change. Root cause: cache stampede. Guardrails: staggered rollout with jitter, cache warm-up, load-test the origin first.* → **[Add]**

## Why

Teams write careful postmortems and then lose them. Months later, someone makes the same change in the same way and causes the same outage. The lesson existed. It just wasn't in front of the person making the change. Precedent closes that gap.

## What it does

| Capability | Where |
|---|---|
| **Déjà vu panel**: past incidents and decisions that resemble this change, with what went wrong, impact, and the agreed guardrails | Jira issue panel |
| **One-click guardrails**: turn a lesson into a sub-task, or a checklist comment if sub-tasks aren't available | Jira issue panel |
| **Auto-flag**: a single warning comment when a newly created issue strongly matches a past incident | Jira trigger |
| **Learning loop**: new postmortems and decision pages, and resolved JSM incidents, are learned automatically | Confluence and Jira triggers, hourly sync |
| **Lesson library and quality score**: how actionable each postmortem is | Jira admin page |
| **One-click demo history**: realistic incident history for a fictional company, so it works on a fresh site | Jira admin page |
| **Rovo agent, MCP server, Bitbucket PR checks, Teamwork Graph** | *in progress* |

## How matching works

Precedent uses deterministic retrieval, not a paid LLM call on every page view. That makes it fast, free to run, and consistent: the same change always gets the same answer.

1. **Extraction**: postmortems and ADRs are split by heading (Trigger, Root cause, Impact, Guardrails, Components and common aliases, including Atlassian's postmortem template). Incidents are parsed from ADF.
2. **Indexing**: field-weighted BM25. Triggers and components weigh most, because they describe *the kind of change* that caused the incident. A domain synonym layer bridges vocabulary ("redis TTL" ≈ "cache expiry", "pool" ≈ "connection pool").
3. **Scoring**: confidence blends BM25 strength, query coverage and component overlap, then maps to a level: strong, possible or weak. Single-word coincidences are suppressed.
4. **Explainability**: every match shows the terms and components that triggered it.

## Develop

```bash
npm install
npm test                 # engine unit tests (demo scenarios included)
forge register           # first time only
forge deploy
forge install            # pick your Jira site; also install on Confluence
```

Then go to **Jira settings → Apps → Precedent** and click **Load demo history**.

## Project layout

```
src/
  engine/       tokenize, extract (postmortem/ADF parsing), match (BM25 + confidence)
  services/     precedent (check/apply/auto-flag), ingest (sync + learning loop), seed (demo)
  data/         demo history: 14 incidents, 4 ADRs, 6 near-miss work items
  frontend/     UI Kit issue panel and admin page
  atlassian.js  Jira/Confluence REST helpers
  store.js      Forge KVS persistence
test/           node:test suite
```

## License

MIT
