# Devpost submission: Precedent

> Paste each section into the matching Devpost field.
> **Category:** Apps for Software Teams · **Bonus prize:** Best Rovo Agent (the app also uses MCP and Teamwork Graph)

---

## Tagline (one line)

Your team already paid for this lesson once. Precedent warns you, in Jira, Rovo and the pull request, before you pay for it twice.

## Inspiration

Every engineering org has a folder of excellent postmortems that nobody reads. Then, months later:

- someone lowers a cache TTL "so prices update faster",
- or adds retries "to make payments more reliable",
- or drops a feature flag that old app versions still depend on,

and the same outage happens again. The lesson was written down. It just wasn't in front of the person making the change, at the moment they made it.

Atlassian already helps teams *write* the lesson: Jira Service Management post-incident reviews, Confluence templates, and Rovo Ops, which can show similar incidents *during* an incident. All of them wait for someone to ask. Nobody asks "has this hurt us before?" before shipping a change that looks harmless. We wanted a tool that asks for them.

## What it does

Precedent reads your incident history (JSM incidents, Confluence postmortems, RCAs and architecture decision records) and warns at the moment of change:

- **Jira: Déjà vu panel.** Every work item is checked against past incidents. A matching item shows what went wrong last time, what it cost and the guardrails agreed afterwards. One click turns a guardrail into a sub-task on the new work.
- **Jira: auto-flag.** Strong matches get a single warning comment when the issue is created. Nobody has to open anything.
- **Risk radar, for managers.** One view of all open work, or just the coming sprints, that repeats a past incident. Unguarded items come first, with the outage minutes at stake. Rovo answers it in chat too: *"What in our upcoming work could repeat an incident?"*
- **Guardrail follow-through.** Adding a guardrail is a promise. If the work is marked done while its guardrail sub-task is still open, Precedent says so on the issue and names the incident it came from. The dashboard tracks guardrails adopted, done and skipped.
- **Bitbucket: repeat-incident check.** A PR panel names the incident the diff resembles. A custom merge check fails until the author acknowledges it (`Precedent-Ack: INC-105`).
- **Rovo agent "Precedent":**
  - "I'm about to add retries to the shipping client. Has this gone wrong before?"
  - "What in our upcoming work could repeat an incident?" (the risk radar)
  - "Where do we keep getting hurt?" (risk hotspots by component, weighted by outage minutes)
  - "What happened in INC-105?"
  - "Add the guardrail to LUMEN-2."

  Seven actions, answers grounded in the incident history, every claim linked to its source.
- **MCP server:** the same seven tools for coding agents in the IDE, so the warning reaches the editor too.
- **Teamwork Graph: "Who has been here before?"** Traces a postmortem to the people who wrote and edited it, their teams and linked decisions, so you know who to ask.
- **The loop closes itself:**
  - When an incident is resolved, Precedent drafts its postmortem in Confluence. The draft uses exactly the sections it learns from, and the incident is told whether this has happened before.
  - A coach on every postmortem scores how actionable it is and shows how many later changes it has protected.
  - Unlabelled pages are discovered automatically, so no re-labelling project is needed.
- **Impact dashboard:** near-misses caught, the outage minutes those same mistakes cost last time, would-be SEV1 repeats, guardrails adopted, and your weakest postmortems.

It also works on a brand-new site in two minutes: **Load demo history** creates two years of realistic history for a fictional online store, including five upcoming work items that quietly repeat past mistakes.

## How we built it

- **Forge, end to end:**
  - UI Kit for the Jira issue panel, Jira page and Confluence byline popup.
  - Forge triggers and scheduled triggers, plus a Forge queue for long-running work.
  - Forge KVS for storage.
  - The `rovo:agent` and `rovo:mcp` modules.
  - Teamwork Graph through `requestTeamworkGraph`.
  - A Bitbucket companion app with `repoPullRequestOverviewPanel` and `mergeCheck`.
