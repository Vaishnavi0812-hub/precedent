/**
 * Precedent for Bitbucket — companion app.
 * Brings Precedent's institutional memory to pull requests: a PR panel and a merge check.
 */
import ResolverModule from '@forge/resolver';
import { checkPullRequest } from './pr.js';
import { getConfig, saveConfig, syncLessons, loadLessons } from './confluence.js';

const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();

const workspaceOf = (context) => context.workspaceId || context.extension?.workspace?.uuid;

/* ---------------- PR overview panel ---------------- */

resolver.define('getPrecedents', async ({ context }) => {
  const repo = context.extension?.repository?.uuid;
  const prId = context.extension?.pullRequest?.id;
  const workspace = workspaceOf(context);
  if (!repo || !prId || !workspace) return { error: 'Open this panel from a pull request.' };
  const { lessons } = await loadLessons();
  if (!lessons.length) return { notConfigured: true };
  return checkPullRequest(workspace, repo, prId);
});

/* ---------------- Workspace settings ---------------- */

resolver.define('getSettings', async () => {
  const [config, { meta }] = await Promise.all([getConfig(), loadLessons()]);
  return { config, meta };
});

resolver.define('saveSettings', async ({ payload }) => {
  const config = await saveConfig(payload);
  try {
    const summary = await syncLessons();
    return { ok: true, config, summary };
  } catch (e) {
    return { ok: false, config, error: e.message };
  }
});

resolver.define('syncNow', async () => {
  try {
    return { ok: true, summary: await syncLessons() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

export const handler = resolver.getDefinitions();

/* ---------------- Merge check ---------------- */

/**
 * Fails when the PR strongly resembles a past incident and the author hasn't
 * acknowledged it. Configured as "Required" it blocks; otherwise it is advisory.
 */
export async function mergeCheck(event) {
  try {
    const workspace = event.workspace?.uuid;
    const repo = event.repository?.uuid;
    const prId = event.pullrequest?.id;
    const res = await checkPullRequest(workspace, repo, prId);
    if (!res.lessonCount) return { success: true, message: 'Precedent is not connected to Confluence yet, so nothing was checked.' };
    if (!res.unacknowledged.length) {
      const acked = res.matches.filter((m) => m.acknowledged).map((m) => m.ref);
      return {
        success: true,
        message: acked.length
          ? `Precedent: ${acked.join(', ')} acknowledged. Ship with confidence.`
          : `Precedent: no past incident resembles this change (checked ${res.lessonCount} postmortems and decisions).`,
      };
    }
    const top = res.unacknowledged[0];
    const others = res.unacknowledged.slice(1).map((m) => m.ref || m.title).join(', ');
    const outage = top.durationMin ? `, ${top.durationMin} min outage` : '';
    const message = [
      `Precedent: this change resembles ${top.ref || top.title} (${top.severity || 'past incident'}${outage}).`,
      top.guardrails[0] ? `Guardrail: ${top.guardrails[0]}` : '',
      others ? `Also similar: ${others}.` : '',
      `Once the guardrails are in place, add "Precedent-Ack: ${res.unacknowledged.map((m) => m.ref).filter(Boolean).join(', ')}" to the PR description.`,
    ].filter(Boolean).join(' ');
    return { success: false, message: message.slice(0, 1000) };
  } catch (e) {
    console.error('merge check failed', e);
    // Never block a merge because Precedent itself had a problem.
    return { success: true, message: `Precedent could not check this PR: ${e.message}`.slice(0, 500) };
  }
}

/* ---------------- Scheduled sync ---------------- */

export async function scheduledSync() {
  const cfg = await getConfig();
  if (!cfg.siteUrl || !cfg.hasToken) return;
  try {
    await syncLessons();
  } catch (e) {
    console.warn('scheduled sync failed', e.message);
  }
}
