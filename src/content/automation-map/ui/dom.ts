/**
 * DOM helpers for the Automation Map UI. CRM text only ever reaches the page through
 * `textContent` / text nodes / attributes set via `setAttribute`; there is no HTML-string path.
 */
import {
  button,
  captureFocus,
  el,
  focusKey,
  marked,
  markRanges,
  restoreFocus,
  text,
} from '../../workflows/view-dom';

export { button, captureFocus, el, focusKey, marked, markRanges, restoreFocus, text };

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | null | undefined> = {},
  children: Array<Node | null> = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs))
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

/** Replaces children only when a cheap signature changed, preserving focus across rebuilds. */
export function setSig(
  node: HTMLElement,
  sig: string,
  build: () => Array<Node | null>,
  root: ShadowRoot,
  fallback: HTMLElement,
): boolean {
  if (node.dataset.sig === sig) return false;
  node.dataset.sig = sig;
  const focused = captureFocus(root, node);
  node.replaceChildren(...build().filter((n): n is Node => n !== null));
  restoreFocus(node, focused, fallback);
  return true;
}

export const compact = <T>(items: ReadonlyArray<T | null | undefined>): T[] =>
  items.filter((i): i is T => i !== null && i !== undefined);

export const kbdKeys = (keys: readonly string[]): HTMLElement[] =>
  keys.map((k) => el('span', { className: 'kbd', text: k }));

/** `CSS.escape` where it exists (jsdom lacks it); identifiers here are ids and API names. */
export const cssEscape = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/[^\w-]/g, (c) => `\\${c}`);

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Trailing debounce. With `leading`, the first call after a quiet period runs at once (a single
 * keystroke answers immediately) and only the calls that follow inside the window are held back
 * to its trailing edge.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  opts: { leading?: boolean } = {},
): ((...args: A) => void) & { cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = () => {
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };
  const debounced = (...args: A) => {
    if (opts.leading && !timer) {
      timer = setTimeout(run, ms);
      fn(...args);
      return;
    }
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  return debounced;
}

/** Cheap guards: jsdom (tests) has no layout, and `ResizeObserver` is missing there. */
export function observeResize(node: Element, callback: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(() => callback());
  observer.observe(node);
  return () => observer.disconnect();
}

export const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const FOCUSABLE =
  'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((n) => !n.closest('[hidden]') && n.style.display !== 'none')
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

export function isTypingTarget(node: Element | null): boolean {
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (node as HTMLElement).isContentEditable === true
  );
}
