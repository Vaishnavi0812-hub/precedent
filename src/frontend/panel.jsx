import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Text, Link, Lozenge, Button, SectionMessage,
  Spinner, Tag, TagGroup, EmptyState, Icon, Tooltip, xcss,
} from '@forge/react';
import { invoke, router, view } from '@forge/bridge';

const card = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.200',
  backgroundColor: 'elevation.surface.raised',
});

const highCard = xcss({
  borderColor: 'color.border.warning',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius.200',
  padding: 'space.200',
  backgroundColor: 'elevation.surface.raised',
});

const guardrailRow = xcss({
  padding: 'space.100',
  borderRadius: 'border.radius',
  backgroundColor: 'color.background.neutral.subtle.hovered',
});

const SOURCE_LABEL = { postmortem: 'Postmortem', incident: 'Incident', decision: 'Decision' };
const LEVEL_APPEARANCE = { high: 'removed', medium: 'moved', low: 'default' };
const LEVEL_TEXT = { high: 'Strong match', medium: 'Possible match', low: 'Weak match' };

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "INC-101" / "ADR-007" from a lesson title, else a readable fallback. */
function refOf(m) {
  const ref = (m.title || '').match(/\b(INC|ADR|PIR|SEV)-?\d+\b/i);
  if (ref) return ref[0].toUpperCase();
  return m.sourceType === 'decision' ? 'A past decision' : 'A past incident';
}

