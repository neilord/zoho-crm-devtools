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

/** Fills `el` with `text`, every run of digits wrapped in a `<b>`. */
function boldNumbers(el: HTMLElement, text: string): void {
  for (const part of text.split(/(\d+)/)) {
    if (!part) continue;
    if (/^\d+$/.test(part)) el.append(h('b', null, null, part));
    else el.append(document.createTextNode(part));
  }
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
  // Every count is bold, whatever the island has: a 0-rule "written from N modules" island reads
  // the same as a 2-rule one (and the wording comes from `plural`, so "1 rule", never "1 rules").
  const line = h('div', 'amc-sc');
  if (I.org || !s.rules) {
    // "written from 2 modules" is "from 2 modules" here: a 640px island is ~100px on screen.
    boldNumbers(line, countsText(I).replace(/^written from /, 'from '));
  } else {
    boldNumbers(
      line,
      `${plural(s.rules, 'rule')} · ${s.activeRules} active · ${plural(s.functions, 'function')}`,
    );
  }
  txt.append(line);
  // Far out an island is a few dozen screen px wide: one short count instead of a cut-off line
  // (empty islands carry nothing there; their title says what they are).
  const shortText = I.org
    ? s.schedules
      ? plural(s.schedules, 'schedule')
      : plural(s.functions, 'function')
    : s.rules
      ? plural(s.rules, 'rule')
      : '';
  line.classList.add('amc-sc-full');
  if (shortText) {
    const short = h('div', 'amc-sc amc-sc-short');
    boldNumbers(short, shortText);
    txt.append(short);
  }
  if (!I.org && s.rules) {
    const line2 = h('div', 'amc-sc amc-sc-full');
    boldNumbers(
      line2,
      `writes ${plural(s.fields, 'field')}${s.buttons ? ` · ${plural(s.buttons, 'button')}` : ''}`,
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

/**
 * Kind colour as an rgb() triplet for `rgba(...)` fills, pulled toward the island's cool slate
 * so the wash reads as a tint of the kind, not a bar of it (and no kind outshouts its neighbours).
 */
function rgbOf(hex: string, keep = 0.55): string {
  const slate = [150, 162, 190];
  const c = (i: number) =>
    Math.round(Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * keep + slate[i] * (1 - keep));
  return `${c(0)},${c(1)},${c(2)}`;
}

/**
 * Paints the island's real node rects as soft, feathered kind-coloured blobs (overview tier).
 * Semantic zoom: far out, cards would be hairline-edged slivers, so the body of an island is a
 * wash of colour (a wide, faint glow under a tighter one) that crossfades into crisp cards as you
 * zoom in. The blur is baked into this one bitmap once per island: nothing filters at paint time.
 */
export function drawSilhouettes(shell: IslandShell, palette: Palette): void {
  if (shell.silDrawn) return;
  shell.silDrawn = true;
  const I = shell.island;
  // Soft shapes need few pixels: large islands render at a lower resolution.
  const scale = Math.min(0.35, Math.sqrt(900_000 / Math.max(1, I.w * I.h)));
  const cv = shell.sil;
  cv.width = Math.max(1, Math.round(I.w * scale));
  cv.height = Math.max(1, Math.round(I.h * scale));
  let ctx: CanvasRenderingContext2D | null = null;
  let src: HTMLCanvasElement | null = null;
  let sctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = cv.getContext('2d');
    src = document.createElement('canvas');
    src.width = cv.width;
    src.height = cv.height;
    sctx = src.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx || !src || !sctx) return;
  // Items are drawn once as full pills, one alpha per kind; the blur is applied to the whole layer.
  const inset = 3;
  for (const item of I.items) {
    const w = Math.max(2, item.w - inset * 2) * scale;
    const h = Math.max(2, item.h - inset * 2) * scale;
    // The org-wide island is one dense stack of rows: it gets less colour and alpha than the rest
    // so it never outshouts them.
    const alpha =
      (item.kind === 'action' || item.kind === 'field' ? 0.26 : 0.46) * (I.org ? 0.6 : 1);
    sctx.fillStyle = `rgba(${rgbOf(palette[item.kind], I.org ? 0.35 : 0.55)},${alpha})`;
    sctx.beginPath();
    sctx.roundRect((item.x + inset) * scale, (item.y + inset) * scale, w, h, h * 0.5);
    sctx.fill();
  }
  const blurPx = (world: number) => `blur(${Math.max(0.6, world * scale).toFixed(2)}px)`;
  if (typeof ctx.filter === 'string') {
    // Three radii so detail resolves gradually as the zoom rises (no switch at a threshold).
    ctx.filter = blurPx(40);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(src, 0, 0);
    ctx.filter = blurPx(18);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(src, 0, 0);
    ctx.filter = blurPx(8);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
  } else {
    ctx.globalAlpha = 0.7;
    ctx.drawImage(src, 0, 0);
  }
  ctx.globalAlpha = 1;
}

/** `count === null` clears search state. */
export function setMatchBadges(shell: IslandShell, count: number | null): void {
  const searching = count !== null;
  shell.el.classList.toggle('amc-nomatch', searching && count === 0);
  for (const b of shell.badges) b.textContent = String(count ?? 0);
  shell.smatch.hidden = !searching;
  if (searching) shell.smatch.textContent = plural(count, 'match', 'matches');
}
