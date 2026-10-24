/** List twin (UX spec §8): an accessible, sortable, windowed treegrid of the filtered graph. */
import type { MapNode, MapNodeId, TeaserFog } from '../types';
import type { RegionEnv } from './actions';
import { el, marked, observeResize, text } from './dom';
import { fogCountsText, quietNote, summarizeFog } from './fog-model';
import { evidenceTier, nodeName, TIER_LABEL } from './format';
import { mapIcon } from './icons';
import { KIND_COLOR, nodeIcon } from './kinds';
import {
  buildRowData,
  type DisplayRow,
  flattenRows,
  listableNodes,
  measure,
  type SortKey,
  sortRows,
  visibleRange,
  type Windowing,
} from './list-model';
import { graphVersion, type ShellModel } from './model';
import { badge, emptyState, LOCKED_AREAS_SHOWN, statusMark, upgradeButton } from './parts';

export interface ListView {
  el: HTMLElement;
  update(m: ShellModel): void;
  /** Mirrors an external selection change without rebuilding rows. */
  syncSelection(selectedId: MapNodeId | null, reveal: boolean): void;
  reset(): void;
  dispose(): void;
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'kind', label: 'Kind' },
  { key: 'name', label: 'Name' },
  { key: 'module', label: 'Module' },
  { key: 'entry', label: 'Entry / trigger' },
  { key: 'reaches', label: 'Reaches' },
  { key: 'writes', label: 'Writes' },
  { key: 'status', label: 'Status' },
];
const FALLBACK_VIEWPORT = 640;
const HEAD_HEIGHT = 36;
/** Three chips do not fit the Writes column at the design width, so two plus a count. */
const WRITE_CHIPS = 2;

