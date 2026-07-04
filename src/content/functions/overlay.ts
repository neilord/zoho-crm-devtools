import { fetchFunctionDetail } from './api';
import type { CrmContext } from './crm-context';
import { closeIcon, el, refreshIcon, searchIcon } from './dom';
import { requestEditInCrm } from './edit-in-crm';
import { loadFunctions } from './function-store';
import overlayCss from './overlay.css?inline';
import {
  filterRecords,
  getCategoryCounts,
  MIN_QUERY_LENGTH,
  normalizeQuery,
  type SortOrder,
  sortByModified,
} from './search';
import type { FunctionRecord } from './types';
import {
  renderCategoryButton,
  renderDetail,
  renderEmptyState,
  renderFunctionRow,
  renderLoadingState,
} from './view';

const HOST_ID = 'zcdt-function-search-overlay';

interface OverlayRefs {
  host: HTMLDivElement;
  searchInput: HTMLInputElement;
  sortButton: HTMLButtonElement;
  reloadButton: HTMLButtonElement;
  progress: HTMLDivElement;
  progressFill: HTMLDivElement;
  categories: HTMLElement;
  main: HTMLElement;
}

interface OverlayState {
  records: FunctionRecord[];
  category: string | null;
  query: string;
  sort: SortOrder;
  selectedId: string | null;
  loading: boolean;
  errorMessage: string | null;
  listScrollTop: number;
  /** Id of the record whose fresh detail is being re-fetched before handing off to Zoho's editor. */
  openingId: string | null;
}

let refs: OverlayRefs | null = null;
let activeContext: CrmContext | null = null;
let state: OverlayState = createInitialState();
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
let stopPropagationHandler: ((event: KeyboardEvent) => void) | null = null;

function createInitialState(): OverlayState {
  return {
    records: [],
    category: null,
    query: '',
    sort: 'newest',
    selectedId: null,
    loading: true,
    errorMessage: null,
    listScrollTop: 0,
    openingId: null,
  };
}

function getVisibleRecords(): FunctionRecord[] {
  const filtered = filterRecords(state.records, { category: state.category, query: state.query });
  return sortByModified(filtered, state.sort);
}

/** The active query to highlight, or '' when it is too short to search on. */
function getHighlightQuery(): string {
  const normalized = normalizeQuery(state.query);
  return normalized.length >= MIN_QUERY_LENGTH ? normalized : '';
}

function renderCategories(): void {
  if (!refs) {
    return;
  }
  const matches = filterRecords(state.records, { category: null, query: state.query });
  const counts = getCategoryCounts(state.records, matches);
  const buttons: HTMLElement[] = [
    renderCategoryButton(
      { key: null, label: 'All', count: matches.length },
      state.category === null,
      selectCategory,
    ),
  ];
  for (const entry of counts) {
    buttons.push(renderCategoryButton(entry, state.category === entry.key, selectCategory));
  }
  refs.categories.replaceChildren(...buttons);
}

function renderMain(): void {
  if (!refs) {
    return;
  }

  refs.reloadButton.disabled = state.loading;

  if (state.errorMessage) {
    refs.main.replaceChildren(renderEmptyState(state.errorMessage));
    return;
  }

  const selected = state.selectedId
    ? state.records.find((record) => record.summary.id === state.selectedId)
    : null;

  if (selected) {
    refs.main.replaceChildren(
      renderDetail(
        selected,
        { onBack: closeDetail, onEdit: editInCrm },
        getHighlightQuery(),
        state.loading,
        state.openingId === selected.summary.id,
      ),
    );
    return;
  }

  const visible = getVisibleRecords();
  if (visible.length === 0) {
    if (state.loading) {
      refs.main.replaceChildren(renderLoadingState('Loading functions…'));
    } else {
      const message =
        state.records.length === 0
          ? 'No functions found in this org.'
          : 'No functions match your search.';
      refs.main.replaceChildren(renderEmptyState(message));
    }
    return;
  }

  const highlight = getHighlightQuery();
  const list = el(
    'ul',
    { className: 'fs-list' },
    visible.map((record) => renderFunctionRow(record, openDetail, highlight)),
  );
  // Background loading (cache/list/detail progress, completion) re-renders the list
  // as data trickles in, which rebuilds this `<ul>` from scratch each time and would
  // otherwise reset scroll to the top mid-browse. Track scroll continuously and
  // reapply it on every rebuild; explicit filter/sort changes reset listScrollTop to
  // 0 themselves so those still land at the top.
  list.addEventListener('scroll', () => {
    state.listScrollTop = list.scrollTop;
  });
  refs.main.replaceChildren(list);
  list.scrollTop = state.listScrollTop;
}

