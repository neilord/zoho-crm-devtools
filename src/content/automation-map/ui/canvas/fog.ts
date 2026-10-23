/**
 * Fog teaser renderer (UX spec §14). The real flow is drawn by the board; everything else is
 * soft drifting fog over text-free silhouettes.
 *
 * Hard constraint: fog is rendered from `FoggedIsland` (counts and an opaque slot) and nothing
 * else. This file never receives the graph, so a fogged module's name, rule, function or field
 * cannot reach the DOM by construction. Every string it writes is built from numbers.
 *
 * Feel: cloud masses (a few overlapping soft puffs per lane, never rows) are painted once on a
 * canvas from radial gradients, so they are soft without any filter; every island gets its own
 * irregular outline; one continuous haze ties the islands together; drifting layers are plain
 * gradients animated with transform/opacity only, and all motion pauses under
 * `prefers-reduced-motion` and while the tab is hidden.
 *
 * Seams: nothing here relies on a mask or a clip to hide a rectangle. Every gradient, puff and
 * lobe reaches alpha 0 inside its own element, so a layer that has not painted yet, or a mask a
 * GPU declines to apply, can never show a straight edge. (The old design painted fills to the
 * edge of each island's box and let a mask-image shape them.)
 */
import type { FoggedIsland, TeaserFog } from '../../types';
import {
  type FogChip,
  fogChips,
  fogCountsText,
  isOrgLike,
  quietNote,
  summarizeFog,
} from '../fog-model';
import type { BoardPlugin } from './board';
import { h, type IconSprite, reducedMotion } from './dom';
import {
  clamp,
  ISLAND_BOTTOM,
  ISLAND_PAD,
  inflate,
  LANE_GAP,
  LANE_TOP,
  LANE_W,
  LANES,
  type Rect,
  rectsIntersect,
  seeded,
  unionRects,
} from './geometry';
import type { MiniRect } from './minimap';
import type { BoardIsland } from './model';

export interface FogRevealed {
  moduleApiName: string;
  /** The revealed module's own (unlocked) name. */
  label: string;
  /** Totals for the revealed module from list metadata: counts only. */
  totalRules: number;
  totalFunctions: number;
}

export interface FogOptions {
  teaser: TeaserFog;
  revealed: FogRevealed | null;
}

const FOG_ID = (slot: number) => `fog-${slot}`;
const MAX_ROWS = 60;

export { isOrgLike };

export function fogGeometry(f: FoggedIsland): { w: number; h: number; org: boolean } {
  const org = isOrgLike(f);
  const rows = Math.min(
    MAX_ROWS,
    Math.max(f.counts.rules, Math.ceil(f.counts.functions / 1.4), org ? f.counts.schedules : 0, 4),
  );
  return { w: org ? 960 : 1296, h: LANE_TOP + rows * 64 + ISLAND_BOTTOM, org };
}

/** "11 rules · 9 functions · 2 buttons": counts only. */
export const fogChipText = fogCountsText;

/**
 * Largest scale at which a lock chip with `text` still fits `share` of `width`. The chip's CSS
 * scale grows as the board zooms out so it stays readable, but never past its island.
 */
export function chipScaleCap(text: string, width: number, share: number): number {
  const estimatedWidth = 118 + 7.2 * text.length;
  return clamp((share * width) / estimatedWidth, 0.6, 6);
}

/* ----------------------------------------------------------------- painting */

/** RGB triples: pale slate-blue puffs, with the odd lavender one for warmth. */
const COOL = ['150,164,208', '140,156,204', '158,170,212'];
const LAVENDER = ['164,146,216', '152,136,208'];
/** The fill under an island's masses. */
const FILL = '176,188,222';
/** At most this many masses per lane: more would read as rows again. */
const MAX_MASSES = 8;

interface PaintRegion {
  w: number;
  h: number;
  top: number;
  /** No lobed outline: a veil over a card's lower part fades only at the box edges. */
  flat?: boolean;
}

/** Lane columns of a module island (entry, rules, actions, resources, effects), or of Org-wide. */
function laneColumns(org: boolean): Array<{ x: number; w: number }> {
  const lanes = org
    ? LANES.filter((l) => l === 'entry' || l === 'resources' || l === 'effects')
    : LANES;
  const out: Array<{ x: number; w: number }> = [];
  let x = ISLAND_PAD;
  for (const lane of lanes) {
    out.push({ x, w: LANE_W[lane] });
    x += LANE_W[lane] + LANE_GAP;
  }
  return out;
}

