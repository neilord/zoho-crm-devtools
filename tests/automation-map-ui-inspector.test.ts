import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import { evidenceMarkers } from '../src/content/automation-map/ui/code';
import {
  click,
  flush,
  type MountedMap,
  mountMap,
  mountWithStore,
  portForInputs,
} from './automation-map-ui-helpers';
import { fixtureGraph, fixtureInputs } from './fixtures/automation-map';

let map: MountedMap | null = null;
afterEach(() => {
  map?.handle.close();
  map = null;
  document.body.replaceChildren();
  history.replaceState(null, '', location.pathname);
});
const open = (id: string, view: 'fields' | 'list' | 'board' = 'list', extra = {}) =>
  mountMap({ initialState: { view, selectedId: id, inspectorOpen: true, ...extra } });
const text = (m: MountedMap, selector: string) => m.q(selector)?.textContent ?? '';

describe('inspector: evidence lines', () => {
  it('marks the code lines that the edge spans point at and names what each writes', () => {
    map = open('function:f-003');
    const graph = fixtureGraph();
    const fn = graph.nodes.get('function:f-003');
    const expected = evidenceMarkers(graph, fn as never)
      .filter((m) => m.writes)
      .map((m) => m.line);
    expect(expected).toEqual([3]);
    const marked = map.qa('.codebox .cl.ev').map((n) => Number(n.dataset.ln));
    expect(marked).toEqual(expected);
    const row = map.q('.codebox .cl.ev') as HTMLElement;
    expect(row.textContent).toContain('writes Stage');
    expect(row.textContent).toContain('may re-trigger rules');
    expect(row.querySelector('.evc.casc')).not.toBeNull();
    expect(text(map, '.cbar .evpos')).toBe('Evidence 1 of 1');
  });

  it('derives call evidence from invokes and calls edges, not only writes', () => {
    const graph = fixtureGraph();
    const markers = evidenceMarkers(graph, graph.nodes.get('function:f-006') as never);
    const labels = markers.flatMap((m) => m.chips.map((c) => c.label));
    expect(labels.some((l) => l.startsWith('writes '))).toBe(true);
    expect(labels.some((l) => l.startsWith('calls '))).toBe(true);
    expect(markers.filter((m) => !m.writes).length).toBeGreaterThan(0);
  });

  it('steps through several evidence lines with the arrows and wraps around', () => {
    const inputs = fixtureInputs();
    const source =
      'zoho.crm.updateRecord("Deals",recordId,{"Stage":"A"});\n// gap\nzoho.crm.updateRecord("Deals",recordId,{"Stage":"B"});\nzoho.crm.updateRecord("Accounts",recordId,{"Health_Score":1});';
    const catalogue = inputs.functions.map((f) => ({
      id: f.delugeId,
      apiName: f.summary.api_name ?? f.delugeId,
      category: 'standalone',
    }));
    const patched = {
      ...inputs,
      functions: inputs.functions.map((f) =>
        f.delugeId === 'f-000'
          ? {
              ...f,
              sourceText: source,
              effects: analyzeDelugeEffects(source, {
                functionId: 'f-000',
                parameters: ['recordId'],
                catalogue,
              }),
            }
          : f,
      ),
    };
    const { port } = portForInputs(patched);
    map = mountMap({
      port,
      initialState: { view: 'list', selectedId: 'function:f-000', inspectorOpen: true },
    });
    const lines = map.qa('.codebox .cl.ev').map((n) => Number(n.dataset.ln));
    expect(lines).toEqual([1, 3, 4]);
    expect(text(map, '.evpos')).toBe('Evidence 1 of 3');
    expect(map.q('.cl.cur')?.getAttribute('data-ln')).toBe('1');
    const next = map.q('[aria-label="Next evidence line"]');
    click(next);
    expect(text(map, '.evpos')).toBe('Evidence 2 of 3');
    expect(map.q('.cl.cur')?.getAttribute('data-ln')).toBe('3');
    click(next);
    click(next);
    expect(text(map, '.evpos')).toBe('Evidence 1 of 3');
    click(map.q('[aria-label="Previous evidence line"]'));
    expect(text(map, '.evpos')).toBe('Evidence 3 of 3');
  });

  it('starts on the evidence line of the lens card that was clicked', () => {
    map = mountMap({
      initialState: { view: 'fields', field: { moduleApiName: 'Deals', fieldApiName: 'Stage' } },
    });
    const card = map
      .qa('.wcard[data-tier="exact"]')
      .find((c) => c.dataset.sel === 'function:f-003') as HTMLElement;
    click(card);
    expect(map.q('.am-insp.open .codebox')).not.toBeNull();
    expect(map.q('.cl.cur')?.getAttribute('data-ln')).toBe('3');
    expect(map.q('.wcard.sel')).toBe(card);
  });

  it('highlights search hits in the code without hiding the evidence bar', () => {
    map = open('function:f-003', 'list', { query: 'updateRecord' });
    const row = map.q('.codebox .cl.ev.hit');
    expect(row).not.toBeNull();
    expect(row?.querySelector('mark')?.textContent?.toLowerCase()).toBe('updaterecord');
  });

  it('explains a function whose source is unavailable instead of faking analysis', () => {
    map = open('function:f-058');
    expect(map.q('.codebox')).toBeNull();
    expect(text(map, '.anabox.bad')).toMatch(/Not analysed: source unavailable/);
    expect(text(map, '.ins-scroll')).toContain(
      'Writes unknown: this function could not be fully analysed.',
    );
  });
});