function updateProgress(loaded: number, total: number): void {
  if (!refs) {
    return;
  }
  const active = state.loading && total > 0 && loaded < total;
  refs.progress.dataset.active = String(active);
  refs.progressFill.style.width = total > 0 ? `${Math.round((loaded / total) * 100)}%` : '0';
}

function selectCategory(key: string | null): void {
  state.category = key;
  // Switching categories while a function's source is open would otherwise leave the
  // detail view showing over a now-irrelevant filter; closing it surfaces the
  // (re-filtered) list instead, matching what the user just asked to see.
  state.selectedId = null;
  state.listScrollTop = 0;
  renderCategories();
  renderMain();
}

/**
 * Whether the currently selected record had a loaded `detail` the last time the
 * detail view was rendered. Lets background detail-loading progress skip
 * re-rendering the open detail view except on the one tick where the selected
 * record's own detail actually arrives.
 */
let selectedHadDetail = false;

function openDetail(record: FunctionRecord): void {
  state.selectedId = record.summary.id;
  selectedHadDetail = Boolean(record.detail);
  renderMain();
}

function closeDetail(): void {
  state.selectedId = null;
  renderMain();
}

/**
 * Re-fetches this function's detail live before opening Zoho's editor, rather than
 * trusting `record.detail`: that value can come from the persisted cache and still
 * reflect the version from before a recent edit, since the list request that would
 * catch the staleness (comparing `updatedTime`) may not have resolved yet. Opening
 * Zoho's editor with a stale detail lets it be saved back over the newer version,
 * silently discarding the user's most recent edit — so the extra round trip here
 * happens unconditionally rather than only when we suspect the cache is stale.
 */
function editInCrm(record: FunctionRecord): void {
  if (!record.detail || !activeContext || state.openingId) {
    return;
  }

  const context = activeContext;
  state.openingId = record.summary.id;
  renderMain();

  void fetchFunctionDetail(context, record.summary)
    .then((freshDetail) => {
      if (!freshDetail) {
        throw new Error('Function detail request returned nothing');
      }
      record.detail = freshDetail;
      // Wait for confirmation before closing: closing unconditionally right after
      // firing the request meant a failed request (e.g. an invalidated extension
      // context from a stale tab) looked like the overlay just closing with
      // nothing happening, since the failure surfaced only in the console after
      // the overlay was already gone.
      return requestEditInCrm(freshDetail);
    })
    .then((opened) => {
      state.openingId = null;
      if (opened) {
        closeOverlay();
        return;
      }
      state.errorMessage = 'Could not reach the extension. Reload this tab and try again.';
      renderMain();
    })
    .catch((error: unknown) => {
      console.error('Zoho CRM DevTools: failed to refresh function detail before editing', error);
      state.openingId = null;
      state.errorMessage = 'Could not load the latest version of this function. Try again.';
      renderMain();
    });
}

function onSearchInput(value: string): void {
  state.query = value;
  state.listScrollTop = 0;
  renderCategories();
  if (!state.selectedId) {
    renderMain();
  }
}

function toggleSort(): void {
  state.sort = state.sort === 'newest' ? 'oldest' : 'newest';
  state.listScrollTop = 0;
  if (refs) {
    refs.sortButton.textContent = state.sort === 'newest' ? 'Newest' : 'Oldest';
  }
  renderMain();
}

/**
 * Kicks off (or re-kicks off) loading. The function-store cache means a
 * reload is cheap: the summary list is refetched, but only new or changed
 * functions (by `updatedTime`) trigger a detail request.
 */
function startLoad(context: CrmContext): void {
  void loadFunctions(context, {
    onCacheLoaded(records) {
      // Renders whatever was cached from a past visit before the network list
      // request even starts, so a slow/first-ever fetch never shows a blank
      // "Loading functions…" screen when we already have something to show.
      state.records = records;
      renderCategories();
      renderMain();
    },
    onListLoaded(records) {
      state.records = records;
      renderCategories();
      renderMain();
    },
    onDetailProgress(loaded, total) {
      updateProgress(loaded, total);
      if (state.selectedId) {
        // Re-rendering the open detail view on every tick recreates its back
        // button while the pool is warming other functions' details, which can
        // drop a click that lands mid-teardown. Only re-render when the
        // selected record's own detail is the one that just arrived.
        const selected = state.records.find((record) => record.summary.id === state.selectedId);
        const hasDetail = Boolean(selected?.detail);
        if (hasDetail !== selectedHadDetail) {
          selectedHadDetail = hasDetail;
          renderMain();
        }
      } else if (state.query.length >= 3 && (loaded === total || loaded % 10 === 0)) {
        renderMain();
      }
    },
    onComplete() {
      state.loading = false;
      updateProgress(1, 1);
      renderMain();
    },
    onError(error) {
      console.error('Zoho CRM DevTools: failed to load functions', error);
      state.loading = false;
      state.errorMessage = 'Could not load functions. Reload the Zoho page and try again.';
      renderMain();
    },
  });
}

