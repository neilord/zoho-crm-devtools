/**
 * Automation Map overlay: a body-level host with a shadow root that owns the shell (header, rail,
 * views, inspector, footer), keyboard map, focus trap, scroll lock and deep-link hash.
 * The canvas (board/trace) is injected through `views`; this module never imports it.
 */
import type { AutomationMapSnapshot, MapFilters, MapNodeId } from '../types';
import type { FieldRef, RegionEnv, ShellActions, UiState } from './actions';
import { banner, cover, filterChips, fogCard, footerStatus, keysSheet } from './chrome';
import type { MapDataPort, MapUiContext, MapView, MapViewState, MountView } from './context';
import { cameraFromHash, type DecodedMapHash, decodeMapHash, encodeMapHash } from './deep-link';
import { cssEscape, el, focusableIn, isTypingTarget, observeResize, text } from './dom';
import { createFieldsView } from './fields-view';
import { createHeader } from './header';
import { createMapHistory, type MapHistory } from './history';
import { createInspector } from './inspector';
import { resolveKey } from './keyboard';
import { DEFAULT_SORT } from './list-model';
import { createListView } from './list-view';
import { coverageView, deriveModel, filtersKey, orderedHits, type ShellModel } from './model';
import overlayCss from './overlay.css?inline';
import { createRail } from './rail';
import tokensCss from './tokens.css?inline';
import {
  createViewStore,
  DEFAULT_TRACE_DEPTH,
  defaultFilters,
  defaultViewState,
  FIELD_TRACE_DEPTH,
} from './view-store';

export interface MountAutomationMapOptions {
  port: MapDataPort;
  views: { board: MountView; trace: MountView; styles: string };
  initialState?: Partial<MapViewState>;
  initialHash?: string;
  onClose?: () => void;
  /** Element the overlay host is appended to; defaults to `document.body`. */
  host?: HTMLElement;
}

export const HOST_ID = 'zcdt-automation-map-overlay';
const SNAPSHOT_THROTTLE_MS = 150;
/** Store keys whose change never needs a panel re-render (the canvas owns them). */
const CANVAS_KEYS: ReadonlySet<keyof MapViewState> = new Set(['camera', 'hoverId']);

/**
 * Why the map is closing. `ui` leaves browser history (pops our entry); `history` means Back
 * already did; `replaced` hands our entry to the next mount.
 */
type CloseReason = 'ui' | 'history' | 'replaced';

let current: { close(reason?: CloseReason): void } | null = null;

