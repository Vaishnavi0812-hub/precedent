# Video script: Precedent (target 2:50, hard limit 3:00)

Judges may stop watching at 3 minutes, so everything that scores is inside 3:00.
Record on the demo site **one-atlas-jvrt.atlassian.net**, which has Rovo, Teamwork Graph and Bitbucket.
Use 1080p, a zoomed browser (125%) and dark or light mode consistently, and hide bookmarks and notifications.

## Before recording (setup checklist)

- [ ] **Jira tabs:**
  - LUMEN-1 ("Lower product catalog cache TTL…") with the Precedent comment visible.
  - A fresh LUMEN issue without guardrails added, so the **Add** click happens on camera. If needed, create one with the summary *"Lower search results cache TTL to 15s"* and component `catalog-service`.
- [ ] **Bitbucket tab:** `lumen-market-demo/checkout-platform` PR #1, with the description **empty** (no Precedent-Ack yet).
- [ ] **Rovo tab:** chat with the **Precedent** agent selected, new conversation.
- [ ] **Incident tab:** a new LOPS incident ready to resolve, e.g. *"Shipping rates API timeouts after client retry change"*, priority Highest.
- [ ] **Confluence tab:** Postmortem: INC-101 (byline shows *protected 1*).
- [ ] **Impact tab:** Jira → Apps → Precedent.
- [ ] Practise each click path twice. Cut dead time (page loads) in editing.

---

## 0:00–0:18 · Hook

**Screen:** Postmortem INC-101 in Confluence: title, "47 min outage", "$310k".

> "In March, someone lowered a cache TTL and took checkout down for 47 minutes. Three hundred and ten thousand dollars. The team wrote a great postmortem.
> Six months later, a different engineer opens this ticket."

**Cut to:** LUMEN-1 *"Lower product catalog cache TTL to 30s…"*

> "Same change. Nobody remembers. Atlassian helps you *write* the lesson. Precedent makes sure it's *read*, at the moment it matters."

## 0:18–0:50 · Jira: the warning finds you

**Screen:** scroll to the Precedent comment on LUMEN-1.

> "Precedent already flagged it the moment it was created. Nobody had to search."

**Click:** open the Precedent panel. Hover over the Déjà vu banner, *What went wrong* and *Matched on*.

> "Here's what went wrong last time, what it cost, and why it matched: same service, same kind of change."

**Click:** **Add** on a guardrail, then the sub-task link.

> "The guardrails the team agreed on become real work, in one click."

## 0:50–1:15 · Bitbucket: the last line of defence

**Screen:** PR #1 *"Add 5 retries to payment gateway client"*: Precedent panel with INC-105 and ADR-007.

> "If it gets to code, Precedent is on the pull request too. This diff touches the payment client's retry config, exactly what caused INC-105."

**Scroll:** checks → *Precedent – repeat-incident check* failed. Hover to show the message.

> "The merge check fails until someone acknowledges the incident."

**Type** `Precedent-Ack: INC-105, ADR-007` in the description → rerun → ✅.

> "Acknowledged. Ship with confidence."

## 1:15–1:50 · Rovo agent

**Screen:** Rovo chat, Precedent agent.

**Type:** *"I'm about to add retries to the shipping rates client. Has this gone wrong before?"*

> "Engineers can just ask." *(Answer appears: verdict first, INC-105 and ADR-007 cited.)* "A verdict first, every claim linked."

**Type:** *"Where do we keep getting hurt?"*

> "Leaders get the hotspots, ranked by real outage minutes."

**Type:** *"Who has been here before on INC-105?"*

> "And through Teamwork Graph, the people and teams who know this failure, so you know who to ask."

*(Optional, 3 s: show the same tools in an MCP client in the IDE.)*

## 1:50–2:20 · The loop closes itself

**Screen:** the LOPS incident → move it to **Resolved**. Refresh → Precedent comment.

> "When an incident is resolved, Precedent drafts the postmortem, and tells you this has happened before."

**Click** the draft link → Confluence draft with the sections ready. **Then** INC-101 → byline popup *"100% actionable · protected 1"*.

> "A coach on every postmortem scores whether it's actually useful, and shows what it has protected since. It even finds postmortems nobody labelled."

## 2:20–2:40 · Impact

**Screen:** Apps → Precedent → Impact (near-misses · outage minutes · would-be SEV1 repeats).

> "And it measures itself. *[N]* near-misses caught. *[M]* minutes of outages those same mistakes cost last time."

*(Read the real numbers off your screen on the day you record.)*

## 2:40–2:55 · How and close

**Screen:** quick montage: Load demo history → "Demo history is ready", then the README.

> "Matching is deterministic: instant, free and explainable, with no AI bill per check. Reasoning goes to Rovo. It runs on Atlassian, data never leaves your site, and it works on an empty site in two minutes."

**Screen:** logo / title card.

> "Precedent. Your team already paid for the lesson once."

---

## Recording tips

- Record each section separately and stitch them together. It's easier than one take.
- Speak a bit slower than feels natural. Captions help, since YouTube auto-captions are fine.
- Show the cursor and zoom in (or crop) on the important element in each shot.
- Upload as **Public** or **Unlisted** to YouTube, titled *"Precedent: stop repeating your incidents (Codegeist 2026)"*.