function reload(): void {
  if (!activeContext || state.loading) {
    return;
  }
  state.loading = true;
  state.errorMessage = null;
  renderMain();
  startLoad(activeContext);
}

function buildOverlay(): OverlayRefs {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = overlayCss;
  shadow.appendChild(style);

  const searchInput = el('input', {
    attrs: {
      type: 'search',
      placeholder: 'Search functions and source…',
      'aria-label': 'Search functions',
    },
  }) as HTMLInputElement;
  searchInput.addEventListener('input', () => onSearchInput(searchInput.value));

  const sortButton = el('button', {
    className: 'fs-sort',
    type: 'button',
    title: 'Sort by last modified',
    text: 'Newest',
    onClick: toggleSort,
  });

  const reloadButton = el(
    'button',
    { className: 'fs-icon-button', type: 'button', title: 'Reload functions', onClick: reload },
    [refreshIcon(16)],
  );

  const closeButton = el(
    'button',
    { className: 'fs-icon-button', type: 'button', title: 'Close', onClick: closeOverlay },
    [closeIcon(18)],
  );

  const header = el('div', { className: 'fs-header' }, [
    el('span', { className: 'fs-brand', text: 'Function Search' }),
    el('label', { className: 'fs-search' }, [searchIcon(16), searchInput]),
    el('span', { className: 'fs-header-spacer' }),
    sortButton,
    reloadButton,
    closeButton,
  ]);

  const progressFill = el('div', { className: 'fs-progress-fill' });
  const progress = el('div', { className: 'fs-progress' }, [progressFill]);
  const categories = el('aside', { className: 'fs-categories' });
  const main = el('section', { className: 'fs-main' });

  const panel = el('div', { className: 'fs-panel' }, [
    header,
    progress,
    el('div', { className: 'fs-body' }, [categories, main]),
  ]);

  const overlay = el('div', { className: 'fs-overlay' }, [panel]);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });
  shadow.appendChild(overlay);

  return {
    host,
    searchInput,
    sortButton,
    reloadButton,
    progress,
    progressFill,
    categories,
    main,
  };
}

export function isOverlayOpen(): boolean {
  return refs !== null;
}

export function openFunctionSearchOverlay(context: CrmContext): void {
  if (refs) {
    refs.searchInput.focus();
    return;
  }

  activeContext = context;
  state = createInitialState();
  refs = buildOverlay();
  document.body.appendChild(refs.host);

  // The overlay lives in an open shadow root, so `document.activeElement` resolves to
  // the shadow host rather than the focused search input. Zoho's own global keyboard
  // shortcuts key off `document.activeElement` to decide whether typing should be
  // treated as a shortcut, so without this it thinks nothing is focused and hijacks
  // keystrokes typed into the search box (e.g. "st" navigates to the Tasks tab).
  // Keyboard events are `composed: true` and cross the shadow boundary, so handle
  // Escape and stop propagation here, at the host, before the event can bubble past
  // it to Zoho's document-level listeners.
  keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeOverlay();
    }
    event.stopPropagation();
  };
  stopPropagationHandler = (event: KeyboardEvent) => event.stopPropagation();
  refs.host.addEventListener('keydown', keydownHandler);
  refs.host.addEventListener('keyup', stopPropagationHandler);
  refs.host.addEventListener('keypress', stopPropagationHandler);

  renderCategories();
  renderMain();
  refs.searchInput.focus();

  startLoad(context);
}

export function closeOverlay(): void {
  if (refs && keydownHandler) {
    refs.host.removeEventListener('keydown', keydownHandler);
  }
  if (refs && stopPropagationHandler) {
    refs.host.removeEventListener('keyup', stopPropagationHandler);
    refs.host.removeEventListener('keypress', stopPropagationHandler);
  }
  keydownHandler = null;
  stopPropagationHandler = null;
  refs?.host.remove();
  refs = null;
  activeContext = null;
}
