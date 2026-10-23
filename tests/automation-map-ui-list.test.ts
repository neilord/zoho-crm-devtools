import { afterEach, describe, expect, it } from 'vitest';
import { filterNodes } from '../src/content/automation-map/graph';
import {
  buildRowData,
  DEFAULT_SORT,
  type DisplayRow,
  flattenRows,
  GROUP_ORG,
  listableNodes,
  measure,
  OVERSCAN,
  sortRows,
  VIRTUALIZE_ABOVE,
  visibleRange,
} from '../src/content/automation-map/ui/list-model';
import { defaultFilters } from '../src/content/automation-map/ui/view-store';
import { click, key, type MountedMap, mountMap, portForInputs } from './automation-map-ui-helpers';
import { fixtureGraph, fixtureInputs, generateLargeInputs } from './fixtures/automation-map';

const graph = fixtureGraph();
const rowsFor = (filters = defaultFilters()) =>
  listableNodes(graph, filterNodes(graph, filters), null).map((n) => buildRowData(graph, n, false));

describe('list model', () => {
  it('excludes module containers and unknown-field buckets', () => {
    const nodes = listableNodes(
      graph,
      filterNodes(graph, { ...defaultFilters(), scope: 'everything' }),
      null,
    );
    expect(nodes.some((n) => n.kind === 'module')).toBe(false);
    expect(nodes.some((n) => n.kind === 'field' && n.bucket !== 'field')).toBe(false);
    expect(nodes.some((n) => n.kind === 'rule')).toBe(true);
  });

  it('follows the filters: scope, module, kind and flag', () => {
    const everything = listableNodes(
      graph,
      filterNodes(graph, { ...defaultFilters(), scope: 'everything' }),
      null,
    );
    const active = listableNodes(graph, filterNodes(graph, defaultFilters()), null);
    expect(everything.length).toBeGreaterThan(active.length);
    const deals = listableNodes(
      graph,
      filterNodes(graph, { ...defaultFilters(), modules: new Set(['Deals']) }),
      null,
    );
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((n) => n.moduleApiName === 'Deals')).toBe(true);
    const functions = listableNodes(
      graph,
      filterNodes(graph, { ...defaultFilters(), kinds: new Set(['function']) }),
      null,
    );
    expect(functions.every((n) => n.kind === 'function')).toBe(true);
    const external = listableNodes(
      graph,
      filterNodes(graph, { ...defaultFilters(), flags: new Set(['callsExternal']) }),
      null,
    );
    expect(external.length).toBeGreaterThan(0);
    expect(
      external.every((n) => (graph.outgoing.get(n.id) ?? []).some((e) => e.kind === 'calls')),
    ).toBe(true);
  });

  it('restricts rows to search hits when given', () => {
    const only = new Set(['rule:rule-003', 'function:f-003']);
    const nodes = listableNodes(
      graph,
      filterNodes(graph, { ...defaultFilters(), scope: 'everything' }),
      only,
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(['function:f-003', 'rule:rule-003']);
  });

  it('sorts by name in both directions, and by module group then kind by default', () => {
    const rows = rowsFor();
    const asc = sortRows(graph, rows, { key: 'name', dir: 1 }, false).map((r) => r.node.label);
    const desc = sortRows(graph, rows, { key: 'name', dir: -1 }, false).map((r) => r.node.label);
    // The comparator is a total order (ties break on id), so descending is exactly reversed.
    expect(desc).toEqual([...asc].reverse());
    expect(asc[0].localeCompare(asc[asc.length - 1])).toBeLessThanOrEqual(0);
    expect(desc[0].localeCompare(desc[desc.length - 1])).toBeGreaterThanOrEqual(0);
    const byModule = sortRows(graph, rows, DEFAULT_SORT, false);
    expect(byModule[0].group).toBe(GROUP_ORG);
    const groups = byModule.map((r) => r.group);
    expect(groups).toEqual([...groups].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)));
  });

  it('sorts by the number of written fields and by status', () => {
    const rows = rowsFor();
    const writes = sortRows(graph, rows, { key: 'writes', dir: -1 }, false);
    expect(writes[0].writes.length).toBeGreaterThanOrEqual(writes[writes.length - 1].writes.length);
    const status = sortRows(graph, rows, { key: 'status', dir: 1 }, false).map(
      (r) => r.status.label,
    );
    expect(status).toEqual([...status].sort((a, b) => a.localeCompare(b)));
  });

  it('describes rows in text, including evidence tiers for writes', () => {
    const rule = rowsFor().find((r) => r.node.id === 'rule:rule-003');
    expect(rule?.entry).toMatch(/Stage is modified/);
    expect(rule?.status.label).toBe('Active');
    const fn = rowsFor().find((r) => r.node.id === 'function:f-003');
    expect(fn?.writes.some((w) => w.tier === 'exact')).toBe(true);
    expect(fn?.status.label).toBe('Analysed');
  });

  it('flattens groups, honours collapsed groups and adds one row per expanded link', () => {
    const rows = sortRows(graph, rowsFor(), DEFAULT_SORT, false);
    const flat = flattenRows({
      graph,
      rows,
      sort: DEFAULT_SORT,
      expanded: new Set(),
      collapsedGroups: new Set(),
      teaser: false,
    });
    expect(flat.filter((r) => r.type === 'group').length).toBeGreaterThan(1);
    const collapsed = flattenRows({
      graph,
      rows,
      sort: DEFAULT_SORT,
      expanded: new Set(),
      collapsedGroups: new Set(['Deals']),
      teaser: false,
    });
    expect(collapsed.length).toBeLessThan(flat.length);
    expect(collapsed.some((r) => r.type === 'group' && r.group === 'Deals' && r.collapsed)).toBe(
      true,
    );
    const expanded = flattenRows({
      graph,
      rows,
      sort: DEFAULT_SORT,
      expanded: new Set(['rule:rule-003']),
      collapsedGroups: new Set(),
      teaser: false,
    });
    const edgeRows = expanded.filter(
      (r): r is Extract<DisplayRow, { type: 'edge' }> => r.type === 'edge',
    );
    expect(edgeRows.length).toBeGreaterThan(0);
    expect(edgeRows.every((r) => r.owner === 'rule:rule-003')).toBe(true);
    expect(edgeRows.some((r) => r.dir === 'reaches' && r.first)).toBe(true);
  });

  it('does not group when sorted by another column', () => {
    const rows = sortRows(graph, rowsFor(), { key: 'name', dir: 1 }, false);
    const flat = flattenRows({
      graph,
      rows,
      sort: { key: 'name', dir: 1 },
      expanded: new Set(),
      collapsedGroups: new Set(),
      teaser: false,
    });
    expect(flat.every((r) => r.type === 'node')).toBe(true);
  });

  it('windows long lists with overscan and renders short ones whole', () => {
    const many: DisplayRow[] = Array.from({ length: 1000 }, (_, i) => ({
      type: 'more',
      key: `m${i}`,
      owner: 'x',
      dir: 'reaches',
      n: 1,
    }));
    const win = measure(many);
    expect(win.total).toBe(1000 * 32);
    const [start, end] = visibleRange(many, win, 3200, 640);
    expect(start).toBe(100 - OVERSCAN);
    expect(end).toBe(100 + 20 + OVERSCAN);
    expect(
      visibleRange(
        many.slice(0, VIRTUALIZE_ABOVE),
        measure(many.slice(0, VIRTUALIZE_ABOVE)),
        0,
        100,
      ),
    ).toEqual([0, VIRTUALIZE_ABOVE]);
    expect(visibleRange(many, win, 0, 640)[0]).toBe(0);
    expect(visibleRange(many, win, 10_000_000, 640)[1]).toBe(1000);
  });
});

