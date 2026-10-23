/**
 * Island shell DOM: header, lane labels, overview frame title and summary card (UX spec §6.1, §6.3).
 * Silhouettes of the real node rects are painted on one `<canvas>` per island rather than one
 * element per node, so the overview costs a handful of DOM nodes however big the org is.
 */
import { h, type IconSprite } from './dom';
import { LANE_GAP, LANE_LABEL, LANE_W, plural, SUBCOLUMN_GAP } from './geometry';
import { type ItemKind, KIND_VAR } from './kinds';
import type { BoardIsland, BoardItem } from './model';

export type Palette = Record<ItemKind, string>;

const DEFAULT_PALETTE: Palette = {
  event: '#b7791f',
  button: '#2b8a3e',
  schedule: '#ae3ec9',
  api: '#e8590c',
  rule: '#2f6df0',
  action: '#5c677d',
  function: '#6741d9',
  template: '#d6336c',
  external: '#8a6d3b',
  field: '#0c8599',
  transition: '#0b7285',
  approval: '#5c940d',
  module: '#3d4657',
  portal: '#6b7488',
};

/** Canvas cannot read CSS variables, so resolve the kind colours once from the live tokens. */
export function resolvePalette(root: Element): Palette {
  const palette = { ...DEFAULT_PALETTE };
  if (typeof getComputedStyle !== 'function') return palette;
  const style = getComputedStyle(root);
  for (const kind of Object.keys(palette) as ItemKind[]) {
    const v = style.getPropertyValue(KIND_VAR[kind]).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) palette[kind] = v;
  }
  return palette;
}

function mix(hex: string, base: string, amount: number): string {
  const c = (h: string, i: number) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(c(base, i) + (c(hex, i) - c(base, i)) * amount));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

export interface IslandShell {
  island: BoardIsland;
  el: HTMLElement;
  sil: HTMLCanvasElement;
  silDrawn: boolean;
  /** Match-count badges (title and header); toggled while searching. */
  badges: HTMLElement[];
  smatch: HTMLElement;
}

export function countsText(I: BoardIsland): string {
  const s = I.stats;
  if (I.org)
    return [
      plural(s.schedules, 'schedule'),
      plural(s.apis, 'API function'),
      plural(s.functions, 'function'),
    ].join(' · ');
  const parts: string[] = [];
  if (s.rules) parts.push(plural(s.rules, 'rule'), `${s.activeRules} active`);
  if (s.functions) parts.push(plural(s.functions, 'function'));
  if (s.fields || s.rules) parts.push(`writes ${plural(s.fields, 'field')}`);
  // A write target with no rules of its own (Tasks) is described by who writes to it.
  if (!s.rules && s.writtenFrom) parts.push(`written from ${plural(s.writtenFrom, 'module')}`);
  return parts.length ? parts.join(' · ') : 'No automation';
}

function avatar(I: BoardIsland, sprite: IconSprite): HTMLElement {
  const av = h('span', I.org ? 'amc-av amc-org' : 'amc-av');
  if (I.org) av.append(sprite.icon('clock', 15));
  else av.textContent = I.abbr;
  return av;
}

function topHubs(I: BoardIsland, n: number): BoardItem[] {
  return I.items
    .filter((i) => i.hub)
    .sort((a, b) => (b.hub?.callers ?? 0) - (a.hub?.callers ?? 0) || (a.key < b.key ? -1 : 1))
    .slice(0, n);
}

function hubChip(item: BoardItem, sprite: IconSprite): HTMLElement {
  const chip = h('span', 'amc-hubchip');
  // Count first: the name truncates, the count is what the chip is for.
  chip.append(
    sprite.icon('function', 12),
    h('b', 'amc-hc-n', null, String(item.hub?.callers ?? 0)),
    h('span', null, null, item.title),
  );
  return chip;
}

export interface ShellOptions {
  sprite: IconSprite;
  /** Called with the finished shell so a plugin (fog teaser) can add decoration. */
  decorate?: (el: HTMLElement, island: BoardIsland) => void;
}