export function createListView(env: RegionEnv): ListView {
  const { ui } = env;
  const head = el('div', { className: 'lt-head', attrs: { role: 'row', 'aria-rowindex': '1' } });
  const spacer = el('div', { className: 'lt-spacer', attrs: { role: 'rowgroup' } });
  const tail = el('div', { className: 'lt-tail' });
  // The scroller holds the sticky header and the rows, so their columns line up exactly.
  const body = el('div', { className: 'lt-body', attrs: { role: 'presentation' } }, [
    head,
    spacer,
    tail,
  ]);
  const emptyHost = el('div', { className: 'lt-empty' });
  const grid = el(
    'div',
    {
      className: 'lt-grid',
      attrs: {
        role: 'treegrid',
        tabindex: '0',
        'data-focus-target': 'grid',
        'aria-label': 'Automation map as a list',
        'aria-multiselectable': 'false',
      },
    },
    [body, emptyHost],
  );
  const root = el('div', { className: 'am-view am-list', attrs: { id: 'am-list' } }, [grid]);

  let model: ShellModel | null = null;
  let rows: DisplayRow[] = [];
  let win: Windowing = { offsets: [], total: 0 };
  let activeKey: string | null = null;
  let selectedId: MapNodeId | null = null;
  let sig = '';
  let frame = 0;
  const rendered = new Map<string, { el: HTMLElement; sig: string }>();

  const clearRendered = () => {
    for (const entry of rendered.values()) entry.el.remove();
    rendered.clear();
  };
  const viewport = () => Math.max(120, (body.clientHeight || FALLBACK_VIEWPORT) - HEAD_HEIGHT);
  const stopResize = observeResize(body, () => paint());

  /* ---- header ---- */
  const renderHead = () => {
    const cells: Node[] = [el('span', { attrs: { role: 'columnheader', 'aria-label': 'Expand' } })];
    for (const col of COLUMNS) {
      const sorted = ui.list.sort.key === col.key;
      cells.push(
        el(
          'span',
          {
            attrs: {
              role: 'columnheader',
              'aria-sort': sorted ? (ui.list.sort.dir > 0 ? 'ascending' : 'descending') : 'none',
            },
          },
          [
            el('button', {
              type: 'button',
              text: col.label,
              attrs: { 'data-fk': `sort:${col.key}` },
              onClick: () => {
                ui.list.sort =
                  ui.list.sort.key === col.key
                    ? { key: col.key, dir: ui.list.sort.dir > 0 ? -1 : 1 }
                    : { key: col.key, dir: 1 };
                env.actions.refresh();
              },
            }),
          ],
        ),
      );
    }
    head.replaceChildren(...cells);
  };

  /* ---- rows ---- */
  const indexOfKey = (key: string | null) => (key ? rows.findIndex((r) => r.key === key) : -1);

  const nameCell = (m: ShellModel, node: MapNode): HTMLElement => {
    const query = m.parsed.text;
    const api =
      node.kind === 'function'
        ? node.apiName
        : node.kind === 'field'
          ? `${node.moduleApiName}.${node.fieldApiName}`
          : null;
    return el('span', { className: 'nm', attrs: { role: 'gridcell' } }, [
      el('b', {}, marked(nodeName(m.graph, node, m.teaser), query)),
      api ? el('span', { className: 'api', text: api }) : null,
    ]);
  };

  const buildNodeRow = (m: ShellModel, row: Extract<DisplayRow, { type: 'node' }>): HTMLElement => {
    const { data } = row;
    const node = data.node;
    const cell = (className: string, children: Array<Node | null> = [], title?: string) =>
      el('span', { className, attrs: { role: 'gridcell' }, title }, children);
    const expand = row.canExpand
      ? el(
          'button',
          {
            className: 'exp',
            type: 'button',
            attrs: {
              tabindex: '-1',
              'aria-label': `${row.expanded ? 'Collapse' : 'Expand'} links`,
              'aria-expanded': String(row.expanded),
            },
            onClick: (e) => {
              e.stopPropagation();
              toggleExpanded(node.id);
            },
          },
          [mapIcon('chevronR', 14)],
        )
      : null;
    const writes = data.writes.slice(0, WRITE_CHIPS).map((w) =>
      el(
        'span',
        {
          className: `fchip ${w.tier === 'exact' ? 'ex' : w.tier === 'partial' ? 'pa' : w.tier === 'unresolved' ? 'ur' : ''}`,
          title: `${w.title} · ${TIER_LABEL[w.tier]}`,
        },
        [
          el('span', { className: 'fchip-t', text: w.label }),
          el('span', { className: 'sr-only', text: ` (${TIER_LABEL[w.tier]})` }),
        ],
      ),
    );
    if (data.writes.length > WRITE_CHIPS)
      writes.push(
        el('span', { className: 'fchip more', text: `+${data.writes.length - WRITE_CHIPS}` }),
      );
    const mark = statusMark(data.status);
    return el(
      'div',
      {
        className: 'lt-row',
        attrs: { role: 'row', 'aria-level': '2' },
        dataset: { id: node.id },
      },
      [
        cell('c exp-c', [expand]),
        cell('kd', [
          (() => {
            const ic = el('span', { className: 'ic' }, [nodeIcon(node, 13)]);
            return ic;
          })(),
          text(data.kindLabel),
        ]),
        nameCell(m, node),
        cell('c', [
          data.moduleBadge
            ? badge(data.moduleBadge)
            : el('span', { className: 'muted', text: '—' }),
        ]),
        cell('c', [text(data.entry)], data.entry),
        cell('c', [text(data.reaches)]),
        cell('c wr', writes),
        cell('stc', [mark, text(data.status.label)]),
      ],
    );
  };

  const buildRow = (m: ShellModel, row: DisplayRow): HTMLElement => {
    switch (row.type) {
      case 'group': {
        const g = el(
          'div',
          {
            className: 'lt-group',
            attrs: { role: 'row', 'aria-level': '1', 'aria-expanded': String(!row.collapsed) },
            dataset: { group: row.group },
          },
          [
            el('span', { className: 'gch', attrs: { role: 'gridcell' } }, [
              mapIcon(row.collapsed ? 'chevronR' : 'chevron', 14),
            ]),
            el('span', { attrs: { role: 'gridcell' } }, [
              text(row.label),
              el('span', {
                className: 'n',
                text: ` ${row.count} item${row.count === 1 ? '' : 's'}`,
              }),
            ]),
          ],
        );
        return g;
      }
      case 'node':
        return buildNodeRow(m, row);
      case 'edge': {
        const other = row.other;
        const tier = evidenceTier(row.edge);
        const link = el(
          'button',
          {
            type: 'button',
            attrs: { tabindex: '-1' },
            onClick: (e) => {
              e.stopPropagation();
              env.actions.select(other.id);
            },
          },
          [text(nodeName(m.graph, other, m.teaser))],
        );
        const holder = el('span', { className: 'tg', attrs: { role: 'gridcell' } }, [
          el('span', { className: 'ic mini' }, [nodeIcon(other, 12)]),
          link,
          row.edge.kind === 'cascades' ? badge('cascade') : null,
          row.edge.evidence !== 'declared' ? badge(TIER_LABEL[tier].toLowerCase()) : null,
        ]);
        holder.style.setProperty('--k', `var(${KIND_COLOR[other.kind]})`);
        return el('div', { className: 'lt-edge', attrs: { role: 'row', 'aria-level': '3' } }, [
          el('span', { attrs: { role: 'gridcell' } }),
          el('span', {
            className: 'dir',
            attrs: { role: 'gridcell' },
            text: row.first ? (row.dir === 'reaches' ? 'Reaches' : 'Reached by') : '',
          }),
          holder,
        ]);
      }
      case 'more':
        return el('div', { className: 'lt-edge more', attrs: { role: 'row', 'aria-level': '3' } }, [
          el('span', { attrs: { role: 'gridcell' } }),
          el('span', { className: 'dir', attrs: { role: 'gridcell' } }),
          el('span', {
            className: 'tg muted',
            attrs: { role: 'gridcell' },
            text: `+${row.n} more ${row.dir === 'reaches' ? 'links' : 'callers'} not shown`,
          }),
        ]);
    }
  };

  const rowSig = (row: DisplayRow, index: number): string => {
    const base = `${index}|${row.key}|${activeKey === row.key}`;
    switch (row.type) {
      case 'node':
        return `${base}|${row.expanded}|${row.data.node.id === selectedId}|${model?.parsed.text ?? ''}|${graphVersion(model?.graph as never)}`;
      case 'group':
        return `${base}|${row.collapsed}|${row.count}`;
      default:
        return base;
    }
  };

  const paint = () => {
    const m = model;
    if (!m) return;
    const [start, end] = visibleRange(rows, win, body.scrollTop, viewport());
    spacer.style.height = `${win.total}px`;
    const keep = new Set<string>();
    const fragment: HTMLElement[] = [];
    for (let i = start; i < end; i++) {
      const row = rows[i];
      keep.add(row.key);
      const s = rowSig(row, i);
      let entry = rendered.get(row.key);
      if (!entry || entry.sig !== s) {
        entry = { el: buildRow(m, row), sig: s };
        rendered.set(row.key, entry);
      }
      const node = entry.el;
      node.style.top = `${win.offsets[i]}px`;
      node.setAttribute('aria-rowindex', String(i + 2));
      node.id = `am-lrow-${i}`;
      const isSel = row.type === 'node' && row.data.node.id === selectedId;
      if (row.type === 'node') {
        node.setAttribute('aria-selected', String(isSel));
        if (row.canExpand) node.setAttribute('aria-expanded', String(row.expanded));
      }
      node.classList.toggle('active', activeKey === row.key);
      node.classList.toggle('alt', row.type === 'node' && i % 2 === 1);
      fragment.push(node);
    }
    for (const [key, entry] of rendered)
      if (!keep.has(key)) {
        entry.el.remove();
        rendered.delete(key);
      }
    // Existing row elements are moved into place, not recreated.
    spacer.replaceChildren(...fragment);
    const active = indexOfKey(activeKey);
    if (active >= start && active < end)
      grid.setAttribute('aria-activedescendant', `am-lrow-${active}`);
    else grid.removeAttribute('aria-activedescendant');
  };

  const schedulePaint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  };
  body.addEventListener('scroll', schedulePaint, { passive: true });

  const toggleExpanded = (id: MapNodeId) => {
    if (!ui.list.expanded.delete(id)) ui.list.expanded.add(id);
    activeKey = `n:${id}`;
    env.actions.refresh();
  };

  const ensureVisible = (index: number) => {
    if (index < 0 || index >= rows.length) return;
    const top = win.offsets[index];
    const bottom = top + (index + 1 < rows.length ? win.offsets[index + 1] - top : 40);
    const view = viewport();
    if (top < body.scrollTop) body.scrollTop = top;
    else if (bottom > body.scrollTop + view) body.scrollTop = bottom - view;
  };

  const setActive = (index: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, index));
    if (!rows[i]) return;
    activeKey = rows[i].key;
    ensureVisible(i);
    paint();
  };

  /* ---- keyboard ---- */
  grid.addEventListener('keydown', (e) => {
    if (e.target !== grid || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!rows.length) return;
    const index = Math.max(0, indexOfKey(activeKey));
    const row = rows[index];
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        handled();
        setActive(index + 1);
        return;
      case 'ArrowUp':
        handled();
        setActive(index - 1);
        return;
      case 'Home':
        handled();
        setActive(0);
        return;
      case 'End':
        handled();
        setActive(rows.length - 1);
        return;
      case 'PageDown':
        handled();
        setActive(index + 10);
        return;
      case 'PageUp':
        handled();
        setActive(index - 10);
        return;
      case 'ArrowRight':
        handled();
        if (row.type === 'group' && row.collapsed) toggleGroup(row.group);
        else if (row.type === 'node' && row.canExpand && !row.expanded)
          toggleExpanded(row.data.node.id);
        return;
      case 'ArrowLeft':
        handled();
        if (row.type === 'node' && row.expanded) toggleExpanded(row.data.node.id);
        else if (row.type === 'group' && !row.collapsed) toggleGroup(row.group);
        else if (row.type === 'node' || row.type === 'edge') {
          // Move to the parent: the owning node or the group header.
          const parentKey = row.type === 'edge' ? `n:${row.owner}` : `g:${row.data.group}`;
          const parent = indexOfKey(parentKey);
          if (parent >= 0) setActive(parent);
        }
        return;
      case 'Enter':
      case ' ':
        handled();
        activate(row);
        return;
    }
    if (e.key.toLowerCase() === 'b' && !e.shiftKey && row.type === 'node') {
      handled();
      env.actions.showOnBoard(row.data.node.id);
    }
  });

  const toggleGroup = (group: string) => {
    if (!ui.list.collapsed.delete(group)) ui.list.collapsed.add(group);
    activeKey = `g:${group}`;
    env.actions.refresh();
  };

  const activate = (row: DisplayRow) => {
    if (row.type === 'group') toggleGroup(row.group);
    else if (row.type === 'node') env.actions.select(row.data.node.id);
    else if (row.type === 'edge') env.actions.select(row.other.id);
  };

  body.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.lt-row, .lt-group');
    if (!target) return;
    const i = Number(target.getAttribute('aria-rowindex')) - 2;
    const row = rows[i];
    if (!row) return;
    activeKey = row.key;
    grid.focus({ preventScroll: true });
    activate(row);
  });
  body.addEventListener('dblclick', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.lt-row');
    const row = target ? rows[Number(target.getAttribute('aria-rowindex')) - 2] : undefined;
    if (row?.type === 'node') env.actions.showOnBoard(row.data.node.id);
  });

  /* ---- update ---- */
  const update = (m: ShellModel) => {
    model = m;
    if (m.access === 'checking') return;
    selectedId = m.state.selectedId;
    const key = JSON.stringify([
      graphVersion(m.graph),
      m.state.filters.scope,
      [...m.filters.modules],
      [...m.filters.kinds],
      [...m.filters.triggerTypes],
      [...m.filters.flags],
      m.parsed.raw,
      ui.list.sort,
      [...ui.list.expanded],
      [...ui.list.collapsed],
      m.teaser,
    ]);
    if (key === sig) {
      paint();
      return;
    }
    sig = key;
    renderHead();
    const nodes = listableNodes(m.graph, m.visible, m.hitIds);
    const data = sortRows(
      m.graph,
      nodes.map((n) => buildRowData(m.graph, n, m.teaser)),
      ui.list.sort,
      m.teaser,
    );
    rows = flattenRows({
      graph: m.graph,
      rows: data,
      sort: ui.list.sort,
      expanded: ui.list.expanded,
      collapsedGroups: ui.list.collapsed,
      teaser: m.teaser,
    });
    win = measure(rows);
    clearRendered();
    grid.setAttribute('aria-rowcount', String(rows.length + 1));
    if (activeKey && indexOfKey(activeKey) < 0) activeKey = null;
    if (!activeKey && selectedId && indexOfKey(`n:${selectedId}`) >= 0)
      activeKey = `n:${selectedId}`;
    if (!activeKey && rows[0]) activeKey = rows[0].key;

    const hasAnything = [...m.graph.nodes.values()].some((n) => n.kind !== 'module');
    emptyHost.replaceChildren();
    tail.replaceChildren();
    if (rows.length === 0) {
      emptyHost.append(emptyView(env, m, hasAnything));
    } else if (m.teaser) {
      const t = m.snapshot.teaser;
      const shownRealItems = nodes.filter((n) => n.kind === 'rule' || n.kind === 'function').length;
      const hidden = t ? Math.max(0, t.totals.rules + t.totals.functions - shownRealItems) : 0;
      tail.append(
        ...(t ? [lockedRows(t)] : []),
        el('div', { className: 'lt-lock' }, [
          mapIcon('lock', 16),
          text(` ${hidden > 0 ? `${hidden} more rules and functions` : 'More items'} in the fog `),
          upgradeButton(env),
        ]),
      );
    }
    emptyHost.hidden = rows.length > 0;
    body.hidden = rows.length === 0;
    paint();
  };

  const syncSelection = (id: MapNodeId | null, reveal: boolean) => {
    selectedId = id;
    if (id && indexOfKey(`n:${id}`) >= 0) {
      activeKey = `n:${id}`;
      if (reveal) ensureVisible(indexOfKey(activeKey));
    }
    paint();
  };

  return {
    el: root,
    update,
    syncSelection,
    reset: () => {
      sig = '';
      rows = [];
      clearRendered();
      tail.replaceChildren();
      emptyHost.replaceChildren();
    },
    dispose: () => {
      stopResize();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

/** At most this many locked areas are listed; the rest are one line. */
const LOCKED_ROWS = LOCKED_AREAS_SHOWN;

/**
 * What the preview does not show, as plainly locked rows rather than blank placeholders: a lock,
 * "In the fog" and the counts, largest first. Counts only (no names exist to leak), no shimmer,
 * and outside the grid's row model, so the keyboard never lands on them.
 */
function lockedRows(fog: TeaserFog): HTMLElement {
  const { areas, quiet } = summarizeFog(fog);
  const notes: HTMLElement[] = [];
  if (areas.length > LOCKED_ROWS)
    notes.push(
      el('div', {
        className: 'lt-fognote',
        text: `${areas.length - LOCKED_ROWS} more ${areas.length - LOCKED_ROWS === 1 ? 'module' : 'modules'} in the fog`,
      }),
    );
  if (quiet > 0) notes.push(el('div', { className: 'lt-fognote', text: quietNote(quiet) }));
  return el('div', { className: 'lt-fog', attrs: { role: 'group', 'aria-label': 'In the fog' } }, [
    ...areas
      .slice(0, LOCKED_ROWS)
      .map((f) =>
        el('div', { className: 'lt-fogrow' }, [
          el('span', { className: 'lk', attrs: { 'aria-hidden': 'true' } }, [mapIcon('lock', 14)]),
          el('b', { text: 'In the fog' }),
          el('span', { className: 'cnt', text: fogCountsText(f) }),
        ]),
      ),
    ...notes,
  ]);
}

function emptyView(env: RegionEnv, m: ShellModel, hasAnything: boolean): HTMLElement {
  const filtered =
    m.state.query.trim() !== '' ||
    m.state.filters.modules.size > 0 ||
    m.state.filters.kinds.size > 0 ||
    m.state.filters.triggerTypes.size > 0 ||
    m.state.filters.flags.size > 0;
  if (!hasAnything) {
    const phase = m.snapshot.phase;
    return phase === 'loading' || phase === 'idle'
      ? emptyState(
          'refresh',
          'Mapping your automation…',
          'Rules and functions appear here as they load.',
        )
      : emptyState(
          'map',
          'No automation yet',
          'This org has no workflow rules, buttons, schedules or API functions to map.',
        );
  }
  if (m.state.query.trim() !== '')
    return emptyState(
      'search',
      `No matches for "${m.state.query.trim()}"`,
      'Nothing in the mapped automation matches this search.',
      [
        el('button', {
          className: 'wf-btn',
          type: 'button',
          text: 'Clear search',
          onClick: () => env.actions.setQuery(''),
        }),
      ],
    );
  return emptyState(
    'filter',
    filtered ? 'Nothing matches these filters' : 'Nothing to show in this scope',
    filtered
      ? 'Clear a filter to see more.'
      : 'Switch to Everything to include inactive automation.',
    filtered
      ? [
          el('button', {
            className: 'wf-btn',
            type: 'button',
            text: 'Clear filters',
            onClick: () => env.actions.clearFilters(),
          }),
        ]
      : [],
  );
}
