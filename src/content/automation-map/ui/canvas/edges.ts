/**
 * Edge geometry and styling shared by the board and the trace flowchart (UX spec §6.2).
 * Declared = solid, inferred = dashed, unresolved = hollow tube ending in a ring; cascades are
 * amber, reactors dotted. Hover and selection toggle classes and swap markers only.
 */
import type { EdgeEvidence, MapEdge } from '../../types';
import { type IconSprite, s } from './dom';

export function pathFwd(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(30, (x2 - x1) * 0.4);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

/** Target is not to the right of the source (same lane or a call arcing back): bulge right. */
export function pathSide(x1: number, y1: number, x2: number, y2: number, bulge = 46): string {
  const bx = Math.max(x1, x2) + bulge;
  return `M${x1},${y1} C${bx},${y1} ${bx},${y2} ${x2},${y2}`;
}

/** Cascade back edge: leaves right, runs under the island, returns to the target's left. */
export function pathBack(x1: number, y1: number, x2: number, y2: number, yb: number): string {
  return `M${x1},${y1} C${x1 + 20},${y1} ${x1 + 20},${yb} ${x1 - 10},${yb} L${x2 + 10},${yb} C${x2 - 46},${yb} ${x2 - 46},${y2} ${x2},${y2}`;
}

export interface EdgeLike {
  kind: string;
  evidence: EdgeEvidence;
  confidence: MapEdge['confidence'];
  back?: boolean;
  loop?: boolean;
}

export interface EdgeMarkers {
  arrow: string;
  arrowHl: string;
  arrowOpen: string;
  ring: string;
  arrowCasc: string;
}

export function markerIds(sprite: IconSprite): EdgeMarkers {
  return {
    arrow: sprite.id('arr'),
    arrowHl: sprite.id('arr-hl'),
    arrowOpen: sprite.id('arr-open'),
    ring: sprite.id('ring'),
    arrowCasc: sprite.id('arr-casc'),
  };
}

/** `<defs>` for the arrowheads; one per svg layer. */
export function createDefs(ids: EdgeMarkers): SVGDefsElement {
  const defs = s('defs');
  const marker = (id: string, size: number, refX: number, fill: string | null, ring = false) => {
    const m = s('marker', {
      id,
      viewBox: '0 0 10 10',
      refX,
      refY: 5,
      markerWidth: size,
      markerHeight: size,
      orient: 'auto',
    });
    if (ring) {
      m.append(
        s('circle', { cx: 5, cy: 5, r: 3.2, fill: '#fff', stroke: '#a9b2c3', 'stroke-width': 1.6 }),
      );
    } else if (fill) {
      m.append(s('path', { d: 'M1,1 L9,5 L1,9 z', fill }));
    } else {
      m.append(
        s('path', {
          d: 'M1,1.5 L9,5 L1,8.5',
          fill: 'none',
          stroke: '#9aa3b5',
          'stroke-width': 1.5,
        }),
      );
    }
    return m;
  };
  defs.append(
    marker(ids.arrow, 7, 9, '#b3bccb'),
    marker(ids.arrowHl, 7, 9, '#2f6df0'),
    marker(ids.arrowOpen, 8, 9, null),
    marker(ids.ring, 8, 8, null, true),
    marker(ids.arrowCasc, 7, 9, '#d97706'),
  );
  return defs;
}

function edgeClass(e: EdgeLike): string {
  const cls = ['amc-e'];
  if (e.kind === 'cascades') cls.push('amc-e-casc');
  else if (e.kind === 'reacts') cls.push('amc-e-react');
  else if (e.evidence === 'inferred') cls.push('amc-e-inf');
  if (e.kind === 'invokes' && e.evidence === 'declared') cls.push('amc-e-call');
  if (e.kind === 'calls') cls.push('amc-e-call');
  return cls.join(' ');
}

function markerFor(e: EdgeLike, ids: EdgeMarkers): string {
  if (e.kind === 'cascades') return `url(#${ids.arrowCasc})`;
  if (e.evidence === 'unresolved') return `url(#${ids.ring})`;
  if (e.evidence === 'inferred') return `url(#${ids.arrowOpen})`;
  if (e.kind === 'reacts' || e.kind === 'calls') return '';
  return `url(#${ids.arrow})`;
}

/**
 * Appends one edge (two stacked paths for the hollow unresolved tube) and returns its elements.
 * `badge` is where the "+?" mark for partial analyses goes.
 */
export function drawEdge(
  layer: Element,
  d: string,
  e: EdgeLike,
  ids: EdgeMarkers,
  extraClass = '',
  badge?: { x: number; y: number },
): SVGElement[] {
  const els: SVGElement[] = [];
  const extra = extraClass ? ` ${extraClass}` : '';
  if (e.evidence === 'unresolved' && e.kind !== 'cascades') {
    els.push(s('path', { d }, `amc-e amc-e-ur-o${extra}`));
    els.push(s('path', { d, 'marker-end': `url(#${ids.ring})` }, `amc-e amc-e-ur-i${extra}`));
  } else {
    const marker = markerFor(e, ids);
    els.push(s('path', { d, 'marker-end': marker || null }, `${edgeClass(e)}${extra}`));
  }
  if (e.confidence === 'partial' && badge) {
    const t = s('text', { x: badge.x, y: badge.y }, 'amc-badge-pq');
    t.textContent = '+?';
    els.push(t);
  }
  for (const el of els) layer.append(el);
  return els;
}

/**
 * A trunk for edges that converge on one node: every source curves to a shared merge point and a
 * single short edge carries on to the target. Sources of the same evidence tier share one path
 * element (many subpaths), so fifty writers into one field cost three elements, not fifty.
 */
export function drawTrunk(
  layer: Element,
  trunk: { from: { x: number; y: number }; to: { x: number; y: number } },
  sources: ReadonlyArray<{ d: string; evidence: EdgeEvidence }>,
  strongest: EdgeLike,
  ids: EdgeMarkers,
  count: number,
): SVGElement[] {
  const els: SVGElement[] = [];
  for (const evidence of ['declared', 'inferred'] as const) {
    const d = sources
      .filter((src) => (evidence === 'inferred') === (src.evidence === 'inferred'))
      .map((src) => src.d)
      .join(' ');
    if (!d) continue;
    els.push(s('path', { d }, `amc-e amc-e-bundle${evidence === 'inferred' ? ' amc-e-inf' : ''}`));
  }
  els.push(
    ...drawEdge(
      layer,
      `M${trunk.from.x},${trunk.from.y} L${trunk.to.x},${trunk.to.y}`,
      { ...strongest, kind: strongest.kind === 'cascades' ? 'writes' : strongest.kind },
      ids,
      'amc-e-trunk',
    ),
  );
  const n = s(
    'text',
    { x: trunk.from.x - 6, y: trunk.from.y - 7, 'text-anchor': 'end' },
    'amc-trunk-n',
  );
  n.textContent = `×${count}`;
  els.push(n);
  for (const el of els) if (!el.parentNode) layer.append(el);
  return els;
}
