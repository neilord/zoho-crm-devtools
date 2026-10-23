/**
 * Browser-history integration for the Automation Map overlay (UX spec §11).
 *
 * Opening the map pushes exactly one history entry that carries the `#zcdt-map=` hash. While it
 * is open the hash is kept current with `replaceState` (debounced, never a new entry), so the
 * address bar and Copy link always name the view you are looking at. Back leaves our entry and
 * closes the map where the Zoho page stood; Forward comes back through the entry hash. Closing
 * from the UI pops the entry if it is still on top and otherwise just removes the hash.
 *
 * Only `pushState`, `replaceState` and `history.back()` are used, on the page's own path: the
 * map never assigns `location`, never changes the route and never reloads. `history.state` is
 * carried across every write because Zoho's router may keep its own object there.
 */
import { AUTOMATION_MAP_HASH_PREFIX } from '../entry/request';

const HASH_PREFIX = AUTOMATION_MAP_HASH_PREFIX;
const MARKER = '__zcdtMap';
export const HASH_DEBOUNCE_MS = 300;
/** A trailing debounce starves while snapshots stream in; this bounds how stale the URL can get. */
const HASH_MAX_WAIT_MS = 1000;

/** Entry tokens minted by this document; one from an earlier document (a reload) is not ours. */
const tokens = new Set<string>();
let tokenCounter = 0;

interface NavigationLike {
  entries(): ReadonlyArray<{ url: string | null; sameDocument?: boolean }>;
  currentEntry: { index: number } | null;
}

const pageKey = (): string => `${location.pathname}${location.search}`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const markerOf = (state: unknown): string | null =>
  isRecord(state) && typeof state[MARKER] === 'string' ? (state[MARKER] as string) : null;
const withMarker = (state: unknown, token: string): Record<string, unknown> => ({
  ...(isRecord(state) ? state : {}),
  [MARKER]: token,
});
function withoutMarker(state: unknown): unknown {
  if (!isRecord(state) || !(MARKER in state)) return state;
  const { [MARKER]: _dropped, ...rest } = state;
  return Object.keys(rest).length ? rest : null;
}

/**
 * Does the history entry right below the current one show this same page, in this same document,
 * without a map hash? Then a pasted or typed link already sits on top of the right entry and
 * needs no extra one. Needs the Navigation API (Chromium); anywhere else the answer is "unknown".
 */
function belowIsThisPage(): boolean {
  try {
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    const index = nav?.currentEntry?.index;
    if (!nav || typeof index !== 'number' || index < 1) return false;
    const below = nav.entries()[index - 1];
    if (!below?.url || below.sameDocument !== true) return false;
    const url = new URL(below.url);
    return `${url.pathname}${url.search}` === pageKey() && !url.hash.startsWith(HASH_PREFIX);
  } catch {
    return false;
  }
}

export interface MapHistoryOptions {
  /** The hash to write now: already sanitised for the current access level. */
  hash(): string;
  /** A map hash arrived from outside (a hand edit, Back or Forward between map entries). */
  onExternal(hash: string): void;
  /** History left the map's entry (Back): the map must close without touching history. */
  onLeave(): void;
}

export interface MapHistory {
  /** Debounced rewrite of the current entry's hash. */
  schedule(): void;
  /** Write now (Copy link, close). */
  flush(): void;
  /** Close from the UI: pop our entry if it is still on top, else remove the hash. */
  release(): void;
  /** Stop listening and writing; leaves the URL as it is. */
  dispose(): void;
}

export function createMapHistory(options: MapHistoryOptions): MapHistory {
  const path = pageKey();
  const token = `m${++tokenCounter}-${Math.random().toString(36).slice(2, 8)}`;
  let active = true;
  let pushed = false;
  let owned = token;
  let lastSeen = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstQueuedAt = 0;

  const urlFor = (hash: string) => `${location.pathname}${location.search}${hash}`;
  const onSamePage = () => pageKey() === path;
  const ownsTop = () => markerOf(history.state) === owned;

  /* ---- open: exactly one entry for the map ---- */
  const hash = options.hash();
  try {
    const marker = markerOf(history.state);
    const urlHasMap = location.hash.startsWith(HASH_PREFIX);
    if (urlHasMap && marker !== null && tokens.has(marker)) {
      // Forward onto an entry this document created: it is already ours.
      owned = marker;
      pushed = true;
    } else if (urlHasMap && belowIsThisPage()) {
      // A link typed or pasted into this tab sits right above the page: claim it as the entry.
      history.replaceState(withMarker(history.state, token), '', urlFor(hash));
      pushed = true;
    } else {
      if (urlHasMap) {
        // Opened from a link with nothing of this page below it: put the plain page under the
        // map so Back closes the map and stays on the page.
        history.replaceState(withoutMarker(history.state), '', urlFor(''));
      }
      history.pushState(withMarker(history.state, token), '', urlFor(hash));
      pushed = true;
    }
    tokens.add(owned);
    lastSeen = location.hash;
  } catch {
    // Sandboxed frames can forbid history writes; the map still works without a link.
  }

  /* ---- keep the entry's hash current ---- */
  function write(): void {
    if (!active || !onSamePage()) return;
    try {
      const next = options.hash();
      if (location.hash !== next) history.replaceState(history.state, '', urlFor(next));
      lastSeen = location.hash;
    } catch {
      // See above.
    }
  }

  function schedule(): void {
    if (!active) return;
    const now = Date.now();
    if (timer === null) firstQueuedAt = now;
    else clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        write();
      },
      Math.max(0, Math.min(HASH_DEBOUNCE_MS, firstQueuedAt + HASH_MAX_WAIT_MS - now)),
    );
  }

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /* ---- Back, Forward and hand-edited hashes ---- */
  const onNavigate = () => {
    if (!active) return;
    const now = location.hash;
    if (!now.startsWith(HASH_PREFIX)) {
      // Back (or any move) off the map's entry: the page is where it was, so just close.
      options.onLeave();
      return;
    }
    // popstate and hashchange both fire for one navigation; our own writes fire neither.
    if (now === lastSeen) return;
    lastSeen = now;
    options.onExternal(now);
  };
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);

  function dispose(): void {
    active = false;
    cancel();
    window.removeEventListener('popstate', onNavigate);
    window.removeEventListener('hashchange', onNavigate);
  }

  return {
    schedule,
    flush() {
      cancel();
      write();
    },
    release() {
      dispose();
      try {
        if (!location.hash.startsWith(HASH_PREFIX)) return;
        // Pop only an entry that is still ours and on top; anything else (a hand edit above it,
        // a router write that replaced the state) just loses the hash.
        if (pushed && onSamePage() && ownsTop()) history.back();
        else if (onSamePage()) history.replaceState(history.state, '', urlFor(''));
      } catch {
        // See above.
      }
    },
    dispose,
  };
}