export function mountAutomationMap(options: MountAutomationMapOptions): { close(): void } {
  current?.close('replaced');
  const { port, views } = options;
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  /* ---- initial state: deep link first, explicit options win ---- */
  const hashed = safeDecode(options.initialHash ?? location.hash);
  const store = createViewStore({ ...(hashed?.state ?? {}), ...(options.initialState ?? {}) });
  let pendingCamera = hashed?.camera && !options.initialState?.camera ? hashed.camera : null;
  // Keys that came only from the URL: a shared link is untrusted input, explicit options are not.
  const explicitKeys = new Set(Object.keys(options.initialState ?? {}));
  const hashOnlyKeys = Object.keys(hashed?.state ?? {}).filter(
    (k) => !explicitKeys.has(k),
  ) as Array<keyof MapViewState>;

  const ui: UiState = {
    railOpen: false,
    coverageOpen: false,
    keysOpen: false,
    fogCardOpen: !isNarrow(),
    bannerDismissed: false,
    lensTrail: [],
    expandedPaths: new Set(),
    expandedGroups: new Set(),
    expandedCode: new Set(),
    evidence: null,
    matchIndex: -1,
    list: { sort: DEFAULT_SORT, expanded: new Set(), collapsed: new Set() },
  };
  const initialField = store.get().field;
  if (initialField) ui.lensTrail = [initialField];

  /* ---- DOM scaffold ---- */
  const hostEl = document.createElement('div');
  hostEl.id = HOST_ID;
  const shadow = hostEl.attachShadow({ mode: 'open' });
  for (const css of [tokensCss, overlayCss, views.styles]) {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }

  let closed = false;
  let snapshot: AutomationMapSnapshot = port.snapshot();
  let model: ShellModel = deriveModel(port, snapshot, store.get());
  let lastAccessKey = '';
  const mounted: { board: (() => void) | null; trace: (() => void) | null } = {
    board: null,
    trace: null,
  };

  // Filled in below; regions keep the reference, so it must exist before they are created.
  const actions = {} as ShellActions;
  const env: RegionEnv = {
    root: shadow,
    port,
    ui,
    actions,
    fallback: () => header.search,
  };

  const header = createHeader(env);
  const rail = createRail(env);
  const fields = createFieldsView(env);
  const list = createListView(env);
  const inspector = createInspector(env);

  const stateBar = el('div', { className: 'am-state' });
  // Forty-odd filter controls stand between the header and the map: one stop to jump past them.
  const skip = el('button', {
    className: 'am-skip',
    type: 'button',
    text: 'Skip to the map',
    attrs: { 'data-fk': 'skip-map' },
    onClick: () => (focusTargetFor(store.get().view) ?? panel).focus({ preventScroll: true }),
  });
  const drawerScrim = el('div', { className: 'am-drawer-scrim' });
  const boardHost = el('div', { className: 'am-view am-canvas-host', attrs: { id: 'am-board' } });
  const traceHost = el('div', { className: 'am-view am-canvas-host', attrs: { id: 'am-trace' } });
  const bannerHost = el('div', { className: 'am-banner-host' });
  const coverHost = el('div', { className: 'am-cover' });
  const fogHost = el('div', { className: 'am-fog-host' });
  const main = el('main', { className: 'am-main', attrs: { id: 'am-main' } }, [
    fields.el,
    list.el,
    boardHost,
    traceHost,
    bannerHost,
    inspector.el,
    coverHost,
    fogHost,
  ]);
  const footStatus = el('span', { className: 'footstatus' });
  const footer = el('footer', { className: 'am-foot' }, [
    el('span', { className: 'hints' }, [
      hint(['/'], 'Search'),
      hint(['F', 'B', 'L'], 'Views', 'opt-h'),
      hint(['T'], 'Trace', 'opt-h'),
      hint(['Esc'], 'Back'),
      hint(['?'], 'Shortcuts', 'opt-h'),
    ]),
    el('span', { className: 'sp' }),
    footStatus,
  ]);
  const toastHost = el('div', { className: 'toast-host' });
  const live = el('div', {
    className: 'sr-only',
    attrs: { 'aria-live': 'polite', role: 'status' },
  });
  const panel = el(
    'div',
    {
      className: 'am-panel',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'am-title',
        tabindex: '-1',
      },
    },
    [
      header.el,
      stateBar,
      el('div', { className: 'am-body' }, [skip, rail.el, drawerScrim, main]),
      footer,
      toastHost,
      live,
    ],
  );
  const overlay = el('div', { className: 'am-overlay', attrs: { role: 'presentation' } }, [panel]);
  const rootEl = el('div', { className: 'am-root' }, [overlay]);
  shadow.appendChild(rootEl);

  /* ---- helpers ---- */
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const toast = (message: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    toastHost.replaceChildren(el('div', { className: 'toast', text: message }));
    live.textContent = message;
    toastTimer = setTimeout(() => toastHost.replaceChildren(), 2600);
  };

  const viewport = () => ({ width: main.clientWidth || 0, height: main.clientHeight || 0 });
  /**
   * The hash for the current state, as it may be written to the address bar. Every write goes
   * through here: the preview carries only the view and a revealed node, and until the plan is
   * known nothing but the view is written, so a link never names state the preview must withhold.
   */
  const hashNow = (): string => {
    sanitizePreviewState();
    const access = snapshot.access.level;
    const state = store.get();
    return encodeMapHash(
      access === 'checking' ? { ...state, selectedId: null, traceRootId: null } : state,
      { viewport: viewport(), teaser: access !== 'full' },
    );
  };
  let mapHistory: MapHistory | null = null;
  const scheduleHash = () => mapHistory?.schedule();

  const setView = (view: MapView) => {
    const s = store.get();
    if (s.view === view) return;
    store.set({ view, ...(view !== 'trace' && s.traceRootId ? { traceRootId: null } : {}) });
  };

  /* ---- actions ---- */
  const implementation: ShellActions = {
    setView,
    select(id, opts) {
      ui.evidence = opts?.evidence ?? null;
      if (id === null) {
        store.set({ selectedId: null, inspectorOpen: false, hoverId: null });
        return;
      }
      store.set({
        selectedId: id,
        inspectorOpen: true,
        ...(opts?.view ? { view: opts.view } : {}),
      });
      // Same node, new evidence: the store sees no change, so refresh the inspector ourselves.
      renderSelection();
    },
    openResult(id) {
      const node = model.graph.nodes.get(id);
      if (!node) return;
      if (node.kind === 'field' && node.bucket === 'field' && node.moduleApiName) {
        actions.openField({ moduleApiName: node.moduleApiName, fieldApiName: node.fieldApiName });
        return;
      }
      const view = store.get().view;
      actions.select(id, {
        view:
          view === 'list'
            ? 'list'
            : view === 'trace'
              ? 'board'
              : view === 'fields'
                ? 'board'
                : view,
      });
    },
    openField(ref: FieldRef, o) {
      const s = store.get();
      if (!o?.pivot) ui.lensTrail = [ref];
      else {
        const trail = ui.lensTrail.length ? [...ui.lensTrail] : s.field ? [s.field] : [];
        const at = trail.findIndex(
          (r) => r.moduleApiName === ref.moduleApiName && r.fieldApiName === ref.fieldApiName,
        );
        ui.lensTrail = at >= 0 ? trail.slice(0, at + 1) : [...trail, ref];
      }
      // A different field's lens must not keep the previous selection's details open: they
      // cover the reactors column and describe something that is no longer on screen.
      const sameNode = s.selectedId === `field:${ref.moduleApiName}.${ref.fieldApiName}`;
      store.set({
        view: 'fields',
        field: ref,
        traceRootId: null,
        ...(sameNode ? {} : { selectedId: null, inspectorOpen: false, hoverId: null }),
      });
      if (!sameNode) ui.evidence = null;
      renderAll();
    },
    closeField() {
      ui.lensTrail = [];
      store.set({ field: null });
      renderAll();
    },
    trace(id) {
      const node = model.graph.nodes.get(id);
      const depth = node?.kind === 'field' ? FIELD_TRACE_DEPTH : DEFAULT_TRACE_DEPTH;
      store.set({
        view: 'trace',
        traceRootId: id,
        traceDepth: { ...depth },
        selectedId: id,
      });
    },
    showOnBoard(id) {
      const node = model.graph.nodes.get(id);
      store.set({
        view: 'board',
        traceRootId: null,
        selectedId: id,
        inspectorOpen: true,
        focusModuleApiName: node?.moduleApiName ?? null,
      });
    },
    showInList(id) {
      store.set({ view: 'list', traceRootId: null, selectedId: id, inspectorOpen: true });
      list.syncSelection(id, true);
    },
    flyToModule(apiName) {
      const s = store.get();
      if (s.focusModuleApiName === apiName) store.set({ focusModuleApiName: null });
      store.set({ view: 'board', traceRootId: null, focusModuleApiName: apiName });
      ui.railOpen = false;
      renderAll();
    },
    setFilters(patch) {
      store.set({ filters: { ...store.get().filters, ...patch } as MapFilters });
    },
    clearFilters() {
      store.set({ filters: { ...defaultFilters(), scope: store.get().filters.scope } });
    },
    setQuery(query) {
      ui.matchIndex = -1;
      store.set({ query });
      header.syncQuery(query, true);
    },
    copyLink() {
      mapHistory?.flush();
      const hash = hashNow();
      const href = `${location.origin}${location.pathname}${location.search}${hash}`;
      const done = () => toast('Link copied');
      try {
        navigator.clipboard
          .writeText(href)
          .then(done, () => toast('Could not copy. The link is in the address bar.'));
      } catch {
        toast('Could not copy. The link is in the address bar.');
      }
    },
    toast,
    upgrade: () => port.requestUpgrade(),
    retry(id) {
      port.retry(id).catch(() => toast('Retry did not complete.'));
    },
    openRule(ruleId) {
      try {
        port.openRuleInZoho(ruleId);
      } catch (error) {
        console.error('Zoho CRM DevTools: failed to open the rule', error);
        toast('This rule cannot be opened from here.');
      }
    },
    openFunction(delugeId) {
      try {
        port.openFunctionInZoho(delugeId);
      } catch (error) {
        console.error('Zoho CRM DevTools: failed to open the function', error);
        toast('This function cannot be opened from here.');
      }
    },
    setCoverageOpen(open) {
      ui.coverageOpen = open;
      header.update(model);
    },
    refreshMap() {
      port.refresh().catch(() => toast('Refresh did not complete.'));
    },
    toggleKeys(open) {
      const want = open ?? !ui.keysOpen;
      if (want === ui.keysOpen) return;
      ui.keysOpen = want;
      panel.querySelector('.am-keys')?.remove();
      if (want) {
        panel.append(keysSheet(env));
        panel.querySelector<HTMLElement>('.am-keys [data-fk="keys-close"]')?.focus();
      } else header.help.focus();
    },
    focusSearch: () => header.focusSearch(),
    refresh: () => renderAll(),
    starter(id) {
      if (id === 'deals-edit') {
        store.set({
          view: 'board',
          traceRootId: null,
          focusModuleApiName: 'Deals',
          filters: {
            ...defaultFilters(),
            scope: store.get().filters.scope,
            modules: new Set(['Deals']),
            triggerTypes: new Set(['edit', 'create_or_edit', 'field_update']),
          },
        });
      } else if (id === 'external') {
        store.set({
          view: 'list',
          filters: {
            ...defaultFilters(),
            scope: store.get().filters.scope,
            flags: new Set(['callsExternal']),
          },
        });
      } else if (id === 'loops') {
        store.set({
          view: 'list',
          filters: {
            ...defaultFilters(),
            scope: store.get().filters.scope,
            flags: new Set(['cascades']),
          },
        });
      } else store.set({ view: 'board', traceRootId: null, focusModuleApiName: null });
    },
  };
  Object.assign(actions, implementation);

  /* ---- canvas views ---- */
  const context: MapUiContext = { port, view: store, root: shadow };
  const mountCanvas = (kind: 'board' | 'trace') => {
    const container = kind === 'board' ? boardHost : traceHost;
    container.replaceChildren();
    try {
      mounted[kind] = views[kind](container, context);
    } catch (error) {
      console.error(`Zoho CRM DevTools: Automation Map ${kind} failed to mount`, error);
      mounted[kind] = () => {};
      container.replaceChildren(
        el('div', { className: 'am-empty' }, [
          el('div', {}, [
            el('h3', { text: 'This view could not load' }),
            el('p', { text: 'Switch to the List or Fields view, or reopen the map.' }),
          ]),
        ]),
      );
    }
  };
  const unmountCanvas = (kind: 'board' | 'trace') => {
    const dispose = mounted[kind];
    mounted[kind] = null;
    try {
      dispose?.();
    } catch (error) {
      console.error(`Zoho CRM DevTools: Automation Map ${kind} failed to dispose`, error);
    }
    (kind === 'board' ? boardHost : traceHost).replaceChildren();
  };
  const syncCanvas = (m: ShellModel) => {
    const want = m.state.view === 'board' || m.state.view === 'trace' ? m.state.view : null;
    for (const kind of ['board', 'trace'] as const) {
      if (kind === want && !mounted[kind] && m.access !== 'checking') mountCanvas(kind);
      else if ((kind !== want || m.access === 'checking') && mounted[kind]) unmountCanvas(kind);
    }
  };

  /* ---- rendering ---- */
  const accessKey = (s: AutomationMapSnapshot) =>
    s.access.level === 'teaser' ? `teaser:${s.access.revealedModuleApiName ?? ''}` : s.access.level;

  /**
   * Chrome that floats over the canvas tells it how much room it takes: the gap banner as
   * `--am-safe-top` (the inspector already publishes `--am-insp-w`). Canvases listen for
   * `am:insets` to re-frame an automatic fit.
   */
  let lastInsetTop = -1;
  // The banner re-wraps when the window or the inspector changes its width: the inset follows.
  let stopBannerWatch = () => {};
  function watchBanner(node: Element | null) {
    stopBannerWatch();
    stopBannerWatch = node ? observeResize(node, publishInsets) : () => {};
  }
  function publishInsets() {
    const bannerEl = bannerHost.firstElementChild as HTMLElement | null;
    let top = 0;
    if (bannerEl) {
      const box = bannerEl.getBoundingClientRect();
      const base = main.getBoundingClientRect();
      top = box.height > 0 ? Math.ceil(box.bottom - base.top + 10) : 0;
    }
    if (top === lastInsetTop) return;
    lastInsetTop = top;
    main.style.setProperty('--am-safe-top', `${top}px`);
    for (const host of [boardHost, traceHost]) host.dispatchEvent(new CustomEvent('am:insets'));
  }

  /** Where keyboard shortcuts should land for a view: its canvas, grid or the view itself. */
  const focusTargetFor = (view: MapView): HTMLElement | null => {
    const host =
      view === 'board'
        ? boardHost
        : view === 'trace'
          ? traceHost
          : view === 'list'
            ? list.el
            : fields.el;
    return (
      host.querySelector<HTMLElement>('[data-focus-target]') ??
      host.querySelector<HTMLElement>('[tabindex="0"]') ??
      (host.hasAttribute('tabindex') ? host : null)
    );
  };

  /**
   * Nothing useful holds focus: no element, the dialog itself (the fallback it is given on open),
   * or one that is gone, hidden or inert.
   */
  const focusLost = () => {
    const active = shadow.activeElement as HTMLElement | null;
    return (
      !active || active === panel || !active.isConnected || !!active.closest('[hidden], [inert]')
    );
  };

  /**
   * Replacing a canvas (or hiding a view) drops focus to the page, which kills every shortcut
   * and Esc. After a structural change, put focus on the new view, but never take it from a
   * control that still has it (the search box keeps it while Enter steps through matches).
   */
  let focusShape = '';
  function keepFocus(view: MapView) {
    const shape = `${view}|${mounted.board ? 'b' : ''}${mounted.trace ? 't' : ''}`;
    const changed = shape !== focusShape;
    focusShape = shape;
    if (!changed || closed || !focusLost()) return;
    (focusTargetFor(view) ?? panel).focus({ preventScroll: true });
  }

  const resetViews = () => {
    fields.reset();
    list.reset();
    rail.reset();
    inspector.reset();
    unmountCanvas('board');
    unmountCanvas('trace');
    ui.lensTrail = [];
    ui.expandedPaths.clear();
    ui.expandedGroups.clear();
    ui.expandedCode.clear();
    ui.evidence = null;
    ui.list.expanded.clear();
    ui.list.collapsed.clear();
    ui.coverageOpen = false;
    ui.fogCardOpen = !isNarrow();
    ui.matchIndex = -1;
    fogHost.replaceChildren();
    bannerHost.replaceChildren();
    coverHost.replaceChildren();
  };

  /**
   * A preview carries only the view and a revealed node (UX spec §11). Anything else could name
   * fogged data or hide the results: either state left over from a full-access session, or a key
   * from a shared link. Entry defaults may keep safe view preferences, but every identity is
   * validated against the current revealed graph, regardless of where it came from.
   */
  function restrictToPreview(origin: 'link' | 'session') {
    const s = store.get();
    const defaults = defaultViewState();
    const revealed = s.selectedId !== null && snapshot.graph.nodes.has(s.selectedId);
    const view = s.view === 'trace' ? 'board' : s.view;
    if (origin === 'session') {
      store.set({
        ...defaults,
        selectedId: revealed ? s.selectedId : null,
        inspectorOpen: revealed && s.inspectorOpen,
        view,
      });
      pendingCamera = null;
    } else {
      const patch: Record<string, unknown> = {};
      for (const key of hashOnlyKeys) {
        if (key === 'view') patch.view = view;
        else if (key === 'selectedId' || key === 'inspectorOpen') {
          if (!revealed) {
            patch.selectedId = null;
            patch.inspectorOpen = false;
          }
        } else patch[key] = defaults[key];
      }
      if (hashOnlyKeys.includes('camera') || !options.initialState?.camera) pendingCamera = null;
      store.set(patch as Partial<MapViewState>);
    }
    header.syncQuery(store.get().query, true);
  }

  /** Entry options, retained controls and later snapshots share the same teaser boundary. */
  function sanitizePreviewState(): boolean {
    if (snapshot.access.level !== 'teaser') return false;
    const state = store.get();
    const nodes = snapshot.graph.nodes;
    const patch: Partial<MapViewState> = {};
    if (state.selectedId && !nodes.has(state.selectedId)) patch.selectedId = null;
    if ((!state.selectedId || patch.selectedId === null) && state.inspectorOpen)
      patch.inspectorOpen = false;
    if (state.hoverId && !nodes.has(state.hoverId)) patch.hoverId = null;
    if (state.traceRootId && !nodes.has(state.traceRootId)) {
      patch.traceRootId = null;
      if (state.view === 'trace') patch.view = 'board';
    }
    if (
      state.focusModuleApiName &&
      nodes.get(`module:${state.focusModuleApiName}`)?.kind !== 'module'
    )
      patch.focusModuleApiName = null;
    if (
      state.field &&
      nodes.get(`field:${state.field.moduleApiName}.${state.field.fieldApiName}`)?.kind !== 'field'
    ) {
      patch.field = null;
      ui.lensTrail = [];
    }
    if (!Object.keys(patch).length) return false;
    store.set(patch);
    return true;
  }

  /** One panel failing to render must not blank the rest of the map. */
  function guard(name: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error(`Zoho CRM DevTools: Automation Map ${name} failed to render`, error);
    }
  }

  let renderingDepth = 0;
  function renderAll(): void {
    if (closed || renderingDepth > 2) return;
    renderingDepth++;
    try {
      const key = accessKey(snapshot);
      const previousKey = lastAccessKey;
      // Set first: restricting the state below re-enters this function through the store.
      lastAccessKey = key;
      if (key !== previousKey) {
        const first = previousKey === '' || previousKey === 'checking';
        if (previousKey) resetViews();
        if (key.startsWith('teaser')) restrictToPreview(first ? 'link' : 'session');
        // What may be written depends on the plan: rewrite the hash for the new access level.
        scheduleHash();
      }
      sanitizePreviewState();
      model = deriveModel(port, snapshot, store.get());
      // "Show on map" for an inactive rule would otherwise land on a board that never shows it.
      if (widenScopeForLanding(model)) model = deriveModel(port, snapshot, store.get());
      // Details of a node that is gone or filtered out must not stay open.
      if (dropStaleSelection(model)) model = deriveModel(port, snapshot, store.get());
      const m = model;
      const view = m.state.view;

      guard('header', () => header.update(m));
      guard('search counter', () => syncCounter(m));
      guard('filter chips', () => renderStateBar(m));
      guard('rail', () => rail.update(m));
      fields.el.hidden = view !== 'fields';
      list.el.hidden = view !== 'list';
      boardHost.hidden = view !== 'board';
      traceHost.hidden = view !== 'trace';
      if (view === 'fields') guard('fields view', () => fields.update(m));
      if (view === 'list') guard('list view', () => list.update(m));
      guard('inspector', () => inspector.update(m));
      // Chrome first: the canvas frames itself around the banner, so the banner has to exist
      // (and publish its height) before the board mounts and fits.
      guard('chrome', () => {
        const coverNode = cover(env, m);
        coverHost.replaceChildren(...(coverNode ? [coverNode] : []));
        coverHost.hidden = !coverNode;
        for (const v of [fields.el, list.el, boardHost, traceHost]) {
          if (coverNode) v.setAttribute('inert', '');
          else v.removeAttribute('inert');
        }
        const bannerNode = view === 'board' ? banner(env, m) : null;
        bannerHost.replaceChildren(...(bannerNode ? [bannerNode] : []));
        watchBanner(bannerNode);
        const fog = fogCard(env, m);
        fogHost.replaceChildren(...(fog ? [fog] : []));
        footStatus.textContent = footerStatus(m);
        publishInsets();
      });
      guard('canvas', () => syncCanvas(m));
      guard('focus', () => keepFocus(view));
      announceProgress(m);

      main.dataset.inspector = inspector.el.classList.contains('open') ? 'open' : 'closed';
      main.dataset.access = m.access;
      rootEl.dataset.teaser = String(m.teaser);
      resolvePendingCamera();
      applySelection();
    } finally {
      renderingDepth--;
    }
  }

  /**
   * The node the map was opened on (Show on map, a link's `sel`). The default scope hides inactive
   * rules, so once the graph has the node and it is outside the active scope, the scope widens
   * once: otherwise the board would never show it. Dropped when the selection moves on or
   * loading ends without the node.
   */
  let landing: MapNodeId | null =
    options.initialState?.selectedId ?? hashed?.state.selectedId ?? null;
  function widenScopeForLanding(m: ShellModel): boolean {
    if (landing === null || m.access !== 'full') return false;
    if (m.state.selectedId !== landing) {
      landing = null;
      return false;
    }
    const node = m.graph.nodes.get(landing);
    if (!node) {
      const phase = m.snapshot.phase;
      if (phase !== 'loading' && phase !== 'enriching' && phase !== 'idle') landing = null;
      return false;
    }
    landing = null;
    if (node.inActiveScope || m.state.filters.scope !== 'active') return false;
    live.textContent = 'Showing everything: this item is not active.';
    store.set({ filters: { ...m.state.filters, scope: 'everything' } });
    return true;
  }

  /**
   * The inspector follows the selection and closes with it. A node that was on the map and has
   * been removed (a refresh) closes it once loading has settled; a filter, scope or search
   * change that hides the selected node closes it too. Links to nodes that never existed keep
   * the "Not in the map" message, and nothing is dropped while the graph is still loading.
   */
  let seenSelection: MapNodeId | null = null;
  let selectionFilterSig: string | null = null;
  function dropStaleSelection(m: ShellModel): boolean {
    const id = m.state.selectedId;
    const sig = `${filtersKey(m.filters)}|${m.state.query.trim()}|${m.state.view}`;
    const filtersChanged = selectionFilterSig !== null && sig !== selectionFilterSig;
    selectionFilterSig = sig;
    if (!id || m.access !== 'full') {
      seenSelection = null;
      return false;
    }
    let gone = false;
    if (m.graph.nodes.has(id)) {
      seenSelection = id;
      const view = m.state.view;
      gone =
        filtersChanged &&
        (view === 'board' || view === 'list') &&
        (!m.visible.has(id) || (view === 'list' && m.hitIds !== null && !m.hitIds.has(id)));
    } else {
      const phase = m.snapshot.phase;
      gone =
        seenSelection === id && phase !== 'loading' && phase !== 'enriching' && phase !== 'idle';
    }
    if (!gone) return false;
    seenSelection = null;
    ui.evidence = null;
    live.textContent = 'Details closed: the selected item is no longer shown.';
    store.set({ selectedId: null, inspectorOpen: false, hoverId: null });
    return true;
  }

  /**
   * Live-region milestones (25/50/75% while mapping) and one "ready" announcement per settle.
   * Settled means the pass finished (`complete`, not refreshing, gap count not provisional): the
   * cached snapshot a reopen starts from, and every progressive tick after it, carry a gap count
   * that later passes overtake (live: "ready with 248 gaps" while the chip read 271), so those
   * are never read out. The number is the settled snapshot's own `coverage.gaps`, the one the
   * chip shows; a later settle announces again only when that number changed.
   */
  let milestone = 0;
  let announcedGaps: number | null = null;
  function announceProgress(m: ShellModel) {
    if (m.access !== 'full') return;
    const snapshot = m.snapshot;
    const cov = coverageView(snapshot);
    if (cov.status === 'loading') {
      const reached = Math.floor(cov.percent / 25) * 25;
      if (reached > milestone && reached < 100) {
        milestone = reached;
        live.textContent = `Mapping ${reached}%`;
      }
      return;
    }
    const settled =
      (cov.status === 'mapped' || cov.status === 'gaps') &&
      snapshot.phase === 'complete' &&
      !snapshot.coverage.refreshing &&
      !snapshot.coverage.gapsProvisional;
    if (!settled || announcedGaps === cov.gaps) return;
    const first = announcedGaps === null;
    announcedGaps = cov.gaps;
    milestone = 100;
    live.textContent = first
      ? cov.gaps
        ? `Map ready with ${cov.gaps} gap${cov.gaps === 1 ? '' : 's'}`
        : 'Map ready'
      : cov.gaps
        ? `Map updated, ${cov.gaps} gap${cov.gaps === 1 ? '' : 's'}`
        : 'Map updated, no gaps';
  }

  function renderStateBar(m: ShellModel) {
    const chips = m.teaser || m.access !== 'full' ? [] : filterChips(env, m);
    const sig = chips.map((c) => c.textContent).join('|');
    stateBar.classList.toggle('on', chips.length > 0);
    if (stateBar.dataset.sig === sig) return;
    stateBar.dataset.sig = sig;
    stateBar.replaceChildren(
      ...(chips.length
        ? [
            el('span', { className: 'lab', text: 'Filters' }),
            ...chips,
            el('button', {
              className: 'wf-btn link',
              type: 'button',
              text: 'Clear all',
              attrs: { 'data-fk': 'clear-all' },
              onClick: () => actions.clearFilters(),
            }),
          ]
        : []),
    );
  }

  function syncCounter(m: ShellModel) {
    const n = m.hits?.length ?? 0;
    if (!m.hits) header.setCounter('');
    else if (ui.matchIndex >= 0 && n) header.setCounter(`${ui.matchIndex + 1} / ${n}`);
    else header.setCounter(m.teaser ? `${n} in preview` : `${n} match${n === 1 ? '' : 'es'}`);
    header.syncQuery(m.state.query);
  }

  /** Cheap updates that follow selection alone. */
  function renderSelection() {
    if (closed || sanitizePreviewState()) return;
    model = deriveModel(port, snapshot, store.get());
    inspector.update(model);
    main.dataset.inspector = inspector.el.classList.contains('open') ? 'open' : 'closed';
    applySelection();
  }

  function applySelection() {
    const id = store.get().selectedId;
    rail.syncSelection(id);
    if (store.get().view === 'list') list.syncSelection(id, false);
    for (const card of fields.el.querySelectorAll<HTMLElement>('[data-sel]')) {
      const on = card.dataset.sel === id;
      card.classList.toggle('sel', on);
      if (on) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
    fields.redraw();
  }

  function resolvePendingCamera() {
    if (!pendingCamera) return;
    const size = viewport();
    // Wait for a measured area (the board needs it to turn a centre point into a corner).
    if (!size.width && typeof ResizeObserver !== 'undefined') return;
    const camera = cameraFromHash(pendingCamera, size);
    pendingCamera = null;
    store.set({ camera });
  }

  /* ---- store + port subscriptions ---- */
  const unsubscribeStore = store.subscribe((next, prev) => {
    if (closed || sanitizePreviewState()) return;
    const changed = (Object.keys(next) as Array<keyof MapViewState>).filter(
      (k) => next[k] !== prev[k],
    );
    scheduleHash();
    const relevant = changed.filter((k) => !CANVAS_KEYS.has(k));
    if (relevant.length === 0) return;
    if (relevant.every((k) => k === 'selectedId' || k === 'inspectorOpen')) {
      renderSelection();
      return;
    }
    if (relevant.every((k) => k === 'traceDepth')) return;
    renderAll();
  });

  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribePort = port.subscribe((next) => {
    if (closed) return;
    const accessChanged = accessKey(next) !== accessKey(snapshot);
    snapshot = next;
    if (accessChanged) {
      if (snapshotTimer) clearTimeout(snapshotTimer);
      snapshotTimer = null;
      renderAll();
      return;
    }
    if (snapshotTimer) return;
    // Progressive snapshots arrive about twice a second; coalesce so typing stays smooth.
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      renderAll();
    }, SNAPSHOT_THROTTLE_MS);
  });

  /* ---- keyboard, focus, dismissal ---- */
  const escapeLadder = () => {
    if (ui.keysOpen) return actions.toggleKeys(false);
    if (ui.coverageOpen) {
      ui.coverageOpen = false;
      header.update(model);
      (indexPill() as HTMLElement | null)?.focus();
      return;
    }
    if (ui.railOpen) return setRail(false);
    const s = store.get();
    if (header.search.value || s.query) {
      actions.setQuery('');
      return;
    }
    if (s.view === 'trace') {
      store.set({ view: 'board', traceRootId: null });
      return;
    }
    if (s.selectedId !== null || s.inspectorOpen) return actions.select(null);
    if (s.view === 'fields' && s.field) return actions.closeField();
    close();
  };
  const indexPill = () => header.el.querySelector('.wf-index .wf-pill');

  const setRail = (open: boolean) => {
    ui.railOpen = open;
    rail.el.classList.toggle('open', open);
    drawerScrim.classList.toggle('open', open);
    header.filtersButton.setAttribute('aria-expanded', String(open));
  };
  header.filtersButton.addEventListener('click', () => setRail(!ui.railOpen));
  drawerScrim.addEventListener('click', () => setRail(false));
  header.closeButton.addEventListener('click', () => close());

  const stepMatch = (dir: 1 | -1) => {
    // `field:Deals.Stage` opens the lens directly (UX spec §9.1).
    if (model.parsed.field) {
      actions.openField(model.parsed.field);
      return;
    }
    const hits = orderedHits(model.graph, model.hits ?? []);
    if (!hits.length) return;
    ui.matchIndex = (ui.matchIndex + dir + hits.length) % hits.length;
    if (ui.matchIndex < 0) ui.matchIndex = 0;
    const id = hits[ui.matchIndex].nodeId;
    syncCounter(model);
    const ritem = rail.el.querySelector<HTMLElement>(`.ritem[data-id="${cssEscape(id)}"]`);
    ritem?.scrollIntoView?.({ block: 'nearest' });
    revealMatch(id);
  };

  /**
   * Enter steps through matches in the view you are in (UX review): selecting a field result
   * must not throw you into the Fields lens. The lens still opens for `field:` queries, rail
   * results and while you are already in the lens.
   */
  const revealMatch = (id: MapNodeId) => {
    const node = model.graph.nodes.get(id);
    if (!node) return;
    const view = store.get().view;
    if (view === 'fields') {
      actions.openResult(id);
      return;
    }
    actions.select(id, { view: view === 'trace' ? 'board' : view });
  };

  hostEl.addEventListener('keyup', (e) => e.stopPropagation());
  hostEl.addEventListener('keypress', (e) => e.stopPropagation());
  hostEl.addEventListener('keydown', (event: KeyboardEvent) => {
    // Zoho's own shortcuts key off document.activeElement, which is this host.
    event.stopPropagation();
    if (event.defaultPrevented) return;
    if (event.key === 'Tab') {
      trapFocus(event);
      return;
    }
    const active = shadow.activeElement as HTMLElement | null;
    const s = store.get();
    const selected = s.selectedId ? model.graph.nodes.get(s.selectedId) : undefined;
    const action = resolveKey(event, {
      typing: isTypingTarget(active),
      canvasFocused: !!active && (boardHost.contains(active) || traceHost.contains(active)),
      searchFocused: active === header.search,
      view: s.view,
      hasSelection: !!selected,
      selectedIsField: selected?.kind === 'field' && selected.bucket === 'field',
    });
    if (!action) return;
    event.preventDefault();
    switch (action.type) {
      case 'escape':
        escapeLadder();
        break;
      case 'focus-search':
        header.focusSearch();
        break;
      case 'view':
        setView(action.view);
        break;
      case 'trace':
        if (s.selectedId) actions.trace(s.selectedId);
        break;
      case 'writers':
        if (selected?.kind === 'field' && selected.moduleApiName)
          actions.openField({
            moduleApiName: selected.moduleApiName,
            fieldApiName: selected.fieldApiName,
          });
        break;
      case 'help':
        actions.toggleKeys();
        break;
      case 'next-match':
        stepMatch(action.dir);
        break;
      case 'trace-depth': {
        const depth = { ...s.traceDepth };
        depth[action.which] += action.delta;
        store.set({ traceDepth: depth });
        break;
      }
    }
  });

  function trapFocus(event: KeyboardEvent) {
    const items = focusableIn(panel);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = shadow.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || active === panel || !active)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !active)) {
      event.preventDefault();
      first.focus();
    }
  }

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) {
      close();
      return;
    }
    if (
      ui.coverageOpen &&
      !event.composedPath().includes(header.el.querySelector('.wf-index') as EventTarget)
    ) {
      ui.coverageOpen = false;
      header.update(model);
    }
  });

  /**
   * A map hash arrived from outside while the map is open: a hand edit, or Back/Forward between
   * map entries. The hash describes the whole view, so what it leaves out resets to its default.
   * The same teaser boundary applies as for a link opened cold; malformed hashes change nothing.
   */
  function applyExternalHash(raw: string): void {
    const decoded = safeDecode(raw);
    const level = snapshot.access.level;
    // Until the plan is known nothing can be validated; the next write puts our state back.
    if (!decoded || level === 'checking') {
      scheduleHash();
      return;
    }
    const defaults = defaultViewState();
    let patch: Partial<MapViewState>;
    if (level === 'teaser') {
      const sel = decoded.state.selectedId ?? null;
      const revealed = sel !== null && snapshot.graph.nodes.has(sel);
      const view = decoded.state.view ?? defaults.view;
      patch = {
        view: view === 'trace' ? 'board' : view,
        selectedId: revealed ? sel : null,
        inspectorOpen: revealed,
      };
      pendingCamera = null;
    } else {
      patch = {
        view: defaults.view,
        field: null,
        selectedId: null,
        inspectorOpen: false,
        traceRootId: null,
        traceDepth: { ...defaults.traceDepth },
        focusModuleApiName: null,
        query: '',
        filters: defaultFilters(),
        ...decoded.state,
      };
      pendingCamera = decoded.camera;
    }
    ui.evidence = null;
    ui.matchIndex = -1;
    ui.lensTrail = patch.field ? [patch.field] : [];
    store.set(patch);
    header.syncQuery(store.get().query, true);
    resolvePendingCamera();
    scheduleHash();
  }

  /* ---- scroll lock, mount, focus ---- */
  const scrollTargets = [document.documentElement, document.body];
  const previousOverflow = scrollTargets.map((n) => n.style.overflow);
  for (const n of scrollTargets) n.style.overflow = 'hidden';

  (options.host ?? document.body).appendChild(hostEl);
  renderAll();
  mapHistory = createMapHistory({
    hash: hashNow,
    onExternal: applyExternalHash,
    onLeave: () => close('history'),
  });
  // Focus the dialog itself (as the prototype does): letter shortcuts work straight away and
  // `/` moves into the search box. Focusing an input would swallow F, B and L.
  panel.focus();

  function close(reason: CloseReason = 'ui') {
    if (closed) return;
    closed = true;
    // Back already left our entry, and a replacing mount adopts it: only the UI pops it.
    if (reason === 'ui') mapHistory?.release();
    else mapHistory?.dispose();
    if (snapshotTimer) clearTimeout(snapshotTimer);
    if (toastTimer) clearTimeout(toastTimer);
    unsubscribeStore();
    unsubscribePort();
    unmountCanvas('board');
    unmountCanvas('trace');
    stopBannerWatch();
    fields.dispose();
    list.dispose();
    header.dispose();
    hostEl.remove();
    scrollTargets.forEach((n, i) => {
      n.style.overflow = previousOverflow[i];
    });
    if (current === registration) current = null;
    if (invoker?.isConnected) invoker.focus();
    options.onClose?.();
  }

  const registration = { close };
  current = registration;
  return { close: () => close() };
}

/**
 * At 1100px and below the floating upgrade card would sit on the revealed flow, so it starts as
 * the pill (the shell's own breakpoint). Without `matchMedia` (tests, old hosts) it stays open.
 */
function isNarrow(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 1100px)').matches;
  } catch {
    return false;
  }
}

function safeDecode(hash: string): DecodedMapHash | null {
  try {
    return decodeMapHash(hash);
  } catch {
    return null;
  }
}

function hint(keys: string[], label: string, className = ''): HTMLElement {
  return el('span', { className }, [
    ...keys.map((k) => el('span', { className: 'kbd', text: k })),
    text(` ${label}`),
  ]);
}

export type { MapNodeId };