- **A deterministic matching engine, deliberately.** Postmortems are parsed by heading (trigger, root cause, impact, guardrails, components, plus common aliases) into structured "lessons". New work is scored with field-weighted BM25, where triggers and components weigh most, because the *kind of change* predicts the next incident. A domain synonym layer bridges vocabulary ("redis TTL" ≈ "cache expiry"), and component overlap adds signal. The result:
  - Every check is instant, free and repeatable.
  - Every match explains itself ("matched on: catalog-service, ttl, cache").
  - Open-ended reasoning goes to Rovo, which is included with Atlassian Cloud.
- **Runs on Atlassian.** The main app has no egress and no remote back end. Data never leaves the customer's site.
- **27 automated tests** cover extraction, matching on every demo scenario, page discovery, postmortem drafts and the Bitbucket path logic.

## Challenges we ran into

- **Forge gives Jira and Confluence separate storage**, even for the same app on the same site. The Confluence coach couldn't see which changes a postmortem had protected. We solved it by publishing each page's impact as a Confluence *page property* that both sides can read. We also added a 5-minute incremental sync, because Confluence page events never reach the Jira install.
- **Bitbucket modules can't share an app with site products.** Precedent for Bitbucket is therefore a small companion app that reuses the same engine through a sync script.
- **Function timeouts versus a realistic demo.** Creating projects, 14 incidents, 18 Confluence pages and 6 work items takes longer than one Forge invocation allows. Seeding is a resumable job that runs in 15-second slices on a queue and survives restarts.
- **Real teams don't label their postmortems.** Label-only ingestion meant an empty app on a real site, so we added title- and structure-based discovery with a "must say something actionable" filter.
- **Precision on real data.** On a site full of ordinary tickets, short titles like "Alter logo on home screen" scored as precedents because they shared one word with an outage. We changed confidence to require corroboration: distinct words of the change that agree with the lesson, with component overlap counting double. Real precedents kept their 0.8–0.99 scores, coincidences dropped below the bar, and regression tests now guard that.
- **Sites differ.** Some have no Jira Service Management, some can't create spaces, some lack sub-tasks. Every step falls back gracefully (incidents in a Jira project, an existing space, a checklist comment).

## Accomplishments that we're proud of

- A judge can go from *install* to *"oh, that would have caught our outage"* in about three minutes, on an empty site.
- One lesson flows through **seven Atlassian surfaces**: JSM, Confluence, Jira, Bitbucket, Rovo, MCP and Teamwork Graph.
- It measures itself. "5 near-misses caught; those same mistakes cost 352 outage minutes last time" (from the demo data) is a number a VP can take to a planning meeting.
- It makes postmortems better over time instead of just consuming them.

## What we learned

- The best moment to deliver a lesson isn't during the incident. It's at planning time, on the ticket, and again on the pull request.
- Deterministic retrieval plus an agent for conversation beats calling an LLM on every page view. It's cheaper, faster and easier to trust.
- Forge's product boundaries (storage, events, Bitbucket scopes) shape the architecture. Design for them early.

## What's next for Precedent

- Confluence and Compass signals: flag changes to components with a history of repeat incidents in their scorecards.
- Semantic matching via Rovo for paraphrased changes, kept behind the deterministic first pass.
- Tie the Bitbucket merge check to guardrail follow-through: fail the merge while the matching guardrail sub-task is still open.
- Marketplace release.

## Built with

Atlassian Forge · Forge UI Kit · Rovo agents · Forge MCP (`rovo:mcp`) · Teamwork Graph · Jira · Jira Service Management · Confluence · Bitbucket Cloud · Forge KVS · Forge Events (queues) · Node.js 22 · JavaScript · React

## Links

- **Code:** https://github.com/Vaishnavi0812-hub/precedent
- **Install (Jira + Confluence):** see the README, "Try it in 5 minutes"
- **Install (Bitbucket):** see the README
- **Video:** *(YouTube link)*