function laneCounts(f: FoggedIsland, org: boolean): number[] {
  const c = f.counts;
  if (org) return [c.schedules + 2, Math.max(3, c.functions), Math.max(3, c.schedules)];
  return [
    Math.max(2, Math.round(c.rules / 2) + c.buttons),
    c.rules,
    Math.round(c.rules * 1.8),
    Math.max(3, c.functions),
    Math.max(3, Math.min(f.recordWrites, c.rules + 4)),
  ];
}

/**
 * One soft lobe of an island's outline, in px of its box. `solid` is the share of the radius that
 * is fully opaque; past it the lobe fades to nothing at the radius. Radii never reach past the
 * box (capped by the distance to every edge), so the outline fades before any edge.
 */
export interface FogLobe {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  solid: number;
}

/**
 * Irregular outline from numbers only: a chain of round lobes along the island's long axis, joined
 * by one broad central lobe. Round lobes, not one ellipse stretched to the box, so a wide, flat
 * island reads as a bank of cloud rather than a lens.
 */
export function fogLobes(slot: number, w: number, h: number): FogLobe[] {
  const r = (i: number) => seeded(slot * 53 + i);
  const short = Math.max(1, Math.min(w, h));
  const long = Math.max(w, h);
  const wide = w >= h;
  const at = (along: number, across: number) => (wide ? [along, across] : [across, along]);
  const cap = (cx: number, cy: number, rx: number, ry: number, solid: number): FogLobe => ({
    cx,
    cy,
    rx: Math.max(1, Math.min(rx, cx, w - cx)),
    ry: Math.max(1, Math.min(ry, cy, h - cy)),
    solid,
  });
  /** A circle, shrunk (still round) until it fits the box. */
  const round = (cx: number, cy: number, radius: number, solid: number): FogLobe => {
    const fit = Math.max(1, Math.min(radius, cx, w - cx, cy, h - cy));
    return { cx, cy, rx: fit, ry: fit, solid };
  };
  const lobes: FogLobe[] = [];
  const n = clamp(Math.round((long / short) * 0.9) + 1, 2, 5);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = at(
      ((i + 0.5 + (r(i * 7 + 1) - 0.5) * 0.5) / n) * long,
      short * (0.5 + (r(i * 7 + 2) - 0.5) * 0.2),
    );
    const radius = short * (0.36 + r(i * 7 + 3) * 0.16);
    lobes.push(round(cx, cy, radius, 0.3 + r(i * 7 + 4) * 0.2));
  }
  const [cx, cy] = at(long * (0.46 + r(40) * 0.08), short * (0.5 + (r(41) - 0.5) * 0.1));
  const [rx, ry] = at(long * 0.34, short * 0.5);
  lobes.push(cap(cx, cy, rx, ry, 0.34));
  return lobes;
}

/** How much of the box is solid mist at (x, y): the union of the lobes, 0 to 1. */
function outlineCover(lobes: readonly FogLobe[], x: number, y: number): number {
  let clear = 1;
  for (const l of lobes) {
    const d = Math.hypot((x - l.cx) / l.rx, (y - l.cy) / l.ry);
    if (d >= 1) continue;
    const a = d <= l.solid ? 1 : ((1 - d) / (1 - l.solid)) ** 1.6;
    clear *= 1 - a;
  }
  return 1 - clear;
}

/**
 * Cloud masses, not rows: each lane gets a handful (more items, more masses, capped) built from
 * three to five overlapping soft puffs at low alpha, placed by a stratified, seeded jitter so no
 * two lanes or slots share a rhythm. Painted once, from radial gradients, so there is no filter.
 * A puff never reaches past the canvas (its radius is capped by its distance to every edge) and
 * its strength follows the island's outline, so nothing is cut off at the box.
 */
