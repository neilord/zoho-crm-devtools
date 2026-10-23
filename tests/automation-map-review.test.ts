import { afterEach, expect, it, vi } from 'vitest';
import { createStorePort } from '../src/content/automation-map/port';
import type { AutomationMapSnapshot, MapNode } from '../src/content/automation-map/types';
import { Viewport } from '../src/content/automation-map/ui/canvas/viewport';
import { mountAutomationMap } from '../src/content/automation-map/ui/overlay';
import { defaultFilters } from '../src/content/automation-map/ui/view-store';
import {
  click,
  everything,
  type MountedMap,
  mountMap,
  recordingViews,
} from './automation-map-ui-helpers';
import { fixtureGraph, fixtureSources } from './fixtures/automation-map';
import { createFixturePort } from './fixtures/automation-map-port';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanups.splice(0).reverse()) stop();
  document.body.replaceChildren();
  history.replaceState(null, '', location.pathname);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const keep = (map: MountedMap) => {
  cleanups.push(() => map.handle.close());
  return map;
};
const leaked = {
  selectedId: 'rule:9000000000000000991',
  traceRootId: 'function:9000000000000000992',
  focusModuleApiName: 'Leads',
  hoverId: 'rule:9000000000000000993',
  field: { moduleApiName: 'Leads', fieldApiName: 'Lead_Status' },
  inspectorOpen: true,
};

it.each([
  false,
  true,
])('review 2 sanitizes explicit teaser entry state before canvas/render/hash (delayed=%s)', async (delayed) => {
  vi.useFakeTimers();
  const teaser = createFixturePort('teaser').port.snapshot();
  const map = keep(
    mountMap({
      mode: 'teaser',
      initialState: { view: 'board', ...leaked },
      ...(delayed ? { snapshot: { ...teaser, access: { level: 'checking' as const } } } : {}),
    }),
  );
  if (delayed) map.publish(teaser);
  const state = map.recorded.store().get();
  expect(state).toMatchObject({
    selectedId: null,
    traceRootId: null,
    focusModuleApiName: null,
    hoverId: null,
    field: null,
    inspectorOpen: false,
  });
  await vi.advanceTimersByTimeAsync(350);
  for (const secret of [
    '9000000000000000991',
    '9000000000000000992',
    '9000000000000000993',
    'Leads',
  ]) {
    expect(everything(map.shadow)).not.toContain(secret);
    expect(decodeURIComponent(location.hash)).not.toContain(secret);
  }
});

it('review 2 sanitizes later teaser updates, graph changes and Copy link', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async (_text: string) => {});
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  cleanups.push(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  const map = keep(
    mountMap({
      mode: 'teaser',
      initialState: { view: 'board', selectedId: 'rule:rule-003', inspectorOpen: true },
    }),
  );
  const copy = map.qa('.ins-acts button').find((b) => b.textContent?.includes('Copy link'));
  expect(copy).toBeDefined();
  map.recorded.store().set(leaked);
  // A retained control must be safe even if it was detached by sanitization.
  click(copy);
  expect(writeText).toHaveBeenCalled();
  expect(writeText.mock.calls.at(-1)?.[0]).not.toContain('9000000000000000991');
  expect(map.recorded.store().get()).toMatchObject({
    selectedId: null,
    traceRootId: null,
    focusModuleApiName: null,
  });
  const snapshot = map.port.snapshot();
  map.recorded.store().set({ selectedId: 'rule:rule-003', inspectorOpen: true });
  const withoutRule = {
    ...snapshot.graph,
    nodes: new Map([...snapshot.graph.nodes].filter(([id]) => id !== 'rule:rule-003')),
  };
  map.publish({ ...snapshot, graph: withoutRule });
  await vi.advanceTimersByTimeAsync(350);
  expect(map.recorded.store().get().selectedId).toBeNull();
  expect(location.hash).not.toContain('rule-003');
});

