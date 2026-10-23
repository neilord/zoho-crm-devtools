import { afterEach, describe, expect, it } from 'vitest';
import { fieldWriters } from '../src/content/automation-map/graph';
import type { AutomationGraph, MapEdge } from '../src/content/automation-map/types';
import {
  buildLensModel,
  cascadeText,
  entryPaths,
  fieldCatalogue,
} from '../src/content/automation-map/ui/lens-model';
import { click, key, type MountedMap, mountMap } from './automation-map-ui-helpers';
import { fixtureGraph } from './fixtures/automation-map';

const graph = fixtureGraph();
const lensFor = (g: AutomationGraph, scope: 'active' | 'everything' = 'active') =>
  buildLensModel(g, fieldWriters(g, 'Deals', 'Stage'), 'Deals', 'Stage', { scope, teaser: false });

describe('lens model', () => {
  it('splits writers into the fixed tiers in order', () => {
    const lens = lensFor(graph, 'everything');
    expect(lens.groups.map((g) => g.key)).toEqual([
      'declared',
      'exact',
      'unknownFields',
      'unresolved',
    ]);
    expect(lens.groups.map((g) => g.title)).toEqual([
      'Declared in configuration',
      'Functions · exact',
      'May write Deals · fields unknown',
      'Unresolved module',
    ]);
    const declared = lens.groups[0].items;
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.every((w) => w.edge.evidence === 'declared' && w.tier === 'declared')).toBe(
      true,
    );
    expect(
      lens.groups[1].items.every((w) => w.edge.evidence === 'inferred' && w.tier === 'exact'),
    ).toBe(true);
    expect(lens.groups[3].items.every((w) => w.tier === 'unresolved')).toBe(true);
  });

  it('selects the owning rule or blueprint transition for a declared writer', () => {
    const declared = lensFor(graph).groups[0].items;
    expect(declared.some((w) => w.selectId.startsWith('transition:'))).toBe(true);
    expect(declared.some((w) => w.selectId.startsWith('rule:'))).toBe(true);
  });

  it('hides unreached writers in the active scope and shows them in Everything', () => {
    const active = lensFor(graph, 'active').writerCount;
    const all = lensFor(graph, 'everything').writerCount;
    expect(all).toBeGreaterThan(active);
    const unreached = lensFor(graph, 'everything')
      .groups.flatMap((g) => g.items)
      .filter((w) => !w.reached);
    expect(unreached.length).toBeGreaterThan(0);
  });

  it('derives cascade notes only from cascade edges on the same write site', () => {
    const exact = lensFor(graph).groups.find((g) => g.key === 'exact')?.items ?? [];
    const explicit = exact.find((w) => w.cascade.kind === 'possible');
    expect(explicit).toBeDefined();
    expect(cascadeText(explicit?.cascade as never).text).toBe(
      'May re-trigger workflow rules (trigger: workflow)',
    );
    expect(exact.some((w) => w.cascade.kind === 'unknown')).toBe(true);
    const declared = lensFor(graph).groups[0].items[0];
    expect(cascadeText(declared.cascade).text).toMatch(/re-trigger behaviour unverified/);
  });

  it('claims "not requested" only when the write explicitly omits the workflow trigger', () => {
    expect(cascadeText({ kind: 'not-requested' }).text).toBe(
      'Workflow not requested (Deluge default)',
    );
    expect(cascadeText({ kind: 'unknown' }).text).toBe('Workflow trigger unknown');
    expect(cascadeText({ kind: 'possible', explicit: false }).text).toBe(
      'May re-trigger workflow rules (Zoho default)',
    );
  });

  it('never treats a write to another or unknown org as an exact local writer', () => {
    const lens = fieldWriters(graph, 'Deals', 'Stage');
    const exactEdge = lens.writers.find((e) => e.evidence === 'inferred') as MapEdge;
    const foreign: MapEdge = { ...exactEdge, destinationScope: 'connection-org-unknown' };
    const patched = {
      ...lens,
      writers: lens.writers.map((e) => (e === exactEdge ? foreign : e)),
    };
    const model = buildLensModel(graph, patched, 'Deals', 'Stage', {
      scope: 'everything',
      teaser: false,
    });
    const entry = model.groups.flatMap((g) => g.items).find((w) => w.edge.id === foreign.id);
    expect(entry?.group).toBe('partial');
    expect(entry?.foreign).toBe(true);
    expect(
      model.groups.find((g) => g.key === 'exact')?.items.some((w) => w.edge.id === foreign.id),
    ).toBeFalsy();
  });

  it('classifies reactors as trigger or criteria and flags a possible loop', () => {
    const lens = lensFor(graph);
    expect(lens.triggerReactors.length).toBeGreaterThan(0);
    expect(lens.criteriaReactors.length).toBeGreaterThan(0);
    expect(lens.triggerReactors.every((r) => r.rule.triggerType === 'field_update')).toBe(true);
    expect(lens.reactorCount).toBe(lens.triggerReactors.length + lens.criteriaReactors.length);
    expect(lens.hasLoop).toBe(true);
    const loop = lens.triggerReactors.flatMap((r) => r.effects).find((e) => e.loop);
    expect(loop?.pivot).toEqual({ moduleApiName: 'Deals', fieldApiName: 'Stage' });
    expect(loop?.cascade).toBe('possible');
  });

  it('marks cross-module effects and does not offer a pivot into unknown-field buckets', () => {
    const effects = lensFor(graph).triggerReactors.flatMap((r) => r.effects);
    expect(effects.some((e) => e.cross && e.pivot?.moduleApiName === 'Accounts')).toBe(true);
    expect(
      effects.filter((e) => e.pivot === null).every((e) => /unknown|Unresolved/.test(e.label)),
    ).toBe(true);
  });

  it('resolves entry paths upstream from a writer', () => {
    const fn = [...graph.nodes.values()].find((n) => n.id === 'function:f-003');
    const paths = entryPaths(graph, fn?.id as string);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path[path.length - 1]).toBe('function:f-003');
      expect(graph.nodes.get(path[0])?.kind).toMatch(
        /rule|button|schedule|transition|approval|function/,
      );
    }
  });

  it('lists fields by writer count for the start screen', () => {
    const catalogue = fieldCatalogue(graph, false);
    expect(catalogue[0].writers).toBeGreaterThanOrEqual(catalogue[catalogue.length - 1].writers);
    const stage = catalogue.find((f) => f.id === 'field:Deals.Stage');
    expect(stage).toMatchObject({ moduleName: 'Deals', label: 'Stage' });
    expect(stage?.writers).toBeGreaterThan(5);
    expect(catalogue.every((f) => !f.id.endsWith('.*'))).toBe(true);
  });
});

