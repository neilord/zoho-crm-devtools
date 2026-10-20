import type { CrmContext } from '../functions/crm-context';
import type { ZohoFunctionSummary } from '../functions/types';
import { openRelatedFunctionInCrm, openRuleInCrm } from '../zoho/workflows-page';
import { requestWorkflowSearchAccess } from './controller';
import overlayCss from './overlay.css?inline';
import type { WorkflowSearchResult, WorkflowSearchScope } from './search';
import type {
  WorkflowActionKind,
  WorkflowIndexFailure,
  WorkflowIndexSnapshot,
  WorkflowRule,
  WorkflowTriggerType,
} from './types';
import { renderCoveragePopover, renderIndexPill } from './view-coverage';
import { renderDetail, renderDetailEmpty } from './view-detail';
import { button, captureFocus, el, restoreFocus, text } from './view-dom';
import { icon } from './view-icons';
import {
  activeFilterCount,
  type CodeFilter,
  type Coverage,
  computeCoverage,
  detailSignature,
  emptyFilters,
  type FunctionAction,
  hasAnyConstraint,
  KIND_LABELS,
  runSearch,
  SCOPE_LABELS,
  SCOPE_ORDER,
  type SearchOutcome,
  type SortKey,
  TRIGGER_LABELS,
  type UiFilters,
} from './view-model';
import { renderRailGroups, renderTriggerFieldOptions } from './view-rail';
import { renderEmpty, renderRow, rowSignature } from './view-rows';
import { WorkflowIndex, type WorkflowIndexListener } from './workflow-store';

const HOST_ID = 'zcdt-workflow-search-overlay';
const ROW_PAGE = 200;
const SEARCH_DEBOUNCE_MS = 80;
const SNAPSHOT_THROTTLE_MS = 150;
const ROUTE_POLL_MS = 400;

/** The slice of WorkflowIndex the dashboard drives; tests supply a fake. */
export interface WorkflowIndexLike {
  load(signal: AbortSignal): Promise<void>;
  subscribe(listener: WorkflowIndexListener): () => void;
  retryFailed(): Promise<void>;
  dispose(): void;
}

export interface WorkflowOverlayDependencies {
  requestAccess(invoker: HTMLElement, signal: AbortSignal): Promise<boolean>;
  createIndex(context: CrmContext): WorkflowIndexLike;
  openRule(ruleId: string): void;
  openFunction(summary: ZohoFunctionSummary, signal: AbortSignal): Promise<boolean>;
  /** False once the page left the workflows list or switched org/origin. */
  isCurrent(context: CrmContext): boolean;
}

const defaultDependencies: WorkflowOverlayDependencies = {
  requestAccess: (invoker, signal) => requestWorkflowSearchAccess(invoker, signal),
  // Wrapped: a bare `fetch` reference called as a method throws "Illegal invocation".
  createIndex: (context) =>
    new WorkflowIndex({ context, fetch: (input, init) => fetch(input, init) }),
  openRule: openRuleInCrm,
  openFunction: openRelatedFunctionInCrm,
  isCurrent: (context) =>
    window.location.origin === context.origin &&
    new RegExp(`^/crm/org${context.orgId}/settings/workflow-rules/?$`).test(
      window.location.pathname,
    ),
};

interface Refs {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  panel: HTMLElement;
  searchInput: HTMLInputElement;
  clearButton: HTMLButtonElement;
  slashHint: HTMLElement;
  indexWrap: HTMLElement;
  scopes: HTMLElement;
  state: HTMLElement;
  count: HTMLElement;
  chips: HTMLElement;
  sort: HTMLSelectElement;
  live: HTMLElement;
  body: HTMLElement;
  scrim: HTMLElement;
  rail: HTMLElement;
  railTop: HTMLElement;
  railBottom: HTMLElement;
  triggerField: HTMLInputElement;
  triggerFieldList: HTMLDataListElement;
  partial: HTMLElement;
  list: HTMLUListElement;
  listHost: HTMLElement;
  emptyHost: HTMLElement;
  foot: HTMLElement;
  footStatus: HTMLElement;
  detail: HTMLElement;
  toast: HTMLElement;
  reload: HTMLButtonElement;
}

interface Session {
  refs: Refs;
  close(): void;
  focusSearch(): void;
}

let session: Session | null = null;
let pendingAccess: AbortController | null = null;

export const isWorkflowSearchOverlayOpen = (): boolean => session !== null;

export function closeWorkflowSearchOverlay(): void {
  pendingAccess?.abort();
  pendingAccess = null;
  session?.close();
}

/**
 * Entitlement is resolved BEFORE an index is created, so a free user never causes
 * a CRM request. While the check (or upgrade modal) is pending, further clicks
 * are ignored; the check is aborted if the overlay is closed or the route changes.
 */