it('review 4 reruns an existing source query when the real port index becomes ready', async () => {
  vi.useFakeTimers();
  const snapshot = createFixturePort('full').port.snapshot();
  const source = fixtureSources();
  const port = createStorePort({
    subscribe: (fn) => {
      fn(snapshot);
      return () => {};
    },
    sourceText: (id) => `${source.get(id) ?? ''}\n// review_async_source_924`,
    retry: async () => {},
    refresh: async () => {},
    refreshAccess: async () => {},
  });
  cleanups.push(() => port.dispose());
  const handle = mountAutomationMap({
    port,
    views: recordingViews().views,
    initialState: { view: 'list', query: 'review_async_source_924' },
  });
  cleanups.push(() => handle.close());
  const root = document.getElementById('zcdt-automation-map-overlay')?.shadowRoot;
  expect(root?.querySelectorAll('.ritem')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(root?.querySelectorAll('.ritem').length).toBeGreaterThan(0);
  expect(root?.querySelector('.am-search input')).toHaveProperty(
    'value',
    'review_async_source_924',
  );
});

it('review 5 restores explicit initialHash instead of an unrelated page hash', () => {
  history.replaceState(null, '', '#native-route');
  const views = recordingViews();
  const handle = mountAutomationMap({
    port: createFixturePort('full').port,
    views: views.views,
    initialHash: '#zcdt-map=v1;view=list;sel=rule:rule-003',
  });
  cleanups.push(() => handle.close());
  const root = document.getElementById('zcdt-automation-map-overlay')?.shadowRoot;
  expect(root?.querySelector('[data-view="list"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(root?.querySelector('.ins-head h2')?.textContent).toContain('Review large opportunities');
});

it.each([
  100, 200,
])('review 6 collects %s function sources linearly and authorizes sourceText with O(1) lookup', (count) => {
  vi.useFakeTimers();
  const base = fixtureGraph();
  const template = [...base.nodes.values()].find((n) => n.kind === 'function');
  if (template?.kind !== 'function') throw new Error('Missing fixture function');
  let visits = 0;
  class CountedNodes extends Map<string, MapNode> {
    override *values(): MapIterator<MapNode> {
      for (const node of super.values()) {
        visits++;
        yield node;
      }
    }
  }
  const nodes = new CountedNodes(
    Array.from({ length: count }, (_, i) => [
      `function:${i}`,
      { ...template, id: `function:${i}`, delugeId: String(i) },
    ]),
  );
  let snapshot: AutomationMapSnapshot = {
    ...createFixturePort('full').port.snapshot(),
    graph: { ...base, nodes },
  };
  let publish = (_snapshot: AutomationMapSnapshot) => {};
  const sourceText = vi.fn(() => '// synthetic source');
  const port = createStorePort({
    subscribe: (fn) => {
      publish = fn;
      fn(snapshot);
      return () => {};
    },
    sourceText,
    retry: async () => {},
    refresh: async () => {},
    refreshAccess: async () => {},
  });
  cleanups.push(() => port.dispose());
  vi.advanceTimersByTime(75);
  expect(sourceText).toHaveBeenCalledTimes(count);
  expect(visits).toBeLessThanOrEqual(count * 4);
  visits = 0;
  for (let i = 0; i < count; i++) expect(port.sourceText(String(i))).toBe('// synthetic source');
  expect(port.sourceText('fogged')).toBeNull();
  expect(visits).toBe(0);
  snapshot = { ...snapshot, graph: { ...snapshot.graph, nodes: new CountedNodes() } };
  publish(snapshot);
  expect(port.sourceText('0')).toBeNull();
  expect(port.search('synthetic', defaultFilters())).toEqual([]);
});

it.each([
  ['pointerup', 1],
  ['pointerup', 2],
  ['pointercancel', 1],
  ['pointercancel', 2],
] as const)('review 7 cleans up %s after lifting pinch pointer %s and continues single-pointer pan', (ending, first) => {
  const canvas = document.createElement('div'),
    world = document.createElement('div');
  document.body.append(canvas);
  canvas.append(world);
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener('error', onError);
  cleanups.push(() => window.removeEventListener('error', onError));
  const vp = new Viewport(canvas, world);
  cleanups.push(() => vp.dispose());
  const pointer = (type: string, id: number, x: number) => {
    const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 20 });
    Object.defineProperty(event, 'pointerId', { value: id });
    canvas.dispatchEvent(event);
  };
  pointer('pointerdown', 1, 10);
  pointer('pointerdown', 2, 110);
  pointer('pointermove', 2, 150);
  const remaining = first === 1 ? 2 : 1;
  pointer(ending, first, first === 1 ? 10 : 150);
  expect(errors).toEqual([]);
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(first);
  const before = { x: vp.x, y: vp.y, z: vp.z };
  pointer('pointermove', remaining, (remaining === 1 ? 10 : 150) + 20);
  expect(vp.x).toBe(before.x + 20);
  expect(vp.z).toBe(before.z);
  pointer('pointerup', remaining, 30);
  expect(canvas.classList.contains('amc-panning')).toBe(false);
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(remaining);
});

it('review 4 preserves pending typed text when index/coverage publishes before its debounce', async () => {
  vi.useFakeTimers();
  const map = keep(mountMap({ initialState: { view: 'board' } }));
  map.publish({ ...map.port.snapshot(), phase: 'enriching' });
  await vi.advanceTimersByTimeAsync(100);
  const input = map.q<HTMLInputElement>('.am-search input');
  if (!input) throw new Error('Missing map search');
  input.value = 'Review';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(60);
  expect(input.value).toBe('Review');
  await vi.advanceTimersByTimeAsync(40);
  expect(map.recorded.store().get().query).toBe('Review');
  expect(map.qa('.ritem').length).toBeGreaterThan(0);
});
