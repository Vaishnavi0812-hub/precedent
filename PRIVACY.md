# Precedent: privacy and data handling

**Short version:** Precedent stores nothing outside your Atlassian site, sends nothing to third parties, and calls no external AI service.

## Precedent for Jira and Confluence (main app)

- **What it reads:**
  - Jira issues (summary, description, components, labels, priority, status) to check them against past incidents.
  - Confluence pages that look like postmortems, incident reviews or decision records.
  - Resolved Jira Service Management incidents.
- **What it stores:**
  - Extracted "lessons" (title, trigger, root cause, guardrails, components, severity, links).
  - Per-issue state (dismissed or flagged).
  - Impact records (which lesson flagged which issue).

  These are stored in Forge storage, which is hosted by Atlassian. A small impact summary is also saved as a property on the relevant Confluence page.
- **What it writes:**
  - Warning comments, labels and guardrail sub-tasks on Jira issues.
  - Postmortem draft pages in Confluence.
  - Demo data (only when an admin clicks *Load demo history*).
- **Teamwork Graph:** read on demand to show who authored or edited a postmortem. The results are not stored.
- **Egress:** none. The app runs entirely on Atlassian's Forge platform and is eligible for *Runs on Atlassian*.
- **Uninstalling:** removes the app's Forge storage. Comments, sub-tasks and pages it created stay, like any other content.

## Precedent for Bitbucket (companion app)

- Reads pull request metadata and the list of changed file paths (not file contents), to check the PR against past incidents.
- Connects to *your* Confluence site using the site URL, email and API token a workspace admin enters. The token is stored as an encrypted Forge secret and never shown again.
- Stores extracted lessons in Forge storage for that workspace.
- **Egress:** only to `*.atlassian.net`, i.e. your own Confluence site.

## Contact

Open an issue at https://github.com/Vaishnavi0812-hub/precedent/issues.
