import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Text, Button, SectionMessage, Spinner, Textfield, Label, Link, Lozenge, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const panel = xcss({
  borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid',
  borderRadius: 'border.radius.200', padding: 'space.300', backgroundColor: 'elevation.surface.raised',
});

function App() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ siteUrl: '', email: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    invoke('getSettings').then((s) => {
      setState(s);
      setForm({ siteUrl: s.config.siteUrl, email: s.config.email, token: '' });
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await invoke('saveSettings', form);
      setResult(res);
      if (res.ok) setState((s) => ({ ...s, config: res.config, meta: { total: res.summary.total, at: new Date().toISOString() } }));
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setBusy(false);
      setForm((f) => ({ ...f, token: '' }));
    }
  };

  const sync = async () => {
    setBusy(true);
    setResult(await invoke('syncNow'));
    setBusy(false);
  };

  if (!state) return <Spinner size="large" label="Loading" />;
  const connected = state.config.siteUrl && state.config.hasToken;

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading size="large">Precedent for Bitbucket</Heading>
        <Text color="color.text.subtle">
          Checks every pull request against your team's postmortems and architecture decisions in Confluence, and warns before a change repeats a past incident.
        </Text>
      </Stack>

      <Box xcss={panel}>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Heading size="medium">Connect your Confluence</Heading>
            {connected ? <Lozenge appearance="success">Connected</Lozenge> : <Lozenge appearance="moved">Not connected</Lozenge>}
          </Inline>
          <Text>
            Use the same Confluence site as the Precedent app for Jira. Create an API token for an account that can read your postmortems; it is stored as an encrypted Forge secret and never shown again.
          </Text>
          <Link href="https://id.atlassian.com/manage-profile/security/api-tokens" openNewTab>Create an API token</Link>
          <Stack space="space.100">
            <Label labelFor="site">Site URL</Label>
            <Textfield id="site" placeholder="https://your-site.atlassian.net" value={form.siteUrl} onChange={(e) => setForm({ ...form, siteUrl: e.target.value })} />
            <Label labelFor="email">Account email</Label>
            <Textfield id="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Label labelFor="token">{state.config.hasToken ? 'API token (leave blank to keep the saved one)' : 'API token'}</Label>
            <Textfield id="token" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </Stack>
          <Inline space="space.200" alignBlock="center">
            <Button appearance="primary" isDisabled={busy} onClick={save}>{busy ? 'Connecting…' : 'Save and sync'}</Button>
            {connected ? <Button isDisabled={busy} onClick={sync}>Re-read postmortems</Button> : null}
          </Inline>
          {result?.ok ? (
            <SectionMessage appearance="success" title="Connected">
              <Text>{`Learned ${result.summary.total} lessons (${result.summary.postmortems} postmortems, ${result.summary.decisions} decisions).`}</Text>
            </SectionMessage>
          ) : null}
          {result && !result.ok ? <SectionMessage appearance="error" title="Could not connect"><Text>{result.error}</Text></SectionMessage> : null}
          {state.meta ? <Text size="small" color="color.text.subtle">{`${state.meta.total} lessons · last synced ${new Date(state.meta.at).toLocaleString()}`}</Text> : null}
        </Stack>
      </Box>

      <Box xcss={panel}>
        <Stack space="space.150">
          <Heading size="medium">Turn on the merge check</Heading>
          <Text>1. Workspace settings → Merge checks (Custom merge checks): enable custom merge checks.</Text>
          <Text>2. Add "Precedent - repeat-incident check" for your repositories or projects.</Text>
          <Text>3. Set it to Required to block merges, or Not required to warn only.</Text>
          <Text>Authors acknowledge a precedent by adding "Precedent-Ack: INC-105" to the PR description once the guardrails are in place.</Text>
        </Stack>
      </Box>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