describe('inspector: content per kind', () => {
  it('shows a rule with its trigger, criteria and actions, and hands off to Zoho', () => {
    map = open('rule:rule-003');
    expect(text(map, '.ins-kind')).toContain('Workflow rule');
    const body = text(map, '.ins-scroll');
    expect(body).toContain('Runs when');
    expect(body).toMatch(/Stage is modified to/);
    expect(body).toContain('Conditions & actions');
    expect(map.qa('.cond .act').length).toBeGreaterThan(1);
    expect(body).toContain('Writes');
    click(map.qa('.ins-foot button').find((b) => b.textContent === 'Open in Zoho'));
    expect(map.calls.openedRules).toEqual(['rule-003']);
  });

  it('opens the owning rule from an action node', () => {
    map = open('action:rule-003/0/i/1');
    expect(text(map, '.ins-kind')).toContain('Field update');
    click(map.qa('.ins-foot button').find((b) => b.textContent === 'Open in Zoho'));
    expect(map.calls.openedRules).toEqual(['rule-003']);
  });

  it('shows a function with callers, writes and the function handoff', () => {
    map = open('function:f-003');
    expect(text(map, '.ins-kind')).toContain('Function');
    expect(text(map, '.ins-scroll')).toContain('Called by');
    expect(map.qa('.wrow .fchip').length).toBeGreaterThan(0);
    click(map.qa('.ins-foot button').find((b) => b.textContent === 'Open in Zoho'));
    expect(map.calls.openedFunctions).toEqual(['f-003']);
  });

  it('shows a field with writer groups, reactors and the lens shortcut', () => {
    map = mountWithStore({ view: 'list', selectedId: 'field:Deals.Stage', inspectorOpen: true });
    expect(text(map, '.ins-scroll')).toContain('Declared in configuration');
    expect(text(map, '.ins-scroll')).toContain('Reactors');
    expect(map.qa('.ins-acts button').map((b) => b.textContent)).toContain('Show writers');
    click(map.qa('.ins-scroll button').find((b) => b.textContent?.includes('Open field lens')));
    expect(map.recorded.store().get()).toMatchObject({
      view: 'fields',
      field: { moduleApiName: 'Deals', fieldApiName: 'Stage' },
    });
  });

  it('shows templates and external systems with the configuration-only note', () => {
    map = open('template:guide-0');
    expect(text(map, '.ins-scroll')).toContain('Your next steps');
    expect(text(map, '.ins-scroll')).toContain('Used by');
    map.handle.close();
    map = open('external:webhookHost:hooks.example.invalid');
    expect(text(map, '.ins-scroll')).toContain('hooks.example.invalid');
    expect(text(map, '.ins-scroll')).toContain('Configuration only. Nothing is called from here.');
  });

  it('shows buttons, schedules, transitions and approvals', () => {
    for (const [id, needle] of [
      ['button:review-partner', 'Placement'],
      ['schedule:nightly-review', 'Every day at 02:00'],
      ['transition:sales-process/submit', 'Opportunity review'],
      ['approval:discount-review', 'Approval process'],
    ] as const) {
      map = open(id);
      expect(text(map, '.ins-scroll')).toContain(needle);
      map.handle.close();
    }
    map = null;
  });

  it('offers no Zoho handoff where the port has none', () => {
    map = open('field:Deals.Stage');
    expect(map.qa('.ins-foot button').map((b) => b.textContent)).toEqual(['Trace from here']);
  });

  it('says so when the selected item is not in the map', () => {
    map = open('rule:does-not-exist');
    expect(text(map, '.ins-head h2')).toBe('Not in the map');
  });
});

