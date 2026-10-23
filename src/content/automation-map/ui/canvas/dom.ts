/**
 * Tiny DOM helpers. CRM-derived text only ever reaches the page through `textContent`/attributes;
 * this module deliberately has no way to parse markup (security boundary, ADR 0026).
 */
import { type MapIconName, mapIcon } from '../icons';

export const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | boolean | null | undefined>;

function applyAttrs(el: Element, attrs?: Attrs | null) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  attrs?: Attrs | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  applyAttrs(el, attrs);
  if (text !== undefined) el.textContent = text;
  return el;
}

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  className?: string | null,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  if (className) el.setAttribute('class', className);
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Pixel value of a CSS custom property (`12px`) on an element, or null when unset or not a length. */
export function cssPx(el: Element, name: string): number | null {
  if (typeof getComputedStyle !== 'function') return null;
  const n = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(n) ? n : null;
}

export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

let spriteSeq = 0;

/**
 * One hidden `<svg>` of `<symbol>`s per mount; cards reference icons with `<use>`, which keeps a
 * card at two icon elements instead of four or five (UX spec §18 render budget).
 */
export class IconSprite {
  readonly el: SVGSVGElement;
  private readonly prefix = `amci${++spriteSeq}-`;
  private readonly made = new Set<string>();

  constructor() {
    this.el = s('svg', {
      width: 0,
      height: 0,
      'aria-hidden': 'true',
      focusable: 'false',
      style: 'position:absolute;width:0;height:0;overflow:hidden',
    });
  }

  private ensure(name: MapIconName) {
    if (this.made.has(name)) return;
    this.made.add(name);
    const source = mapIcon(name);
    const symbol = s('symbol', { id: this.prefix + name, viewBox: '0 0 20 20' });
    while (source.firstChild) symbol.append(source.firstChild);
    this.el.append(symbol);
  }

  /** `<svg class="amc-i"><use/></svg>`; stroke styling comes from the `.amc-i` CSS rule. */
  icon(name: MapIconName, size = 16, className = ''): SVGSVGElement {
    this.ensure(name);
    const svg = s(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 20 20',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      className ? `amc-i ${className}` : 'amc-i',
    );
    const use = s('use');
    use.setAttribute('href', `#${this.prefix}${name}`);
    svg.append(use);
    return svg;
  }

  /** Id prefix for other defs (markers) that must not collide between mounts. */
  id(name: string): string {
    return this.prefix + name;
  }
}
