import { afterEach, describe, expect, it } from 'vitest';
import type {
  AutomationMapSnapshot,
  MapAccess,
  TeaserReason,
} from '../src/content/automation-map/types';
import {
  click,
  everything,
  flush,
  key,
  type MountedMap,
  mountMap,
  mountWithStore,
} from './automation-map-ui-helpers';
import { fixtureGraph } from './fixtures/automation-map';
import { createFixturePort, withSkewedFog } from './fixtures/automation-map-port';

const full = fixtureGraph();
const teaserSnapshot = createFixturePort('teaser').port.snapshot();

/** Everything in the org that the teaser must not name: not in the revealed subgraph. */
function foggedNames(): string[] {
  const revealed = teaserSnapshot.graph.nodes;
  const revealedText = new Set<string>();
  for (const node of revealed.values()) {
    revealedText.add(node.label);
    if (node.kind === 'function' && node.apiName) revealedText.add(node.apiName);
  }
  const names = new Set<string>();
  for (const [id, node] of full.nodes) {
    if (revealed.has(id) || node.kind === 'module') continue;
    names.add(node.label);
    if (node.kind === 'function' && node.apiName) names.add(node.apiName);
    if (node.kind === 'external') names.add(node.key);
    if (node.kind === 'template' && node.subject) names.add(node.subject);
  }
  // Generic words ("Status", "email") double as ordinary UI copy, so only distinctive strings
  // are scanned for. Module names are always scanned: they are labels too, even when a
  // revealed field or function mentions the module.
  const distinctive = (n: string) => n.length >= 8 || /[\s_\d]/.test(n);
  const scanned = [...names].filter((n) => distinctive(n) && !revealedText.has(n));
  for (const mod of full.modules) {
    if (revealed.has(mod.id)) continue;
    scanned.push(mod.label, mod.apiName);
  }
  return [...new Set(scanned)];
}

const fogged = foggedNames();