export async function openWorkflowSearchOverlay(
  context: CrmContext,
  invoker: HTMLElement,
  overrides: Partial<WorkflowOverlayDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...overrides };
  if (session) {
    session.focusSearch();
    return;
  }
  if (pendingAccess) return;
  const abort = new AbortController();
  pendingAccess = abort;
  const checkPendingRoute = () => {
    if (!deps.isCurrent(context)) abort.abort();
  };
  const pendingRouteTimer = setInterval(checkPendingRoute, ROUTE_POLL_MS);
  window.addEventListener('popstate', checkPendingRoute);
  invoker.setAttribute('aria-busy', 'true');
  let allowed = false;
  try {
    allowed = await deps.requestAccess(invoker, abort.signal);
  } catch (error) {
    console.error('Zoho CRM DevTools: workflow search access check failed', error);
  } finally {
    clearInterval(pendingRouteTimer);
    window.removeEventListener('popstate', checkPendingRoute);
    if (pendingAccess === abort) pendingAccess = null;
    invoker.removeAttribute('aria-busy');
  }
  if (!allowed || abort.signal.aborted || session || !deps.isCurrent(context)) return;
  session = mount(context, invoker, deps);
}

// ---------------------------------------------------------------------------

interface State {
  snapshot: WorkflowIndexSnapshot | null;
  ui: UiFilters;
  sort: SortKey;
  outcome: SearchOutcome | null;
  selectedId: string | null;
  limit: number;
  showAllModules: boolean;
  popOpen: boolean;
  railOpen: boolean;
  expandedCode: Set<string>;
  openingFunction: string | null;
  loadFailed: boolean;
  maxPercent: number;
}

