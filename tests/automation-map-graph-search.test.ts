// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import { buildAutomationGraph } from '../src/content/automation-map/graph/build';
import { buildSearchIndex, searchMap } from '../src/content/automation-map/graph/search';
import type { MapFilters } from '../src/content/automation-map/types';
import {
  fixtureGraph,
  fixtureInputs,
  fixtureSources,
  generateLargeInputs,
} from './fixtures/automation-map';

const filters = (patch: Partial<MapFilters> = {}): MapFilters => ({
  scope: 'everything',
  modules: new Set(),
  kinds: new Set(),
  triggerTypes: new Set(),
  flags: new Set(),
  ...patch,
});

describe('Automation Map literal search', () => {
  it('indexes names, APIs, criteria, values, templates, URLs and source', () => {
    const index = buildSearchIndex(fixtureGraph(), fixtureSources());
    for (const [query, location] of [
      ['Update sales health', 'name'],
      ['update_sales_health', 'apiName'],
      ['Manufacturing', 'criteria'],
      ['Review', 'value'],
      ['Arrange a product review', 'template'],
      ['/crm/review?source=', 'url'],
      ['input.get("patch")', 'source'],
    ] as const) {
      expect(
        searchMap(index, query, filters()).some((h) =>
          h.matches.some((m) => m.location === location),
        ),
        `${location}: ${query}`,
      ).toBe(true);
    }
    expect(
      searchMap(index, 'YOUR NEXT STEPS', filters()).some((h) => h.nodeId.startsWith('template:')),
    ).toBe(true);
    expect(searchMap(index, '   ', filters())).toEqual([]);
    expect(searchMap(index, 'not present anywhere', filters())).toEqual([]);
  });
  it('ranks name before apiName before body, then active before inactive', () => {
    const inputs = fixtureInputs();
    const make = (id: string, display: string, api: string, source: string, active: boolean) => ({
      ...inputs.functions[0],
      delugeId: id,
      summary: {
        ...inputs.functions[0].summary,
        id,
        display_name: display,
        api_name: api,
        rest_api: [{ type: 'oauth', active }],
      },
      places: [],
      sourceText: source,
      effects: analyzeDelugeEffects(source),
    });
    const functions = [
      make('inactive-name', 'Needle', 'old', '', false),
      make('active-name', 'NEEDLE', 'new', '', true),
      make('api', 'API match', 'needle_api', '', true),
      make('source', 'Body match', 'body', 'info "needle";', true),
    ];
    const graph = buildAutomationGraph({
      ...inputs,
      functions,
      rules: [],
      buttons: [],
      schedules: [],
      approvals: [],
      transitions: [],
    });
    const index = buildSearchIndex(
      graph,
      new Map(functions.map((f) => [f.delugeId, f.sourceText ?? ''])),
    );
    expect(searchMap(index, 'needle', filters()).map((h) => h.nodeId)).toEqual([
      'function:active-name',
      'function:inactive-name',
      'function:api',
      'function:source',
    ]);
    expect(
      searchMap(index, 'needle', filters({ scope: 'active' })).map((h) => h.nodeId),
    ).not.toContain('function:inactive-name');
  });
  it('reports one-based CRLF lines, bounded snippets and relative literal highlights', () => {
    const inputs = fixtureInputs();
    const source = '// 😀 first\r\ninfo "Stage = [Review].";\r\ninfo "stage = [review].";\r\n';
    const f = { ...inputs.functions[0], sourceText: source, effects: analyzeDelugeEffects(source) };
    const graph = buildAutomationGraph({ ...inputs, functions: [f] });
    const index = buildSearchIndex(graph, new Map([[f.delugeId, source]]));
    const hit = searchMap(index, '[review].', filters()).find((h) => h.nodeId === 'function:f-000');
    expect(hit?.matches.map((m) => m.line)).toEqual([2, 3]);
    for (const match of hit?.matches ?? []) {
      expect(match.snippet.length).toBeLessThan(180);
      expect(
        match.highlights.map((h) => match.snippet.slice(h.start, h.end).toLowerCase()),
      ).toEqual(['[review].']);
    }
  });
  it('caps dense matches per node and honors module, kind and active filters', () => {
    const inputs = fixtureInputs();
    const source = Array.from({ length: 100 }, () => 'info "needle needle";').join('\n');
    const graph = buildAutomationGraph(inputs);
    const index = buildSearchIndex(graph, new Map([['f-000', source]]));
    const hits = searchMap(index, 'needle', filters());
    expect(hits[0]?.matches).toHaveLength(8);
    expect(hits[0]?.matches[0].highlights).toHaveLength(2);
    const rules = searchMap(
      index,
      'review',
      filters({ scope: 'active', modules: new Set(['Deals']), kinds: new Set(['rule']) }),
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const h of rules)
      expect(graph.nodes.get(h.nodeId)).toMatchObject({
        kind: 'rule',
        moduleApiName: 'Deals',
        inActiveScope: true,
      });
  });
  it('keeps original highlight offsets when Unicode case folding expands text', () => {
    const graph = fixtureGraph();
    const index = buildSearchIndex(graph, new Map([['f-000', 'info "İSTANBUL 😀 Review";']]));
    const matches =
      searchMap(index, 'review', filters())[0]?.matches.filter((m) => m.location === 'source') ??
      [];
    const hit = searchMap(index, 'review', filters()).find((h) => h.nodeId === 'function:f-000');
    expect(matches.length).toBeLessThanOrEqual(8);
    const match = hit?.matches.find((m) => m.location === 'source');
    const range = match?.highlights[0];
    expect(match?.snippet.slice(range?.start, range?.end)).toBe('Review');
    const foldedChar = searchMap(index, 'i', filters())
      .find((h) => h.nodeId === 'function:f-000')
      ?.matches.find((m) => m.location === 'source');
    expect(foldedChar?.highlights).toContainEqual({ start: 6, end: 7 });
    expect(searchMap(index, 'i̇stanbul', filters())[0]?.matches[0].highlights[0]).toEqual({
      start: 6,
      end: 14,
    });
  });
  it('accepts all regular-expression and HTML metacharacters as plain text', () => {
    const inputs = fixtureInputs();
    const source = 'info "<script>[a-z]+(.*)$</script>";';
    const index = buildSearchIndex(buildAutomationGraph(inputs), new Map([['f-000', source]]));
    expect(searchMap(index, '[a-z]+(.*)$', filters())[0]?.matches[0].snippet).toContain(
      '[a-z]+(.*)$',
    );
    expect(searchMap(index, '<script>', filters())[0]?.matches[0].highlights[0]).toEqual({
      start: 6,
      end: 14,
    });
  });
});