export function paintFogSilhouettes(
  cv: HTMLCanvasElement,
  f: FoggedIsland,
  region: PaintRegion,
  salt = 0,
): void {
  const scale = Math.min(0.4, Math.sqrt(520_000 / Math.max(1, region.w * region.h)));
  cv.width = Math.max(1, Math.round(region.w * scale));
  cv.height = Math.max(1, Math.round(region.h * scale));
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = cv.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return;
  const c2d = ctx;
  const org = isOrgLike(f);
  const lanes = laneColumns(org);
  const counts = laneCounts(f, org);
  const r = (i: number) => seeded(f.slot * 131 + salt * 17 + i);
  const lobes = region.flat ? null : fogLobes(f.slot, region.w, region.h);
  const cover = (x: number, y: number) => (lobes ? outlineCover(lobes, x, y) : 1);

  /** One soft puff: an elliptical radial gradient, opaque in the middle and gone at the rim. */
  const puff = (x: number, y: number, rx: number, ry: number, rgb: string, alpha: number) => {
    const a = alpha * cover(x, y);
    if (a < 0.012) return;
    // Shrink it (shape kept) until it fits: it fades to nothing inside the canvas, not at its edge.
    const k = Math.min(1, x / rx, (region.w - x) / rx, y / ry, (region.h - y) / ry);
    if (k <= 0.05) return;
    c2d.save();
    c2d.translate(x * scale, y * scale);
    c2d.scale(1, ry / rx);
    const reach = rx * k * scale;
    const g = c2d.createRadialGradient(0, 0, 0, 0, 0, reach);
    // A gentle, bell-like falloff: no kink in the middle that would read as a rim.
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.3, `rgba(${rgb},${a * 0.76})`);
    g.addColorStop(0.55, `rgba(${rgb},${a * 0.4})`);
    g.addColorStop(0.8, `rgba(${rgb},${a * 0.12})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c2d.fillStyle = g;
    c2d.beginPath();
    c2d.arc(0, 0, reach, 0, Math.PI * 2);
    c2d.fill();
    c2d.restore();
  };

  // Broad, uneven shading behind the masses gives the island depth without a visible panel.
  for (const [i, [cx, cy, k, a]] of (
    [
      [0.38 + r(40) * 0.12, 0.36 + r(41) * 0.12, 0.62, 0.2],
      [0.66 + r(42) * 0.1, 0.62 + r(43) * 0.12, 0.46, 0.15],
    ] as const
  ).entries()) {
    const reach = Math.max(region.w, region.h * 0.5) * k;
    puff(
      region.w * cx,
      region.h * cy,
      reach,
      Math.min(region.h * 0.5, reach * (1.1 + r(44 + i) * 0.5)),
      '158,172,212',
      a,
    );
  }

  const top = Math.max(LANE_TOP, region.top);
  const usable = Math.max(120, region.h - top - ISLAND_BOTTOM);
  lanes.forEach((lane, li) => {
    const n = clamp(Math.round(Math.sqrt(counts[li] ?? 0) * 1.25), 2, MAX_MASSES);
    // Lanes start at different phases so the masses of neighbouring lanes never line up.
    const phase = r(li * 19 + 3) * 0.6;
    const pitch = usable / (n + phase);
    for (let i = 0; i < n; i++) {
      const k = li * 211 + i * 11;
      if (r(k) < 0.12) continue;
      const cy = top + (i + 0.5 + phase * 0.5 + (r(k + 1) - 0.5) * 0.8) * pitch;
      // Wide masses that wander across neighbouring lanes: confined to a lane they stacked into
      // vertical streaks.
      const w = lane.w * (0.95 + r(k + 2) * 0.8);
      const hh = pitch * (0.7 + r(k + 3) * 0.55);
      const cx = lane.x + lane.w * (0.5 + (r(k + 4) - 0.5) * 1.5);
      // Mass height is capped so a very tall island does not turn into a few vast smudges.
      const lobesN = 3 + Math.floor(r(k + 5) * 3);
      const lav = (i + li + salt) % 4 === 0;
      for (let j = 0; j < lobesN; j++) {
        const m = k * 7 + j * 5;
        const rgb = lav ? LAVENDER[j % LAVENDER.length] : COOL[(i + j + li) % COOL.length];
        puff(
          cx + (r(m) - 0.5) * w * 0.8,
          cy + (r(m + 1) - 0.5) * Math.min(hh, 260) * 0.6,
          w * (0.26 + r(m + 2) * 0.22),
          // Rounder puffs (the old flat ones read as lenses and eyes when they stacked).
          Math.min(hh, 300) * (0.5 + r(m + 3) * 0.35),
          rgb,
          0.07 + r(m + 4) * 0.08,
        );
      }
    }
  });
}

/**
 * The island's outline as a stack of gradients (the fill), from the same lobes the canvas follows.
 * Numbers only. It is the island's background, not a mask: every lobe is capped inside the box
 * and fades to nothing, so no straight edge can show.
 */
export function fogOutline(slot: number, w: number, h: number): string {
  const px = (n: number) => `${n.toFixed(0)}px`;
  return fogLobes(slot, w, h)
    .map(
      (l) =>
        `radial-gradient(ellipse ${px(l.rx)} ${px(l.ry)} at ${px(l.cx)} ${px(l.cy)}, rgba(${FILL},0.62) 0%, rgba(${FILL},0.5) ${(l.solid * 100).toFixed(0)}%, rgba(${FILL},0.2) ${(l.solid * 55 + 45).toFixed(0)}%, rgba(${FILL},0) 100%)`,
    )
    .join(', ');
}

/* --------------------------------------------------------------- fog layer */

function fogIsland(
  f: FoggedIsland,
  rect: Rect,
  sprite: IconSprite,
  org: boolean,
  weight: FogChip,
  onUpgrade: () => void,
): { el: HTMLElement; canvas: HTMLCanvasElement } {
  const chip = fogChipText(f);
  const el = h('div', 'amc-fog amc-fog-hit', {
    id: FOG_ID(f.slot),
    role: 'button',
    tabindex: '0',
    // The tier is a count bucket (nothing identifying); styles and tests read it.
    'data-tier': weight.tier,
    'aria-label': `Locked area: ${chip}. Upgrade to Pro to see it.`,
  });
  el.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;--lk:${weight.scale};--lo:${weight.opacity}`;
  const body = h('div', 'amc-fog-body', { 'aria-hidden': 'true' });
  // The fill is the outline itself (see fogOutline): there is no mask to fail.
  body.style.background = fogOutline(f.slot, rect.w, rect.h);
  const canvas = h('canvas', 'amc-fog-sil');
  const clouds = h('div', 'amc-clouds');
  for (const [i, cls] of ['amc-c1', 'amc-c2'].entries()) {
    const cloud = h('i', `amc-cloud ${cls}`);
    cloud.style.setProperty('--d', `${-((f.slot * 7 + i * 13) % 53)}s`);
    cloud.style.left = `${-14 + seeded(f.slot * 3 + i) * 34}%`;
    cloud.style.top = `${-16 + seeded(f.slot * 5 + i) * 38}%`;
    clouds.append(cloud);
  }
  body.append(canvas, clouds);
  const lock = h('div', 'amc-lock');
  lock.style.setProperty('--lcap', String(chipScaleCap(chip, rect.w, 0.9 / weight.scale)));
  const lk = h('span', 'amc-lk');
  lk.append(sprite.icon('lock', 18));
  const text = h('span', 'amc-lock-text');
  text.append(
    h('span', 'amc-l1', null, chip),
    h('span', 'amc-l2', null, 'In the fog'),
    h('span', 'amc-l2 amc-l2-hov', null, `Upgrade to Pro to see this ${org ? 'area' : 'module'}`),
  );
  lock.append(lk, text, h('span', 'amc-pro', null, 'Pro'));
  // The chip is a sibling of the masked body: the feathered outline must not fade or clip it.
  el.append(body, lock);
  el.addEventListener('click', onUpgrade);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onUpgrade();
    }
  });
  return { el, canvas };
}

