import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Text, Lozenge, Icon, Link, ProgressBar, SectionMessage, Spinner, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const wrap = xcss({ padding: 'space.200', width: '380px' });
const row = xcss({ padding: 'space.075', borderRadius: 'border.radius', backgroundColor: 'color.background.neutral.subtle.hovered' });

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { invoke('coachPage').then(setData).catch((e) => setError(e.message || String(e))); }, []);

  if (error) return <Box xcss={wrap}><SectionMessage appearance="error"><Text>{error}</Text></SectionMessage></Box>;
  if (!data) return <Box xcss={wrap}><Inline space="space.100" alignBlock="center"><Spinner size="small" /><Text>Reading this page…</Text></Inline></Box>;
  if (data.error) return <Box xcss={wrap}><Text>{data.error}</Text></Box>;

  const pct = Math.round(data.quality * 100);
  const missing = data.checks.filter((c) => !c.ok);
  return (
    <Box xcss={wrap}>
      <Stack space="space.200">
        <Stack space="space.075">
          <Inline spread="space-between" alignBlock="center">
            <Heading size="small">{data.sourceType === 'decision' ? 'Precedent decision coach' : 'Precedent postmortem coach'}</Heading>
            <Lozenge appearance={pct >= 85 ? 'success' : pct >= 50 ? 'moved' : 'removed'} isBold>{`${pct}% actionable`}</Lozenge>
          </Inline>
          <ProgressBar value={data.quality} ariaLabel="Actionability" appearance={pct >= 85 ? 'success' : 'default'} />
          {!data.tracked ? (
            <Text size="small" color="color.text.subtle">
              {data.looksLikePostmortem
                ? 'This looks like a postmortem, but it doesn\'t yet say what changed, why it broke or what to do differently. Add those sections and Precedent will start warning teams before they repeat it.'
                : `Precedent isn't learning from this page yet. Add the label "${data.suggestedLabel}" and it will start warning teams before they repeat this.`}
            </Text>
          ) : data.discovered ? (
            <Text size="small" color="color.text.subtle">
              {missing.length ? 'Precedent found this page on its own and is learning from it. Fill the gaps below for sharper warnings.' : 'Precedent found this page on its own and is learning from it.'}
            </Text>
          ) : (
            <Text size="small" color="color.text.subtle">
              {missing.length ? 'Fill the gaps below and Precedent will give sharper warnings.' : 'Everything Precedent needs is here.'}
            </Text>
          )}
        </Stack>

        <Stack space="space.075">
          {data.checks.map((c) => (
            <Box key={c.field} xcss={row}>
              <Inline space="space.100" alignBlock="start">
                <Icon glyph={c.ok ? 'check-circle' : 'cross-circle'} label="" size="small" color={c.ok ? 'color.icon.success' : 'color.icon.danger'} />
                <Stack space="space.025">
                  <Text size="small" weight="semibold">{c.label}</Text>
                  {!c.ok ? <Text size="small" color="color.text.subtle">{`Add a "${c.heading}" heading. ${c.why}`}</Text> : null}
                </Stack>
              </Inline>
            </Box>
          ))}
        </Stack>

        {data.tracked ? (
          <Stack space="space.075">
            <Text size="small" weight="semibold" color="color.text.subtle">
              {data.protectedChanges.length ? `PROTECTED ${data.protectedChanges.length} LATER ${data.protectedChanges.length === 1 ? 'CHANGE' : 'CHANGES'}` : 'NOT TRIGGERED YET'}
            </Text>
            {data.protectedChanges.length ? data.protectedChanges.slice(0, 5).map((p) => (
              <Inline key={p.issueKey} space="space.075" alignBlock="center">
                <Icon glyph="shield" label="" size="small" color="color.icon.success" />
                <Link href={`/browse/${p.issueKey}`} openNewTab>{p.issueKey}</Link>
                <Text size="small">{p.summary}</Text>
              </Inline>
            )) : <Text size="small" color="color.text.subtle">{`When new work resembles this ${data.sourceType === 'decision' ? 'decision' : 'incident'}, Precedent will warn the team and list it here.`}</Text>}
            {data.guardrailsAdopted ? <Text size="small" color="color.text.subtle">{`${data.guardrailsAdopted} guardrails from this page were added to later work.`}</Text> : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
