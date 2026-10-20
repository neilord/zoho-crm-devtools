import { tokenizeDeluge } from '../../syntax/deluge-tokenizer';
import { SYNTAX_TOKEN_ATTR } from '../../syntax/syntax-highlighting';
import { button, el, text } from './view-dom';
import { icon } from './view-icons';

/** Source excerpt box: line numbers, search-hit lines, collapsed gaps, "Show all lines". */

const COLLAPSE_ABOVE = 16;
const CONTEXT = 2;
const HEAD_LINES = 14;

interface Segment {
  start: number;
  end: number;
  token: string | null;
}

/** Tokenizes the whole source once (so multi-line strings/comments classify correctly). */
function segments(source: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const t of tokenizeDeluge(source)) {
    if (t.start > cursor) out.push({ start: cursor, end: t.start, token: null });
    out.push({ start: t.start, end: t.end, token: t.token });
    cursor = Math.max(cursor, t.end);
  }
  if (cursor < source.length) out.push({ start: cursor, end: source.length, token: null });
  return out;
}

function matchRanges(source: string, query: string): Array<[number, number]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hay = source.toLowerCase();
  const out: Array<[number, number]> = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    out.push([i, i + needle.length]);
  }
  return out;
}

function slice(
  source: string,
  start: number,
  end: number,
  ranges: Array<[number, number]>,
): Array<Text | HTMLElement> {
  const nodes: Array<Text | HTMLElement> = [];
  let cursor = start;
  for (const [a, b] of ranges) {
    if (b <= start || a >= end) continue;
    const s = Math.max(a, cursor);
    const e = Math.min(b, end);
    if (e <= s) continue;
    if (s > cursor) nodes.push(text(source.slice(cursor, s)));
    nodes.push(el('mark', { text: source.slice(s, e) }));
    cursor = e;
  }
  if (cursor < end) nodes.push(text(source.slice(cursor, end)));
  return nodes;
}

export interface CodeLine {
  number: number;
  nodes: Array<Text | HTMLElement>;
  hit: boolean;
}

/** Splits highlighted source into per-line node lists. Exported for tests. */
export function buildCodeLines(source: string, query: string): CodeLine[] {
  const segs = segments(source);
  const ranges = matchRanges(source, query);
  const lines: CodeLine[] = [];
  let offset = 0;
  let segIndex = 0;
  const parts = source.split('\n');
  parts.forEach((raw, i) => {
    const lineStart = offset;
    const lineEnd = offset + raw.length;
    const nodes: Array<Text | HTMLElement> = [];
    while (segIndex < segs.length && segs[segIndex].end <= lineStart) segIndex++;
    for (let k = segIndex; k < segs.length && segs[k].start < lineEnd; k++) {
      const s = Math.max(segs[k].start, lineStart);
      const e = Math.min(segs[k].end, lineEnd);
      if (e <= s) continue;
      const children = slice(source, s, e, ranges);
      if (segs[k].token === null) nodes.push(...children);
      else {
        const span = el('span');
        span.setAttribute(SYNTAX_TOKEN_ATTR, segs[k].token as string);
        for (const child of children) span.appendChild(child);
        nodes.push(span);
      }
    }
    const hit = ranges.some(([a, b]) => a < lineEnd && b > lineStart);
    lines.push({ number: i + 1, nodes: nodes.length ? nodes : [text(' ')], hit });
    offset = lineEnd + 1;
  });
  return lines;
}

export interface CodeBoxOptions {
  name: string;
  source: string;
  query: string;
  expanded: boolean;
  /** Stable focus key: the toggle's label changes when it is pressed. */
  focusKey: string;
  onToggle(): void;
}

export function renderCodeBox(o: CodeBoxOptions): HTMLElement {
  const lines = buildCodeLines(o.source, o.query);
  const hits = lines.filter((l) => l.hit).length;
  const collapsible = lines.length > COLLAPSE_ABOVE;
  const showAll = o.expanded || !collapsible;
  const keep = lines.map(() => showAll);
  if (!showAll) {
    if (hits > 0) {
      lines.forEach((l, i) => {
        if (!l.hit) return;
        for (let k = i - CONTEXT; k <= i + CONTEXT; k++)
          if (k >= 0 && k < lines.length) keep[k] = true;
      });
    } else {
      for (let k = 0; k < Math.min(HEAD_LINES, lines.length); k++) keep[k] = true;
    }
  }

  const body: HTMLElement[] = [];
  let gap = 0;
  const flushGap = () => {
    if (!gap) return;
    body.push(el('div', { className: 'gap-l', text: `⋯ ${gap} line${gap > 1 ? 's' : ''} hidden` }));
    gap = 0;
  };
  lines.forEach((l, i) => {
    if (!keep[i]) {
      gap++;
      return;
    }
    flushGap();
    body.push(
      el('div', { className: `cl${l.hit ? ' hit' : ''}` }, [
        el('span', { className: 'no', text: String(l.number) }),
        el('span', { className: 'ct' }, l.nodes),
      ]),
    );
  });
  flushGap();

  const bar = el('div', { className: 'cbar' }, [
    icon('code', 13),
    el('b', { className: 'cname', text: o.name, title: o.name }),
    el('span', {
      className: 'cmeta',
      text: `${lines.length} line${lines.length === 1 ? '' : 's'}${hits ? ` · ${hits} match${hits > 1 ? 'es' : ''}` : ''}`,
    }),
    el('span', { className: 'cspacer' }),
    collapsible
      ? button('wf-btn link', o.expanded ? 'Collapse' : 'Show all lines', o.onToggle, [], {
          attrs: { 'aria-expanded': String(o.expanded), 'data-fk': o.focusKey },
        })
      : null,
  ]);
  const pre = el(
    'pre',
    { className: 'fs-code', attrs: { 'data-zcdt-syntax-enhancement': 'true' } },
    body,
  );
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', `${o.name} source`);
  return el('div', { className: 'codebox' }, [bar, pre]);
}