describe('fields view', () => {
  let map: MountedMap | null = null;
  afterEach(() => {
    map?.handle.close();
    map = null;
    document.body.replaceChildren();
    history.replaceState(null, '', location.pathname);
  });

  const lensMap = (extra: Parameters<typeof mountMap>[0] = {}) =>
    mountMap({
      initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } },
      ...extra,
    });

  it('renders the start screen with the question, hot fields, starter cards and totals', () => {
    map = mountMap();
    expect(map.q('.lens-start h1')?.textContent).toBe('What can change a field?');
    expect(map.qa('.hotchip').length).toBeLessThanOrEqual(6);
    expect(map.qa('.hotchip').length).toBeGreaterThan(0);
    expect(map.qa('.qcard')).toHaveLength(4);
    expect(map.q('.estate')?.textContent).toMatch(/45.*rules.*60.*functions/);
  });

  it('opens the lens from a most-written chip and from the keyboard picker', () => {
    map = mountMap();
    const chip = map.qa('.hotchip').find((c) => c.textContent?.includes('Stage')) as HTMLElement;
    click(chip);
    expect(map.q('.fcard .fn')?.textContent).toBe('Stage');
    expect(map.q('.fcard .fa')?.textContent).toBe('Deals.Stage');
    click(map.q('[data-fk="lens-back"]'));
    const input = map.q('[data-fk="field-picker"]') as HTMLInputElement;
    input.value = 'last auto';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(map.qa('[role="option"]').length).toBeGreaterThan(0);
    key(input, 'Enter');
    expect(map.q('.fcard .fn')?.textContent).toBe('Last Automation');
  });

  it('shows every writer tier with connectors, counts and evidence attributes', () => {
    map = lensMap();
    const titles = map.qa('.lcol[data-col="w"] .lgrp-h').map((h) => h.firstChild?.textContent);
    expect(titles).toEqual([
      'Declared in configuration',
      'Functions · exact',
      'May write Deals · fields unknown',
    ]);
    expect(map.qa('.lcol[data-col="w"] .wcard').length).toBeGreaterThan(5);
    const tiers = new Set(map.qa('.lcol[data-col="w"] .wcard').map((c) => c.dataset.tier));
    expect(tiers).toEqual(new Set(['declared', 'exact', 'unresolved']));
    expect(map.q('.lens-grid > svg')).not.toBeNull();
    expect(map.q('.lens-sum')?.textContent).toMatch(/possible writers/);
    expect(map.q('.lens-sum')?.textContent).toMatch(/possible cascades/);
    expect(map.q('.lens-sum')?.textContent).toMatch(/possible loop/);
  });

  it('shows the Unresolved module group once Everything scope includes it', () => {
    map = lensMap({
      initialState: {
        field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
        filters: {
          scope: 'everything',
          modules: new Set(),
          kinds: new Set(),
          triggerTypes: new Set(),
          flags: new Set(),
        },
      },
    });
    const titles = map.qa('.lcol[data-col="w"] .lgrp-h').map((h) => h.firstChild?.textContent);
    expect(titles).toContain('Unresolved module');
    // Collapsed by default: one summary line, no cards, until the user asks.
    expect(map.q('.lgrp[data-g="unresolved"] .lgrp-sum')?.textContent).toMatch(
      /functions? writes? records in a module we couldn't resolve\. (They|It) may affect this field\./,
    );
    expect(map.qa('.lgrp[data-g="unresolved"] .wcard')).toHaveLength(0);
  });

  it('always renders the coverage footer and the unindexed-automation note', () => {
    map = lensMap();
    const footer = map.q('.lens-foot')?.textContent ?? '';
    expect(footer).toMatch(/Coverage: 45 of 45 rules and \d+ of 60 functions analysed/);
    expect(footer).toMatch(/\d+ gaps? in the map .* could also write Stage/);
    expect(footer).toMatch(
      /People, manual edits, imports, integrations and API clients, client scripts and other automation this map does not index can also change Stage\. This is a list of possible writers, not a guarantee that each one runs\./,
    );
    expect(map.q('[data-fk="view-gaps"]')).not.toBeNull();
  });

  it('keeps the footer and an honest empty state for a field nothing writes', () => {
    map = mountMap({
      initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Nothing_Here' } },
    });
    const body = map.q('.lcol[data-col="w"]')?.textContent ?? '';
    expect(body).toContain('No known writers in analysed automation.');
    expect(body).toContain('That is not proof that nothing writes Nothing_Here');
    expect(map.q('.lens-foot')?.textContent).toMatch(/Coverage:/);
    expect(map.q('[data-fk="lens-back"]')).not.toBeNull();
    expect(map.qa('.fbtns button')).toHaveLength(0);
  });

  it('shows the still-analysing box and the loading empty text while functions are pending', () => {
    map = mountMap({
      mode: 'loading',
      initialState: { field: { moduleApiName: 'Deals', fieldApiName: 'Nothing_Here' } },
    });
    expect(map.q('.lens-box')?.textContent).toMatch(/0 of 60 functions analysed so far/);
    expect(map.q('.lens-box')?.textContent).toContain('More writers may appear.');
    expect(map.q('.lcol[data-col="w"]')?.textContent).toContain('No writers found yet.');
  });

  it('selects the owning rule and opens the inspector when a declared writer is clicked', () => {
    map = lensMap({
      initialState: { view: 'fields', field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } },
    });
    const card = map.q('.wcard[data-tier="declared"]') as HTMLElement;
    click(card);
    expect(map.q('.am-insp.open')).not.toBeNull();
    expect(card.classList.contains('sel') || map.q('.wcard.sel')).toBeTruthy();
    expect(map.q('.am-insp .ins-kind')?.textContent).toMatch(/Workflow rule|Blueprint transition/);
  });

  it('pivots the lens through a reactor effect chip and keeps a breadcrumb trail', () => {
    map = lensMap();
    const chip = map
      .qa('.rcard .eff[title^="Open the field lens"]')
      .find((b) => b.textContent?.includes('Accounts')) as HTMLElement;
    expect(chip).toBeDefined();
    click(chip);
    expect(map.q('.fcard .fa')?.textContent).toBe('Accounts.Health_Score');
    const crumbs = map.qa('.crumbs button').map((b) => b.textContent);
    expect(crumbs).toEqual(['Deals › Stage', 'Accounts › Health Score']);
    click(map.qa('.crumbs button')[0]);
    expect(map.q('.fcard .fa')?.textContent).toBe('Deals.Stage');
    expect(map.qa('.crumbs button')).toHaveLength(1);
  });

  it('expands the entry points of a writer reached from several triggers', () => {
    map = lensMap();
    const toggle = map.q('.pmore') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const before = map.qa('.path.sub').length;
    click(toggle);
    expect(map.qa('.path.sub').length).toBeGreaterThan(before);
    expect(map.q('.pmore')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('highlights writer and reactor cards that match the search', () => {
    map = lensMap({
      initialState: {
        field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
        query: 'large opportunities 1',
      },
    });
    const matched = map.qa('.wcard.match');
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((c) => /large opportunities 1/i.test(c.textContent ?? ''))).toBe(true);
  });

  it('applies starter questions as real filters and views', () => {
    map = mountMap({ initialState: { view: 'board' } });
    const store = map.recorded.store();
    store.set({ view: 'fields' });
    click(map.qa('.qcard')[1]);
    expect(store.get().view).toBe('list');
    expect([...store.get().filters.flags]).toEqual(['callsExternal']);
    store.set({ view: 'fields' });
    click(map.qa('.qcard')[0]);
    expect(store.get().view).toBe('board');
    expect([...store.get().filters.modules]).toEqual(['Deals']);
    expect(store.get().focusModuleApiName).toBe('Deals');
  });
});
