# Precedent

**Your team already paid for this lesson once. Precedent makes sure you don't pay twice.**

Precedent is an Atlassian Forge app, built for Codegeist 2026, that turns your incident history into a safety net. It reads your postmortems, incidents and architecture decisions. When someone plans a change that resembles something that has hurt you before, it warns them in Jira, in Rovo and on the Bitbucket pull request, before the change ships. The guardrails your team already agreed on become one click away.

> **LUMEN-15** "Lower product catalog cache TTL to 30s so price changes show up faster"
> ⚠️ **Déjà vu.** INC-101 caused a 47 min checkout outage in Mar 2026 after exactly this change (cache stampede, ~$310k lost).
> Guardrails: roll TTL changes out gradually with jitter · warm the cache first · load-test the origin at 3× peak → **[Add]** creates the sub-task.

---

## The problem

Teams write careful, blameless postmortems, and then nobody reads them again. Months later, someone lowers a cache TTL, raises a retry count or drops a feature flag, and the same outage happens again. The lesson existed. It just wasn't in front of the person making the change, at the moment they made it.

Atlassian's tools help you **write** the postmortem: Jira Service Management post-incident reviews, Confluence templates, Rovo search. They all wait for someone to ask. Nobody asks "has this hurt us before?" before shipping a change that looks harmless. **Precedent asks for them.**

## What it does

| | Where | What happens |
|---|---|---|
| **Déjà vu panel** | Jira issue | Past incidents and decisions that resemble this work: what went wrong, what it cost, and the guardrails agreed afterwards. The panel also shows why each match was made. |
| **One-click guardrails** | Jira issue | Each guardrail becomes a tracked sub-task (or a checklist comment) on the new work. |
| **Auto-flag** | Jira | New issues that strongly resemble a past incident get one warning comment, without anyone opening the panel. |
| **Repeat-incident check** | Bitbucket PR | A PR panel names the incident the diff resembles. A merge check fails until the author acknowledges it (`Precedent-Ack: INC-105`). It blocks merges on Premium workspaces and warns on other plans. |
| **Rovo agent "Precedent"** | Rovo chat | "Has this gone wrong before?", "Where do we keep getting hurt?", "Who has been here before?", "Add the guardrail". Six actions, answers backed by the incident history. |
| **MCP server** | Any MCP client | The same six tools, available to coding agents in the IDE. |
| **Who has been here before?** | Jira and Rovo | Uses **Teamwork Graph** to trace a postmortem to the people who wrote and edited it, their teams, and linked decisions. You know who to ask. |
| **Postmortem drafts** | JSM → Confluence | When an incident is resolved, Precedent drafts the postmortem in Confluence with the sections it learns from. It also tells the incident if *this has happened before*. |
| **Postmortem quality coach** | Confluence byline | Scores every postmortem and decision record for actionability, says what's missing, and shows how many later changes the page has already protected. |
| **Finds your history without labels** | Confluence | Recognises postmortems, RCAs, incident reviews and ADRs by title and structure. No re-labelling project needed. |
| **Impact dashboard** | Jira (Apps → Precedent) | Near-misses caught, outage minutes those same mistakes cost last time, would-be SEV1 repeats, guardrails adopted, and the weakest postmortems. |

## Try it in 5 minutes (judges start here)