describe('teaser leak check', () => {
  let map: MountedMap | null = null;
  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
    history.replaceState(null, '', location.pathname);
  });
  const leaks = (m: MountedMap) => {
    const blob = everything(m.shadow);
    return fogged.filter((name) => blob.includes(name));
  };

  it('has real names to look for', () => {
    expect(fogged.length).toBeGreaterThan(40);
    expect(fogged).toEqual(
      expect.arrayContaining(['Leads', 'Quotes', 'Invoices', 'Cases', 'Contacts']),
    );
    expect(fogged.some((n) => /Partner[ _]Reviews/.test(n))).toBe(true);
    expect(fogged.some((n) => n.startsWith('Qualify new enquiries'))).toBe(true);
  });

  const states: Array<[string, Parameters<typeof mountMap>[0]]> = [
    ['fields start', { mode: 'teaser' }],
    [
      'field lens',
      {
        mode: 'teaser',
        initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } },
      },
    ],
    ['list', { mode: 'teaser', initialState: { view: 'list' } }],
    ['board placeholder', { mode: 'teaser', initialState: { view: 'board' } }],
    [
      'trace placeholder',
      { mode: 'teaser', initialState: { view: 'trace', traceRootId: 'rule:rule-003' } },
    ],
    ['search', { mode: 'teaser', initialState: { view: 'list', query: 'review' } }],
    [
      'search for a fogged name',
      { mode: 'teaser', initialState: { view: 'list', query: 'Qualify' } },
    ],
    [
      'rule inspector',
      {
        mode: 'teaser',
        initialState: { view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true },
      },
    ],
    [
      'function inspector',
      {
        mode: 'teaser',
        initialState: { view: 'list', selectedId: 'function:f-003', inspectorOpen: true },
      },
    ],
    [
      'field inspector',
      {
        mode: 'teaser',
        initialState: { view: 'list', selectedId: 'field:Deals.Stage', inspectorOpen: true },
      },
    ],
    [
      'stale fogged selection',
      {
        mode: 'teaser',
        initialState: { view: 'list', selectedId: 'rule:rule-001', inspectorOpen: true },
      },
    ],
    [
      'stale fogged field',
      {
        mode: 'teaser',
        initialState: { field: { moduleApiName: 'Leads', fieldApiName: 'Lead_Status' } },
      },
    ],
  ];

  it.each(states)('names nothing from the fog: %s', (_name, options) => {
    map = mountMap(options);
    expect(leaks(map)).toEqual([]);
  });

  it('names nothing from the fog with the coverage popover and shortcut sheet open', () => {
    map = mountMap({ mode: 'teaser' });
    click(map.q('.wf-index .wf-pill'));
    expect(map.q('.wf-pop')).not.toBeNull();
    click(map.q('[aria-label="Keyboard shortcuts"]'));
    expect(leaks(map)).toEqual([]);
  });

  it('writes no fogged id or name into the URL hash', () => {
    map = mountWithStore(
      { view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true, query: 'review' },
      { mode: 'teaser' },
    );
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Copy link')));
    const hash = decodeURIComponent(location.hash);
    expect(hash).toBe('#zcdt-map=v1;view=list;sel=rule:rule-003');
    expect(fogged.filter((n) => hash.includes(n))).toEqual([]);
  });

  it('drops anything fogged from the DOM when the entitlement changes under the user', async () => {
    map = mountWithStore({
      view: 'list',
      query: 'Qualify',
      selectedId: 'rule:rule-001',
      inspectorOpen: true,
      field: { moduleApiName: 'Leads', fieldApiName: 'Lead_Status' },
    });
    expect(everything(map.shadow)).toContain('Qualify new enquiries');
    map.publish(teaserSnapshot);
    await flush();
    expect(leaks(map)).toEqual([]);
    expect(map.recorded.store().get()).toMatchObject({ selectedId: null, query: '', field: null });
    expect(map.q('.am-search input')).toHaveProperty('value', '');
  });

  it('keeps explicit initial state from the entry point when the first snapshot is a preview', () => {
    map = mountMap({
      mode: 'teaser',
      initialState: { view: 'list', query: 'Review', focusModuleApiName: 'Deals' },
    });
    expect((map.q('.am-search input') as HTMLInputElement).value).toBe('Review');
    expect(map.qa('.ritem').length).toBeGreaterThan(0);
  });

  it('drops a shared full link down to the view and the revealed node in a preview', () => {
    history.replaceState(
      null,
      '',
      `${location.pathname}#zcdt-map=v1;view=trace;sel=rule:rule-003;scope=all;mods=Leads;q=Qualify;field=Leads.Lead_Status;focus=Leads;trace=rule:rule-003,2,3`,
    );
    map = mountMap({ mode: 'teaser' });
    expect(map.q('[data-canvas="board"]')).not.toBeNull();
    expect(map.q('[data-canvas="trace"]')).toBeNull();
    expect((map.q('.am-search input') as HTMLInputElement).value).toBe('');
    expect(map.q('.am-insp.open')).not.toBeNull();
    expect(map.q('.am-state.on')).toBeNull();
    expect(leaks(map)).toEqual([]);
  });

  it('drops a link to a node the preview does not reveal', () => {
    history.replaceState(null, '', `${location.pathname}#zcdt-map=v1;view=list;sel=rule:rule-001`);
    map = mountMap({ mode: 'teaser' });
    expect(map.q('.am-insp.open')).toBeNull();
    expect(leaks(map)).toEqual([]);
  });

  it('remounts the canvas views when the entitlement changes', () => {
    map = mountMap({ initialState: { view: 'board' } });
    expect(map.recorded.mounts.board).toBe(1);
    map.publish(teaserSnapshot);
    expect(map.recorded.disposed.board).toBe(1);
    expect(map.recorded.mounts.board).toBe(2);
  });
});

