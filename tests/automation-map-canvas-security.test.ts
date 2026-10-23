import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAutomationGraph } from '../src/content/automation-map/graph';
import {
  boardControllerFor,
  mountBoardView,
  mountTraceView,
  traceControllerFor,
} from '../src/content/automation-map/ui/canvas';
import { attach, installDomStubs, makeContext, portFor } from './automation-map-canvas-fixtures';
import { fixtureInputs, fixtureSources } from './fixtures/automation-map';

const PAYLOAD = '<img src=x onerror=alert(1)>';

/** The fixture org with the payload as a module, rule, function, field and template label. */
function hostileGraph() {
  const inputs = fixtureInputs();
  const functions = inputs.functions.map((f) =>
    f.delugeId === 'f-000' ? { ...f, summary: { ...f.summary, display_name: PAYLOAD } } : f,
  );
  const rules = inputs.rules.map((r) =>
    r.id === 'rule-003'
      ? { ...r, name: PAYLOAD }
      : r.id === 'rule-005'
        ? {
            ...r,
            conditions: r.conditions.map((c) => ({
              ...c,
              instantActions: c.instantActions.map((a) =>
                a.kind === 'emailNotification' && a.template
                  ? { ...a, template: { ...a.template, name: PAYLOAD } }
                  : a,
              ),
            })),
          }
        : r,
  );
  return buildAutomationGraph({
    ...inputs,
    modules: inputs.modules.map((m) => (m.apiName === 'Deals' ? { ...m, label: PAYLOAD } : m)),
    fields: new Map(
      [...inputs.fields].map(([module, list]) => [
        module,
        list.map((f) => (f.apiName === 'Stage' ? { ...f, label: PAYLOAD } : f)),
      ]),
    ),
    functions,
    rules,
  });
}

beforeEach(() => installDomStubs());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.textContent = '';
});

const noInjected = (root: Element) => {
  expect(root.querySelectorAll('img').length).toBe(0);
  expect(root.querySelectorAll('script').length).toBe(0);
  expect(root.querySelectorAll('[onerror]').length).toBe(0);
  for (const el of root.querySelectorAll('*'))
    for (const attr of el.attributes) expect(attr.name.startsWith('on')).toBe(false);
};

describe('hostile CRM names', () => {
  it('never become elements on the board', () => {
    const graph = hostileGraph();
    expect([...graph.nodes.values()].filter((n) => n.label === PAYLOAD).length).toBeGreaterThan(3);
    const port = portFor(graph, fixtureSources());
    const { ctx, store } = makeContext(port, { focusModuleApiName: 'Deals' });
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    const board = boardControllerFor(container);
    board?.flush();
    // Overview, detail, search, selection and hover all render names.
    noInjected(container);
    store.set({ query: 'sales' });
    const rule = [...(board?.model().byIid.values() ?? [])].find((i) => i.node?.label === PAYLOAD);
    expect(rule).toBeDefined();
    store.set({ selectedId: rule?.node?.id ?? null });
    board?.flush();
    const card = container.querySelector(`[data-iid="${rule?.iid}"]`);
    expect(card?.textContent).toContain(PAYLOAD);
    card?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    noInjected(container);
    // The text is there, verbatim, as text.
    expect(container.textContent).toContain(PAYLOAD);
    dispose();
  });

  it('never become elements in the trace', async () => {
    const graph = hostileGraph();
    const port = portFor(graph, fixtureSources());
    const hostile = [...graph.nodes.values()].find((n) => n.kind === 'rule' && n.label === PAYLOAD);
    const { ctx } = makeContext(port, { view: 'trace', traceRootId: hostile?.id ?? null });
    const container = attach();
    const dispose = mountTraceView(container, ctx);
    await traceControllerFor(container)?.ready;
    expect(container.textContent).toContain(PAYLOAD);
    noInjected(container);
    dispose();
  });

  it('never become elements in the fog teaser', async () => {
    const graph = hostileGraph();
    const base = portFor(graph, fixtureSources());
    const snap = base.snapshot();
    base.publish({
      ...snap,
      access: { level: 'teaser', revealedModuleApiName: 'Deals', reason: 'lower-plan' },
      teaser: {
        fogged: [
          {
            slot: 0,
            counts: { rules: 3, functions: 2, buttons: 0, schedules: 0 },
            recordWrites: 1,
          },
        ],
        totals: { rules: 10, functions: 9, modules: 3 },
      },
    });
    const { ctx } = makeContext(base);
    const container = attach();
    const dispose = mountBoardView(container, ctx);
    boardControllerFor(container)?.flush();
    expect(container.textContent).toContain(PAYLOAD);
    noInjected(container);
    dispose();
  });
});