describe('inspector: actions and state', () => {
  it('opens from a store change made elsewhere, such as the canvas', () => {
    map = mountMap({ initialState: { view: 'board' } });
    expect(map.q('.am-insp.open')).toBeNull();
    map.recorded.store().set({ selectedId: 'rule:rule-003', inspectorOpen: true });
    expect(map.q('.am-insp.open')).not.toBeNull();
    expect(text(map, '.ins-head h2')).toContain('Review large opportunities');
    map.recorded.store().set({ inspectorOpen: false });
    expect(map.q('.am-insp.open')).toBeNull();
    expect(map.q('.am-insp')?.children.length).toBe(0);
  });

  it('closes with the close button and clears the selection', () => {
    map = mountWithStore({ selectedId: 'rule:rule-003', inspectorOpen: true });
    click(map.q('[data-fk="insp-close"]'));
    expect(map.recorded.store().get()).toMatchObject({ selectedId: null, inspectorOpen: false });
  });

  it('starts a trace from the node, with field depths for a field', () => {
    map = mountWithStore({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Trace from here')));
    expect(map.recorded.store().get()).toMatchObject({
      view: 'trace',
      traceRootId: 'rule:rule-003',
      traceDepth: { upstream: 2, downstream: 3 },
    });
    map.handle.close();
    map = mountWithStore({ view: 'list', selectedId: 'field:Deals.Stage', inspectorOpen: true });
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Trace from here')));
    expect(map.recorded.store().get().traceDepth).toEqual({ upstream: 3, downstream: 2 });
  });

  it('switches between list and board for the same node', () => {
    map = mountWithStore({ view: 'list', selectedId: 'rule:rule-003', inspectorOpen: true });
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Show on board')));
    expect(map.recorded.store().get()).toMatchObject({
      view: 'board',
      selectedId: 'rule:rule-003',
    });
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Show in list')));
    expect(map.recorded.store().get().view).toBe('list');
  });

  it('copies a local deep link and confirms it', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    map = open('rule:rule-003');
    click(map.qa('.ins-acts button').find((b) => b.textContent?.includes('Copy link')));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const link = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(link).toContain('#zcdt-map=v1;view=list;sel=rule:rule-003');
    expect(text(map, '.toast')).toBe('Link copied');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('navigates to a linked node from the inspector', () => {
    map = mountWithStore({ view: 'list', selectedId: 'function:f-003', inspectorOpen: true });
    click(map.q('.lnk'));
    expect(map.recorded.store().get().selectedId).not.toBe('function:f-003');
  });
});