1. **Install** Precedent on your site (Jira **and** Confluence): **[Install Precedent for Jira + Confluence](https://developer.atlassian.com/console/install/b3f2aded-a5b9-4610-a6f1-0af3336dbb5e?signature=AYABeMzFBcefeBvdj4TYlv41AK8AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB9Y5yJ0yr91A6FI22JGowfgAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDCA2oDZgERRxSVOmngIBEIA7blhQ7QkNt2Ihsbezxm7D98zrgpl7%2Ft%2FGh3brduPnOiC1AXgu4Cyu6H3e0gcGDYazcmFRX4RrESo%2F7zUAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFfLJSgqrwHhT0AbP%2FPXC2ZAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMdLYWT1uXidNRYRYpAgEQgDsh4GpwAgW6Ak1sCPaw4gjFW6XxvBXxIrcB0aO6gjxsM75foTQvm%2BWSZQKgO9pASvZEBbxGFFNB8A8KGQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAZJK4tz%2BRWxymIalz3lUBHAAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwNDpEgHwfbO%2BsufXoCARCAO5g3ouqYGO8qb5qLQv%2B2EukhUOiERB2VItVKnV2F754Ogj1SM6yiNmZjriNy2jRJuf%2BNhjJw8ygQoXJsAgAAAAAMAAAQAAAAAAAAAAAAAAAAAH0YfGQNPOuLdkMzWVl%2F7sL%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLoKVG22L9tiistRQrNa9QTcvDaOeVETcxjEbH8t96VVEJuWUgyzKrO3csXjedByU6dPn86apQMGymGPY8U5i5vsBY%3D&product=confluence&product=jira)**
2. In Jira, open **Apps → Precedent** (or *Settings → Apps → Precedent*) and click **Load demo history**. In about two minutes it creates two years of history for *Lumen Market*, a fictional online store:
   - 14 incidents with blameless postmortems
   - 4 architecture decisions
   - 6 upcoming work items, five of which quietly repeat a past mistake

   The Jira projects and Confluence space are created for you. Sites without Jira Service Management store the incidents in a Jira project instead.
3. Open the work item it points you to (e.g. *"Lower product catalog cache TTL…"*):
   - Precedent has already commented on it.
   - Open the **Precedent** panel (the Apps button under the issue title) and click **Add** on a guardrail.
4. In Confluence, open any postmortem in the **Lumen Market Engineering** space and click the **Precedent** byline.
5. Back in **Apps → Precedent**, look at the impact dashboard.
6. *With Rovo enabled:* open Rovo chat, pick the **Precedent** agent and ask *"Where do we keep getting hurt?"* or *"I'm about to add retries to the shipping client. Has this gone wrong before?"*
7. *Bitbucket (optional):*
   1. Install the companion app on a workspace: **[Install Precedent for Bitbucket](https://developer.atlassian.com/console/install/d78bc630-f99d-4da6-9853-b38e62bd0746?signature=AYABeMxjB7k7Cikat92bswtjw7UAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBdLl%2FtcIix3BDUnI1AAJgJAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDIVKCR%2F%2FxvYQ%2BDVS0AIBEIA73FMOy7ombxE6mZtje8WkInNX1TTs8GbDNOv%2BrWPQAQ99OzRfs8ewwUYqcMwuWb5EwbfZDcgcduLfXn0AB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGALw2IGgImz3mZLVr6HQGGAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMcc%2BN3OPIPkURAz2qAgEQgDtIxbFl7XFAxFnp%2BYFENe%2FokXtlpsN7zDK8JdlZoQtzOYuhuuiWUG%2BTWWH9A4WlzxiE1ky5Ny%2FlDFMtPQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEATd7xhjqL0boW1JW0mqnkqcAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwAIdJgyVrmoqkD4BYCARCAO9Ok4LasYb8mHqMRDRQ6JG2baXyVKxFSgny%2BDSHVafncHj8tLxjLJAK4DLGlhjoyD1KAi8uzuJMxlGzsAgAAAAAMAAAQAAAAAAAAAAAAAAAAAOTxQ%2FuqKIU33i2IfP4J9RT%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLyNSuFoHm%2FQyoo5mPHdWFOTFyT6cX9h8iw53aHxUO4vJf9VWNaRn%2FtJXwpxiiBFZLuQt6n%2FnsoGbqTZTC8yF%2BqoVQ%3D&product=bitbucket)**
   2. Open *Workspace settings → Precedent*, enter the site URL, an email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens), then click **Save and sync**.
   3. Open a PR that touches `services/payment-gateway-client/config/retries.yaml`.

## How it works

```
 Jira Service Management        Confluence                      Jira               Bitbucket
 resolved incidents ──┐   postmortems · RCAs · ADRs ──┐                                  
                      ▼                               ▼                                  
              ┌────────────────────────────────────────────┐                             
              │  Extraction → lessons                       │   trigger · root cause ·    
              │  (heading-aware, ADF + storage format)      │   guardrails · components   
              ├────────────────────────────────────────────┤                             
              │  Field-weighted BM25 + synonyms + component │                             
              │  overlap → confidence (strong/possible)     │                             
              └────────────────────────────────────────────┘                             
                 │            │             │            │              │                
          issue panel    auto-flag     Rovo agent    MCP tools    PR panel + merge check 
                 │                                                                       
          guardrail sub-task ─► impact record ─► dashboard + "protected N" on the page   
```

- **Deterministic and free to run.** Matching uses field-weighted BM25, not an LLM call per page view. The same change always gets the same answer, in milliseconds, at no per-check cost. Reasoning and conversation go through **Rovo**, which is included with Atlassian Cloud.
- **Explainable.** Every match shows the terms and components it matched on. Single-word coincidences are suppressed.
- **Triggers weigh most.** Postmortems are split by heading (Trigger, Root cause, Impact, Guardrails, Affected components, plus common aliases and Atlassian's template). The *kind of change* that caused an incident is what predicts the next one.
- **Runs on Atlassian.** The main app has no external egress and no remote back end, so it is eligible for the *Runs on Atlassian* programme. All data stays in Forge storage and on your own Confluence pages.
- **A closed loop:**
  - An incident is resolved, and Precedent drafts the postmortem.
  - The team fills it in, and Precedent learns from it within minutes.
  - Look-alike work gets warned, and the guardrails become sub-tasks.
  - The page shows that it *protected N changes*.
  - The dashboard shows what it was worth.

### Engineering notes

- **Shared impact across products.** Forge keeps separate storage for an app's Jira and Confluence installs. Precedent therefore publishes each page's impact as a Confluence **page property**, so the Confluence coach can show what the Jira side caught.
- **Resumable demo seeding.** Demo seeding runs as resumable 15-second slices on a Forge queue, so it can't hit function timeouts on slow sites. It's idempotent, so you can run it again safely.
- **Bitbucket companion app.** Bitbucket modules can't share an app with site-scoped products. That's why the Bitbucket integration is a small companion app (`/bitbucket`) that reuses the same engine (`scripts/sync-engine.mjs`).
- **Teamwork Graph.** Queries use curated graph fields (`confluencePageCreator/Owners/Contributors`, `atlassianUserInTeams`, `confluencePageLinkedConfluencePages`).

## Requirements and limits

- Jira Cloud and Confluence Cloud on the same site. Jira Service Management is optional.
- Rovo agent and Teamwork Graph features need a site with Rovo.
- The Bitbucket merge check *blocks* merges only on Bitbucket Premium (custom merge check enforcement). On other plans it reports pass or fail without blocking.
- Matching is lexical with a domain synonym layer. It catches "the same kind of change", not arbitrary paraphrases. Rovo covers open-ended questions.

## Develop

```bash
npm install
npm test                         # 25 tests: engine, extraction, discovery, drafts, Bitbucket
forge deploy -e development
forge install -e development     # Jira, then again for Confluence
cd bitbucket && npm install && forge deploy -e development
node scripts/sync-engine.mjs     # after changing src/engine, re-vendor it into /bitbucket
```

```
src/
  engine/      tokenize · extract (storage/ADF → lessons, page classification) · match (BM25 + confidence)
  services/    precedent (check, guardrails, auto-flag) · ingest (sync, discovery, quick sync)
               draft (postmortem drafts) · coach (quality + impact) · graph (Teamwork Graph) · seed (demo)
  frontend/    UI Kit: issue panel · admin/impact page · Confluence coach
  rovo.js      Rovo agent / MCP actions
bitbucket/     companion app: PR panel, merge check, workspace settings
test/          node:test suites
```

## License

MIT
