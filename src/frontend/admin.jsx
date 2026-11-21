import React, { useEffect, useState, useCallback, useRef } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Text, Link, Lozenge, Button, SectionMessage,
  Spinner, ProgressBar, Toggle, Label, Select, DynamicTable, xcss, Badge,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const panel = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.300',
  backgroundColor: 'elevation.surface.raised',
});

const statBox = xcss({
  borderRadius: 'border.radius.200',
  padding: 'space.200',
  backgroundColor: 'color.background.neutral',
  minWidth: '140px',
});

function Stat({ label, value }) {
  return (
    <Box xcss={statBox}>
      <Stack space="space.050">
        <Heading size="large">{String(value ?? 0)}</Heading>
        <Text size="small" color="color.text.subtle">{label}</Text>
      </Stack>
    </Box>
  );
}

const TYPE_LOZENGE = { postmortem: 'removed', incident: 'moved', decision: 'new' };

function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [incidentProject, setIncidentProject] = useState(null);
  const [workProject, setWorkProject] = useState(null);
  const poll = useRef(null);

  const [impact, setImpact] = useState(null);
  const load = useCallback(() => {
    invoke('getImpact').then(setImpact).catch(() => setImpact(null));
    return invoke('getAdminState').then(setState).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); return () => clearInterval(poll.current); }, [load]);

  const seedRunning = state?.seed && ['queued', 'running'].includes(state.seed.status);
  useEffect(() => {
    clearInterval(poll.current);
    if (!seedRunning) return undefined;
    poll.current = setInterval(async () => {
      const seed = await invoke('getSeedProgress');
      setState((s) => ({ ...s, seed }));
      if (seed && !['queued', 'running'].includes(seed.status)) { clearInterval(poll.current); load(); }
    }, 2000);
    return () => clearInterval(poll.current);
  }, [seedRunning, load]);

  const startSeed = async () => {
    setState((s) => ({ ...s, seed: { status: 'queued', done: 0, total: 1, log: ['Queued…'] } }));
    try {
      const res = await invoke('startSeed', { incidentProjectKey: incidentProject?.value, workProjectKey: workProject?.value });
      if (res && res.ok === false) setState((s) => ({ ...s, seed: { status: 'error', error: res.error, log: [] } }));
    } catch (e) {
      setState((s) => ({ ...s, seed: { status: 'error', error: e.message || String(e), log: [] } }));
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try { await invoke('syncNow'); await load(); } finally { setSyncing(false); }
  };

  const [graph, setGraph] = useState(null);
  const checkGraph = async () => {
    setGraph({ loading: true });
    try { setGraph(await invoke('probeGraph')); } catch (e) { setGraph({ ok: false, error: e.message || String(e) }); }
  };

  const toggleAutoFlag = async () => {
    const config = await invoke('saveConfig', { autoFlag: !state.config.autoFlag });
    setState((s) => ({ ...s, config }));
  };

  if (error) return <SectionMessage appearance="error" title="Could not load Precedent settings"><Text>{error}</Text></SectionMessage>;
  if (!state) return <Spinner size="large" label="Loading" />;

  const { lastSync, stats, lessons, config, projects, seed } = state;
  const projectOptions = (type) => projects.filter((p) => !type || p.type === type).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }));

  return (
    <Stack space="space.400">
      <Stack space="space.100">
        <Text color="color.text.subtle">
          Precedent reads your postmortems, incidents and decision records, and warns your team when a new piece of work looks like something that has hurt you before.
        </Text>
      </Stack>

      {/* ---- Impact ---- */}
      <Box xcss={panel}>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Heading size="medium">Impact</Heading>
            <Lozenge appearance="success">Caught before shipping</Lozenge>
          </Inline>
          {impact ? (
            <>
              <Inline space="space.200" shouldWrap>
                <Stat label="Near-misses caught" value={impact.nearMissCount} />
                <Stat label="Outage minutes those same mistakes cost last time" value={impact.minutesAtRisk.toLocaleString()} />
                <Stat label="Would-be SEV1 repeats" value={impact.sev1Repeats} />
                <Stat label="Guardrails adopted" value={impact.guardrailsAdopted} />
                <Stat label="Average postmortem quality" value={`${impact.avgQuality}%`} />
              </Inline>
              {impact.nearMisses.length ? (
                <DynamicTable
                  rowsPerPage={6}
                  head={{ cells: [{ key: 'i', content: 'Change' }, { key: 'p', content: 'Resembled' }, { key: 'm', content: 'Cost last time' }, { key: 'g', content: 'Status' }] }}
                  rows={impact.nearMisses.map((n) => ({
                    key: n.issueKey,
                    cells: [
                      { key: 'i', content: <Link href={`/browse/${n.issueKey}`} openNewTab>{`${n.issueKey} ${n.summary || ''}`}</Link> },
                      { key: 'p', content: n.precedent || '—' },
                      { key: 'm', content: n.minutes ? `${n.severity} · ${n.minutes} min outage` : (n.severity || '—') },
                      { key: 'g', content: <Lozenge appearance={n.guarded ? 'success' : 'moved'}>{n.guarded ? 'Guardrails added' : 'Warned'}</Lozenge> },
                    ],
                  }))}
                />
              ) : (
                <Text color="color.text.subtle">No near-misses yet. When new work resembles a past incident, it shows up here.</Text>
              )}
            </>
          ) : <Spinner size="small" label="Loading impact" />}
          <Inline space="space.200" shouldWrap>
            <Text size="small" color="color.text.subtle">{`${lessons.length} lessons learned · ${stats.issuesFlagged || 0} warnings posted · ${stats.dismissed || 0} dismissed as not relevant`}</Text>
          </Inline>
        </Stack>
      </Box>

      {/* ---- Demo history ---- */}
      <Box xcss={panel}>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Heading size="medium">Try it with demo history</Heading>
            <Lozenge appearance="new">Recommended for evaluation</Lozenge>
          </Inline>
          <Text>
            Creates two years of incident history for “Lumen Market”, a fictional online store: 14 incidents with blameless postmortems, 4 architecture decisions, and 6 upcoming work items that quietly repeat past mistakes. Open one of those work items to see Precedent catch it.
          </Text>
          <Inline space="space.200" shouldWrap>
            <Box xcss={xcss({ width: '280px' })}>
              <Label labelFor="inc">Incidents project (Jira Service Management)</Label>
              <Select inputId="inc" placeholder="Auto-detect" isClearable options={projectOptions('service_desk')} value={incidentProject} onChange={setIncidentProject} />
            </Box>
            <Box xcss={xcss({ width: '280px' })}>
              <Label labelFor="work">Project for upcoming work</Label>
              <Select inputId="work" placeholder="Auto-detect" isClearable options={projectOptions()} value={workProject} onChange={setWorkProject} />
            </Box>
          </Inline>

          {seed && seed.status !== 'idle' ? (
            <Stack space="space.100">
              {seedRunning ? <ProgressBar value={seed.total ? seed.done / seed.total : 0} ariaLabel="Seeding progress" /> : null}
              {seed.status === 'done' ? (
                <SectionMessage appearance="success" title="Demo history is ready">
                  <Text>{`Open ${seed.result?.workItems?.[0] || 'a new work item'} in ${seed.result?.workProject} — Precedent will flag it. Postmortems are in the Confluence space ${seed.result?.space}.`}</Text>
                </SectionMessage>
              ) : null}
              {seed.status === 'error' ? (
                <SectionMessage appearance="error" title="Demo setup hit a problem"><Text>{seed.error}</Text></SectionMessage>
              ) : null}
              <Text size="small" color="color.text.subtle">{(seed.log || []).slice(-1)[0] || ''}</Text>
            </Stack>
          ) : null}

          <Inline>
            <Button appearance="primary" isDisabled={seedRunning} onClick={startSeed}>
              {seedRunning ? 'Building history…' : seed?.status === 'done' ? 'Run demo setup again' : 'Load demo history'}
            </Button>
          </Inline>
        </Stack>
      </Box>

      {/* ---- Your own history ---- */}
      <Box xcss={panel}>
        <Stack space="space.200">
          <Heading size="medium">Your history</Heading>
          <Text>
            {`Precedent learns automatically from Confluence pages labelled "${config.postmortemLabels.slice(0, 2).join('", "')}" (postmortems) or "${config.decisionLabels.slice(0, 2).join('", "')}" (decisions), and from resolved Jira Service Management incidents. New pages and resolved incidents are learned as soon as they appear.`}
          </Text>
          <Inline space="space.200" alignBlock="center" shouldWrap>
            <Button isDisabled={syncing} onClick={syncNow}>{syncing ? 'Re-reading…' : 'Re-read everything now'}</Button>
            {lastSync ? (
              <Text size="small" color="color.text.subtle">
                {`Last full sync ${new Date(lastSync.at).toLocaleString()} · ${lastSync.postmortems} postmortems · ${lastSync.decisions} decisions · ${lastSync.incidents} incidents · ${lastSync.tookMs} ms`}
              </Text>
            ) : null}
          </Inline>
          <Inline space="space.100" alignBlock="center">
            <Toggle id="autoflag" isChecked={config.autoFlag} onChange={toggleAutoFlag} />
            <Label labelFor="autoflag">Comment on new issues when there is a strong match</Label>
          </Inline>
        </Stack>
      </Box>

      {/* ---- Teamwork Graph ---- */}
      <Box xcss={panel}>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Heading size="medium">Teamwork Graph</Heading>
            <Lozenge appearance="new">Who has been here before</Lozenge>
          </Inline>
          <Text>
            Precedent uses Teamwork Graph to find the people connected to each past incident (who wrote the postmortem, who owns it, who contributed) and the teams they belong to, so you know who to ask before you ship.
          </Text>
          <Inline space="space.200" alignBlock="center" shouldWrap>
            <Button isDisabled={graph?.loading} onClick={checkGraph}>{graph?.loading ? 'Checking…' : 'Check Teamwork Graph connection'}</Button>
            {graph && !graph.loading ? (
              graph.ok
                ? <Lozenge appearance="success">{`Connected · ${graph.found.length} of ${graph.found.length + graph.missing.length} graph queries available`}</Lozenge>
                : <Text size="small" color="color.text.danger">{graph.error}</Text>
            ) : null}
          </Inline>
        </Stack>
      </Box>

      {/* ---- Lesson library ---- */}
      <Box xcss={panel}>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Heading size="medium">Lesson library</Heading>
            <Badge>{lessons.length}</Badge>
          </Inline>
          <Text size="small" color="color.text.subtle">
            The quality score shows how actionable each lesson is: does it have a clear trigger, root cause, guardrails and affected components? Better postmortems produce sharper warnings.
          </Text>
          <DynamicTable
            rowsPerPage={10}
            emptyView="No lessons yet. Load the demo history or label a postmortem."
            head={{ cells: [{ key: 't', content: 'Lesson' }, { key: 'ty', content: 'Type' }, { key: 'd', content: 'Date' }, { key: 'g', content: 'Guardrails' }, { key: 'q', content: 'Quality' }] }}
            rows={lessons.map((l) => ({
              key: l.id,
              cells: [
                { key: 't', content: l.url ? <Link href={l.url} openNewTab>{l.title}</Link> : l.title },
                { key: 'ty', content: <Lozenge appearance={TYPE_LOZENGE[l.sourceType]}>{l.sourceType}</Lozenge> },
                { key: 'd', content: l.date || '—' },
                { key: 'g', content: String(l.guardrails) },
                { key: 'q', content: <Lozenge appearance={l.quality >= 0.85 ? 'success' : l.quality >= 0.5 ? 'moved' : 'removed'}>{`${Math.round((l.quality || 0) * 100)}%`}</Lozenge> },
              ],
            }))}
          />
        </Stack>
      </Box>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