function mount(
  context: CrmContext,
  invoker: HTMLElement,
  deps: WorkflowOverlayDependencies,
): Session {
  const refs = buildShell();
  const state: State = {
    snapshot: null,
    ui: emptyFilters(),
    sort: 'relevance',
    outcome: null,
    selectedId: null,
    limit: ROW_PAGE,
    showAllModules: false,
    popOpen: false,
    railOpen: false,
    expandedCode: new Set(),
    openingFunction: null,
    loadFailed: false,
    maxPercent: 0,
  };
  const abort = new AbortController();
  const index = deps.createIndex(context);
  let closed = false;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let handoff: AbortController | null = null;
  let lastListSig = '';
  let lastDetailKey = '';
  let lastDetailRuleId: string | null = null;
  let lastCoverage: Coverage | null = null;

  // ---- helpers -----------------------------------------------------------
  const failures = (): readonly WorkflowIndexFailure[] => state.snapshot?.progress.failures ?? [];
  const selectedResult = (): WorkflowSearchResult | undefined =>
    state.outcome?.results.find((r) => r.rule.id === state.selectedId);
  const setSig = (node: HTMLElement, sig: string, build: () => Node[]): void => {
    if (node.dataset.sig === sig) return;
    node.dataset.sig = sig;
    const focused = captureFocus(refs.shadow, node);
    node.replaceChildren(...build());
    restoreFocus(node, focused, refs.searchInput);
  };
  const toast = (message: string): void => {
    if (toastTimer) clearTimeout(toastTimer);
    refs.toast.replaceChildren(
      el('div', { className: 'toast', text: message, attrs: { role: 'alert' } }),
    );
    toastTimer = setTimeout(() => refs.toast.replaceChildren(), 4000);
  };

  // ---- rendering ---------------------------------------------------------
  function renderScopes(coverage: Coverage): void {
    const indexing = coverage.status.kind === 'indexing';
    const rowFraction = (key: string): number => {
      const row = coverage.rows.find((r) => r.key === key);
      if (!row || row.total === 0) return 1;
      return Math.min(1, (row.done + row.failed) / row.total);
    };
    const details = rowFraction('details');
    const actions = Math.min(details, rowFraction('actions'));
    const sources = coverage.pending.sources
      ? Math.min(actions, 1 - coverage.pending.sources / Math.max(1, coverage.rows[4].total))
      : actions;
    const progress: Record<WorkflowSearchScope, number> = {
      all: 1,
      name: 1,
      conditions: details,
      actions,
      code: sources,
    };
    const sig = JSON.stringify([
      state.ui.scope,
      indexing,
      SCOPE_ORDER.map((s) => Math.floor(progress[s] * 100)),
    ]);
    setSig(refs.scopes, sig, () => [
      el('span', { className: 'lab', text: 'Search in', attrs: { id: 'wf-scope-label' } }),
      ...SCOPE_ORDER.map((scope) => {
        const p = progress[scope];
        return el(
          'button',
          {
            className: 'wf-scope',
            type: 'button',
            attrs: { 'aria-pressed': String(state.ui.scope === scope) },
            dataset: { scope, fk: `scope:${scope}` },
            onClick: () => {
              state.ui.scope = scope;
              render(true);
            },
          },
          [
            text(SCOPE_LABELS[scope]),
            indexing && p < 1
              ? el('span', { className: 'ld wait', text: `${Math.floor(p * 100)}%` })
              : null,
          ],
        );
      }),
    ]);
  }

  function chip(label: string, value: string | null, remove: () => void): HTMLElement {
    return el('span', { className: 'fs-chip' }, [
      text(label),
      value ? el('em', { text: ` ${value}` }) : null,
      el(
        'button',
        {
          type: 'button',
          attrs: { 'aria-label': `Remove filter ${label}${value ? ` ${value}` : ''}` },
          onClick: remove,
        },
        [icon('close', 11)],
      ),
    ]);
  }

  function clearAll(): void {
    state.ui = emptyFilters();
    refs.searchInput.value = '';
    refs.triggerField.value = '';
    render(true);
  }

  function renderState(outcome: SearchOutcome, total: number): void {
    const ui = state.ui;
    refs.count.replaceChildren(
      el('b', { text: String(outcome.results.length) }),
      el('span', { text: ` of ${total} rules` }),
    );
    const modulesByKey = new Map(outcome.counts.modules.map((m) => [m.key, m.label]));
    const chips: HTMLElement[] = [];
    for (const v of ui.status)
      chips.push(
        chip('Status', v === 'active' ? 'Active' : 'Inactive', () => toggle(state.ui.status, v)),
      );
    for (const v of ui.modules)
      chips.push(chip('Module', modulesByKey.get(v) ?? v, () => toggle(state.ui.modules, v)));
    for (const v of ui.triggerTypes)
      chips.push(chip('Trigger', TRIGGER_LABELS[v], () => toggle(state.ui.triggerTypes, v)));
    if (ui.triggerField.trim())
      chips.push(
        chip('Trigger field', ui.triggerField.trim(), () => {
          state.ui.triggerField = '';
          refs.triggerField.value = '';
          render(true);
        }),
      );
    for (const v of ui.actionKinds)
      chips.push(chip('Action', KIND_LABELS[v], () => toggle(state.ui.actionKinds, v)));
    for (const v of ui.code)
      chips.push(
        chip('Function code', v === 'has' ? 'has source' : 'source unavailable', () =>
          toggle(state.ui.code, v),
        ),
      );
    const sig = JSON.stringify([chips.map((c) => c.textContent), hasAnyConstraint(ui), ui.scope]);
    setSig(refs.chips, sig, () => {
      const nodes: Node[] = chips.length
        ? chips
        : [el('span', { className: 'wf-none', text: 'No filters applied' })];
      if (hasAnyConstraint(ui) || ui.scope !== 'all')
        nodes.push(button('wf-btn link wf-clearall', 'Clear all', clearAll));
      return nodes;
    });
    const filterBtn = refs.state.querySelector('.wf-filterbtn');
    const n = activeFilterCount(ui);
    if (filterBtn?.lastChild) filterBtn.lastChild.textContent = n ? `Filters (${n})` : 'Filters';
    const hasQuery = ui.query.trim() !== '';
    const best = refs.sort.options[0] as HTMLOptionElement;
    best.hidden = !hasQuery;
    best.disabled = !hasQuery;
    refs.sort.value = state.sort === 'relevance' && !hasQuery ? 'name' : state.sort;
    refs.clearButton.style.display = ui.query ? 'inline-flex' : 'none';
    refs.slashHint.style.display = ui.query ? 'none' : 'inline-grid';
  }

  function toggle<T>(set: Set<T>, value: T): void {
    if (set.has(value)) set.delete(value);
    else set.add(value);
    render(true);
  }

  function renderRail(outcome: SearchOutcome, coverage: Coverage): void {
    const sig = JSON.stringify([
      outcome.counts,
      [...state.ui.status],
      [...state.ui.modules],
      [...state.ui.triggerTypes],
      [...state.ui.actionKinds],
      [...state.ui.code],
      state.showAllModules,
      coverage.pending,
    ]);
    const groups = renderRailGroups(outcome.counts, state.ui, coverage, state.showAllModules, {
      toggleStatus: (v) => toggle(state.ui.status, v),
      toggleModule: (v) => toggle(state.ui.modules, v),
      toggleTrigger: (v: WorkflowTriggerType) => toggle(state.ui.triggerTypes, v),
      toggleKind: (v: WorkflowActionKind) => toggle(state.ui.actionKinds, v),
      toggleCode: (v: CodeFilter) => toggle(state.ui.code, v),
      toggleAllModules: () => {
        state.showAllModules = !state.showAllModules;
        render(false);
      },
    });
    setSig(refs.railTop, sig, () => groups.before);
    setSig(refs.railBottom, sig, () => groups.after);
    setSig(refs.triggerFieldList, JSON.stringify(outcome.triggerFields), () =>
      renderTriggerFieldOptions(outcome.triggerFields),
    );
  }

  function renderIndex(coverage: Coverage): void {
    const sig = JSON.stringify([
      state.popOpen,
      coverage.status,
      coverage.refreshing,
      coverage.rows,
      coverage.failures.map((f) => f.id),
    ]);
    setSig(refs.indexWrap, sig, () => {
      const nodes: Node[] = [
        renderIndexPill(coverage, state.popOpen, () => {
          state.popOpen = !state.popOpen;
          renderIndex(computeCoverage(state.snapshot as WorkflowIndexSnapshot));
        }),
      ];
      if (state.popOpen) {
        nodes.push(
          renderCoveragePopover(coverage, {
            onRetryAll: () =>
              void index.retryFailed().catch(() => toast('Retry did not complete.')),
            onRetryFailure: (i) => retry(coverage.failures[i]),
            onReindex: reindex,
          }),
        );
      }
      return nodes;
    });
    refs.reload.disabled = coverage.status.kind === 'indexing';
    refs.footStatus.textContent =
      coverage.status.kind === 'indexing' ? 'Index building…' : 'Index ready';
  }

  function renderPartial(coverage: Coverage): void {
    const ui = state.ui;
    const constrained = hasAnyConstraint(ui);
    const need: string[] = [];
    const usesDetail =
      ui.scope === 'all' ||
      ui.scope === 'conditions' ||
      ui.scope === 'actions' ||
      ui.scope === 'code' ||
      ui.actionKinds.size > 0 ||
      ui.triggerTypes.size > 0 ||
      ui.triggerField.trim() !== '';
    const usesActions = ui.scope === 'all' || ui.scope === 'actions' || ui.actionKinds.size > 0;
    const usesCode = ui.scope === 'all' || ui.scope === 'code' || ui.code.size > 0;
    const indexing = coverage.status.kind === 'indexing';
    if (constrained && indexing) {
      if (usesDetail && coverage.pending.details)
        need.push(`${coverage.pending.details} rule details`);
      if (usesActions && coverage.pending.actions) need.push(`${coverage.pending.actions} actions`);
      if (usesCode && coverage.pending.sources)
        need.push(`${coverage.pending.sources} function sources`);
    }
    let content: Node[] = [];
    let sig = 'none';
    if (need.length) {
      sig = `partial:${need.join(',')}`;
      content = bannerNodes([
        el('b', { text: 'Partial index. ' }),
        text(`Still loading ${need.join(', ')}. Results may grow as indexing finishes.`),
      ]);
    } else if (constrained && coverage.status.kind === 'gaps' && coverage.gaps > 0) {
      sig = `gaps:${coverage.gaps}`;
      content = bannerNodes([
        el('b', { text: `${coverage.gaps} gap${coverage.gaps === 1 ? '' : 's'} in the index. ` }),
        text(
          'Matches inside items that failed to load, or whose function source is unavailable, cannot be found. ',
        ),
        button('wf-btn link', 'Details', () => {
          state.popOpen = true;
          renderIndex(coverage);
        }),
      ]);
    } else if (constrained && coverage.status.kind === 'failed') {
      sig = 'failed';
      content = bannerNodes([
        el('b', { text: 'Index failed. ' }),
        text('Only previously cached rules are shown.'),
      ]);
    }
    setSig(refs.partial, sig, () => content);
  }

  function bannerNodes(children: Node[]): Node[] {
    return [
      el('div', { className: 'wf-partial', attrs: { role: 'status' } }, [
        icon('warn', 15),
        el('div', {}, children),
      ]),
    ];
  }

  function renderList(
    outcome: SearchOutcome,
    snapshot: WorkflowIndexSnapshot,
    user: boolean,
  ): void {
    const q = state.ui.query;
    const shown = outcome.results.slice(0, state.limit);
    const rowSigs = shown.map((r) => `${r.rule.id}:${rowSignature(r, q)}`).join('\n');
    const listSig = `${rowSigs}|${outcome.results.length}|${state.limit}|${[...state.ui.actionKinds]}`;
    const coverageKind = snapshot.progress.phase;
    let empty: HTMLElement | null = null;
    if (snapshot.rules.length === 0) {
      empty = renderEmpty({
        kind:
          state.loadFailed || coverageKind === 'failed'
            ? 'failed'
            : coverageKind === 'complete'
              ? 'empty-org'
              : 'listing',
        query: '',
        scopeLabel: null,
        filterCount: 0,
        indexing: false,
        actions: emptyActions(),
      });
    } else if (outcome.results.length === 0) {
      empty = renderEmpty({
        kind: 'no-results',
        query: q,
        scopeLabel: state.ui.scope !== 'all' ? SCOPE_LABELS[state.ui.scope] : null,
        filterCount: activeFilterCount(state.ui),
        indexing: lastCoverage?.status.kind === 'indexing',
        actions: emptyActions(),
      });
    }
    if (lastListSig !== listSig || user) {
      const previousScroll = refs.list.scrollTop;
      const focused = captureFocus(refs.shadow, refs.list);
      lastListSig = listSig;
      refs.list.replaceChildren(
        ...(empty
          ? []
          : shown.map((result) =>
              renderRow({
                result,
                query: q,
                selected: result.rule.id === state.selectedId,
                activeKinds: state.ui.actionKinds,
                onSelect: (rule) => select(rule.id),
              }),
            )),
      );
      if (!empty && outcome.results.length > shown.length) {
        const more = outcome.results.length - shown.length;
        refs.list.appendChild(
          el('li', { className: 'fs-more', attrs: { role: 'presentation' } }, [
            button(
              'wf-btn',
              `Show ${Math.min(more, ROW_PAGE)} more rules`,
              () => {
                state.limit += ROW_PAGE;
                render(false);
              },
              [],
              { attrs: { 'data-fk': 'more-rules' } },
            ),
          ]),
        );
      }
      refs.list.scrollTop = user ? 0 : previousScroll;
      restoreFocus(refs.list, focused, refs.searchInput);
    }
    refs.listHost.dataset.empty = empty ? 'true' : 'false';
    setSig(refs.emptyHost, empty ? `e:${empty.textContent}:${coverageKind}` : 'none', () =>
      empty ? [empty] : [],
    );
    applySelection(false);
  }

  function emptyActions() {
    return {
      searchEverywhere: () => {
        state.ui.scope = 'all';
        render(true);
      },
      clearFilters: () => {
        const q = state.ui.query;
        state.ui = emptyFilters();
        state.ui.query = q;
        refs.triggerField.value = '';
        render(true);
      },
      retry: reindex,
    };
  }

  /** Mirrors selection into aria and scroll without rebuilding rows. */
  function applySelection(scroll: boolean): void {
    let activeId = '';
    for (const row of refs.list.querySelectorAll<HTMLElement>('.fs-row')) {
      const on = row.dataset.ruleId === state.selectedId;
      row.setAttribute('aria-selected', String(on));
      if (on) {
        activeId = row.id;
        if (scroll) row.scrollIntoView?.({ block: 'nearest' });
      }
    }
    for (const node of [refs.searchInput, refs.list]) {
      if (activeId) node.setAttribute('aria-activedescendant', activeId);
      else node.removeAttribute('aria-activedescendant');
    }
  }

  function renderDetailPane(opts: { force?: boolean; fresh?: boolean } = {}): void {
    const rule = state.snapshot?.rules.find((r) => r.id === state.selectedId);
    const result = selectedResult();
    const key = rule
      ? JSON.stringify([
          rule.id,
          detailSignature(rule),
          state.ui.query,
          [...state.expandedCode],
          state.openingFunction,
          failures().map((f) => f.id),
          result?.matches.length ?? 0,
        ])
      : 'none';
    if (!opts.force && key === lastDetailKey) return;
    const scrollTop = refs.detail.querySelector<HTMLElement>('.fs-info-scroll')?.scrollTop ?? 0;
    const sameRule = (rule?.id ?? null) === lastDetailRuleId;
    lastDetailKey = key;
    lastDetailRuleId = rule?.id ?? null;
    const next = rule
      ? renderDetail({
          rule,
          result,
          query: state.ui.query,
          failures: failures(),
          expandedCode: state.expandedCode,
          openingFunction: state.openingFunction,
          handlers: {
            onOpenRule: openRule,
            onOpenFunction: openFunction,
            onToggleCode: (codeKey) => {
              if (!state.expandedCode.delete(codeKey)) state.expandedCode.add(codeKey);
              renderDetailPane({ force: true });
            },
            onRetry: retry,
          },
        })
      : renderDetailEmpty();
    const focused = captureFocus(refs.shadow, refs.detail);
    refs.detail.replaceWith(next);
    restoreFocus(next, focused, refs.searchInput);
    refs.detail = next;
    const scroller = next.querySelector<HTMLElement>('.fs-info-scroll');
    if (!scroller) return;
    if (sameRule && !opts.fresh) scroller.scrollTop = scrollTop;
    else if (state.ui.query.trim())
      next.querySelector('.act.matched')?.scrollIntoView?.({ block: 'center' });
  }

  /** Recomputes everything. `user` marks an explicit query/filter/selection change. */
  function render(user: boolean): void {
    if (closed || !state.snapshot) return;
    if (!deps.isCurrent(context)) {
      queueMicrotask(close);
      return;
    }
    const snapshot = state.snapshot;
    const outcome = runSearch(snapshot, state.ui, state.sort);
    state.outcome = outcome;
    const ids = new Set(outcome.results.map((r) => r.rule.id));
    const keep = !user && state.selectedId !== null && ids.has(state.selectedId);
    state.selectedId = keep ? state.selectedId : (outcome.results[0]?.rule.id ?? null);
    const coverage = computeCoverage(snapshot);
    if (coverage.status.kind === 'indexing') {
      // The percentage may be re-derived as new work is discovered; it never moves backwards.
      state.maxPercent = Math.max(state.maxPercent, coverage.status.percent);
      coverage.status = { kind: 'indexing', percent: state.maxPercent };
    }
    lastCoverage = coverage;
    renderScopes(coverage);
    renderState(outcome, snapshot.rules.length);
    renderRail(outcome, coverage);
    renderIndex(coverage);
    renderPartial(coverage);
    renderList(outcome, snapshot, user);
    renderDetailPane({ fresh: user });
    refs.searchInput.placeholder = snapshot.rules.length
      ? state.ui.scope === 'code'
        ? 'Search Deluge code in functions called by workflows…'
        : `Search ${snapshot.rules.length} workflow rules: names, conditions, actions, function code`
      : 'Search workflow rules';
    // Announce only deliberate changes; indexing ticks would otherwise chatter.
    if (user) {
      refs.live.textContent = `${outcome.results.length} of ${snapshot.rules.length} rules shown`;
    }
  }

  // ---- actions -----------------------------------------------------------
  function select(ruleId: string): void {
    if (state.selectedId === ruleId) return;
    state.selectedId = ruleId;
    applySelection(false);
    renderDetailPane({ force: true, fresh: true });
  }

  function move(delta: number): void {
    const results = state.outcome?.results ?? [];
    if (results.length === 0) return;
    const current = results.findIndex((r) => r.rule.id === state.selectedId);
    const next = Math.max(0, Math.min(results.length - 1, (current < 0 ? -1 : current) + delta));
    if (next >= state.limit) {
      state.limit = Math.ceil((next + 1) / ROW_PAGE) * ROW_PAGE;
      state.selectedId = results[next].rule.id;
      lastListSig = '';
      render(false);
      applySelection(true);
      return;
    }
    select(results[next].rule.id);
    applySelection(true);
  }

  function openRule(rule: WorkflowRule): void {
    if (!deps.isCurrent(context)) {
      close();
      return;
    }
    if (!/^\d+$/.test(rule.id)) {
      toast('This rule cannot be opened from here.');
      return;
    }
    close();
    try {
      deps.openRule(rule.id);
    } catch (error) {
      console.error('Zoho CRM DevTools: failed to open the workflow rule', error);
    }
  }

  function openFunction(_rule: WorkflowRule, action: FunctionAction): void {
    if (!deps.isCurrent(context)) {
      close();
      return;
    }
    if (state.openingFunction || !action.delugeFunctionId) return;
    state.openingFunction = action.delugeFunctionId;
    renderDetailPane({ force: true });
    handoff = new AbortController();
    const controller = handoff;
    const summary: ZohoFunctionSummary = {
      id: action.delugeFunctionId,
      display_name: action.bindingName || action.name,
      api_name: action.apiName ?? undefined,
      category: '',
    };
    deps
      .openFunction(summary, controller.signal)
      .then((opened) => {
        if (closed || controller.signal.aborted) return;
        state.openingFunction = null;
        if (opened) {
          renderDetailPane({ force: true });
          return;
        }
        renderDetailPane({ force: true });
        toast('Could not open the function in the editor. Try again.');
      })
      .catch((error: unknown) => {
        if (closed || controller.signal.aborted) return;
        console.error('Zoho CRM DevTools: failed to open the function', error);
        state.openingFunction = null;
        renderDetailPane({ force: true });
        toast('Could not open the function in the editor. Try again.');
      });
  }

  function retry(failure: WorkflowIndexFailure | undefined): void {
    if (!failure) return;
    failure.retry().catch(() => toast('Retry did not complete.'));
  }

  function load(): void {
    state.loadFailed = false;
    index.load(abort.signal).catch((error: unknown) => {
      if (closed || abort.signal.aborted) return;
      console.error('Zoho CRM DevTools: failed to load workflows', error);
      state.loadFailed = true;
      render(false);
    });
  }

  /** A user-requested re-index starts a fresh progress run. */
  function reindex(): void {
    state.maxPercent = 0;
    load();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    abort.abort();
    handoff?.abort();
    for (const t of [renderTimer, searchTimer, toastTimer, fieldTimer]) if (t) clearTimeout(t);
    clearInterval(routeTimer);
    window.removeEventListener('popstate', checkRoute);
    unsubscribe();
    try {
      index.dispose();
    } catch (error) {
      console.error('Zoho CRM DevTools: workflow index disposal failed', error);
    }
    refs.host.remove();
    if (session?.refs === refs) session = null;
    if (invoker.isConnected) invoker.focus?.();
  }

  function checkRoute(): void {
    if (!deps.isCurrent(context)) close();
  }

  // ---- events ------------------------------------------------------------
  const scheduleSnapshotRender = (): void => {
    if (renderTimer || closed) return;
    // Coalesce progressive publications; unchanged rules reuse prepared search documents.
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render(false);
    }, SNAPSHOT_THROTTLE_MS);
  };

  refs.searchInput.addEventListener('input', () => {
    state.ui.query = refs.searchInput.value;
    refs.clearButton.style.display = state.ui.query ? 'inline-flex' : 'none';
    refs.slashHint.style.display = state.ui.query ? 'none' : 'inline-grid';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      render(true);
    }, SEARCH_DEBOUNCE_MS);
  });
  refs.clearButton.addEventListener('click', () => {
    refs.searchInput.value = '';
    state.ui.query = '';
    render(true);
    refs.searchInput.focus();
  });
  refs.sort.addEventListener('change', () => {
    state.sort = refs.sort.value as SortKey;
    render(true);
  });
  let fieldTimer: ReturnType<typeof setTimeout> | null = null;
  refs.triggerField.addEventListener('input', () => {
    state.ui.triggerField = refs.triggerField.value;
    if (fieldTimer) clearTimeout(fieldTimer);
    fieldTimer = setTimeout(() => render(true), 200);
  });
  refs.reload.addEventListener('click', reindex);
  refs.panel.querySelector('[data-act="close"]')?.addEventListener('click', close);
  refs.panel.querySelector('.wf-filterbtn')?.addEventListener('click', () => {
    state.railOpen = !state.railOpen;
    refs.rail.classList.toggle('open', state.railOpen);
    refs.scrim.classList.toggle('open', state.railOpen);
  });
  refs.scrim.addEventListener('click', () => {
    state.railOpen = false;
    refs.rail.classList.remove('open');
    refs.scrim.classList.remove('open');
  });
  const overlayRoot = refs.shadow.querySelector('.fs-overlay') as HTMLElement;
  overlayRoot.addEventListener('mousedown', (event) => {
    if (event.target === overlayRoot) close();
    else if (state.popOpen && !event.composedPath().includes(refs.indexWrap)) {
      state.popOpen = false;
      if (lastCoverage) renderIndex(lastCoverage);
    }
  });

  const stop = (event: Event) => event.stopPropagation();
  refs.host.addEventListener('keyup', stop);
  refs.host.addEventListener('keypress', stop);
  refs.host.addEventListener('keydown', (event: KeyboardEvent) => {
    // Zoho's global shortcuts key off document.activeElement, which is this host.
    event.stopPropagation();
    const active = refs.shadow.activeElement as HTMLElement | null;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.popOpen) {
        state.popOpen = false;
        if (lastCoverage) renderIndex(lastCoverage);
        (refs.indexWrap.querySelector('.wf-pill') as HTMLElement | null)?.focus();
      } else if (state.railOpen) {
        state.railOpen = false;
        refs.rail.classList.remove('open');
        refs.scrim.classList.remove('open');
      } else close();
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event, refs, active);
      return;
    }
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      refs.searchInput.focus();
      refs.searchInput.select();
      return;
    }
    const inListContext = active === refs.searchInput || active === refs.list;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && inListContext) {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && inListContext && !event.isComposing) {
      const rule = state.snapshot?.rules.find((r) => r.id === state.selectedId);
      if (rule) {
        event.preventDefault();
        openRule(rule);
      }
    }
  });

  document.body.appendChild(refs.host);
  const routeTimer = setInterval(checkRoute, ROUTE_POLL_MS);
  window.addEventListener('popstate', checkRoute);
  refs.searchInput.focus();

  const unsubscribe = index.subscribe((snapshot) => {
    if (!deps.isCurrent(context)) {
      queueMicrotask(close);
      return;
    }
    const first = state.snapshot === null;
    state.snapshot = snapshot;
    if (import.meta.env.MODE === 'development' && snapshot.progress.phase === 'complete') {
      // Counts only: compare the code haystack with literal source scanning during acceptance.
      const sources = new Map<string, string>();
      const matchingRules = new Set<string>();
      for (const rule of snapshot.rules)
        for (const c of rule.conditions)
          for (const a of [...c.instantActions, ...c.scheduledActions.flatMap((s) => s.actions)])
            if (a.kind === 'function' && a.sourceState === 'available' && a.sourceText) {
              sources.set(a.delugeFunctionId ?? a.id ?? a.bindingName, a.sourceText);
              if (a.sourceText.toLowerCase().includes('invokeurl')) matchingRules.add(rule.id);
            }
      refs.host.dataset.sourceAudit = JSON.stringify({
        loaded: sources.size,
        invokeurlSources: [...sources.values()].filter((s) => s.toLowerCase().includes('invokeurl'))
          .length,
        invokeurlRules: matchingRules.size,
        legacyCacheBytes: new TextEncoder().encode(
          JSON.stringify({ version: 1, savedAt: Date.now(), rules: snapshot.rules }),
        ).length,
      });
    }
    if (first) render(true);
    else scheduleSnapshotRender();
  });
  load();

  return {
    refs,
    close,
    focusSearch: () => refs.searchInput.focus(),
  };
}

