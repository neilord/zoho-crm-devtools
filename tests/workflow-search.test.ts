import { describe, expect, it, vi } from 'vitest';
import {
  normalizeAction,
  normalizeRule,
  normalizeTemplate,
} from '../src/content/workflows/normalize';
import { joinFunction } from '../src/content/workflows/related-functions';
import {
  facetCounts,
  searchWorkflows,
  type WorkflowFilters,
} from '../src/content/workflows/search';
import type { WorkflowIndexSnapshot } from '../src/content/workflows/types';
import {
  binding,
  catalogue,
  condition,
  detail,
  functionResource,
  summary,
} from './fixtures/workflows';

const filters: WorkflowFilters = {
  query: '',
  modules: [],
  active: 'all',
  triggerTypes: [],
  triggerFieldApiNames: [],
  actionKinds: [],
  scope: 'all',
};
function snapshot(): WorkflowIndexSnapshot {
  const raw = detail('101', [binding]),
    rule = normalizeRule(raw, raw);
  const a = normalizeAction(binding, functionResource);
  if (a.kind !== 'function') throw new Error();
  return {
    rules: [
      {
        ...rule,
        conditions: [
          {
            ...rule.conditions[0],
            instantActions: [
              {
                ...a,
                joinConfidence: 'exact',
                sourceState: 'available',
                sourceText: 'void test()\n{\ninfo "crimson pear";\n}',
              },
              {
                ...normalizeAction(
                  { id: '303', type: 'email_notifications' },
                  { template: { id: '601' } },
                ),
                kind: 'emailNotification',
                recipients: null,
                template: normalizeTemplate({
                  id: '601',
                  name: 'Harvest letter',
                  subject: 'Crisp pears',
                  content: '<p>crimson pear</p>',
                }),
              },
            ],
            scheduledActions: [
              {
                ...rule.conditions[0].scheduledActions[0],
                actions: [{ ...a, sourceState: 'available', sourceText: 'info "crimson pear";' }],
              },
            ],
          },
        ],
      },
      normalizeRule({
        ...summary('102'),
        module: { api_name: 'Baskets' },
        status: { active: false },
      }),
    ],
    progress: {
      phase: 'complete',
      rulesTotal: null,
      ruleDetailsTotal: null,
      actionResourcesTotal: null,
      templatesTotal: null,
      functionSourcesTotal: null,
      functionSourcesFailed: 0,
      rulesListed: 2,
      ruleDetailsLoaded: 1,
      ruleDetailsFailed: 0,
      actionResourcesLoaded: 2,
      actionResourcesFailed: 0,
      templatesLoaded: 1,
      templatesFailed: 0,
      functionSourcesAvailable: 1,
      functionSourcesUnavailable: 0,
      functionSourcesUncertain: 0,
      isComplete: false,
      failures: [],
    },
  };
}
describe('workflow search', () => {
  it('explains code hits at every occurrence with line numbers and snippet-relative ranges', () => {
    const result = searchWorkflows(snapshot(), {
      ...filters,
      query: 'CRIMSON PEAR',
      scope: 'code',
    });
    expect(result).toHaveLength(1);
    expect(result[0].matches).toHaveLength(2);
    expect(result[0].matches[0]).toMatchObject({
      location: 'functionSource',
      lineNumber: 3,
      action: { timing: 'instant', actionIndex: 0 },
    });
    expect(result[0].matches[1]).toMatchObject({
      location: 'functionSource',
      lineNumber: 1,
      action: { timing: 'scheduled', scheduleIndex: 0 },
    });
    const m = result[0].matches[0];
    expect(m.snippet.slice(m.highlights[0].start, m.highlights[0].end)).toBe('crimson pear');
  });
  it('anchors source snippets and highlights to the reported line', () => {
    const s = snapshot();
    const r = s.rules[0];
    s.rules = [
      {
        ...r,
        conditions: r.conditions.map((c) => ({
          ...c,
          instantActions: c.instantActions.map((a) =>
            a.kind === 'function'
              ? {
                  ...a,
                  sourceText: `${'info "context";\n'.repeat(11)}payload.put("quote_total", 42);\nresponse = invokeurl\n[\nurl: "https://example.invalid"\n];`,
                }
              : a,
          ),
          scheduledActions: [],
        })),
      },
    ];
    const m = searchWorkflows(s, { ...filters, query: 'invokeurl', scope: 'code' })[0].matches[0];
    expect(m).toMatchObject({
      lineNumber: 13,
      snippet: 'response = invokeurl',
      highlights: [{ start: 11, end: 20 }],
    });
  });
  it('reuses prepared rule documents across progressive snapshots and refreshes changed rules', () => {
    const s = snapshot();
    const rule = s.rules[0];
    // Source metadata includes raw action configuration; watch its serialization.
    const action = rule.conditions[0].instantActions[0];
    const serialize = vi.fn(() => ({ synthetic: 'harvest' }));
    const watched = {
      ...rule,
      conditions: [
        { ...rule.conditions[0], instantActions: [{ ...action, raw: { toJSON: serialize } }] },
      ],
    };
    searchWorkflows({ ...s, rules: [watched] }, filters);
    const calls = serialize.mock.calls.length;
    searchWorkflows({ ...s, rules: [watched] }, { ...filters, query: 'harvest' });
    facetCounts({ ...s, rules: [watched] }, filters);
    expect(serialize).toHaveBeenCalledTimes(calls);
    expect(
      searchWorkflows(
        { ...s, rules: [{ ...watched, name: 'Changed revision' }] },
        { ...filters, query: 'Changed revision' },
      ),
    ).toHaveLength(1);
  });
  it('filters mixed source states by occurrence and counts rules excluding the source facet itself', () => {
    const s = snapshot();
    const r = s.rules[0];
    s.rules = [
      {
        ...r,
        conditions: r.conditions.map((c) => ({
          ...c,
          scheduledActions: c.scheduledActions.map((schedule) => ({
            ...schedule,
            actions: schedule.actions.map((a) =>
              a.kind === 'function'
                ? { ...a, sourceState: 'unavailable' as const, sourceText: null }
                : a,
            ),
          })),
        })),
      },
      s.rules[1],
    ];
    for (const functionSource of ['available', 'unavailable'] as const) {
      expect(searchWorkflows(s, { ...filters, functionSource }).map((r) => r.rule.id)).toEqual([
        '101',
      ]);
      expect(
        facetCounts(s, { ...filters, functionSource }).functionSource.map((c) => c.count),
      ).toEqual([1, 1]);
    }
    expect(
      facetCounts(s, { ...filters, modules: ['Baskets'] }).functionSource.map((c) => c.count),
    ).toEqual([0, 0]);
  });
  it.each([
    ['name', 'ripeness', 'ruleDescription'],
    ['conditions', 'Pear', 'condition'],
    ['actions', 'Crisp pears', 'action'],
    ['all', 'Harvest letter', 'emailTemplate'],
  ] as const)('searches scope %s with provenance', (scope, query, location) => {
    expect(
      searchWorkflows(snapshot(), { ...filters, scope, query })[0].matches.some(
        (m) => m.location === location,
      ),
    ).toBe(true);
  });
  it('isolates source scope from actions and name', () => {
    expect(
      searchWorkflows(snapshot(), { ...filters, query: 'void test()', scope: 'actions' }),
    ).toHaveLength(0);
    expect(
      searchWorkflows(snapshot(), { ...filters, query: 'Harvest letter', scope: 'code' }),
    ).toHaveLength(0);
  });
  it('combines facets, trigger fields, templates and source availability', () => {
    const s = snapshot();
    expect(
      searchWorkflows(s, {
        ...filters,
        modules: ['Orchards'],
        active: 'active',
        actionKinds: ['function'],
        triggerFieldApiNames: ['Fruit'],
        templateIds: ['601'],
        hasFunctionSource: true,
      }),
    ).toHaveLength(1);
    expect(
      searchWorkflows(s, { ...filters, active: 'inactive', hasFunctionSource: false }),
    ).toHaveLength(1);
    expect(searchWorkflows(s, { ...filters, triggerFieldApiNames: ['Unknown'] })).toHaveLength(0);
  });
  it('counts distinct rules excluding each facet’s own filter and retains zero options', () => {
    const counts = facetCounts(snapshot(), { ...filters, modules: ['Baskets'] });
    expect(counts.modules.map((m) => m.count)).toEqual([1, 1]);
    expect(counts.actionKinds.find((a) => a.key === 'function')?.count).toBe(0);
    const active = facetCounts(snapshot(), { ...filters, active: 'active' });
    expect(active.active.map((a) => a.count)).toEqual([1, 1]);
    expect(active.actionKinds.find((a) => a.key === 'function')?.count).toBe(1);
  });
  it('preserves nested criteria paths', () => {
    const raw = detail(),
      c = condition();
    c.criteria_details.criteria.group = [
      { ...c.criteria_details.criteria.group[0], value: 'crimson' },
    ];
    raw.conditions = [c];
    const s = snapshot();
    s.rules = [normalizeRule(raw, raw)];
    expect(
      searchWorkflows(s, { ...filters, query: 'crimson', scope: 'conditions' })[0].matches,
    ).toContainEqual(
      expect.objectContaining({ location: 'condition', criteriaPath: [0], related: false }),
    );
  });
  it('keeps UTF-16 highlights correct after expanding Unicode case folds', () => {
    const s = snapshot();
    s.rules = [{ ...s.rules[0], name: 'İ orchard 🍐 pear' }];
    const result = searchWorkflows(s, { ...filters, query: 'pear', scope: 'name' })[0];
    const m = result.matches.find((m) => m.location === 'ruleName');
    expect(m?.snippet.slice(m.highlights[0].start, m.highlights[0].end)).toBe('pear');
  });
  it('scans a prepared 500-rule source snapshot repeatedly', () => {
    const s = snapshot(),
      rule = s.rules[0];
    const expanded = {
      ...rule,
      conditions: rule.conditions.map((c) => ({
        ...c,
        instantActions: c.instantActions.map((a) =>
          a.kind === 'function'
            ? { ...a, sourceText: `${'info "synthetic harvest";\n'.repeat(500)}info "crimson";` }
            : a,
        ),
      })),
    };
    s.rules = Array.from({ length: 500 }, (_, i) => ({ ...expanded, id: String(1000 + i) }));
    searchWorkflows(s, filters); // cold preparation is outside the per-keystroke budget
    const samples: number[] = [];
    for (let i = 0; i < 15; i++) {
      const next = { ...s, progress: { ...s.progress } };
      const f = { ...filters, query: i % 2 ? 'crimson' : 'absent needle', scope: 'code' as const };
      const start = performance.now();
      const results = searchWorkflows(next, f);
      facetCounts(next, f);
      samples.push(performance.now() - start);
      expect(results).toHaveLength(i % 2 ? 500 : 0);
    }
    const median = samples.sort((a, b) => a - b)[7];
    console.info(`500 heavy rules: median search + facets ${median.toFixed(2)} ms`);
    // ~6 ms locally; the bound guards the ~120 ms unprepared regression with headroom for loaded CI.
    expect(median).toBeLessThan(40);
  });
});
describe('related function identity', () => {
  it('uses unique API names, and never guesses from mismatched namespaces', () => {
    const a = normalizeAction(binding, functionResource);
    if (a.kind !== 'function') throw new Error();
    expect(joinFunction(a, catalogue)).toMatchObject({
      confidence: 'exact',
      summary: { id: '501' },
    });
    expect(joinFunction({ ...a, apiName: 'missing' }, catalogue).confidence).toBe('none');
    expect(joinFunction(a, [...catalogue, { ...catalogue[0], id: '502' }]).confidence).toBe('none');
    expect(joinFunction({ ...a, apiName: null }, catalogue).confidence).toBe('uncertain');
    expect(
      joinFunction({ ...a, apiName: null }, [...catalogue, { ...catalogue[0], id: '502' }])
        .confidence,
    ).toBe('none');
  });
});

it('prefers matches in an active action kind over repeated function code hits', () => {
  const s = snapshot();
  const first = s.rules[0];
  const webhook = normalizeAction(
    { id: '900', type: 'webhooks' },
    { name: 'Delivery', url: 'https://delivery.invalid/crimson pear' },
  );
  const codeOnly = {
    ...first,
    id: '103',
    conditions: first.conditions.map((c) => ({
      ...c,
      instantActions: [
        ...c.instantActions,
        normalizeAction({ id: '901', type: 'webhooks' }, { url: 'https://other.invalid' }),
      ],
    })),
  };
  const direct = {
    ...first,
    id: '104',
    conditions: first.conditions.map((c) => ({
      ...c,
      instantActions: [webhook],
      scheduledActions: [],
    })),
  };
  const results = searchWorkflows(
    { ...s, rules: [codeOnly, direct] },
    { ...filters, query: 'crimson pear', actionKinds: ['webhook'] },
  );
  expect(results.map((r) => r.rule.id)).toEqual(['104', '103']);
  expect(results[0].matches[0].location).toBe('webhook');
});
