import type { CrmContext } from './crm-context';
import { closeIcon, el, searchIcon } from './dom';
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
import { renderCategoryButton, renderDetail, renderEmptyState, renderFunctionRow } from './view';

const HOST_ID = 'zcdt-function-search-overlay';

interface OverlayRefs {
  host: HTMLDivElement;
  searchInput: HTMLInputElement;
  sortButton: HTMLButtonElement;
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
}

let refs: OverlayRefs | null = null;
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
  const counts = getCategoryCounts(state.records);
  const buttons: HTMLElement[] = [
    renderCategoryButton(
      { key: null, label: 'All', count: state.records.length },
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

  if (state.errorMessage) {
    refs.main.replaceChildren(renderEmptyState(state.errorMessage));
    return;
  }

  const selected = state.selectedId
    ? state.records.find((record) => record.summary.id === state.selectedId)
    : null;

  if (selected) {
    refs.main.replaceChildren(
      renderDetail(selected, { onBack: closeDetail, onEdit: editInCrm }, getHighlightQuery()),
    );
    return;
  }

  const visible = getVisibleRecords();
  if (visible.length === 0) {
    const message = state.loading
      ? 'Loading functions…'
      : state.records.length === 0
        ? 'No functions found in this org.'
        : 'No functions match your search.';
    refs.main.replaceChildren(renderEmptyState(message));
    return;
  }

  const highlight = getHighlightQuery();
  const list = el(
    'ul',
    { className: 'fs-list' },
    visible.map((record) => renderFunctionRow(record, openDetail, highlight)),
  );
  refs.main.replaceChildren(list);
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
  renderCategories();
  renderMain();
}

function openDetail(record: FunctionRecord): void {
  state.selectedId = record.summary.id;
  renderMain();
}

function closeDetail(): void {
  state.selectedId = null;
  renderMain();
}

function editInCrm(record: FunctionRecord): void {
  if (record.detail) {
    requestEditInCrm(record.detail);
  }
  closeOverlay();
}

function onSearchInput(value: string): void {
  state.query = value;
  if (!state.selectedId) {
    renderMain();
  }
}

function toggleSort(): void {
  state.sort = state.sort === 'newest' ? 'oldest' : 'newest';
  if (refs) {
    refs.sortButton.textContent = state.sort === 'newest' ? 'Newest' : 'Oldest';
  }
  renderMain();
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

  void loadFunctions(context, {
    onListLoaded(records) {
      state.records = records;
      renderCategories();
      renderMain();
    },
    onDetailProgress(loaded, total) {
      updateProgress(loaded, total);
      if (state.selectedId) {
        renderMain();
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
}
