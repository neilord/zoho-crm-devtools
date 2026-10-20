import { el, highlightNodes } from '../functions/dom';
import type { HighlightRange } from './types';

export { el, highlightNodes };

export const text = (value: string): Text => document.createTextNode(value);

/** Literal, case-insensitive query highlighting (search is literal text, never regex). */
export function marked(value: string, query: string): Array<Text | HTMLElement> {
  return highlightNodes(value, query.trim());
}

/** Wraps provenance ranges in <mark>; ranges are snippet-relative UTF-16, end-exclusive. */
export function markRanges(
  value: string,
  ranges: readonly HighlightRange[],
): Array<Text | HTMLElement> {
  const nodes: Array<Text | HTMLElement> = [];
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, value.length);
    if (end <= start) continue;
    if (start > cursor) nodes.push(text(value.slice(cursor, start)));
    nodes.push(el('mark', { text: value.slice(start, end) }));
    cursor = end;
  }
  if (cursor < value.length) nodes.push(text(value.slice(cursor)));
  return nodes;
}

export const button = (
  className: string,
  label: string,
  onClick: () => void,
  children: Array<Node | null> = [],
  extra: { title?: string; disabled?: boolean; attrs?: Record<string, string> } = {},
): HTMLButtonElement =>
  el(
    'button',
    {
      className,
      type: 'button',
      title: extra.title,
      disabled: extra.disabled,
      attrs: extra.attrs,
      onClick,
    },
    [...children, label ? text(label) : null],
  );

/**
 * Focus survives list/pane rebuilds only if we put it back: removing the focused node sends
 * focus to <body>, where Esc, "/" and arrow keys never reach the dialog. Controls carry a
 * stable `data-fk` where their text changes; otherwise tag, label and text identify them.
 */
export const focusKey = (node: HTMLElement): string =>
  node.dataset.fk ??
  `${node.tagName}|${node.getAttribute('aria-label') ?? ''}|${node.textContent?.trim() ?? ''}|${node.className}`;

/** The key of the focused control inside `within`, `null` if focus is elsewhere. */
export function captureFocus(root: ShadowRoot, within: Element): string | null {
  const active = root.activeElement as HTMLElement | null;
  return active && active !== within && within.contains(active) ? focusKey(active) : null;
}

export function restoreFocus(within: ParentNode, key: string | null, fallback: HTMLElement): void {
  if (key === null) return;
  const hit = [...within.querySelectorAll<HTMLElement>('button, input, select, [tabindex]')].find(
    (n) => focusKey(n) === key && !(n as HTMLButtonElement).disabled,
  );
  (hit ?? fallback).focus();
}