/**
 * The haze that joins the islands: one static sheet over the whole fogged estate plus a bounded
 * handful of large drifting puffs (transform and opacity only). It is sized from the islands'
 * rects, so it carries no names and costs the same however many islands there are.
 */
function buildHaze(
  layer: HTMLElement,
  rects: readonly Rect[],
): { puffs: Array<{ el: HTMLElement; rect: Rect }> } {
  const puffs: Array<{ el: HTMLElement; rect: Rect }> = [];
  if (!rects.length) return { puffs };
  const bounds = inflate(unionRects([...rects]), 700);
  const sheet = h('div', 'amc-fog-sheet', { 'aria-hidden': 'true' });
  sheet.style.cssText = `left:${bounds.x}px;top:${bounds.y}px;width:${bounds.w}px;height:${bounds.h}px`;
  layer.append(sheet);
  const span = Math.min(bounds.w, bounds.h * 1.6);
  const count = clamp(Math.round((bounds.w * bounds.h) / 5_000_000), 5, 12);
  for (let i = 0; i < count; i++) {
    const size = clamp(span * (0.22 + seeded(i * 7 + 1) * 0.2), 1100, 2600);
    const x = bounds.x + seeded(i * 11 + 2) * (bounds.w - size * 0.6) - size * 0.2;
    const y = bounds.y + seeded(i * 13 + 3) * (bounds.h - size * 0.5) - size * 0.2;
    const el = h('div', 'amc-haze', { 'aria-hidden': 'true' });
    el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size * (0.55 + seeded(i * 5 + 4) * 0.25)}px;--d:${-((i * 17) % 71)}s;--dur:${60 + ((i * 9) % 34)}s`;
    el.dataset.tone = i % 3 === 0 ? 'lav' : 'cool';
    layer.append(el);
    puffs.push({ el, rect: { x, y, w: size, h: size } });
  }
  return { puffs };
}

export function createFogPlugin(options: FogOptions): BoardPlugin {
  const { teaser, revealed } = options;
  // Modules without automation are one note, never empty islands.
  const { areas, quiet } = summarizeFog(teaser);
  const chips = fogChips(areas);
  const geo = new Map(areas.map((f) => [f.slot, fogGeometry(f)]));
  const flowBottoms = new Map<string, number>();
  const revealedSize = { w: 1296, h: 700 };
  let upgrade: () => void = () => {};

  const restRows = (I: BoardIsland) =>
    revealed ? Math.min(10, Math.max(0, revealed.totalRules - I.stats.rules)) : 0;

  return {
    redact: { keep: revealed?.moduleApiName ?? null },
    flows: false,
    note: () => (quiet > 0 ? quietNote(quiet) : null),
    blocks: () =>
      areas.map((f) => {
        const g = geo.get(f.slot) ?? fogGeometry(f);
        return {
          id: FOG_ID(f.slot),
          w: g.w,
          h: g.h,
          org: g.org,
          weight: f.counts.rules * 1000 + f.counts.buttons * 10 + f.counts.functions,
        };
      }),
    layout: {
      weightOf: (I) =>
        revealed && I.id === revealed.moduleApiName
          ? revealed.totalRules * 1000 + revealed.totalFunctions
          : I.stats.rules * 1000 + I.stats.functions,
      adjust: (I) => {
        if (!revealed || I.id !== revealed.moduleApiName) return;
        const flowBottom = Math.max(LANE_TOP, ...I.items.map((i) => i.y + i.h));
        flowBottoms.set(I.id, flowBottom);
        I.h = Math.max(I.h, flowBottom + 22 + Math.max(restRows(I), 3) * 54 + 70);
        revealedSize.w = I.w;
        revealedSize.h = I.h;
      },
    },
    arrival: (islands) => {
      const I = revealed ? islands.find((x) => x.id === revealed.moduleApiName) : undefined;
      if (!I) return null;
      return {
        rect: { x: I.x, y: I.y, w: I.w, h: (flowBottoms.get(I.id) ?? I.h) + 30 },
        zoom: 0.86,
        delayMs: 900,
      };
    },
    decorateIsland: (el, I, sprite) => {
      if (!revealed || I.id !== revealed.moduleApiName) return;
      const flowBottom = flowBottoms.get(I.id) ?? LANE_TOP;
      const rest = Math.max(0, revealed.totalRules - I.stats.rules);
      const shown = I.stats.rules;
      const cnt = el.querySelector('.amc-cnt');
      if (cnt)
        cnt.textContent = `${revealed.totalRules} rules · ${shown === 1 ? '1 flow' : `${shown} flows`} shown in this preview`;
      const rib = () => h('span', 'amc-preview-rib', null, 'Preview');
      el.querySelector('.amc-head')?.insertBefore(rib(), el.querySelector('.amc-hubs'));
      el.querySelector('.amc-ttl')?.append(rib());
      const sum = el.querySelector('.amc-sumtxt');
      if (sum) {
        sum.textContent = '';
        const line = h('div', 'amc-sc');
        line.append(
          h('b', null, null, String(shown)),
          document.createTextNode(shown === 1 ? ' flow shown · ' : ' flows shown · '),
          h('b', null, null, String(rest)),
          document.createTextNode(rest === 1 ? ' more rule in the fog' : ' more rules in the fog'),
        );
        sum.append(line);
      }
      // The rest of the module: silhouettes under a drifting veil, with a lock chip.
      const veil = h('div', 'amc-veil amc-fog-hit');
      veil.style.top = `${flowBottom + 6}px`;
      const canvas = h('canvas', 'amc-fog-sil', { 'aria-hidden': 'true' });
      const clouds = h('div', 'amc-clouds', { 'aria-hidden': 'true' });
      for (const [i, cls] of ['amc-c1', 'amc-c2'].entries()) {
        const cloud = h('i', `amc-cloud ${cls}`);
        cloud.style.setProperty('--d', `${-(11 + i * 17)}s`);
        clouds.append(cloud);
      }
      const lock = h('div', 'amc-lock amc-lock-rest');
      const restText = `${rest} more rule${rest === 1 ? '' : 's'} in ${revealed.label}`;
      // The chip sits at 30% of the island, so only 60% of the width is available to it.
      lock.style.setProperty('--lcap', String(chipScaleCap(restText, I.w, 0.55)));
      const lk = h('span', 'amc-lk');
      lk.append(sprite.icon('lock', 18));
      const text = h('span', 'amc-lock-text');
      text.append(
        h('span', 'amc-l1', null, restText),
        h('span', 'amc-l2', null, 'Upgrade to Pro to see them'),
      );
      lock.append(lk, text, h('span', 'amc-pro', null, 'Pro'));
      veil.append(canvas, clouds, lock);
      veil.addEventListener('click', () => upgrade());
      el.append(veil);
      const rowsFog: FoggedIsland = {
        slot: 900,
        counts: {
          rules: restRows(I),
          functions: Math.max(3, Math.round(revealed.totalFunctions / 2)),
          buttons: 0,
          schedules: 0,
        },
        recordWrites: 4,
      };
      paintFogSilhouettes(
        canvas,
        rowsFog,
        { w: I.w, h: Math.max(80, I.h - flowBottom - 6), top: 0, flat: true },
        3,
      );
    },
    attach: ({ layer, anchors, sprite, onUpgrade }) => {
      upgrade = onUpgrade;
      const rects: MiniRect[] = [];
      const islands: Array<{
        f: FoggedIsland;
        rect: Rect;
        el: HTMLElement;
        canvas: HTMLCanvasElement;
        painted: boolean;
        visible: boolean | null;
      }> = [];
      const home = revealed ? anchors.get(revealed.moduleApiName) : undefined;
      const placed: Array<{ f: FoggedIsland; rect: Rect }> = [];
      for (const f of areas) {
        const a = anchors.get(FOG_ID(f.slot));
        const g = geo.get(f.slot) ?? fogGeometry(f);
        if (!a) continue;
        placed.push({ f, rect: { x: a.x, y: a.y, w: g.w, h: g.h } });
      }
      // Haze first: it sits under every island, so the islands read as denser masses within it.
      const haze = buildHaze(layer, [
        ...placed.map((p) => p.rect),
        ...(home ? [{ x: home.x, y: home.y, w: revealedSize.w, h: revealedSize.h }] : []),
      ]);
      if (home) {
        // A soft clearing in the fog around the revealed flow.
        const halo = h('div', 'amc-clearing', { 'aria-hidden': 'true' });
        halo.style.cssText = `left:${home.x - 520}px;top:${home.y - 520}px;width:${revealedSize.w + 1040}px;height:${revealedSize.h + 1040}px`;
        layer.append(halo);
      }
      for (const { f, rect } of placed) {
        const g = geo.get(f.slot) ?? fogGeometry(f);
        rects.push({ ...rect, fog: true });
        const weight = chips.get(f.slot) as FogChip;
        const { el, canvas } = fogIsland(f, rect, sprite, g.org, weight, onUpgrade);
        layer.append(el);
        islands.push({ f, rect, el, canvas, painted: false, visible: null });
      }
      layer.classList.toggle('amc-fog-still', reducedMotion());
      const onVisibility = () => layer.classList.toggle('amc-fog-paused', document.hidden);
      document.addEventListener('visibilitychange', onVisibility);
      onVisibility();
      let lastLs = 0;
      return {
        rects,
        update: (view, zoom) => {
          // Lock chips scale up as the board zooms out so they stay readable.
          const ls = clamp(0.9 / zoom, 1, 6);
          if (Math.abs(ls - lastLs) > 0.02) {
            lastLs = ls;
            // On the world, so the revealed island's lock chip scales with the fog chips.
            (layer.parentElement ?? layer).style.setProperty('--ls', String(ls));
          }
          const cull = inflate(view, 360 / zoom);
          for (const puff of haze.puffs) puff.el.hidden = !rectsIntersect(puff.rect, cull);
          for (const isl of islands) {
            const visible = rectsIntersect(isl.rect, cull);
            // Hidden islands drop out of layout and paint, so their animations cost nothing.
            if (isl.visible === visible) continue;
            isl.visible = visible;
            isl.el.hidden = !visible;
            if (visible && !isl.painted) {
              isl.painted = true;
              paintFogSilhouettes(isl.canvas, isl.f, { w: isl.rect.w, h: isl.rect.h, top: 0 });
            }
          }
        },
        dispose: () => document.removeEventListener('visibilitychange', onVisibility),
      };
    },
  };
}
