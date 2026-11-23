/**
 * Lesson extraction: turns postmortems (Confluence storage format), decision
 * records and JSM incidents (Atlassian Document Format) into structured lessons.
 *
 * Deterministic heading-based parsing. Works with the common postmortem
 * templates (Atlassian's incident postmortem template included) and degrades
 * gracefully to "summary only" lessons for free-form pages.
 */

/** Heading aliases -> lesson field. Order matters: first match wins. */
const SECTION_ALIASES = [
  ['trigger', ['trigger', 'what changed', 'the change', 'triggering change', 'proximate cause', 'what happened']],
  ['rootCause', ['root cause', 'root causes', 'cause', 'why it happened', 'five whys', '5 whys', 'contributing factors']],
  ['impact', ['impact', 'customer impact', 'user impact', 'blast radius']],
  ['guardrails', ['guardrail', 'guardrails', 'prevention', 'how we prevent this', 'lessons learned', 'lessons', 'what we will do differently', 'action items', 'follow-up actions', 'follow ups', 'decision', 'the decision', 'rule']],
  ['components', ['components', 'affected components', 'affected services', 'services', 'systems affected', 'scope']],
  ['summary', ['summary', 'overview', 'incident summary', 'context', 'tl;dr', 'tldr', 'background', 'status']],
  ['tags', ['tags', 'keywords', 'labels']],
];