describe('teaser chrome', () => {
  let map: MountedMap | null = null;
  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
    history.replaceState(null, '', location.pathname);
  });
  const withAccess = (access: MapAccess): AutomationMapSnapshot => ({ ...teaserSnapshot, access });
  const teaser = (reason: TeaserReason, revealed: string | null = 'Deals') =>
    withAccess({ level: 'teaser', revealedModuleApiName: revealed, reason });

  it('marks the preview in the header and offers upgrade in three places', () => {
    map = mountMap({ mode: 'teaser' });
    expect(map.q('.am-chip-preview')?.hasAttribute('hidden')).toBe(false);
    expect(map.q('.wf-index .wf-pill')?.textContent).toContain('Preview');
    const buttons = map.qa('.am-upgrade-btn');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    click(map.q('.am-head .am-upgrade-btn'));
    expect(map.calls.upgrade).toBe(1);
    click(map.q('.fog-card .am-upgrade-btn'));
    expect(map.calls.upgrade).toBe(2);
  });

  it('shows the fog card and collapses it to a pill that still upgrades', () => {
    map = mountMap({ mode: 'teaser' });
    expect(map.q('.fog-card h3')?.textContent).toBe(
      "You're seeing 1 flow. The rest of your org is in the fog.",
    );
    click(map.q('.fog-card [data-fk="fog-later"]'));
    expect(map.q('.fog-card')).toBeNull();
    expect(map.q('.fog-pill')?.textContent).toContain('1 flow shown · the rest is in the fog');
    click(map.q('.fog-pill .am-upgrade-btn'));
    expect(map.calls.upgrade).toBe(1);
  });

  it('never tells a lower plan that its plan unlocks the map', () => {
    map = mountMap({ mode: 'teaser', snapshot: teaser('lower-plan') });
    const plan = map.q('.fog-card .plan')?.textContent ?? '';
    expect(plan).toBe('Your plan includes Search All Workflows. Automation Map needs Pro.');
    expect(plan).not.toMatch(/unlock|includes Automation Map/i);
    map.handle.close();
    map = mountMap({ mode: 'teaser', snapshot: teaser('free') });
    expect(map.q('.fog-card .plan')?.textContent).toBe(
      'Sign in and upgrade to Pro to map your whole org.',
    );
    map.handle.close();
    map = mountMap({ mode: 'teaser', snapshot: teaser('signed-out') });
    expect(map.q('.fog-card .plan')?.textContent).toBe(
      'Sign in and upgrade to Pro to map your whole org.',
    );
  });

  it('says when the plan check failed and retries it', () => {
    map = mountMap({ mode: 'teaser', snapshot: teaser('unavailable') });
    expect(map.q('.fog-card .warnline')?.textContent).toContain(
      "We couldn't check your plan. Showing a preview.",
    );
    click(map.q('[data-fk="fog-retry"]'));
    expect(map.calls.retries).toEqual([undefined]);
  });

  it('fogs the whole board when nothing is revealed', () => {
    map = mountMap({ mode: 'teaser', snapshot: teaser('free', null) });
    expect(map.q('.fog-card h3')?.textContent).toBe('Upgrade to Pro to map your org.');
  });

  it('lists modules by number, locked, with no names or fogged counts in the labels', () => {
    map = mountMap({ mode: 'teaser' });
    const locked = map.qa('.opt.locked');
    expect(locked.length).toBeGreaterThan(3);
    expect(locked.map((n) => n.querySelector('.t')?.textContent)).toEqual(
      locked.map((_, i) => `Module ${i + 1}`),
    );
    click(locked[0]);
    expect(map.calls.upgrade).toBe(1);
    expect(map.q('.am-rail')?.textContent).toContain(
      'Totals come from your rule list and function catalogue.',
    );
  });

  it('hides the filters, the legend and the filter chips', () => {
    map = mountMap({ mode: 'teaser' });
    expect(map.q('.am-scope')).toBeNull();
    expect(map.q('[data-fk^="kind:"]')).toBeNull();
    expect(map.q('.am-state.on')).toBeNull();
  });

  it('searches only the revealed preview and never reports a fogged-match count', () => {
    map = mountMap({ mode: 'teaser', initialState: { view: 'list', query: 'Review' } });
    const revealedMatches = map.qa('.ritem').length;
    expect(revealedMatches).toBeGreaterThan(0);
    expect(map.q('.rail-results .help')?.textContent).toBe(
      `${revealedMatches} match${revealedMatches === 1 ? '' : 'es'} in your preview`,
    );
    expect(map.q('.am-search .cnt')?.textContent).toBe(`${revealedMatches} in preview`);
    expect(map.q('.am-rail .lockrow')?.textContent).toMatch(
      /Pro searches all \d+ rules and \d+ functions/,
    );
    map.handle.close();
    // A query that only fogged items match looks exactly like one that matches nothing.
    map = mountMap({ mode: 'teaser', initialState: { view: 'list', query: 'Qualify' } });
    expect(map.q('.rail-results .help')?.textContent).toBe('0 matches in your preview');
    expect(map.q('.am-search .cnt')?.textContent).toBe('0 in preview');
    const noMatch = map.q('.am-rail')?.textContent;
    map.handle.close();
    map = mountMap({ mode: 'teaser', initialState: { view: 'list', query: 'zzzzzz' } });
    expect(map.q('.am-rail')?.textContent?.replace(/"zzzzzz"/, '"Qualify"')).toBe(noMatch);
  });

  it('shows revealed list rows, locked rows and a sticky lock row with a count', () => {
    map = mountMap({ mode: 'teaser', initialState: { view: 'list' } });
    expect(map.qa('.lt-row').length).toBeGreaterThan(3);
    // Locked rows say what they are; nothing blank that could pass for a loading row.
    expect(map.qa('.lt-silh')).toHaveLength(0);
    const locked = map.qa('.lt-fogrow');
    expect(locked.length).toBeGreaterThan(0);
    for (const row of locked) expect(row.textContent).toMatch(/^In the fog.*\d+ (rule|function)/);
    expect(map.q('.lt-lock')?.textContent).toMatch(/\d+ more rules and functions in the fog/);
    click(map.q('.lt-lock .am-upgrade-btn'));
    expect(map.calls.upgrade).toBe(1);
  });

  describe('locked list rows', () => {
    const skewedPort = () => withSkewedFog(createFixturePort('teaser').port, 9);

    it('lists locked areas as counts only, largest first, never as blank skeleton rows', () => {
      map = mountMap({ port: skewedPort(), initialState: { view: 'list' } });
      const rows = map.qa('.lt-fogrow');
      expect(rows).toHaveLength(8);
      expect(rows[0].textContent).toBe('In the fog101 rules · 87 functions · 4 buttons');
      const counts = rows.map((r) =>
        Number(r.querySelector('.cnt')?.textContent?.match(/^\d+/)?.[0]),
      );
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      for (const row of rows) {
        expect(row.querySelector('svg')).not.toBeNull();
        expect(row.textContent).toMatch(/^In the fog\d+ /);
      }
      expect(map.qa('.lt-silh')).toHaveLength(0);
      expect(map.q('.lt-fog')?.getAttribute('aria-label')).toBe('In the fog');
      const notes = map.qa('.lt-fognote').map((n) => n.textContent);
      expect(notes).toEqual(['15 more modules in the fog', '9 other modules without automation']);
    });

    it('keeps the locked rows out of the grid: not rows, not in the row count, not keyboard stops', () => {
      map = mountMap({ port: skewedPort(), initialState: { view: 'list' } });
      const grid = map.q('[role="treegrid"]') as HTMLElement;
      const gridRows = map.qa('[role="row"]');
      expect(Number(grid.getAttribute('aria-rowcount'))).toBe(gridRows.length);
      for (const row of map.qa('.lt-fogrow')) {
        expect(row.closest('[role="row"]')).toBeNull();
        expect(row.querySelector('button, a, input, [tabindex]')).toBeNull();
      }
    });

    it('is leak-free: no module name can reach a locked row or the notes', () => {
      map = mountMap({ port: skewedPort(), initialState: { view: 'list' } });
      const text = (map.q('.lt-fog') as HTMLElement).textContent as string;
      expect(text).toMatch(/^(In the fog[\d\sA-Za-z·]+?)+/);
      expect(fogged.filter((n) => everything(map?.shadow as ShadowRoot).includes(n))).toEqual([]);
    });

    it('adds the quiet-module note to the rail instead of rows of zeros', () => {
      map = mountMap({ port: skewedPort(), initialState: { view: 'board' } });
      const rail = map.q('.am-rail') as HTMLElement;
      expect(rail.textContent).toContain('9 other modules without automation');
      const counts = map.qa('.am-rail .opt.locked .n').map((n) => Number(n.textContent));
      expect(counts.length).toBe(8);
      expect(counts.every((n) => n > 0)).toBe(true);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });
  });

  it('shows the revealed writers, then silhouettes and a fog message, in the field lens', () => {
    map = mountMap({
      mode: 'teaser',
      initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } },
    });
    expect(map.qa('.lcol[data-col="w"] .wcard').length).toBeGreaterThan(0);
    expect(map.qa('.lcol[data-col="w"] .silh')).toHaveLength(4);
    expect(map.q('.lcol[data-col="w"] .fogtext')?.textContent).toContain(
      'More writers are in the fog.',
    );
    expect(map.q('.fstats')?.textContent).toMatch(/\d\+writers/);
    expect(map.q('.lens-foot')?.textContent).toContain('Preview coverage');
    click(map.q('.lens-bar .am-upgrade-btn'));
    expect(map.calls.upgrade).toBe(1);
  });

  it('lists only revealed fields on the start screen, with search locked', () => {
    map = mountMap({ mode: 'teaser' });
    const search = map.q('.fpick input') as HTMLInputElement;
    expect(search.disabled).toBe(true);
    const chips = map.qa('.hotchip');
    expect(chips.length).toBeGreaterThan(0);
    expect(map.q('.fogtext')?.textContent).toContain('Pro');
    expect(map.qa('.qcard')).toHaveLength(0);
    click(chips[0]);
    expect(map.q('.fcard')).not.toBeNull();
  });

  it('puts a lock panel, not code, on a function whose source was not read', () => {
    const fixture = createFixturePort('teaser');
    const fn = [...fixture.port.snapshot().graph.nodes.values()].find((n) => n.kind === 'function');
    expect(fn).toBeDefined();
    map = mountMap({
      port: { ...fixture.port, sourceText: () => null },
      initialState: { view: 'list', selectedId: fn?.id, inspectorOpen: true },
    });
    expect(map.q('.codebox')).toBeNull();
    expect(map.q('.lockpanel')?.textContent).toContain(
      'What this function writes and calls is in the fog.',
    );
    click(map.q('.lockpanel .am-upgrade-btn'));
    expect(fixture.calls.upgrade).toBe(1);
  });

  it('shows the revealed function source with its evidence in the preview', () => {
    map = mountMap({
      mode: 'teaser',
      initialState: { view: 'list', selectedId: 'function:f-003', inspectorOpen: true },
    });
    expect(map.q('.codebox .cl.ev')).not.toBeNull();
  });

  it('keeps Escape and keyboard behaviour in the preview', () => {
    map = mountMap({
      mode: 'teaser',
      initialState: { view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true },
    });
    key(map.q('.am-panel') as HTMLElement, 'Escape');
    expect(map.q('.am-insp.open')).toBeNull();
  });
});

describe('access states', () => {
  let map: MountedMap | null = null;
  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
  });

  it('shows a checking state and mounts no canvas until access is known', async () => {
    const snap = {
      ...createFixturePort('full').port.snapshot(),
      access: { level: 'checking' } as const,
    };
    map = mountMap({ snapshot: snap, initialState: { view: 'board' } });
    expect(map.q('.am-cover h3')?.textContent).toBe('Checking your plan…');
    expect(map.q('.wf-index')?.textContent).toContain('Checking your plan…');
    expect(map.recorded.mounts.board).toBe(0);
    map.publish(createFixturePort('full').port.snapshot());
    await flush();
    expect(map.q('.am-cover h3')).toBeNull();
    expect(map.recorded.mounts.board).toBe(1);
  });
});
