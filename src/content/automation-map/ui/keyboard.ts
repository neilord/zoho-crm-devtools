/** Shell-level keyboard map (UX spec §12) as a pure resolver, so it is testable without a DOM. */
import type { MapView } from './context';

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

export interface KeyContext {
  /** Focus is in an input, textarea or select. */
  typing: boolean;
  /** Focus is inside the board or trace canvas, which owns arrows, zoom and depth keys. */
  canvasFocused: boolean;
  searchFocused: boolean;
  view: MapView;
  hasSelection: boolean;
  selectedIsField: boolean;
}

export type KeyAction =
  | { type: 'focus-search' }
  | { type: 'view'; view: 'fields' | 'board' | 'list' }
  | { type: 'trace' }
  | { type: 'writers' }
  | { type: 'help' }
  | { type: 'escape' }
  | { type: 'next-match'; dir: 1 | -1 }
  | { type: 'trace-depth'; which: 'upstream' | 'downstream'; delta: 1 | -1 };

export function resolveKey(e: KeyInput, c: KeyContext): KeyAction | null {
  if (e.isComposing) return null;
  if (e.key === 'Escape') return { type: 'escape' };
  if (e.key === 'Enter' && c.searchFocused && !e.ctrlKey && !e.metaKey && !e.altKey)
    return { type: 'next-match', dir: e.shiftKey ? -1 : 1 };
  if (c.typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  // Match on `key`, not `code`: "?" arrives with Shift held and layouts differ.
  switch (e.key) {
    case '/':
      return { type: 'focus-search' };
    case '?':
      return { type: 'help' };
    case '[':
    case ']':
    case '{':
    case '}':
      if (c.view !== 'trace' || c.canvasFocused) return null;
      return {
        type: 'trace-depth',
        which: e.key === '[' || e.key === ']' ? 'downstream' : 'upstream',
        delta: e.key === ']' || e.key === '}' ? 1 : -1,
      };
  }
  if (e.key.length !== 1 || e.shiftKey) return null;
  switch (e.key.toLowerCase()) {
    case 'f':
      return { type: 'view', view: 'fields' };
    case 'b':
      return { type: 'view', view: 'board' };
    case 'l':
      return { type: 'view', view: 'list' };
    case 't':
      return c.hasSelection ? { type: 'trace' } : null;
    case 'w':
      return c.selectedIsField ? { type: 'writers' } : null;
  }
  return null;
}