it('builds and searches a large synthetic org within the performance budgets', () => {
  const inputs = generateLargeInputs({ rules: 330, functions: 920 });
  expect(inputs.rules).toHaveLength(330);
  expect(inputs.functions).toHaveLength(920);
  const start = performance.now();
  const graph = buildAutomationGraph(inputs);
  const built = performance.now();
  const index = buildSearchIndex(
    graph,
    new Map(
      inputs.functions.flatMap((f) =>
        f.sourceText === null ? [] : [[f.delugeId, f.sourceText] as const],
      ),
    ),
  );
  const indexed = performance.now();
  const timings: number[] = [];
  const documents = index.documents[Symbol.iterator].bind(index.documents);
  let visits = 0;
  const iteration = vi.spyOn(index.documents, Symbol.iterator).mockImplementation(function* () {
    for (const document of documents()) {
      visits++;
      yield document;
    }
    return undefined;
  });
  for (const query of ['Review', 'updateRecord', 'not-in-this-org', 'Stage', 'a']) {
    visits = 0;
    const before = performance.now();
    const hits = searchMap(index, query, filters());
    timings.push(performance.now() - before);
    expect(hits.length > 0).toBe(query !== 'not-in-this-org');
    // Bound work independently of wall-clock scheduling and CPU contention.
    expect(visits).toBe(index.documents.size);
  }
  iteration.mockRestore();
  console.info(
    `Automation Map: ${graph.nodes.size} nodes, ${graph.edges.length} edges; build ${(built - start).toFixed(1)} ms; index ${(indexed - built).toFixed(1)} ms; search max ${Math.max(...timings).toFixed(1)} ms (${timings.map((n) => n.toFixed(1)).join(', ')}).`,
  );
  expect(built - start).toBeLessThan(1500);
  // Parallel suites can deschedule this worker for longer than the interactive 50 ms target.
  // Keep a coarse runaway ceiling alongside the deterministic single-pass assertion above.
  expect(Math.max(...timings)).toBeLessThan(500);
});