function fmtDuration(m) {
  if (!m) return null;
  if (m >= 1440) return `${Math.round(m / 1440)}d outage`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m outage`;
  return `${m} min outage`;
}

function Guardrail({ text, applied, onApply, busy }) {
  return (
    <Box xcss={guardrailRow}>
      <Inline space="space.100" alignBlock="center" spread="space-between">
        <Box xcss={xcss({ flexGrow: 1, flexShrink: 1 })}>
          <Inline space="space.075" alignBlock="start">
            <Icon glyph={applied ? 'check-circle' : 'shield'} label="" size="small" color={applied ? 'color.icon.success' : 'color.icon.subtle'} />
            <Text size="small">{text}</Text>
          </Inline>
        </Box>
        {applied ? (
          <Inline space="space.075" alignBlock="center">
            <Lozenge appearance="success">Added</Lozenge>
            {applied.key ? (
              <Link href={`/browse/${applied.key}`}>{applied.key}</Link>
            ) : (
              <Text size="small" color="color.text.subtle">as checklist comment</Text>
            )}
          </Inline>
        ) : (
          <Button spacing="compact" appearance="default" isDisabled={busy} onClick={onApply}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        )}
      </Inline>
    </Box>
  );
}

function PrecedentCard({ m, applied, onApply, onDismiss, busyKey }) {
  const meta = [fmtDate(m.date), m.severity, fmtDuration(m.durationMin)].filter(Boolean).join(' · ');
  const isDecision = m.sourceType === 'decision';
  return (
    <Box xcss={m.level === 'high' ? highCard : card}>
      <Stack space="space.150">
        <Inline spread="space-between" alignBlock="start" space="space.100">
          <Stack space="space.050">
            <Inline space="space.075" alignBlock="center" shouldWrap>
              <Lozenge appearance={isDecision ? 'new' : 'removed'} isBold={!isDecision}>{SOURCE_LABEL[m.sourceType] || 'Lesson'}</Lozenge>
              <Tooltip content={`Confidence ${Math.round(m.confidence * 100)}%`}>
                <Lozenge appearance={LEVEL_APPEARANCE[m.level]}>{LEVEL_TEXT[m.level]}</Lozenge>
              </Tooltip>
            </Inline>
            {m.url ? <Link href={m.url} openNewTab>{m.title}</Link> : <Text weight="semibold">{m.title}</Text>}
            {meta ? <Text size="small" color="color.text.subtle">{meta}</Text> : null}
          </Stack>
          <Tooltip content="Not relevant — hide for this issue">
            <Button appearance="subtle" spacing="compact" onClick={onDismiss} iconBefore="cross" aria-label="Dismiss" />
          </Tooltip>
        </Inline>

        {m.impact && !isDecision ? (
          <Stack space="space.025">
            <Text size="small" weight="semibold" color="color.text.subtle">IMPACT</Text>
            <Text size="small">{m.impact}</Text>
          </Stack>
        ) : null}

        {(isDecision ? m.summary : m.rootCause) ? (
          <Stack space="space.025">
            <Text size="small" weight="semibold" color="color.text.subtle">{isDecision ? 'WHY WE DECIDED' : 'WHAT WENT WRONG'}</Text>
            <Text size="small">{isDecision ? m.summary : m.rootCause}</Text>
          </Stack>
        ) : null}

        {m.guardrails.length ? (
          <Stack space="space.075">
            <Text size="small" weight="semibold" color="color.text.subtle">{isDecision ? 'THE RULE' : 'GUARDRAILS WE AGREED ON'}</Text>
            {m.guardrails.slice(0, 4).map((g) => (
              <Guardrail
                key={g}
                text={g}
                applied={applied.find((a) => a.lessonId === m.id && a.guardrail === g)}
                busy={busyKey === `${m.id}|${g}`}
                onApply={() => onApply(m, g)}
              />
            ))}
          </Stack>
        ) : null}

        <Inline space="space.075" alignBlock="center" shouldWrap>
          <Text size="small" color="color.text.subtlest">Matched on</Text>
          <TagGroup>
            {[...m.componentHits.map((c) => ({ t: c, comp: true })), ...m.matchedTerms.map((t) => ({ t }))].slice(0, 6).map(({ t, comp }) => (
              <Tag key={t} text={t} color={comp ? 'purpleLight' : 'standard'} />
            ))}
          </TagGroup>
        </Inline>
      </Stack>
    </Box>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setError(null);
    invoke('getPrecedents').then(setData).catch((e) => setError(e.message || String(e)));
  }, []);

  useEffect(load, [load]);

  const apply = async (m, guardrail) => {
    setBusyKey(`${m.id}|${guardrail}`);
    try {
      const res = await invoke('applyGuardrail', { lessonId: m.id, guardrail });
      setToast(res.subtaskKey ? `Created sub-task ${res.subtaskKey}` : 'Added as a checklist comment');
      setData((d) => ({ ...d, applied: [...d.applied, { lessonId: m.id, guardrail, key: res.subtaskKey }] }));
      // Refresh the Jira issue view so the new sub-task / comment appears immediately.
      try { await view.refresh(); } catch (_) { /* not supported in every context */ }
    } catch (e) {
      setToast(`Could not add guardrail: ${e.message}`);
    } finally {
      setBusyKey(null);
    }
  };

  const dismissMatch = async (m) => {
    setData((d) => ({ ...d, matches: d.matches.filter((x) => x.id !== m.id), dismissedCount: d.dismissedCount + 1 }));
    await invoke('dismiss', { lessonId: m.id });
  };

  if (error) {
    return (
      <SectionMessage appearance="error" title="Precedent couldn't load">
        <Text>{error}</Text>
        <Button onClick={load}>Try again</Button>
      </SectionMessage>
    );
  }
  if (!data) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text color="color.text.subtle">Checking this change against your incident history…</Text>
      </Inline>
    );
  }

  if (!data.lessonCount) {
    return (
      <EmptyState
        header="Precedent has no history to learn from yet"
        description="Label Confluence postmortems with “postmortem” and decisions with “decision”, or load the demo history from the Precedent settings page."
        primaryAction={<Button appearance="primary" onClick={() => router.navigate('/jira/settings/apps')}>Open Precedent setup</Button>}
      />
    );
  }

  const strong = data.matches.filter((m) => m.level !== 'low');
  const top = strong[0];

  return (
    <Stack space="space.200">
      {top && top.level === 'high' ? (
        <SectionMessage appearance="warning" title="Déjà vu — this change looks like something that has hurt us before">
          <Text>
            {top.sourceType === 'decision'
              ? `It touches a rule the team agreed on in ${refOf(top)}. Review it before you start.`
              : `${refOf(top)}${top.durationMin ? ` caused a ${fmtDuration(top.durationMin)}` : ' hurt us'}${top.date ? ` in ${fmtDate(top.date)}` : ''}. Review what went wrong and add the guardrails before you ship.`}
          </Text>
        </SectionMessage>
      ) : strong.length ? (
        <SectionMessage appearance="information" title="Related history worth a look">
          <Text>Precedent found past incidents or decisions that may apply to this change.</Text>
        </SectionMessage>
      ) : (
        <SectionMessage appearance="success" title="No precedent found">
          <Text>{`Nothing in ${data.lessonCount} postmortems and decisions resembles this change. You're in new territory, so write a postmortem if it goes wrong.`}</Text>
        </SectionMessage>
      )}

      {toast ? (
        <Inline space="space.100" alignBlock="center">
          <Icon glyph="check-circle" label="" color="color.icon.success" size="small" />
          <Text size="small">{toast}</Text>
        </Inline>
      ) : null}

      {strong.map((m) => (
        <PrecedentCard key={m.id} m={m} applied={data.applied} busyKey={busyKey} onApply={apply} onDismiss={() => dismissMatch(m)} />
      ))}

      <Inline spread="space-between" alignBlock="center">
        <Text size="small" color="color.text.subtlest">
          {`Learned from ${data.lessonCount} postmortems, incidents and decisions${data.dismissedCount ? ` · ${data.dismissedCount} dismissed` : ''}`}
        </Text>
        <Button appearance="subtle" spacing="compact" onClick={load}>Refresh</Button>
      </Inline>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