export function fieldForHeading(heading) {
  const h = heading.toLowerCase().replace(/[^a-z0-9;\s-]/g, '').trim();
  for (const [field, aliases] of SECTION_ALIASES) {
    if (aliases.some((a) => h === a || h.startsWith(`${a} `) || h.endsWith(` ${a}`))) return field;
  }
  return null;
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
  mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←', harr: '↔', uarr: '↑', darr: '↓', rArr: '⇒',
  times: '×', divide: '÷', plusmn: '±', le: '≤', ge: '≥', ne: '≠', asymp: '≈', deg: '°', middot: '·',
  bull: '•', trade: '™', copy: '©', reg: '®', euro: '€', pound: '£', sect: '§', para: '¶', laquo: '«', raquo: '»',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Strip storage-format HTML to text, keeping list items as separate lines. */
export function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<ac:structured-macro[^>]*ac:name="(?:toc|children|jira)"[\s\S]*?<\/ac:structured-macro>/g, ' ')
      // Template prompts ("What change set this off?") are not content.
      .replace(/<ac:placeholder[^>]*>[\s\S]*?<\/ac:placeholder>/g, ' ')
      .replace(/<(br|\/p|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

/** Split Confluence storage HTML into { heading, text } sections. */
export function storageToSections(html) {
  const sections = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let last = { heading: '', start: 0 };
  let m;
  const src = String(html || '');
  while ((m = re.exec(src))) {
    sections.push({ heading: last.heading, text: htmlToText(src.slice(last.start, m.index)) });
    last = { heading: htmlToText(m[2]), start: m.index + m[0].length };
  }
  sections.push({ heading: last.heading, text: htmlToText(src.slice(last.start)) });
  return sections.filter((s) => s.heading || s.text);
}

/** Flatten ADF to plain text. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text || '';
  if (node.type === 'inlineCard' || node.type === 'blockCard') return node.attrs?.url || '';
  const inner = (node.content || []).map(adfToText).join('');
  const block = ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'tableRow', 'panel'];
  if (node.type === 'listItem') return `• ${inner.trim()}\n`;
  return block.includes(node.type) ? `${inner.trim()}\n` : inner;
}

/** Split ADF into { heading, text } sections. */
export function adfToSections(doc) {
  const sections = [];
  let current = { heading: '', parts: [] };
  for (const node of doc?.content || []) {
    if (node.type === 'heading') {
      sections.push(current);
      current = { heading: adfToText(node).trim(), parts: [] };
    } else {
      current.parts.push(adfToText(node));
    }
  }
  sections.push(current);
  return sections
    .map((s) => ({ heading: s.heading, text: s.parts.join('').trim() }))
    .filter((s) => s.heading || s.text);
}

function splitList(text) {
  return text
    .split(/\n|•/)
    .map((s) => s.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((s) => s.length > 1);
}

/** Pull "Key: value" metadata lines (Severity, Duration, Date...) from text. */
export function parseMeta(text) {
  const meta = {};
  const grab = (re) => (text.match(re) || [])[1]?.trim();
  meta.severity = grab(/\bsev(?:erity)?\s*[:=]?\s*(sev\s?\d|p\d|\d|critical|high|major|minor|low)/i);
  if (meta.severity) {
    const n = meta.severity.match(/\d/);
    meta.severity = n ? `SEV${n[0]}` : meta.severity.toUpperCase();
  }
  const dur = grab(/\bduration\s*[:=]\s*([^\n•]+)/i);
  if (dur) {
    const h = (dur.match(/(\d+(?:\.\d+)?)\s*h/i) || [])[1];
    const mins = (dur.match(/(\d+)\s*m/i) || [])[1];
    meta.durationMin = Math.round((h ? parseFloat(h) * 60 : 0) + (mins ? parseInt(mins, 10) : 0)) || undefined;
  }
  meta.date = grab(/\b(?:date|occurred|incident date)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i);
  meta.incidentKey = grab(/\b(?:[Ii]ncident|[Jj]ira|[Tt]icket)(?:\s+key)?\s*[:=]\s*([A-Z][A-Z0-9]+-\d+)/);
  return meta;
}

/**
 * Build a lesson from { heading, text } sections.
 * @param {object} base  id, sourceType, sourceKey, url, title, plus any known fields
 */
export function lessonFromSections(sections, base) {
  const lesson = {
    summary: '', trigger: '', rootCause: '', impact: '',
    guardrails: [], components: [], tags: [],
    ...base,
  };
  const unassigned = [];
  for (const { heading, text } of sections) {
    const field = heading ? fieldForHeading(heading) : null;
    if (!field) { unassigned.push(text); continue; }
    if (field === 'guardrails' || field === 'tags') {
      lesson[field] = [...lesson[field], ...splitList(text)];
    } else if (field === 'components') {
      lesson.components = [...lesson.components, ...text.split(/[,\n•]/).map((s) => s.trim()).filter(Boolean)];
    } else {
      lesson[field] = [lesson[field], text].filter(Boolean).join('\n');
    }
  }
  const allText = sections.map((s) => s.text).join('\n');
  const meta = parseMeta(allText);
  for (const [k, v] of Object.entries(meta)) if (v && !lesson[k]) lesson[k] = v;
  if (!lesson.summary) lesson.summary = unassigned.join('\n').slice(0, 1200);
  lesson.components = [...new Set(lesson.components.map((c) => c.replace(/^components?:\s*/i, '')))];
  lesson.tags = [...new Set(lesson.tags)];
  lesson.quality = lessonQuality(lesson);
  return lesson;
}

/** 0..1 — how actionable a lesson is. Used to rank & to nudge teams to improve postmortems. */
export function lessonQuality(l) {
  let q = 0;
  if (l.trigger) q += 0.3;
  if (l.rootCause) q += 0.25;
  if (l.guardrails?.length) q += 0.3;
  if (l.components?.length) q += 0.15;
  return Number(q.toFixed(2));
}

const POSTMORTEM_TITLE = /post[\s-]?mortem|incident\s+(review|report|retro(spective)?|analysis|write[\s-]?up)|root[\s-]cause|\bRCA\b|\bPIR\b|\bCOE\b|correction of errors?|outage\s+(review|report)|\bINC-\d+\b/i;
const DECISION_TITLE = /^\s*ADR[\s:-]?\d+|architecture decision|decision record/i;

/**
 * Does this page look like a postmortem or decision record, labels or not?
 * Real teams rarely label consistently, so Precedent recognises the page by its
 * title and its structure (a root-cause section plus a trigger or follow-ups).
 * @returns 'postmortem' | 'decision' | null
 */
export function classifyPage(page) {
  const title = page.title || '';
  const labels = (page.labels?.results || page.labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
  if (labels.some((l) => /^(decision|adr|architecture-decision)$/.test(l)) || DECISION_TITLE.test(title)) return 'decision';
  if (labels.some((l) => /^(postmortem|post-mortem|pir|incident-review|rca)$/.test(l)) || POSTMORTEM_TITLE.test(title)) return 'postmortem';
  const fields = new Set(storageToSections(page.body?.storage?.value ?? page.body ?? '').map((s) => (s.heading ? fieldForHeading(s.heading) : null)));
  if (fields.has('rootCause') && (fields.has('trigger') || fields.has('guardrails'))) return 'postmortem';
  return null;
}

export function lessonFromConfluencePage(page, wikiBaseUrl = '') {
  const html = page.body?.storage?.value ?? page.body ?? '';
  const labels = (page.labels?.results || page.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const isDecision = labels.some((l) => /^(decision|adr|architecture-decision)$/i.test(l)) || DECISION_TITLE.test(page.title || '');
  const webui = page._links?.webui;
  return lessonFromSections(storageToSections(html), {
    id: `cf:${page.id}`,
    sourceType: isDecision ? 'decision' : 'postmortem',
    sourceKey: page.id,
    title: page.title,
    url: webui ? `${wikiBaseUrl}${webui}` : undefined,
    tags: labels.filter((l) => !/^(postmortem|post-mortem|decision|adr|pir)$/i.test(l)),
  });
}

export function lessonFromIncidentIssue(issue, siteUrl = '') {
  const f = issue.fields || {};
  const desc = f.description;
  const sections = desc && typeof desc === 'object' ? adfToSections(desc) : [{ heading: '', text: String(desc || '') }];
  return lessonFromSections(sections, {
    id: `jira:${issue.key}`,
    sourceType: 'incident',
    sourceKey: issue.key,
    title: f.summary,
    url: siteUrl ? `${siteUrl}/browse/${issue.key}` : undefined,
    date: (f.resolutiondate || f.created || '').slice(0, 10) || undefined,
    severity: f.priority?.name && /highest|critical|blocker/i.test(f.priority.name) ? 'SEV1' : undefined,
    components: (f.components || []).map((c) => c.name),
    tags: f.labels || [],
  });
}
