/**
 * Inspector source view: the dashboard's highlighted Deluge lines plus evidence marking.
 * Evidence lines come from the `spans` on the function's outgoing edges (UX spec §10), so the
 * map points at the exact code that justifies each inferred write, call or cascade.
 */
import { buildCodeLines } from '../../workflows/view-code';
import type { AutomationGraph, FunctionNode } from '../types';
import { button, el } from './dom';
import { mapIcon } from './icons';

export interface EvidenceChip {
  label: string;
  tone?: 'casc';
}
export interface EvidenceMarker {
  line: number;
  chips: EvidenceChip[];
  /** Write evidence gets the violet bar and takes part in "Evidence n of m" stepping. */
  writes: boolean;
}

export function evidenceMarkers(graph: AutomationGraph, fn: FunctionNode): EvidenceMarker[] {
  const byLine = new Map<number, EvidenceMarker>();
  for (const edge of graph.outgoing.get(fn.id) ?? []) {
    if (!edge.spans?.length) continue;
    const target = graph.nodes.get(edge.to);
    let chip: EvidenceChip | null = null;
    let writes = false;
    if (edge.kind === 'writes' && target?.kind === 'field') {
      writes = true;
      chip = {
        label:
          target.bucket === 'unknownModule'
            ? 'writes ? · module unknown'
            : target.bucket === 'unknownFields'
              ? 'writes ? · keys unknown'
              : `writes ${target.label}`,
      };
    } else if (edge.kind === 'invokes' && target) chip = { label: `calls ${target.label}` };
    else if (edge.kind === 'calls' && target?.kind === 'external')
      chip = {
        label: target.key === '*' ? 'calls external (target unknown)' : `calls ${target.key}`,
      };
    else if (edge.kind === 'cascades') chip = { label: 'may re-trigger rules', tone: 'casc' };
    if (!chip) continue;
    for (const span of edge.spans) {
      const marker = byLine.get(span.line) ?? { line: span.line, chips: [], writes: false };
      if (!marker.chips.some((c) => c.label === chip.label)) marker.chips.push(chip);
      marker.writes ||= writes;
      byLine.set(span.line, marker);
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

const COLLAPSE_ABOVE = 160;
const CONTEXT = 4;
const HEAD_LINES = 40;

export interface CodeViewOptions {
  name: string;
  source: string;
  query: string;
  markers: readonly EvidenceMarker[];
  /** One-based line to start on; defaults to the first write evidence line. */
  currentLine: number | null;
  expanded: boolean;
  onToggle(): void;
}

export interface CodeView {
  el: HTMLElement;
  /** Scrolls the current evidence line to the middle of the code box. */
  reveal(): void;
}

export function renderEvidenceCode(o: CodeViewOptions): CodeView {
  const lines = buildCodeLines(o.source, o.query);
  const markers = new Map(o.markers.map((m) => [m.line, m]));
  const writeLines = o.markers.filter((m) => m.writes).map((m) => m.line);
  const start =
    o.currentLine !== null && writeLines.includes(o.currentLine)
      ? writeLines.indexOf(o.currentLine)
      : 0;
  let index = writeLines.length ? start : -1;

  const collapsible = lines.length > COLLAPSE_ABOVE;
  const showAll = o.expanded || !collapsible;
  const keep = lines.map(() => showAll);
  if (!showAll) {
    const anchors = lines.filter((l) => l.hit || markers.has(l.number)).map((l) => l.number - 1);
    if (anchors.length) {
      for (const a of anchors)
        for (let k = a - CONTEXT; k <= a + CONTEXT; k++)
          if (k >= 0 && k < lines.length) keep[k] = true;
    } else for (let k = 0; k < Math.min(HEAD_LINES, lines.length); k++) keep[k] = true;
  }

  const body: HTMLElement[] = [];
  const rowByLine = new Map<number, HTMLElement>();
  let gap = 0;
  const flushGap = () => {
    if (!gap) return;
    body.push(el('div', { className: 'gap-l', text: `⋯ ${gap} line${gap > 1 ? 's' : ''} hidden` }));
    gap = 0;
  };
  for (const line of lines) {
    if (!keep[line.number - 1]) {
      gap++;
      continue;
    }
    flushGap();
    const marker = markers.get(line.number);
    const row = el(
      'div',
      {
        className: `cl${marker?.writes ? ' ev' : marker ? ' ev-soft' : ''}${line.hit ? ' hit' : ''}`,
        dataset: { ln: String(line.number) },
      },
      [
        el('span', { className: 'no', text: String(line.number) }),
        el('span', { className: 'ct' }, line.nodes),
        marker
          ? el(
              'span',
              { className: 'evrow' },
              marker.chips.map((c) =>
                el('span', { className: `evc${c.tone === 'casc' ? ' casc' : ''}`, text: c.label }),
              ),
            )
          : null,
      ],
    );
    rowByLine.set(line.number, row);
    body.push(row);
  }
  flushGap();

  const pre = el(
    'pre',
    { className: 'fs-code', attrs: { 'data-zcdt-syntax-enhancement': 'true' } },
    body,
  );
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', `${o.name} source`);

  const position = el('span', { className: 'evpos', attrs: { 'aria-live': 'polite' } });
  const mark = () => {
    for (const r of pre.querySelectorAll('.cl.cur')) r.classList.remove('cur');
    if (index < 0) return;
    rowByLine.get(writeLines[index])?.classList.add('cur');
    position.textContent = `Evidence ${index + 1} of ${writeLines.length}`;
  };
  const reveal = () => {
    if (index < 0) return;
    const row = rowByLine.get(writeLines[index]);
    if (row && pre.clientHeight > 0)
      pre.scrollTop = Math.max(0, row.offsetTop - pre.clientHeight / 2);
  };
  const step = (delta: number) => {
    if (!writeLines.length) return;
    index = (index + delta + writeLines.length) % writeLines.length;
    mark();
    reveal();
  };
  mark();

  const hits = lines.filter((l) => l.hit).length;
  const bar = el('div', { className: 'cbar' }, [
    mapIcon('code', 13),
    el('b', { className: 'cname', text: o.name, title: o.name }),
    el('span', {
      className: 'cmeta',
      text: `${lines.length} line${lines.length === 1 ? '' : 's'}${hits ? ` · ${hits} match${hits > 1 ? 'es' : ''}` : ''}`,
    }),
    el('span', { className: 'cspacer' }),
    writeLines.length
      ? el('span', { className: 'evnav' }, [
          position,
          el(
            'button',
            {
              className: 'evbtn',
              type: 'button',
              attrs: { 'aria-label': 'Previous evidence line' },
              onClick: () => step(-1),
            },
            [mapIcon('back', 11)],
          ),
          el(
            'button',
            {
              className: 'evbtn',
              type: 'button',
              attrs: { 'aria-label': 'Next evidence line' },
              onClick: () => step(1),
            },
            [mapIcon('chevronR', 11)],
          ),
        ])
      : null,
    collapsible
      ? button('wf-btn link', o.expanded ? 'Collapse' : 'Show all lines', o.onToggle, [], {
          attrs: { 'aria-expanded': String(o.expanded), 'data-fk': 'code-toggle' },
        })
      : null,
  ]);
  return { el: el('div', { className: 'codebox' }, [bar, pre]), reveal };
}

/** Exposed for stepping from outside the code box ("line 18" links in the Writes list). */
export function lineButton(line: number, onClick: () => void): HTMLElement {
  return button('ln', `line ${line}`, onClick, [], { attrs: { 'data-line': String(line) } });
}