function trapFocus(event: KeyboardEvent, refs: Refs, active: HTMLElement | null): void {
  const focusable = [
    ...refs.panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ]
    .filter((n) => !n.closest('[hidden]') && n.style.display !== 'none')
    // Selector lists are not guaranteed to come back in document order everywhere.
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (active === first || !active)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !active)) {
    event.preventDefault();
    first.focus();
  }
}

function buildShell(): Refs {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = overlayCss;
  shadow.appendChild(style);

  const searchInput = el('input', {
    attrs: {
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-label': 'Search workflow rules',
      'aria-controls': 'wf-results',
      'aria-expanded': 'true',
      'aria-autocomplete': 'list',
      placeholder: 'Search workflow rules',
    },
  }) as HTMLInputElement;
  const clearButton = el(
    'button',
    {
      className: 'wf-clear',
      type: 'button',
      title: 'Clear search',
      attrs: { 'aria-label': 'Clear search' },
    },
    [icon('close', 16)],
  );
  const slashHint = el('span', { className: 'kbd', text: '/', attrs: { 'aria-hidden': 'true' } });
  const indexWrap = el('div', { className: 'wf-index' });
  const reload = el(
    'button',
    {
      className: 'fs-icon-button',
      type: 'button',
      title: 'Re-index all workflows',
      attrs: { 'aria-label': 'Re-index all workflows' },
    },
    [icon('refresh', 16)],
  );
  const closeButton = el(
    'button',
    {
      className: 'fs-icon-button',
      type: 'button',
      title: 'Close (Esc)',
      attrs: { 'aria-label': 'Close', 'data-act': 'close' },
    },
    [icon('close', 18)],
  );
  const header = el('div', { className: 'fs-header' }, [
    el('h2', { className: 'fs-brand', text: 'Search All Workflows', attrs: { id: 'wf-title' } }),
    el('span', { className: 'fs-header-spacer' }),
    indexWrap,
    reload,
    closeButton,
  ]);

  const scopes = el('div', {
    className: 'wf-scopes',
    attrs: { role: 'group', 'aria-labelledby': 'wf-scope-label' },
  });
  const band = el('div', { className: 'wf-band' }, [
    el('label', { className: 'wf-search' }, [
      icon('search', 20),
      searchInput,
      clearButton,
      slashHint,
    ]),
    scopes,
  ]);

  const count = el('span', { className: 'wf-count' });
  const chips = el('span', { className: 'wf-chips' });
  const sort = el('select', { attrs: { 'aria-label': 'Sort rules' } }, [
    el('option', { attrs: { value: 'relevance' }, text: 'Best match' }),
    el('option', { attrs: { value: 'name' }, text: 'Name' }),
    el('option', { attrs: { value: 'module' }, text: 'Module' }),
    el('option', { attrs: { value: 'modified' }, text: 'Recently modified' }),
  ]) as HTMLSelectElement;
  const filterBtn = el('button', { className: 'wf-btn wf-filterbtn', type: 'button' }, [
    icon('chevron', 12),
    text('Filters'),
  ]);
  const stateBar = el('div', { className: 'wf-state' }, [
    count,
    filterBtn,
    chips,
    el('label', { className: 'wf-sort' }, [text('Sort'), sort]),
  ]);
  const live = el('div', {
    className: 'sr-only',
    attrs: { 'aria-live': 'polite', role: 'status' },
  });

  const railTop = el('div');
  const triggerField = el('input', {
    attrs: {
      type: 'text',
      list: 'wf-trigger-fields',
      placeholder: 'Trigger field, e.g. Stage',
      'aria-label': 'Trigger field',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;
  const triggerFieldList = el('datalist', {
    attrs: { id: 'wf-trigger-fields' },
  }) as HTMLDataListElement;
  const railBottom = el('div');
  const rail = el('aside', { className: 'wf-rail', attrs: { 'aria-label': 'Filters' } }, [
    railTop,
    el('div', { className: 'fac fac-tail' }, [triggerField, triggerFieldList]),
    railBottom,
  ]);
  const scrim = el('div', { className: 'wf-drawer-scrim' });

  const partial = el('div');
  const list = el('ul', {
    className: 'fs-list',
    attrs: { role: 'listbox', id: 'wf-results', 'aria-label': 'Workflow rules', tabindex: '0' },
  }) as HTMLUListElement;
  const emptyHost = el('div', { className: 'fs-empty-host' });
  const listHost = el('div', { className: 'fs-listhost' }, [emptyHost, list]);
  const footStatus = el('span', { className: 'footstatus' });
  const foot = el('div', { className: 'wf-foot' }, [
    el('div', { className: 'hints' }, [
      hint(['/'], 'search'),
      hint(['↑', '↓'], 'navigate'),
      hint(['Enter'], 'open in Zoho'),
      hint(['Esc'], 'close'),
    ]),
    el('span', { className: 'sp' }),
    footStatus,
  ]);
  const main = el('section', { className: 'fs-main' }, [partial, listHost, foot]);
  const detail = renderDetailEmpty();
  const body = el('div', { className: 'fs-body' }, [scrim, rail, main, detail]);
  const toastHost = el('div', { className: 'toast-host' });

  const panel = el(
    'div',
    {
      className: 'fs-panel',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'wf-title',
        // Focusable so clicks on blank areas keep focus (and key events) inside the dialog.
        tabindex: '-1',
      },
    },
    [header, band, stateBar, live, body, toastHost],
  );
  const overlay = el('div', { className: 'fs-overlay' }, [panel]);
  shadow.appendChild(overlay);

  return {
    host,
    shadow,
    panel,
    searchInput,
    clearButton,
    slashHint,
    indexWrap,
    scopes,
    state: stateBar,
    count,
    chips,
    sort,
    live,
    body,
    scrim,
    rail,
    railTop,
    railBottom,
    triggerField,
    triggerFieldList,
    partial,
    list,
    listHost,
    emptyHost,
    foot,
    footStatus,
    detail,
    toast: toastHost,
    reload,
  };
}

function hint(keys: string[], label: string): HTMLElement {
  return el('span', {}, [
    ...keys.map((k) => el('span', { className: 'kbd', text: k })),
    text(` ${label}`),
  ]);
}