export function createIslandShell(I: BoardIsland, opts: ShellOptions): IslandShell {
  const { sprite } = opts;
  const el = h('div', I.h < 640 ? 'amc-isl amc-short' : 'amc-isl', {
    'data-island': I.id,
    role: 'group',
    'aria-label': `${I.label} island`,
  });
  el.style.cssText = `left:${I.x}px;top:${I.y}px;width:${I.w}px;height:${I.h}px;--sh:${Math.round(I.h)};--sw:${Math.round(I.w)}`;

  const badges: HTMLElement[] = [];
  const badge = () => {
    const b = h('span', 'amc-ismatch', null, '0');
    badges.push(b);
    return b;
  };

  const ttl = h('div', 'amc-ttl');
  ttl.append(avatar(I, sprite), h('span', 'amc-ttl-name', null, I.label), badge());

  const head = h('div', 'amc-head', { title: `Fly to ${I.label}` });
  const main = h('div', 'amc-head-main');
  main.append(h('div', 'amc-name', null, I.label), h('div', 'amc-cnt', null, countsText(I)));
  const hubs = h('span', 'amc-hubs');
  for (const hub of topHubs(I, 2)) hubs.append(hubChip(hub, sprite));
  head.append(avatar(I, sprite), main, hubs, badge());

  el.append(ttl, head);
  I.present.forEach((lane, index) => {
    const cols = I.laneCols[lane] ?? 1;
    const x0 = I.laneX[lane] ?? 0;
    for (let c = 0; c < cols; c++) {
      const label = h('span', 'amc-lane-lbl', null, LANE_LABEL[lane]);
      label.style.left = `${x0 + c * (LANE_W[lane] + SUBCOLUMN_GAP)}px`;
      el.append(label);
    }
    if (index > 0) {
      const sep = h('span', 'amc-lane-sep');
      sep.style.left = `${x0 - LANE_GAP / 2}px`;
      el.append(sep);
    }
  });

  const sum = h('div', 'amc-sum', { 'data-sum': I.id });
  const sil = h('canvas', 'amc-sil', { 'aria-hidden': 'true' });
  const txt = h('div', 'amc-sumtxt');
  const s = I.stats;
  const line = h('div', 'amc-sc');
  const bold = (n: number | string, tail: string) => {
    line.append(h('b', null, null, String(n)), document.createTextNode(tail));
  };
  if (I.org || !s.rules) {
    line.textContent = countsText(I);
  } else {
    bold(s.rules, ' rules · ');
    bold(s.activeRules, ' active · ');
    bold(s.functions, ' functions');
  }
  txt.append(line);
  if (!I.org && s.rules) {
    const line2 = h('div', 'amc-sc');
    line2.append(
      document.createTextNode('writes '),
      h('b', null, null, String(s.fields)),
      document.createTextNode(` fields${s.buttons ? ` · ${plural(s.buttons, 'button')}` : ''}`),
    );
    txt.append(line2);
  }
  if (s.rules) {
    const bar = h('div', 'amc-sbar');
    const on = h('i');
    on.style.flex = String(s.activeRules);
    const off = h('i');
    off.style.flex = String(s.rules - s.activeRules);
    bar.append(on, off);
    txt.append(bar);
  }
  const hubItems = topHubs(I, 2);
  if (hubItems.length) {
    const wrap = h('div', 'amc-shubs');
    for (const hub of hubItems) wrap.append(hubChip(hub, sprite));
    txt.append(wrap);
  }
  const smatch = h('div', 'amc-smatch');
  smatch.hidden = true;
  txt.append(smatch);
  sum.append(sil, txt);
  el.append(sum);

  opts.decorate?.(el, I);
  return { island: I, el, sil, silDrawn: false, badges, smatch };
}

/** Paints the island's real node rects as soft kind-coloured silhouettes (overview tier). */
export function drawSilhouettes(shell: IslandShell, palette: Palette): void {
  if (shell.silDrawn) return;
  shell.silDrawn = true;
  const I = shell.island;
  // Bound the bitmap: large islands render at a lower resolution (they are only seen small).
  const scale = Math.min(0.5, Math.sqrt(1_200_000 / Math.max(1, I.w * I.h)));
  const cv = shell.sil;
  cv.width = Math.max(1, Math.round(I.w * scale));
  cv.height = Math.max(1, Math.round(I.h * scale));
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = cv.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return;
  const cache = new Map<ItemKind, string>();
  for (const item of I.items) {
    let fill = cache.get(item.kind);
    if (!fill) {
      fill = mix(palette[item.kind], '#f4f6fa', 0.16);
      cache.set(item.kind, fill);
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(
      item.x * scale,
      item.y * scale,
      item.w * scale,
      item.h * scale,
      Math.min(10 * scale, item.h * scale * 0.4),
    );
    ctx.fill();
  }
}

/** `count === null` clears search state. */
export function setMatchBadges(shell: IslandShell, count: number | null): void {
  const searching = count !== null;
  shell.el.classList.toggle('amc-nomatch', searching && count === 0);
  for (const b of shell.badges) b.textContent = String(count ?? 0);
  shell.smatch.hidden = !searching;
  if (searching) shell.smatch.textContent = plural(count, 'match', 'matches');
}
