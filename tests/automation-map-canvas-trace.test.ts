import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAutomationGraph } from '../src/content/automation-map/graph';
import { createTraceView } from '../src/content/automation-map/ui/canvas/trace';
import {
  buildTraceModel,
  TRACE_FAN_OUT,
} from '../src/content/automation-map/ui/canvas/trace-model';
import {
  attach,
  defaultFilters,
  fire,
  fixturePort,
  installDomStubs,
  makeContext,
  press,
} from './automation-map-canvas-fixtures';
import { fixtureInputs } from './fixtures/automation-map';

beforeEach(() => installDomStubs());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.textContent = '';
});

async function mountTrace(
  root: string,
  patch: Parameters<typeof makeContext>[1] = {},
  port = fixturePort(),
) {
  const { ctx, store } = makeContext(port, { view: 'trace', traceRootId: root, ...patch });
  const container = attach();
  const trace = createTraceView(container, ctx);
  await trace.ready;
  return { trace, store, container, port, ctx };
}

describe('trace view', () => {
  it('lays columns out left to right by depth, with the base node highlighted', async () => {
    const { trace, container } = await mountTrace('rule:rule-005');
    const vm = trace.model();
    const lay = trace.layout();
    expect(vm).not.toBeNull();
    expect(lay).not.toBeNull();
    if (!vm || !lay) return;
    expect(lay.levels).toEqual([...lay.levels].sort((a, b) => a - b));
    expect(lay.levels).toContain(0);
    expect(lay.levels.some((l) => l < 0)).toBe(true);
    expect(lay.levels.some((l) => l > 0)).toBe(true);
    // Columns snap to depth: same level, same x; deeper level, further right.
    for (const a of vm.nodes)
      for (const b of vm.nodes) {
        // Cards are centred in their column, so compare centres.
        if (a.level === b.level) expect(a.x + a.w / 2).toBeCloseTo(b.x + b.w / 2, 5);
        else if (a.level < b.level) expect(a.x + a.w / 2).toBeLessThan(b.x + b.w / 2);
      }
    // Every forward edge points rightwards.
    const byId = new Map(vm.nodes.map((n) => [n.id, n]));
    for (const e of vm.edges) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (from && to && !e.back) expect(to.x).toBeGreaterThan(from.x);
    }
    const base = container.querySelector('.amc-nd.amc-base') as HTMLElement;
    expect(trace.nodeIdOf(base)).toBe('rule:rule-005');
    const labels = [...container.querySelectorAll('.amc-lvl-lbl')].map((e) => e.textContent);
    expect(labels).toContain('Start');
    expect(labels.some((l) => /^\d+ down$/.test(l ?? ''))).toBe(true);
    expect(labels.some((l) => /^\d+ up$/.test(l ?? ''))).toBe(true);
  });

  it('dims a context ring one hop beyond the depth and expands it from the "+"', async () => {
    const { container, store } = await mountTrace('rule:rule-005', {
      traceDepth: { upstream: 1, downstream: 1 },
    });
    const ghosts = [...container.querySelectorAll('.amc-nd.amc-ghost')] as HTMLElement[];
    expect(ghosts.length).toBeGreaterThan(0);
    const plus = ghosts[0].querySelector('.amc-plus') as HTMLElement;
    expect(plus).not.toBeNull();
    const before = store.get().traceDepth;
    fire(ghosts[0], 'click');
    const after = store.get().traceDepth;
    expect(after.upstream + after.downstream).toBe(before.upstream + before.downstream + 1);
    // No ring without "Show context".
    const checkbox = container.querySelector('.amc-check input') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('caps fan-out at five plus a "+N more" chip that expands in place', async () => {
    const root = 'function:f-000';
    // Callers in active scope, one layer up.
    const callers = fixturePort()
      .trace(root, {
        upstream: 1,
        downstream: 0,
        maxNodes: 160,
        includeInactive: false,
      })
      .edges.filter((e) => e.to === root).length;
    expect(callers).toBeGreaterThan(TRACE_FAN_OUT);
    const { container, trace } = await mountTrace(root, {
      traceDepth: { upstream: 1, downstream: 0 },
    });
    const chip = container.querySelector('.amc-more-fan') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe(`+${callers - (TRACE_FAN_OUT - 1)} more`);
    const shown = trace.model()?.nodes.filter((n) => n.level === -1 && n.item && !n.ghost).length;
    expect(shown).toBe(TRACE_FAN_OUT - 1);
    fire(chip, 'click');
    await trace.settled();
    expect(container.querySelector('.amc-more-fan')).toBeNull();
    expect(trace.model()?.nodes.filter((n) => n.level === -1 && n.item && !n.ghost).length).toBe(
      callers,
    );
  });

  it('shows a truncation chip when the node limit cuts the trace', async () => {
    const port = fixturePort();
    port.traceOverrides.maxNodes = 7;
    const { container, trace } = await mountTrace(
      'function:f-000',
      { traceDepth: { upstream: 0, downstream: 3 } },
      port,
    );
    const limit = container.querySelector('.amc-more-limit') as HTMLElement;
    expect(limit).not.toBeNull();
    expect(limit.textContent).toMatch(/^\+\d+ more$/);
    // The view asks for one extra layer each way for the context ring.
    const result = port.trace('function:f-000', {
      upstream: 1,
      downstream: 4,
      maxNodes: 7,
      includeInactive: false,
    });
    expect(limit.textContent).toBe(`+${result.truncated.downstream} more`);
    expect(trace.model()?.nodes.some((n) => n.more?.kind === 'limit')).toBe(true);
  });

  it('styles edges by evidence tier and cascade', async () => {
    // Inferred writes are dashed, unresolved ones hollow, possible cascades amber.
    const everything = { filters: { ...defaultFilters(), scope: 'everything' as const } };
    const writes = await mountTrace('function:f-005', {
      traceDepth: { upstream: 0, downstream: 2 },
      ...everything,
    });
    expect(writes.container.querySelector('.amc-e-ur-o')).not.toBeNull();
    expect(writes.container.querySelector('.amc-e-ur-i')).not.toBeNull();
    const inferred = await mountTrace('function:f-000', {
      traceDepth: { upstream: 0, downstream: 2 },
      ...everything,
    });
    expect(inferred.container.querySelector('.amc-e-inf')).not.toBeNull();
    const declared = [...inferred.container.querySelectorAll('.amc-e')].filter(
      (e) =>
        !e.classList.contains('amc-e-inf') &&
        !e.classList.contains('amc-e-ur-o') &&
        !e.classList.contains('amc-e-ur-i'),
    );
    expect(declared.length).toBeGreaterThan(0);
    const cascade = await mountTrace('function:f-003', {
      traceDepth: { upstream: 0, downstream: 2 },
      ...everything,
    });
    expect(cascade.container.querySelector('.amc-e-casc')).not.toBeNull();
  });

  it('re-bases on double-click, steps depth, and exits to the board', async () => {
    const { container, store, trace } = await mountTrace('rule:rule-005');
    const other = container.querySelector(
      '.amc-nd[data-ix]:not(.amc-base):not(.amc-ghost)',
    ) as HTMLElement;
    fire(other, 'click');
    const otherId = trace.nodeIdOf(other);
    expect(otherId).toBeTruthy();
    expect(store.get().selectedId).toBe(otherId);
    fire(other, 'dblclick');
    expect(store.get().traceRootId).toBe(otherId);
    await trace.settled();
    expect(trace.nodeIdOf(container.querySelector('.amc-nd.amc-base') as Element)).toBe(otherId);

    const d0 = store.get().traceDepth.downstream;
    const buttons = [...container.querySelectorAll('.amc-stepper button')] as HTMLElement[];
    const moreDown = buttons.find((b) => b.getAttribute('aria-label') === 'More downstream');
    moreDown?.click();
    expect(store.get().traceDepth.downstream).toBe(d0 + 1);
    const root = container.querySelector('.amc-root') as HTMLElement;
    press(root, ']');
    expect(store.get().traceDepth.downstream).toBe(d0 + 2);
    const up0 = store.get().traceDepth.upstream;
    press(root, '}');
    expect(store.get().traceDepth.upstream).toBe(up0 + 1);
    press(root, '{');
    expect(store.get().traceDepth.upstream).toBe(up0);

    press(root, 'Escape');
    expect(store.get().view).toBe('board');
    expect(store.get().traceRootId).toBeNull();
  });

  it('opens the inspector on click and Enter, and moves through the chart with the arrow keys', async () => {
    const { container, store, trace } = await mountTrace('rule:rule-005');
    const other = container.querySelector(
      '.amc-nd[data-ix]:not(.amc-base):not(.amc-ghost)',
    ) as HTMLElement;
    const id = trace.nodeIdOf(other);
    fire(other, 'click');
    expect(store.get()).toMatchObject({ selectedId: id, inspectorOpen: true });
    fire(container.querySelector('.amc-canvas') as Element, 'click');
    expect(store.get()).toMatchObject({ selectedId: null, inspectorOpen: false });

    // Exactly one card is a tab stop, and Enter opens it.
    const stops = container.querySelectorAll('.amc-nd[tabindex="0"]');
    expect(stops.length).toBe(1);
    const base = container.querySelector('.amc-nd.amc-base') as HTMLElement;
    expect(stops[0]).toBe(base);
    base.focus();
    press(base, 'Enter');
    expect(store.get()).toMatchObject({ selectedId: 'rule:rule-005', inspectorOpen: true });
    // Arrows walk downstream and upstream; the selection follows.
    press(document.activeElement as Element, 'ArrowRight');
    const down = trace.nodeIdOf(document.activeElement as Element);
    expect(down).toBeTruthy();
    expect(down).not.toBe('rule:rule-005');
    expect(store.get().selectedId).toBe(down);
    press(document.activeElement as Element, 'ArrowLeft');
    expect(trace.nodeIdOf(document.activeElement as Element)).toBe('rule:rule-005');
  });

  it('puts a node on a cycle in its nearer column and keeps cycle labels apart', async () => {
    // Set Stage writes Deals.Stage, and rules that react to Stage lead back to it: the field is
    // one hop downstream of the action, so a "1 down" column must exist (upstream used to win).
    const { trace, container } = await mountTrace('action:rule-003/0/i/1', {
      traceDepth: { upstream: 2, downstream: 3 },
    });
    const vm = trace.model();
    expect(vm?.nodes.find((n) => n.id === 'field:Deals.Stage')?.level).toBe(1);
    const labels = [...container.querySelectorAll('.amc-lvl-lbl')].map((e) => e.textContent);
    expect(labels).toContain('1 down');
    expect(vm?.edges.some((e) => e.back)).toBe(true);
    // Every forward edge still points right; only the cycle edges run back.
    const byId = new Map(vm?.nodes.map((n) => [n.id, n]));
    for (const e of vm?.edges ?? []) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (a && b && !e.back) expect(b.level).toBeGreaterThan(a.level);
    }
    // One label per lane, each at its own height: nothing overprints.
    const spots = [...container.querySelectorAll('.amc-elabel')].map(
      (t) => `${t.getAttribute('x')},${t.getAttribute('y')}`,
    );
    expect(new Set(spots).size).toBe(spots.length);
    const ys = [...container.querySelectorAll('.amc-elabel')].map((t) =>
      Number(t.getAttribute('y')),
    );
    for (let i = 1; i < ys.length; i++)
      expect(Math.abs(ys[i] - ys[i - 1])).toBeGreaterThanOrEqual(12);
  });

  it('places the reactors of a field downstream even when they also write it', async () => {
    const { trace } = await mountTrace('field:Deals.Stage', {
      traceDepth: { upstream: 3, downstream: 2 },
    });
    const vm = trace.model();
    const down = vm?.nodes.filter((n) => n.level > 0 && !n.more && !n.ghost) ?? [];
    expect(down.length).toBeGreaterThan(0);
    expect(down.some((n) => n.item?.kind === 'rule')).toBe(true);
  });

  it('shows a hint when there is nothing to trace', async () => {
    const { container } = await mountTrace('rule:does-not-exist');
    expect(container.querySelector('.amc-empty')?.hasAttribute('hidden')).toBe(false);
  });

  it('shows only the way out when there is nothing to trace', async () => {
    const { container } = await mountTrace('rule:does-not-exist');
    expect(container.querySelector('.amc-stepper')).toBeNull();
    expect(container.querySelector('.amc-check')).toBeNull();
    expect(container.querySelector('.amc-tracebar')?.textContent).toContain('Exit trace');
    const none = await mountTrace('');
    expect(none.container.querySelector('.amc-stepper')).toBeNull();
  });

  it('keeps node text readable: fits whole at 0.85 or more, otherwise stays at 0.85', async () => {
    const wide = await mountTrace('rule:rule-005', { traceDepth: { upstream: 6, downstream: 6 } });
    const z = wide.trace.viewport().z;
    expect(z).toBeGreaterThanOrEqual(0.85 - 1e-9);
  });

  it('keeps the base node where it was when a group expands', async () => {
    const { trace, container } = await mountTrace('rule:rule-005', {
      traceDepth: { upstream: 1, downstream: 1 },
    });
    const baseCentre = () => {
      const base = trace.model()?.nodes.find((n) => n.id === trace.model()?.rootId);
      const vp = trace.viewport();
      return base
        ? { x: (base.x + base.w / 2) * vp.z + vp.x, y: (base.y + base.h / 2) * vp.z + vp.y }
        : null;
    };
    const before = baseCentre();
    // Deeper trace: dagre re-lays the whole chart out, but the base stays under the pointer.
    container.querySelectorAll<HTMLElement>('.amc-stepper button').forEach((b) => {
      if (b.getAttribute('aria-label') === 'More downstream') b.click();
    });
    await trace.settled();
    const after = baseCentre();
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 3);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 3);
  });

  it('never joins a context node across the chart, whatever the root and depth', async () => {
    for (const root of ['action:rule-003/0/i/1', 'field:Deals.Stage', 'rule:rule-005']) {
      for (const depth of [1, 2]) {
        const { trace } = await mountTrace(root, {
          traceDepth: { upstream: depth, downstream: depth },
        });
        const vm = trace.model();
        const level = new Map(vm?.nodes.map((n) => [n.id, n.level]));
        const ghosts = new Set(vm?.nodes.filter((n) => n.ghost).map((n) => n.id));
        for (const e of vm?.edges ?? [])
          if (ghosts.has(e.from) || ghosts.has(e.to))
            expect(
              Math.abs((level.get(e.to) ?? 0) - (level.get(e.from) ?? 0)),
              `${root} depth ${depth}: ${e.from} > ${e.to}`,
            ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('draws no faint context edge across the chart', async () => {
    const { trace } = await mountTrace('field:Deals.Stage', {
      traceDepth: { upstream: 1, downstream: 1 },
    });
    const vm = trace.model();
    const level = new Map(vm?.nodes.map((n) => [n.id, n.level]));
    const ghosts = new Set(vm?.nodes.filter((n) => n.ghost).map((n) => n.id));
    expect(ghosts.size).toBeGreaterThan(0);
    const span = (e: { from: string; to: string }) =>
      Math.abs((level.get(e.to) ?? 0) - (level.get(e.from) ?? 0));
    for (const g of ghosts) {
      const mine = (vm?.edges ?? []).filter((e) => e.from === g || e.to === g);
      // A context node hangs off a neighbouring column; none is joined across the chart.
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.filter((e) => span(e) > 1)).toEqual([]);
    }
  });

  it('builds a deterministic model', () => {
    const graph = buildAutomationGraph(fixtureInputs());
    const port = fixturePort();
    const build = () =>
      buildTraceModel(
        graph,
        port.trace('rule:rule-005', {
          upstream: 3,
          downstream: 4,
          maxNodes: 160,
          includeInactive: false,
        }),
        { up: 2, down: 3, context: true, expanded: new Set() },
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
