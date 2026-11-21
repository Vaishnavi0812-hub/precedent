import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Text, Link, Lozenge, Button, SectionMessage, Spinner, Tag, TagGroup, Icon, Code, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const card = xcss({
  borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid',
  borderRadius: 'border.radius.200', padding: 'space.200', backgroundColor: 'elevation.surface.raised',
});

const fmtDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);

function Match({ m }) {
  const meta = [fmtDate(m.date), m.severity, m.durationMin ? `${m.durationMin} min outage` : null].filter(Boolean).join(' · ');
  const decision = m.sourceType === 'decision';
  return (
    <Box xcss={card}>
      <Stack space="space.100">
        <Inline space="space.075" alignBlock="center" shouldWrap>
          <Lozenge appearance={decision ? 'new' : 'removed'} isBold={!decision}>{decision ? 'Decision' : 'Postmortem'}</Lozenge>
          <Lozenge appearance={m.level === 'high' ? 'removed' : 'moved'}>{m.level === 'high' ? 'Strong match' : 'Possible match'}</Lozenge>
          {m.acknowledged ? <Lozenge appearance="success">Acknowledged</Lozenge> : null}
        </Inline>
        {m.url ? <Link href={m.url} openNewTab>{m.title}</Link> : <Text weight="semibold">{m.title}</Text>}
        {meta ? <Text size="small" color="color.text.subtle">{meta}</Text> : null}
        {(decision ? m.summary : m.rootCause) ? <Text size="small">{decision ? m.summary : m.rootCause}</Text> : null}
        {m.guardrails.slice(0, 3).map((g) => (
          <Inline key={g} space="space.075" alignBlock="start">
            <Icon glyph="shield" label="" size="small" color="color.icon.subtle" />
            <Text size="small">{g}</Text>
          </Inline>
        ))}
        <TagGroup>{m.matchedTerms.map((t) => <Tag key={t} text={t} />)}</TagGroup>
      </Stack>
    </Box>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    invoke('getPrecedents').then(setData).catch((e) => setError(e.message || String(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <SectionMessage appearance="error" title="Precedent couldn't check this pull request"><Text>{error}</Text></SectionMessage>;
  if (!data) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text color="color.text.subtle">Checking this pull request against your incident history…</Text>
      </Inline>
    );
  }
  if (data.error) return <SectionMessage appearance="warning"><Text>{data.error}</Text></SectionMessage>;
  if (data.notConfigured) {
    return (
      <SectionMessage appearance="information" title="Connect Precedent to your Confluence">
        <Text>A workspace admin can connect it under Workspace settings → Precedent. It reads your postmortems and decision records so pull requests can be checked against them.</Text>
      </SectionMessage>
    );
  }

  const pending = data.unacknowledged.map((m) => m.ref).filter(Boolean);
  return (
    <Stack space="space.200">
      {data.unacknowledged.length ? (
        <SectionMessage appearance="warning" title="Déjà vu: this pull request resembles a past incident">
          <Stack space="space.100">
            <Text>Review what went wrong and make sure the guardrails are in place. Then acknowledge it by adding this line to the PR description:</Text>
            <Code>{`Precedent-Ack: ${pending.join(', ')}`}</Code>
          </Stack>
        </SectionMessage>
      ) : data.matches.length ? (
        <SectionMessage appearance="success" title="Precedents acknowledged">
          <Text>The related incidents are acknowledged in the PR description.</Text>
        </SectionMessage>
      ) : (
        <SectionMessage appearance="success" title="No precedent found">
          <Text>{`Nothing in ${data.lessonCount} postmortems and decisions resembles this change.`}</Text>
        </SectionMessage>
      )}
      {data.matches.map((m) => <Match key={m.id} m={m} />)}
      <Inline spread="space-between" alignBlock="center">
        <Text size="small" color="color.text.subtlest">
          {`Checked title, description, branch and ${data.pr.paths.length} changed files against ${data.lessonCount} lessons`}
        </Text>
        <Button appearance="subtle" spacing="compact" onClick={load}>Refresh</Button>
      </Inline>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
