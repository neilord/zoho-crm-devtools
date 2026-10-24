/** Header (UX spec §3): brand, view tabs, global search, coverage pill + gaps popover, help, close. */
import type { CoverageState } from '../types';
import type { RegionEnv } from './actions';
import type { MapView } from './context';
import { button, debounce, el, text } from './dom';
import { updatedAgo } from './format';
import { mapIcon } from './icons';
import { type CoverageView, coverageView, type ShellModel } from './model';
import { upgradeButton } from './parts';

/** Longer than a typist's key cadence, so a burst of keys commits once; Enter commits at once. */
export const SEARCH_DEBOUNCE_MS = 160;
const SHOWN_FAILURES = 3;
const FULL_PLACEHOLDER = 'Search rules, functions, fields, templates, webhooks and code…';
/** The preview reads one flow in full: it can search that, not the whole org's code. */
const PREVIEW_PLACEHOLDER = 'Search the flow in this preview…';

export interface Header {
  el: HTMLElement;
  search: HTMLInputElement;
  filtersButton: HTMLButtonElement;
  help: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  update(m: ShellModel): void;
  /** Keeps the box in step with a query changed elsewhere (deep link, results back button). */
  syncQuery(query: string, force?: boolean): void;
  setCounter(label: string): void;
  focusSearch(): void;
  dispose(): void;
}

const TABS: Array<{
  view: 'fields' | 'board' | 'list';
  label: string;
  tip: string;
  icon: 'field' | 'board' | 'list';
}> = [
  { view: 'fields', label: 'Fields', tip: 'Field lens (F)', icon: 'field' },
  { view: 'board', label: 'Board', tip: 'Board (B)', icon: 'board' },
  { view: 'list', label: 'List', tip: 'List (L)', icon: 'list' },
];