describe('list view', () => {
  let map: MountedMap | null = null;
  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
    history.replaceState(null, '', location.pathname);
  });
  const rows = () => map?.qa('.lt-row') ?? [];

  it('is an accessible treegrid with sortable columns', () => {
    map = mountMap({ initialState: { view: 'list' } });
    const grid = map.q('[role="treegrid"]') as HTMLElement;
    expect(grid.getAttribute('aria-label')).toBe('Automation map as a list');
    expect(Number(grid.getAttribute('aria-rowcount'))).toBeGreaterThan(20);
    expect(map.qa('[role="columnheader"]').length).toBe(8);
    expect(map.q('[role="columnheader"][aria-sort="ascending"]')?.textContent).toBe('Module');
    expect(rows()[0].getAttribute('aria-rowindex')).toMatch(/^\d+$/);
    expect(rows()[0].getAttribute('role')).toBe('row');
    expect(rows()[0].querySelectorAll('[role="gridcell"]')).toHaveLength(8);
  });

  it('sorts by clicking a header and reverses on a second click', () => {
    map = mountMap({ initialState: { view: 'list' } });
    click(map.q('[data-fk="sort:name"]'));
    expect(map.q('[role="columnheader"][aria-sort="ascending"]')?.textContent).toBe('Name');
    expect(map.q('.lt-group')).toBeNull();
    const names = rows().map((r) => r.querySelector('.nm b')?.textContent ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    click(map.q('[data-fk="sort:name"]'));
    expect(map.q('[role="columnheader"][aria-sort="descending"]')?.textContent).toBe('Name');
    const desc = rows().map((r) => r.querySelector('.nm b')?.textContent ?? '');
    expect(desc[0].localeCompare(desc[desc.length - 1])).toBeGreaterThanOrEqual(0);
  });

  it('filters to search hits and says so when nothing matches', async () => {
    map = mountMap({ initialState: { view: 'list', query: 'maintain_deals' } });
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => /maintain_deals/i.test(r.textContent ?? ''))).toBe(true);
    map.handle.close();
    map = mountMap({ initialState: { view: 'list', query: 'zzzz-not-here' } });
    expect(map.q('.lt-empty h3')?.textContent).toContain('No matches for "zzzz-not-here"');
  });

  it('shows a clear action when the filters hide everything', () => {
    map = mountMap({
      initialState: {
        view: 'list',
        filters: { ...defaultFilters(), modules: new Set(['Deals']), kinds: new Set(['schedule']) },
      },
    });
    expect(map.q('.lt-empty h3')?.textContent).toBe('Nothing matches these filters');
    click(map.qa('.lt-empty button').find((b) => b.textContent === 'Clear filters'));
    expect(rows().length).toBeGreaterThan(0);
  });

  it('moves with the arrow keys, expands with right and collapses with left', () => {
    map = mountMap({ initialState: { view: 'list' } });
    const grid = map.q('[role="treegrid"]') as HTMLElement;
    grid.focus();
    const active = () => grid.getAttribute('aria-activedescendant');
    const first = active();
    expect(first).toBeTruthy();
    key(grid, 'ArrowDown');
    key(grid, 'ArrowDown');
    expect(active()).not.toBe(first);
    expect(map.q('.lt-row.active, .lt-group.active')).not.toBeNull();
    // move to the first expandable node row
    let guard = 0;
    while (!map.q('.lt-row.active .exp') && guard++ < 10) key(grid, 'ArrowDown');
    const before = map.qa('.lt-edge').length;
    key(grid, 'ArrowRight');
    expect(map.qa('.lt-edge').length).toBeGreaterThan(before);
    expect(map.q('.lt-row.active')?.getAttribute('aria-expanded')).toBe('true');
    key(grid, 'ArrowLeft');
    expect(map.qa('.lt-edge').length).toBe(before);
  });

  it('opens the inspector with Enter and shows the node on the board with B', () => {
    map = mountMap({ initialState: { view: 'list' } });
    const grid = map.q('[role="treegrid"]') as HTMLElement;
    grid.focus();
    let guard = 0;
    while (!map.q('.lt-row.active') && guard++ < 6) key(grid, 'ArrowDown');
    key(grid, 'Enter');
    expect(map.q('.am-insp.open')).not.toBeNull();
    expect(map.q('.lt-row[aria-selected="true"]')).not.toBeNull();
    key(grid, 'b');
    expect(map.recorded.store().get().view).toBe('board');
  });

  it('collapses a module group from its header', () => {
    map = mountMap({ initialState: { view: 'list' } });
    const header = map
      .qa('.lt-group')
      .find((g) => g.textContent?.startsWith('Deals')) as HTMLElement;
    const before = rows().length;
    click(header);
    expect(rows().length).toBeLessThan(before);
    expect(
      map
        .qa('.lt-group')
        .find((g) => g.textContent?.startsWith('Deals'))
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('virtualizes about 2,500 nodes: few rows in the DOM, full count in ARIA', () => {
    const { port, graph: big } = portForInputs(generateLargeInputs());
    const total = listableNodes(
      big,
      filterNodes(big, { ...defaultFilters(), scope: 'everything' }),
      null,
    ).length;
    expect(total).toBeGreaterThan(2000);
    map = mountMap({
      port,
      initialState: {
        view: 'list',
        filters: { ...defaultFilters(), scope: 'everything' },
      },
    });
    const dom = map.qa('.lt-row, .lt-group, .lt-edge').length;
    expect(dom).toBeGreaterThan(10);
    expect(dom).toBeLessThan(120);
    expect(Number(map.q('[role="treegrid"]')?.getAttribute('aria-rowcount'))).toBeGreaterThan(
      total,
    );
    expect(Number.parseInt((map.q('.lt-spacer') as HTMLElement).style.height, 10)).toBeGreaterThan(
      total * 30,
    );
  });
});

describe('board and accessible twin filter agreement', () => {
  it.each([
    'module',
    'trigger',
    'flag',
    'combined',
  ] as const)('uses the same reached nodes for %s filters', async (kind) => {
    const { buildBoardModel } = await import('../src/content/automation-map/ui/canvas/model');
    const { computeVisibility } = await import(
      '../src/content/automation-map/ui/canvas/visibility'
    );
    const { deriveModel } = await import('../src/content/automation-map/ui/model');
    const { defaultViewState } = await import('../src/content/automation-map/ui/view-store');
    const { port, snapshot } = portForInputs(fixtureInputs());
    const filters = {
      ...defaultFilters(),
      modules: new Set(kind === 'module' || kind === 'combined' ? ['Deals'] : []),
      triggerTypes: new Set<'field_update'>(
        kind === 'trigger' || kind === 'combined' ? ['field_update'] : [],
      ),
      flags: new Set<'writesFields'>(
        kind === 'flag' || kind === 'combined' ? ['writesFields'] : [],
      ),
    };
    const board = buildBoardModel(snapshot.graph, computeVisibility(snapshot.graph, filters), {
      includeLoose: false,
    });
    const model = deriveModel(port, snapshot, { ...defaultViewState(), filters });
    const expected = listableNodes(snapshot.graph, new Set(board.byNode.keys()), null)
      .map((n) => n.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(
      listableNodes(snapshot.graph, model.visible, null)
        .map((n) => n.id)
        .sort(),
    ).toEqual(expected);
    if (kind === 'module')
      expect(expected.some((id) => snapshot.graph.nodes.get(id)?.kind === 'function')).toBe(true);
  });
});
