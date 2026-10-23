import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationMapStore } from '../src/content/automation-map/data/store';
import { buildSearchIndex } from '../src/content/automation-map/graph';
import { createStorePort } from '../src/content/automation-map/port';
import type { AutomationMapSnapshot, MapFilters } from '../src/content/automation-map/types';
import { context, graph } from './automation-map-data-fixtures';
import { fixtureGraph, fixtureSources } from './fixtures/automation-map';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  const seed = new AutomationMapStore({
    context,
    fetch,
    getEntitlement: async () => {
      throw new Error();
    },
    buildGraph: graph,
  });
  let snapshot!: AutomationMapSnapshot;
  seed.subscribe((s) => {
    snapshot = { ...s, graph: fixtureGraph(), access: { level: 'full' } };
  });
  seed.dispose();
  let listener!: (s: AutomationMapSnapshot) => void;
  const unsubscribe = vi.fn();
  const sourceText = vi.fn((id: string) => fixtureSources().get(id) ?? 'secret fogged source');
  const store = {
    subscribe: (fn: typeof listener) => {
      listener = fn;
      fn(snapshot);
      return unsubscribe;
    },
    sourceText,
    retry: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    refreshAccess: vi.fn(async () => {}),
  };
  const build = vi.fn(buildSearchIndex);
  const openRule = vi.fn();
  const openFunction = vi.fn(async () => true);
  const closeUpgrade = vi.fn();
  const requestUpgrade = vi.fn((_onEntitled: () => void) => closeUpgrade);
  const port = createStorePort(store, {
    buildSearchIndex: build,
    openRule,
    openFunction,
    requestUpgrade,
  });
  cleanups.push(() => port.dispose());
  return {
    port,
    store,
    build,
    snapshot,
    unsubscribe,
    openRule,
    openFunction,
    requestUpgrade,
    closeUpgrade,
    emit: (patch: Partial<AutomationMapSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
      listener(snapshot);
    },
  };
}
const filters: MapFilters = {
  scope: 'everything',
  modules: new Set(),
  kinds: new Set(),
  triggerTypes: new Set(),
  flags: new Set(),
};
describe('Automation Map store port', () => {
  it('caches progressive snapshots and immediately subscribes readers', () => {
    const s = setup();
    const seen = vi.fn();
    const stop = s.port.subscribe(seen);
    expect(s.port.snapshot()).toBe(s.snapshot);
    s.emit({ phase: 'enriching' });
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    s.emit({ phase: 'complete' });
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it('debounces graph builds, never builds on keystrokes or coverage-only updates', () => {
    const s = setup();
    s.port.search('sales', filters);
    expect(s.build).not.toHaveBeenCalled();
    vi.advanceTimersByTime(75);
    expect(s.build).toHaveBeenCalledOnce();
    for (const query of ['s', 'sa', 'sales']) s.port.search(query, filters);
    s.emit({ phase: 'complete' });
    vi.advanceTimersByTime(100);
    expect(s.build).toHaveBeenCalledOnce();
    s.emit({ graph: fixtureGraph() });
    s.emit({ graph: fixtureGraph() });
    expect(s.port.search('sales', filters)).toEqual([]);
    vi.advanceTimersByTime(75);
    expect(s.build).toHaveBeenCalledTimes(2);
    expect(s.port.search('Update sales health', filters).length).toBeGreaterThan(0);
  });
  it('exposes and indexes only current graph function sources, including in teaser', () => {
    const s = setup();
    const node = [...s.snapshot.graph.nodes.values()].find((n) => n.kind === 'function');
    if (node?.kind !== 'function') throw new Error();
    expect(s.port.sourceText(node.delugeId)).not.toBeNull();
    expect(s.port.sourceText('fogged')).toBeNull();
    const revealed = { ...s.snapshot.graph, nodes: new Map([[node.id, node]]) };
    s.emit({
      graph: revealed,
      access: { level: 'teaser', revealedModuleApiName: node.moduleApiName, reason: 'free' },
    });
    s.store.sourceText.mockClear();
    vi.advanceTimersByTime(75);
    expect(s.store.sourceText).toHaveBeenCalledExactlyOnceWith(node.delugeId);
    s.emit({ graph: { ...revealed, nodes: new Map() } });
    expect(s.port.sourceText(node.delugeId)).toBeNull();
    expect(s.port.search('sales', filters)).toEqual([]);
  });
  it('delegates lens, bounded trace and retries against the current snapshot', async () => {
    const s = setup();
    expect(s.port.fieldLens('Deals', 'Stage').field?.id).toBe('field:Deals.Stage');
    const id = [...s.snapshot.graph.nodes.keys()][0];
    expect(
      s.port
        .trace(id, { upstream: 1, downstream: 1, maxNodes: 3, includeInactive: true })
        .nodeIds.has(id),
    ).toBe(true);
    await s.port.retry('source:123');
    await s.port.retry();
    expect(s.store.retry.mock.calls).toEqual([['source:123'], [undefined]]);
  });
  it('hands off only revealed identities and refreshes access after upgrading', () => {
    const s = setup();
    const rule = [...s.snapshot.graph.nodes.values()].find((n) => n.kind === 'rule');
    const fn = [...s.snapshot.graph.nodes.values()].find((n) => n.kind === 'function');
    if (rule?.kind !== 'rule' || fn?.kind !== 'function') throw new Error();
    s.port.openRuleInZoho(rule.ruleId);
    s.port.openFunctionInZoho(fn.delugeId);
    s.port.openRuleInZoho('fogged');
    s.port.openFunctionInZoho('fogged');
    expect(s.openRule).toHaveBeenCalledExactlyOnceWith(rule.ruleId);
    expect(s.openFunction).toHaveBeenCalledExactlyOnceWith(fn.summary);
    s.port.requestUpgrade();
    s.port.requestUpgrade();
    expect(s.requestUpgrade).toHaveBeenCalledOnce();
    s.requestUpgrade.mock.calls[0][0]();
    expect(s.store.refreshAccess).toHaveBeenCalledOnce();
    s.port.dispose();
    expect(s.closeUpgrade).toHaveBeenCalledOnce();
    expect(s.unsubscribe).toHaveBeenCalledOnce();
    s.requestUpgrade.mock.calls[0][0]();
    expect(s.store.refreshAccess).toHaveBeenCalledOnce();
  });
  it('cancels queued search work and subscriptions on disposal', () => {
    const s = setup();
    s.port.dispose();
    s.port.dispose();
    vi.runAllTimers();
    expect(s.build).not.toHaveBeenCalled();
    expect(s.unsubscribe).toHaveBeenCalledOnce();
    expect(s.port.sourceText('anything')).toBeNull();
  });
});

it('forwards refresh and exposes the store gap count to the field lens', async () => {
  const s = setup();
  s.emit({ coverage: { ...s.snapshot.coverage, gaps: 17, lastRevalidatedAt: 1234 } });
  expect(s.port.fieldLens('Deals', 'Stage').coverageGaps).toBe(17);
  expect(s.port.snapshot().coverage.lastRevalidatedAt).toBe(1234);
  expect(s.port.mostWrittenFields(filters, 2)).toHaveLength(2);
  await s.port.refresh();
  expect(s.store.refresh).toHaveBeenCalledOnce();
  s.port.dispose();
  await s.port.refresh();
  expect(s.store.refresh).toHaveBeenCalledOnce();
});