export function createHeader(env: RegionEnv): Header {
  const { actions } = env;
  const preview = el('span', { className: 'am-chip-preview', text: 'Preview' });
  preview.hidden = true;

  const filtersButton = el(
    'button',
    {
      className: 'wf-btn am-filterbtn',
      type: 'button',
      attrs: { 'aria-label': 'Filters', 'aria-controls': 'am-rail', 'aria-expanded': 'false' },
    },
    [mapIcon('filter', 13), text(' Filters')],
  );

  const tabs = TABS.map((t) =>
    el(
      'button',
      {
        type: 'button',
        title: t.tip,
        attrs: {
          'aria-pressed': 'false',
          'data-view': t.view,
          'data-fk': `view:${t.view}`,
          'aria-label': t.label,
        },
        onClick: () => actions.setView(t.view),
      },
      [mapIcon(t.icon, 15), el('span', { className: 'lbl', text: t.label })],
    ),
  );
  const seg = el(
    'div',
    { className: 'am-seg', attrs: { role: 'group', 'aria-label': 'View' } },
    tabs,
  );
  seg.style.setProperty('--n', String(TABS.length));

  const input = el('input', {
    attrs: {
      type: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: FULL_PLACEHOLDER,
      'aria-label': 'Search the map',
      'aria-keyshortcuts': '/',
    },
  });
  // At 1100px and below the search box is too narrow for the full prompt (UX spec §3).
  const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 1100px)') : null;
  let previewing = false;
  const applyPlaceholder = () => {
    input.placeholder = narrow?.matches
      ? 'Search…'
      : previewing
        ? PREVIEW_PLACEHOLDER
        : FULL_PLACEHOLDER;
  };
  applyPlaceholder();
  narrow?.addEventListener?.('change', applyPlaceholder);
  const counter = el('span', { className: 'cnt', attrs: { 'aria-live': 'polite' } });
  const clear = el(
    'button',
    { className: 'x', type: 'button', attrs: { 'aria-label': 'Clear search' } },
    [mapIcon('close', 14)],
  );
  const slash = el('span', { className: 'kbd', text: '/', attrs: { 'aria-hidden': 'true' } });
  const searchBox = el('label', { className: 'am-search' }, [
    mapIcon('search', 16),
    input,
    counter,
    clear,
    slash,
  ]);

  // Leading edge: one keystroke after idle renders at once; a burst settles on the trailing edge.
  const commit = debounce((value: string) => actions.setQuery(value), SEARCH_DEBOUNCE_MS, {
    leading: true,
  });
  const refreshHas = () => searchBox.classList.toggle('has', input.value !== '');
  input.addEventListener('input', () => {
    refreshHas();
    commit(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Flush so Enter steps through the matches for what is on screen.
      commit.flush();
    } else if (e.key === 'Escape' && input.value) {
      // First Esc clears the text; the shell's ladder sees the box already empty next time.
      e.preventDefault();
      e.stopPropagation();
      commit.cancel();
      input.value = '';
      refreshHas();
      actions.setQuery('');
    } else if (e.key === 'ArrowDown') {
      const first = env.root.querySelector<HTMLElement>('.ritem');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  clear.addEventListener('click', () => {
    commit.cancel();
    input.value = '';
    refreshHas();
    actions.setQuery('');
    input.focus();
  });

  const upgrade = upgradeButton(env);
  upgrade.hidden = true;
  const indexWrap = el('div', { className: 'wf-index' });
  const help = el(
    'button',
    {
      className: 'fs-icon-button',
      type: 'button',
      title: 'Keyboard shortcuts (?)',
      attrs: { 'aria-label': 'Keyboard shortcuts', 'aria-haspopup': 'dialog' },
      onClick: () => actions.toggleKeys(),
    },
    [mapIcon('keyboard', 16)],
  );
  const closeButton = el(
    'button',
    {
      className: 'fs-icon-button',
      type: 'button',
      title: 'Close (Esc)',
      attrs: { 'aria-label': 'Close Automation Map', 'data-act': 'close' },
    },
    [mapIcon('close', 16)],
  );

  const root = el('header', { className: 'am-head' }, [
    el('h2', { className: 'am-brand', attrs: { id: 'am-title' } }, [
      el('span', { className: 'logo' }, [mapIcon('map', 15)]),
      text('Automation Map'),
    ]),
    preview,
    filtersButton,
    seg,
    searchBox,
    el('span', { className: 'am-sp' }),
    upgrade,
    indexWrap,
    help,
    closeButton,
  ]);

  let pillSig = '';
  const update = (m: ShellModel) => {
    preview.hidden = !m.teaser;
    upgrade.hidden = !m.teaser;
    if (previewing !== m.teaser) {
      previewing = m.teaser;
      applyPlaceholder();
    }
    const view: MapView = m.state.view === 'trace' ? 'board' : m.state.view;
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
    // The sliding indicator reads the active index (CSS transform only).
    seg.style.setProperty(
      '--i',
      String(
        Math.max(
          0,
          TABS.findIndex((t) => t.view === view),
        ),
      ),
    );
    filtersButton.hidden = false;
    const cov = m.access === 'checking' ? null : coverageView(m.snapshot);
    const sig = JSON.stringify([
      m.access,
      m.teaser,
      env.ui.coverageOpen,
      cov,
      m.snapshot.coverage.failures.map((f) => f.id),
      m.snapshot.coverage.refreshing,
      // The age label is minute-granular, so only a minute boundary needs a rebuild.
      env.ui.coverageOpen ? updatedAgo(m.snapshot.coverage.lastRevalidatedAt) : null,
      m.snapshot.access,
      JSON.stringify(m.snapshot.coverage.functions),
      JSON.stringify([
        m.snapshot.coverage.rules,
        m.snapshot.coverage.buttons,
        m.snapshot.coverage.schedules,
        m.snapshot.coverage.blueprints,
        m.snapshot.coverage.approvals,
      ]),
    ]);
    if (sig === pillSig) return;
    pillSig = sig;
    indexWrap.replaceChildren(...buildIndex(env, m, cov));
    // The popover may have held focus (a Retry button) when the snapshot changed.
  };

  let syncedQuery: string | undefined;
  return {
    el: root,
    search: input,
    filtersButton,
    help,
    closeButton,
    update,
    syncQuery(query, force = false) {
      // Coverage/index readiness can publish while the input debounce is still pending.
      if (!force && query === syncedQuery) return;
      syncedQuery = query;
      if (input.value === query) return;
      commit.cancel();
      input.value = query;
      refreshHas();
    },
    setCounter(label) {
      counter.textContent = label;
    },
    focusSearch() {
      input.focus();
      input.select();
    },
    dispose() {
      commit.cancel();
      narrow?.removeEventListener?.('change', applyPlaceholder);
    },
  };
}

/* ---------- coverage pill ---------- */

function fill(percent: number): HTMLElement {
  const bar = el('i');
  bar.style.width = `${percent}%`;
  return bar;
}

function buildIndex(env: RegionEnv, m: ShellModel, cov: CoverageView | null): Node[] {
  const { actions, ui } = env;
  const toggle = (e: Event) => {
    e.stopPropagation();
    actions.setCoverageOpen(!ui.coverageOpen);
  };
  const attrs = {
    'aria-expanded': String(ui.coverageOpen),
    'aria-haspopup': 'dialog',
    'data-fk': 'coverage-pill',
  };
  if (m.access === 'checking' || !cov)
    return [
      el('span', { className: 'wf-pill', attrs: { role: 'status' } }, [
        mapIcon('refresh', 13, 'spin'),
        text(' Checking your plan…'),
      ]),
    ];
  if (m.teaser)
    return [
      el('button', { className: 'wf-pill pro', type: 'button', onClick: toggle, attrs }, [
        mapIcon('lock', 13),
        text(' Preview'),
      ]),
      ...(ui.coverageOpen ? [teaserPopover(env, m)] : []),
    ];
  let pill: HTMLElement;
  switch (cov.status) {
    case 'loading':
      pill = el('button', { className: 'wf-pill', type: 'button', onClick: toggle, attrs }, [
        mapIcon('refresh', 13, 'spin'),
        text(` Mapping ${cov.percent}%`),
        el('span', { className: 'mini' }, [fill(cov.percent)]),
      ]);
      break;
    case 'gaps':
      pill = el('button', { className: 'wf-pill warn', type: 'button', onClick: toggle, attrs }, [
        mapIcon('warn', 13),
        text(` Mapped · ${cov.gaps} gap${cov.gaps === 1 ? '' : 's'}`),
      ]);
      break;
    case 'failed':
      pill = el('button', { className: 'wf-pill bad', type: 'button', onClick: toggle, attrs }, [
        mapIcon('warn', 13),
        text(' Map failed'),
      ]);
      break;
    case 'stopped':
      pill = el('button', { className: 'wf-pill warn', type: 'button', onClick: toggle, attrs }, [
        mapIcon('warn', 13),
        text(' Mapping stopped'),
      ]);
      break;
    default:
      pill = el('button', { className: 'wf-pill ok', type: 'button', onClick: toggle, attrs }, [
        mapIcon('check', 13),
        text(m.snapshot.coverage.refreshing ? ' Mapped · refreshing…' : ' Mapped'),
      ]);
  }
  return [pill, ...(ui.coverageOpen ? [popover(env, m, cov)] : [])];
}

function teaserPopover(env: RegionEnv, m: ShellModel): HTMLElement {
  return el(
    'div',
    { className: 'wf-pop', attrs: { role: 'dialog', 'aria-label': 'Preview coverage' } },
    [
      el('h4', { text: 'Preview' }),
      el('p', {
        className: 'sub',
        text: `This preview is built from your rule list and function catalogue, plus ${
          m.flowsShown === 1 ? 'one flow' : m.flowsShown ? `${m.flowsShown} flows` : 'a flow'
        } loaded in full. Nothing else is read until you upgrade.`,
      }),
      el('div', { className: 'foot' }, [
        el('span', { className: 'footnote', text: 'Automation Map is a Pro feature' }),
        upgradeButton(env),
      ]),
    ],
  );
}

function row(
  label: string,
  done: number,
  total: number,
  notes: string[] = [],
  warn = false,
  num?: string,
  info: string[] = [],
): HTMLElement {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
  return el('div', { className: 'cov' }, [
    el('span', { className: 'lbl', text: label }),
    el(
      'span',
      {
        className: `bar${done >= total && !warn ? ' done' : ''}`,
        attrs: {
          role: 'progressbar',
          'aria-label': label,
          'aria-valuemin': '0',
          'aria-valuemax': String(total),
          'aria-valuenow': String(done),
        },
      },
      [fill(pct)],
    ),
    el('span', { className: 'num', text: num ?? `${done}/${total}` }),
    ...notes.map((n) => el('span', { className: 'gap', text: n })),
    ...info.map((n) => el('span', { className: 'gap info', text: n })),
  ]);
}

/** Entry-point lists load as a unit, so they report a state and a count, not a fraction. */
function listRow(
  label: string,
  parts: ReadonlyArray<{
    loaded: number;
    failed: number;
    unsupported?: number;
    state: CoverageState;
  }>,
): HTMLElement {
  const sum = (pick: (p: (typeof parts)[number]) => number) =>
    parts.reduce((n, p) => n + pick(p), 0);
  const loaded = sum((p) => p.loaded);
  // A whole-list failure reports no per-read count: it still counts as one thing that failed.
  const failed = sum((p) => p.failed || (p.state === 'failed' ? 1 : 0));
  // Zoho says some modules have no such configuration: say so, without calling it a fault.
  const unsupported = sum((p) => p.unsupported ?? 0);
  const busy = parts.some((p) => p.state === 'loading');
  const notRead = parts.every((p) => p.state === 'not-requested');
  // "0 loaded" under a full bar read as a contradiction: nothing there is a result, not a fault.
  const num = busy
    ? 'loading…'
    : notRead
      ? 'not read'
      : loaded === 0 && !failed
        ? unsupported
          ? 'none loaded'
          : 'none in this org'
        : `${loaded} loaded`;
  return row(
    label,
    busy ? 0 : 1,
    1,
    failed ? [`${failed} could not be loaded`] : [],
    failed > 0,
    num,
    !busy && unsupported ? [`${unsupported} not supported by Zoho`] : [],
  );
}

function popover(env: RegionEnv, m: ShellModel, cov: CoverageView): HTMLElement {
  const c = m.snapshot.coverage;
  const f = c.functions;
  const total = c.rules.total ?? c.rules.listed;
  const notes: string[] = [];
  if (f.limited)
    notes.push(`${f.limited} function${f.limited === 1 ? '' : 's'} only partly analysed`);
  if (f.unsupported) notes.push(`${f.unsupported} not supported by the analyser`);
  if (f.sourceUnavailable || f.failed)
    notes.push(`${f.sourceUnavailable} source unavailable · ${f.failed} could not be parsed`);
  const done = !cov.loading;
  const failures = c.failures;
  // The detail scrolls; the footer (gap total, Refresh now) stays in view however long it grows.
  return el(
    'div',
    { className: 'wf-pop split', attrs: { role: 'dialog', 'aria-label': 'Map coverage' } },
    [
      el('div', { className: 'pop-body' }, [
        el('h4', { text: done ? 'Map coverage' : 'Building the map' }),
        el('p', {
          className: 'sub',
          text: done
            ? 'Everything Zoho returned is on the map. Items below could not be read or fully analysed.'
            : 'Rule names and modules are on the map now. Actions, functions and field writes are added as they load.',
        }),
        row('Workflow rules', c.rules.listed, total),
        row(
          'Rule details',
          c.rules.detailed + c.rules.failed,
          c.rules.listed,
          c.rules.failed
            ? [`${c.rules.failed} rule${c.rules.failed === 1 ? '' : 's'} could not be loaded`]
            : [],
          c.rules.failed > 0,
        ),
        row('Functions', f.listed, f.listed),
        row('Code analysed', f.analyzed, f.listed, done ? notes : [], notes.length > 0 && done),
        listRow('Buttons & schedules', [c.buttons, c.schedules]),
        listRow('Blueprints & approvals', [c.blueprints, c.approvals]),
        failures.length
          ? el('ul', { className: 'failures' }, [
              ...failures
                .slice(0, SHOWN_FAILURES)
                .map((fail) =>
                  el('li', {}, [
                    el('span', { text: fail.message }),
                    button(
                      'wf-btn',
                      'Retry',
                      () => env.actions.retry(fail.id),
                      [mapIcon('refresh', 12)],
                      { attrs: { 'data-fk': `retry:${fail.id}` } },
                    ),
                  ]),
                ),
              // A large org can fail over a hundred identical reads; the list must not bury the footer.
              failures.length > SHOWN_FAILURES
                ? el('li', {
                    className: 'more',
                    text: `${failures.length - SHOWN_FAILURES} more could not be read. Retry failed tries them all.`,
                  })
                : null,
            ])
          : null,
      ]),
      el('div', { className: 'pop-foot' }, [
        el('div', { className: 'foot' }, [
          el('span', {
            className: 'footnote',
            text: done
              ? `${cov.gaps} gap${cov.gaps === 1 ? '' : 's'}${c.refreshing ? ' · refreshing…' : ''}`
              : 'Runs in this tab; nothing leaves your browser',
          }),
          failures.length > 1
            ? button(
                'wf-btn',
                'Retry failed',
                () => env.actions.retry(),
                [mapIcon('refresh', 13)],
                {
                  attrs: { 'data-fk': 'retry-all' },
                },
              )
            : null,
        ]),
        el('div', { className: 'foot fresh' }, [
          el('span', {
            className: 'footnote',
            text: c.refreshing
              ? 'Refreshing…'
              : (updatedAgo(c.lastRevalidatedAt) ?? 'Not refreshed yet'),
          }),
          button(
            'wf-btn',
            'Refresh now',
            () => env.actions.refreshMap(),
            [mapIcon('refresh', 13)],
            {
              disabled: c.refreshing,
              title: 'Re-read your Zoho configuration now',
              attrs: { 'data-fk': 'refresh-now' },
            },
          ),
        ]),
      ]),
    ],
  );
}
