// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeDelugeEffects } from '../src/content/automation-map/analyzer';
import { buildAutomationGraph } from '../src/content/automation-map/graph/build';
import {
  fieldWriters,
  filterNodes,
  neighbors,
  traceFrom,
} from '../src/content/automation-map/graph/queries';
import type {
  AutomationGraph,
  AutomationGraphInputs,
  FunctionInput,
  MapFilters,
} from '../src/content/automation-map/types';
import type {
  WorkflowAction,
  WorkflowCriteria,
  WorkflowRule,
  WorkflowTriggerType,
} from '../src/content/workflows/types';
import { fixtureGraph, fixtureInputs } from './fixtures/automation-map';

function empty(): AutomationGraphInputs {
  const { modules, fields } = fixtureInputs();
  return {
    modules,
    fields,
    rules: [],
    functions: [],
    buttons: [],
    schedules: [],
    transitions: [],
    approvals: [],
  };
}
function fn(id: string, source = '', apiName = id): FunctionInput {
  return {
    delugeId: id,
    summary: { id, display_name: id, api_name: apiName, category: 'standalone' },
    places: [],
    sourceState: 'available',
    sourceText: source,
    effects: analyzeDelugeEffects(source, {
      functionId: id,
      parameters: ['recordId'],
      currentCrmOrigin: 'https://crm.zoho.com',
    }),
  };
}
const pred = (f: string): WorkflowCriteria => ({
  kind: 'predicate',
  field: { apiName: f, label: f },
  comparator: 'equal',
  value: 'Review',
  raw: null,
});
function rule(
  id: string,
  type: WorkflowTriggerType = 'edit',
  actions: readonly WorkflowAction[] = [],
  moduleApiName = 'Deals',
  active: boolean | null = true,
): WorkflowRule {
  const sample = fixtureInputs().rules[3];
  return {
    ...sample,
    id,
    name: id,
    module: { apiName: moduleApiName, label: moduleApiName },
    active,
    trigger:
      type === 'field_update'
        ? {
            type,
            triggerModule: null,
            repeat: true,
            raw: null,
            criteria: pred('Stage'),
            matchAll: false,
          }
        : ({ type, triggerModule: null, repeat: true, raw: null } as WorkflowRule['trigger']),
    conditions: [
      {
        ...sample.conditions[0],
        criteria: pred('Stage'),
        relatedCriteria: null,
        instantActions: actions,
        scheduledActions: [],
      },
    ],
  };
}
function call(
  apiName: string | null,
  joinConfidence: 'exact' | 'uncertain' | 'none' = 'exact',
): WorkflowAction {
  return {
    id: 'binding-id',
    name: 'Run shared helper',
    module: null,
    state: 'loaded',
    raw: null,
    kind: 'function',
    apiName,
    bindingName: 'shared',
    crmFunctionId: 'different-crm-id',
    delugeFunctionId: 'misleading-deluge-id',
    joinConfidence,
    sourceState: 'available',
    sourceText: null,
    arguments: [],
  };
}
const edges = (g: AutomationGraph, kind: string, from?: string) =>
  g.edges.filter((e) => e.kind === kind && (!from || e.from === from));
const filters = (patch: Partial<MapFilters> = {}): MapFilters => ({
  scope: 'everything',
  modules: new Set(),
  kinds: new Set(),
  triggerTypes: new Set(),
  flags: new Set(),
  ...patch,
});

describe('Automation Map builder', () => {
  it('preserves instant/scheduled occurrences, templates, webhook hosts and declared writes', () => {
    const g = fixtureGraph();
    expect(g.nodes.get('action:rule-000/0/i/0')).toMatchObject({
      kind: 'action',
      ownerId: 'rule:rule-000',
      moduleApiName: 'Leads',
      location: { timing: 'instant', actionIndex: 0 },
    });
    expect(g.nodes.get('action:rule-000/0/s0/0')).toMatchObject({
      timingLabel: '2 days after Renewal Date',
      location: { timing: 'scheduled', scheduleIndex: 0 },
    });
    expect(edges(g, 'starts', 'rule:rule-000')).toHaveLength(8);
    expect(edges(g, 'invokes', 'action:rule-000/0/i/0')[0]?.to).toBe('function:f-000');
    expect(edges(g, 'uses')[0]?.to).toMatch(/^template:guide-/);
    expect(g.nodes.get('external:webhookHost:hooks.example.invalid')).toMatchObject({
      moduleApiName: null,
    });
    expect(
      g.edges.some(
        (e) => e.kind === 'writes' && e.to === 'field:Tasks.Subject' && e.operation === 'create',
      ),
    ).toBe(true);
    expect(
      g.edges.some(
        (e) =>
          e.kind === 'writes' && e.to === 'field:Contacts.Lead_Source' && e.operation === 'convert',
      ),
    ).toBe(true);
  });

  it('uses unique exact api names, never CRM/binding/name-only IDs', () => {
    const inputs = {
      ...empty(),
      functions: [fn('catalogue', '', 'shared')],
      rules: [
        rule('one', 'edit', [
          call('shared'),
          call('shared', 'uncertain'),
          call('shared', 'none'),
          call(null),
          call('missing'),
        ]),
      ],
    };
    const g = buildAutomationGraph(inputs);
    expect(edges(g, 'invokes')).toHaveLength(3);
    expect(edges(g, 'invokes')[0]?.to).toBe('function:catalogue');
    expect([...g.nodes.values()].filter((n) => n.kind === 'action')).toHaveLength(5);
    expect(
      edges(
        buildAutomationGraph({
          ...inputs,
          functions: [...inputs.functions, fn('duplicate', '', 'shared')],
        }),
        'invokes',
      ),
    ).toHaveLength(0);
    expect(
      edges(
        buildAutomationGraph({
          ...inputs,
          functions: [
            ...inputs.functions,
            {
              ...inputs.functions[0],
              summary: { ...inputs.functions[0].summary, source: 'extension' },
            },
          ],
        }),
        'invokes',
      ),
    ).toHaveLength(0);
    expect(
      edges(
        buildAutomationGraph({ ...inputs, functions: [...inputs.functions, inputs.functions[0]] }),
        'invokes',
      ),
    ).toHaveLength(3);
  });

  it('joins buttons by catalogue id and schedules by API/reverse place only', () => {
    const f = fn('f', '', 'shared');
    f.places = [{ type: 'schedules', id: 's', modulePluralLabel: 'Partner Reviews', raw: null }];
    const inputs = {
      ...empty(),
      functions: [f],
      buttons: [
        {
          id: 'b',
          name: 'Run',
          moduleApiName: 'Partner_Reviews',
          placements: ['view'],
          actionType: 'custom_function',
          functionDelugeId: 'f',
          raw: null,
        },
        {
          id: 'url',
          name: 'URL',
          moduleApiName: 'Deals',
          placements: [],
          actionType: 'url',
          functionDelugeId: 'f',
          raw: null,
        },
      ],
      schedules: [
        {
          id: 's',
          name: 'Nightly',
          active: true,
          recurrenceLabel: null,
          functionApiName: 'shared',
          raw: { function: { id: 'wrong' } },
        },
        {
          id: 'bad',
          name: 'Unbound',
          active: true,
          recurrenceLabel: null,
          functionApiName: null,
          raw: { function: { id: 'f', name: 'shared' } },
        },
      ],
    };
    const g = buildAutomationGraph(inputs);
    expect(edges(g, 'starts', 'schedule:s')).toHaveLength(1);
    expect(edges(g, 'starts', 'button:b')).toHaveLength(1);
    expect(edges(g, 'starts', 'button:url')).toHaveLength(0);
    expect(edges(g, 'starts', 'schedule:bad')).toHaveLength(0);
    expect(g.nodes.get('schedule:s')?.moduleApiName).toBe('Partner_Reviews');
    expect(g.nodes.get('function:f')?.moduleApiName).toBe('Partner_Reviews');
  });

  it('supplements associated places and deduplicates rule/action paths', () => {
    const f = fn('f', '', 'shared');
    f.places = ['workflow_rules', 'approvals', 'custom_buttons', 'schedules'].map((type) => ({
      type,
      id: type === 'workflow_rules' ? 'r' : type,
      modulePluralLabel: 'Partner Reviews',
      raw: { status: true, name: `Synthetic ${type}` },
    }));
    const g = buildAutomationGraph({
      ...empty(),
      functions: [f],
      rules: [rule('r', 'edit', [call('shared')], 'Partner_Reviews')],
    });
    expect(edges(g, 'starts', 'rule:r')).toHaveLength(1);
    for (const id of ['approval:approvals', 'button:custom_buttons', 'schedule:schedules'])
      expect(edges(g, 'starts', id)[0]?.to).toBe('function:f');
    expect(g.nodes.get('function:f')).toMatchObject({
      inDegree: 4,
      entryKinds: ['approval', 'button', 'rule', 'schedule'],
      moduleApiName: 'Partner_Reviews',
    });
  });

  it('keeps unknown/ambiguous plural labels unresolved and ignores later-scope places', () => {
    const f = fn('f');
    f.places = [
      { type: 'custom_buttons', id: 'b', modulePluralLabel: 'Partner_Reviews', raw: null },
      { type: 'related_list', id: 'later', modulePluralLabel: 'Deals', raw: null },
    ];
    const g = buildAutomationGraph({ ...empty(), functions: [f] });
    expect(g.nodes.get('button:b')?.moduleApiName).toBeNull();
    expect(g.nodes.has('button:later')).toBe(false);
  });

  it('writes blueprint during-inputs and approval/transition action occurrences', () => {
    const g = fixtureGraph();
    expect(edges(g, 'writes', 'transition:sales-process/submit')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'field:Deals.Amount',
          evidence: 'declared',
          note: 'entered during transition',
        }),
      ]),
    );
    expect(edges(g, 'starts', 'transition:sales-process/submit')).toHaveLength(2);
    expect(edges(g, 'starts', 'approval:discount-review')).toHaveLength(2);
    expect(g.nodes.get('action:transition:sales-process/submit/0/i/0')).toMatchObject({
      ownerId: 'transition:sales-process/submit',
      location: null,
    });
    expect(g.nodes.get('field:Deals.Amount')).toMatchObject({
      label: 'Amount',
      labelConfirmed: false,
    });
  });

  it('separates literal, partial-field and unresolved-module writes with UTF-16 evidence lines', () => {
    const text =
      '// 😀 evidence\r\np = {"Stage":"Review"};\r\np.putAll(input.get("patch"));\r\nzoho.crm.updateRecord("Deals",recordId,p);\r\nzoho.crm.updateRecord(input.get("module"),recordId,input.get("patch"));';
    const g = buildAutomationGraph({ ...empty(), functions: [fn('f', text)] });
    expect(g.nodes.get('field:Deals.Stage')).toMatchObject({
      labelConfirmed: true,
      bucket: 'field',
      moduleApiName: 'Deals',
    });
    expect(g.nodes.get('field:Deals.*')).toMatchObject({
      bucket: 'unknownFields',
      moduleApiName: 'Deals',
    });
    expect(g.nodes.get('field:*.*')).toMatchObject({
      bucket: 'unknownModule',
      moduleApiName: null,
    });
    for (const e of edges(g, 'writes', 'function:f')) {
      expect(e.spans?.[0].line).toBe(e.to === 'field:*.*' ? 5 : 4);
      expect(text.slice(e.spans?.[0].start, e.spans?.[0].end)).toContain('zoho.crm.updateRecord');
    }
    const lens = fieldWriters(g, 'Deals', 'Stage');
    expect(lens.writers).toHaveLength(0);
    expect(
      edges(g, 'writes').every(
        (e) =>
          e.confidence ===
          fn('f', text).effects?.writes.find((w) => w.span.start === e.spans?.[0].start)
            ?.confidence,
      ),
    ).toBe(true);
    expect(lens.possibleWriters).toHaveLength(1);
    expect(lens.unresolvedWriters).toHaveLength(1);
  });

  it('groups HTTP hosts, registered connections, service calls and sendmail', () => {
    const g = fixtureGraph();
    for (const id of [
      'external:urlHost:sync.example.invalid',
      'external:connection:partner_sync',
      'external:connection:account_sync',
      'external:zohoService:books',
      'external:email:email',
    ])
      expect(g.nodes.get(id), id).toMatchObject({ kind: 'external', moduleApiName: null });
    expect([...g.nodes.keys()].some((id) => id.includes('?region') || id.includes('/v1/'))).toBe(
      false,
    );
    const f = fn(
      'f',
      'x = invokeurl [ url:input.get("url") type:POST parameters:{"url":"https://decoy.example.invalid/path"} ];',
    );
    const unknown = buildAutomationGraph({ ...empty(), functions: [f] });
    expect(unknown.nodes.has('external:urlHost:decoy.example.invalid')).toBe(false);
    expect(unknown.nodes.has('external:urlHost:*')).toBe(true);
  });

  it('joins code calls by API name and keeps ambiguous/different-product calls out', () => {
    const inputs = {
      ...empty(),
      functions: [
        fn('a', 'standalone.shared(recordId);\nthisapp.shared(recordId);'),
        fn('b', '', 'shared'),
      ],
    };
    expect(edges(buildAutomationGraph(inputs), 'invokes').map((e) => e.to)).toEqual(['function:b']);
    expect(
      edges(
        buildAutomationGraph({
          ...inputs,
          functions: [...inputs.functions, fn('c', '', 'shared')],
        }),
        'invokes',
      ),
    ).toHaveLength(0);
  });

  it('reacts to watched, recursive and related criteria in their own module', () => {
    const r = rule('r', 'field_update');
    r.trigger = {
      ...r.trigger,
      triggerModule: { apiName: 'Leads', label: 'Leads' },
    } as WorkflowRule['trigger'];
    r.conditions = [
      {
        ...r.conditions[0],
        criteria: {
          kind: 'group',
          operator: 'AND',
          children: [pred('Amount'), pred('Stage')],
          raw: null,
        },
        relatedCriteria: {
          module: { apiName: 'Accounts', label: 'Accounts' },
          criteria: pred('Industry'),
          moduleSelection: null,
          raw: null,
        },
      },
    ];
    const g = buildAutomationGraph({ ...empty(), rules: [r] });
    expect(
      edges(g, 'reacts')
        .map((e) => e.from)
        .sort(),
    ).toEqual([
      'field:Accounts.Industry',
      'field:Deals.Amount',
      'field:Deals.Stage',
      'field:Leads.Stage',
    ]);
    expect(g.nodes.get('rule:r')).toMatchObject({ watchedFields: ['Stage'] });
    expect(g.nodes.get('field:Accounts.Industry')?.inActiveScope).toBe(true);
  });
});

describe('workflow cascades', () => {
  function cascade(source: string) {
    const rules = ['create', 'create_or_edit', 'edit', 'field_update', 'date_or_datetime'].map(
      (type) => rule(type, type as WorkflowTriggerType),
    );
    const other = rule('other-field', 'field_update');
    other.trigger = {
      type: 'field_update',
      triggerModule: null,
      repeat: true,
      raw: null,
      criteria: pred('Amount'),
      matchAll: false,
    };
    rules.push(
      other,
      rule('inactive', 'edit', [], 'Deals', false),
      rule('contacts', 'edit', [], 'Contacts'),
    );
    return buildAutomationGraph({ ...empty(), rules, functions: [fn('f', source)] });
  }
  it.each([
    ['createRecord', ['rule:create', 'rule:create_or_edit']],
    ['updateRecord', ['rule:create_or_edit', 'rule:edit', 'rule:field_update']],
    ['upsert', ['rule:create', 'rule:create_or_edit', 'rule:edit', 'rule:field_update']],
  ])('matches %s event families and watched fields', (task, expected) => {
    const g = cascade(
      `zoho.crm.${task}("Deals",${task === 'updateRecord' ? 'recordId,' : ''}{"Stage":"Review"},{"trigger":["workflow"]});`,
    );
    const actual = edges(g, 'cascades', 'function:f');
    expect(actual.map((e) => e.to).sort()).toEqual(expected.sort());
    expect(
      actual.every((e) => e.note?.includes('Possible') && e.note.includes('same-record')),
    ).toBe(true);
  });
  it.each([
    '',
    ',{"trigger":[]}',
    ',{"trigger":["approval"]}',
  ])('excludes native default or explicitly excluded workflows: %s', (options) => {
    expect(
      edges(
        cascade(`zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"}${options});`),
        'cascades',
      ),
    ).toHaveLength(0);
  });
  it('includes dynamic policies and unknown write sets', () => {
    const g = cascade(
      'zoho.crm.updateRecord("Deals",recordId,input.get("patch"),input.get("options"));',
    );
    expect(
      edges(g, 'cascades')
        .map((e) => e.to)
        .sort(),
    ).toEqual(['rule:create_or_edit', 'rule:edit', 'rule:field_update', 'rule:other-field']);
  });
  it('honors documented REST insert defaults', () => {
    const g = cascade(
      'response = invokeurl [ url:"https://crm.zoho.com/crm/v8/Deals" type:POST parameters:{"data":[{"Stage":"Review"}]} ];',
    );
    expect(
      edges(g, 'cascades')
        .map((e) => e.to)
        .sort(),
    ).toEqual(['rule:create', 'rule:create_or_edit']);
  });
  it('does not treat delete/relate/attach/tag writes as edit events', () => {
    const g = cascade(
      'zoho.crm.attachFile("Deals",recordId,input.get("file"));\nzoho.crm.updateRelatedRecord("Contacts",recordId,"Deals",recordId,{"Stage":"Review"});',
    );
    expect(edges(g, 'cascades')).toHaveLength(0);
  });
  it('keeps a cascade cycle finite and visible', () => {
    const f = fn(
      'f',
      'zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"},{"trigger":["workflow"]});',
      'shared',
    );
    const g = buildAutomationGraph({
      ...empty(),
      functions: [f],
      rules: [rule('r', 'field_update', [call('shared')])],
    });
    expect(edges(g, 'cascades')).toHaveLength(1);
    const trace = traceFrom(g, 'rule:r', {
      upstream: 20,
      downstream: 20,
      maxNodes: 100,
      includeInactive: true,
    });
    expect(trace.nodeIds.size).toBe(4);
    expect(trace.truncated).toEqual({ upstream: 0, downstream: 0 });
  });
});

describe('homes, scope and graph queries', () => {
  it('propagates homes through transitive function calls and shared cycles', () => {
    const functions = [
      fn('a', 'standalone.b(recordId);', 'a'),
      fn('b', 'standalone.a(recordId);', 'b'),
    ];
    const inputs = { ...empty(), functions, rules: [rule('r', 'edit', [call('a')])] };
    const g = buildAutomationGraph(inputs);
    expect(g.nodes.get('function:a')?.moduleApiName).toBe('Deals');
    expect(g.nodes.get('function:b')?.moduleApiName).toBe('Deals');
    const shared = buildAutomationGraph({
      ...inputs,
      rules: [...inputs.rules, rule('other', 'edit', [call('b')], 'Leads')],
    });
    expect(shared.nodes.get('function:a')?.moduleApiName).toBeNull();
    expect(shared.nodes.get('function:b')?.moduleApiName).toBeNull();
  });
  it('seeds only active entries, includes downstream dependencies and criteria fields', () => {
    const rest = fn('rest');
    rest.summary.rest_api = [
      { type: 'oauth', active: true },
      { type: 'zapikey', active: false },
    ];
    const g = buildAutomationGraph({
      ...empty(),
      functions: [
        fn(
          'f',
          'zoho.crm.updateRecord("Contacts",recordId,{"Email":"new@example.invalid"});',
          'shared',
        ),
        fn('inactive'),
        fn('orphan'),
        rest,
      ],
      rules: [
        rule('active', 'edit', [call('shared')]),
        rule('inactive', 'edit', [call('inactive')], 'Leads', false),
        rule('unknown', 'edit', [], 'Cases', null),
      ],
    });
    expect(g.nodes.get('function:f')).toMatchObject({
      active: true,
      inActiveScope: true,
      entryKinds: ['rule'],
      inDegree: 1,
    });
    expect(g.nodes.get('function:rest')).toMatchObject({
      active: true,
      entryKinds: ['restApi'],
      restApi: { apiKey: false, oauth: true },
    });
    expect(g.nodes.get('function:inactive')?.active).toBe(false);
    expect(g.nodes.get('function:orphan')?.active).toBe(false);
    expect(g.nodes.get('rule:unknown')?.active).toBeNull();
    expect(g.nodes.get('field:Contacts.Email')?.inActiveScope).toBe(true);
    expect(g.nodes.get('field:Leads.Stage')?.inActiveScope).toBe(false);
    expect(
      g.edges.every(
        (e) =>
          e.inActiveScope ===
          (!!g.nodes.get(e.from)?.inActiveScope && !!g.nodes.get(e.to)?.inActiveScope),
      ),
    ).toBe(true);
  });
  it('counts module volume, analysis states and field-lens gaps without multiplying callers', () => {
    const g = fixtureGraph();
    expect(fieldWriters(g, 'Deals', 'Stage').coverageGaps).toBe(3);
    expect(g.nodes.get('function:f-057')).toMatchObject({ analysis: 'pending' });
    expect(g.nodes.get('function:f-058')).toMatchObject({ analysis: 'source-unavailable' });
    expect(g.nodes.get('function:f-059')).toMatchObject({ analysis: 'failed' });
    expect(g.modules.find((m) => m.apiName === 'Leads')?.counts.rules).toBe(6);
    expect(
      g.modules.every(
        (m, i) =>
          !i ||
          Object.entries(g.modules[i - 1].counts)
            .filter(([k]) => k !== 'activeRules')
            .reduce((n, [, v]) => n + v, 0) >=
            Object.entries(m.counts)
              .filter(([k]) => k !== 'activeRules')
              .reduce((n, [, v]) => n + v, 0),
      ),
    ).toBe(true);
    expect(fieldWriters(g, 'No_Module', 'No_Field').field).toBeNull();
  });
  it('filters module/kind/trigger/flags and active scope by intersection', () => {
    const g = fixtureGraph();
    const rules = filterNodes(
      g,
      filters({
        scope: 'active',
        modules: new Set(['Deals']),
        kinds: new Set(['rule']),
        triggerTypes: new Set(['field_update']),
      }),
    );
    expect(rules.size).toBeGreaterThan(0);
    for (const id of rules)
      expect(g.nodes.get(id)).toMatchObject({
        kind: 'rule',
        moduleApiName: 'Deals',
        triggerType: 'field_update',
        inActiveScope: true,
      });
    const rest = filterNodes(g, filters({ flags: new Set(['restApi']) }));
    expect([...rest]).toEqual(['function:f-012']);
    const writers = filterNodes(g, filters({ flags: new Set(['writesFields', 'cascades']) }));
    expect(writers.has('function:f-003')).toBe(true);
    expect(filterNodes(g, filters({ flags: new Set(['gaps']) })).size).toBe(3);
    expect(
      filterNodes(g, filters({ flags: new Set(['callsExternal']) })).has('function:f-006'),
    ).toBe(true);
  });
  it.each([
    [1, 2, 1],
    [2, 1, -1],
    [1, 1, 1],
  ])('uses nearest trace depth (down %i, up %i), with downstream ties', (down, up, expected) => {
    const inputs = empty();
    const base = fixtureInputs().functions[0];
    const ids = ['root', 'shared', 'up', 'down'];
    const g = buildAutomationGraph({
      ...inputs,
      functions: ids.map((id) => ({
        ...base,
        delugeId: id,
        summary: { ...base.summary, id },
        effects: null,
      })),
    });
    const links = [
      ...(down === 1
        ? [['root', 'shared']]
        : [
            ['root', 'down'],
            ['down', 'shared'],
          ]),
      ...(up === 1
        ? [['shared', 'root']]
        : [
            ['shared', 'up'],
            ['up', 'root'],
          ]),
    ];
    const edges = links.map(([from, to], i) => ({
      id: String(i),
      kind: 'invokes' as const,
      from: `function:${from}`,
      to: `function:${to}`,
      evidence: 'declared' as const,
      confidence: null,
      inActiveScope: true,
    }));
    const graph = {
      ...g,
      edges,
      incoming: new Map(
        ids.map((id) => [`function:${id}`, edges.filter((e) => e.to === `function:${id}`)]),
      ),
      outgoing: new Map(
        ids.map((id) => [`function:${id}`, edges.filter((e) => e.from === `function:${id}`)]),
      ),
    };
    const trace = traceFrom(graph, 'function:root', {
      upstream: 5,
      downstream: 5,
      maxNodes: 20,
      includeInactive: true,
    });
    expect(trace.depth.get('function:shared')).toBe(expected);
    expect(trace.depth.get('function:root')).toBe(0);
  });
  it('traces separate depths, respects inactive scope and counts capped frontier nodes', () => {
    const g = fixtureGraph();
    const t = traceFrom(g, 'function:f-000', {
      upstream: 1,
      downstream: 1,
      maxNodes: 1000,
      includeInactive: true,
    });
    expect(t.depth.get('function:f-001')).toBe(1);
    expect(t.depth.get('action:rule-000/0/i/0')).toBe(-1);
    const limited = traceFrom(g, 'function:f-000', {
      upstream: 10,
      downstream: 10,
      maxNodes: 3,
      includeInactive: true,
    });
    expect(limited.nodeIds.size).toBe(3);
    expect(limited.truncated.upstream + limited.truncated.downstream).toBeGreaterThan(0);
    expect(
      limited.edges.every((e) => limited.nodeIds.has(e.from) && limited.nodeIds.has(e.to)),
    ).toBe(true);
    expect(
      traceFrom(g, 'rule:rule-008', {
        upstream: 0,
        downstream: 4,
        maxNodes: 100,
        includeInactive: false,
      }).nodeIds.size,
    ).toBe(1);
    expect(
      traceFrom(g, 'missing', { upstream: 5, downstream: 5, maxNodes: 100, includeInactive: true })
        .nodeIds.size,
    ).toBe(0);
    expect(neighbors(g, 'function:f-000').incoming.length).toBeGreaterThan(5);
  });
  it('is deterministic under top-level input permutation and leaves inputs untouched', () => {
    const inputs = fixtureInputs();
    const before = JSON.stringify(inputs);
    const g = buildAutomationGraph(inputs);
    const reverse = buildAutomationGraph({
      ...inputs,
      modules: [...inputs.modules].reverse(),
      functions: [...inputs.functions].reverse(),
      rules: [...inputs.rules].reverse(),
      buttons: [...inputs.buttons].reverse(),
      schedules: [...inputs.schedules].reverse(),
      transitions: [...inputs.transitions].reverse(),
      approvals: [...inputs.approvals].reverse(),
    });
    expect([...g.nodes]).toEqual([...reverse.nodes]);
    expect(g.edges).toEqual(reverse.edges);
    expect([...g.outgoing]).toEqual([...reverse.outgoing]);
    expect(g.modules).toEqual(reverse.modules);
    expect(JSON.stringify(inputs)).toBe(before);
  });
});

describe('uncertainty and boundary regressions', () => {
  it('propagates org-level homes from rootless callers alongside known-module callers', () => {
    const g = buildAutomationGraph({
      ...empty(),
      functions: [fn('rootless', 'standalone.target(recordId);'), fn('target')],
      rules: [rule('r', 'edit', [call('target')])],
    });
    expect(g.nodes.get('function:target')?.moduleApiName).toBeNull();
  });
  it('does not expose URL authority guesses from dynamic expressions, comments or duplicate keys', () => {
    for (const code of [
      'url:"https://prefix.example.invalid" + input.get("suffix")',
      'url:input.get("url") parameters:{url:"https://nested.example.invalid/path"}',
      'url:"https://one.example.invalid/path" url:"https://two.example.invalid/path"',
      'url:input.get("url") /* url:"https://comment.example.invalid/path" */',
    ]) {
      const g = buildAutomationGraph({
        ...empty(),
        functions: [fn('f', `response = invokeurl [ ${code} type:POST ];`)],
      });
      expect(
        [...g.nodes.values()]
          .filter((n) => n.kind === 'external' && n.externalKind === 'urlHost')
          .map((n) => n.id),
      ).toEqual(['external:urlHost:*']);
    }
    const g = buildAutomationGraph({
      ...empty(),
      functions: [
        fn(
          'f',
          'response = invokeurl [ url:"https://fixed.example.invalid/path/" + recordId type:POST ];',
        ),
      ],
    });
    expect(g.nodes.has('external:urlHost:fixed.example.invalid')).toBe(true);
  });
  it('returns exact writers and all function analysis states without claiming completeness', () => {
    const exact = fn('exact', 'zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"});');
    const limited = fn('limited', 'info "x";');
    const unsupported = fn('unsupported', 'info "x";');
    const failed = fn('failed', 'info "x";');
    if (limited.effects) limited.effects.analysis.status = 'limited';
    if (unsupported.effects) unsupported.effects.analysis.status = 'unsupported';
    if (failed.effects) failed.effects.analysis.status = 'failed';
    const g = buildAutomationGraph({
      ...empty(),
      functions: [exact, limited, unsupported, failed],
    });
    const lens = fieldWriters(g, 'Deals', 'Stage');
    expect(lens.writers).toHaveLength(1);
    expect(lens.coverageGaps).toBe(3);
    expect(g.nodes.get('function:limited')).toMatchObject({ analysis: 'limited' });
    expect(g.nodes.get('function:unsupported')).toMatchObject({ analysis: 'unsupported' });
    expect(g.nodes.get('function:failed')).toMatchObject({ analysis: 'failed' });
  });
  it('maps every analyzer operation without turning resource operations into record fields', () => {
    const f = fn('f', 'zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"});');
    const operations = [
      'create',
      'update',
      'bulk-create',
      'bulk-update',
      'update-related',
      'upsert',
      'delete',
      'attach',
      'add-tags',
      'remove-tags',
      'convert',
      'crm-mutation',
    ] as const;
    const expected = [
      'create',
      'update',
      'create',
      'update',
      'relate',
      'upsert',
      'delete',
      'attach',
      'other',
      'other',
      'convert',
      'other',
    ];
    const w = f.effects?.writes[0];
    if (!w || !f.effects) throw new Error('Expected real analyzer write');
    f.effects.writes = operations.map((op, i) => ({ ...w, op, id: String(i) }));
    const g = buildAutomationGraph({ ...empty(), functions: [f] });
    for (const [i, operation] of expected.entries())
      expect(edges(g, 'writes').find((e) => e.id.endsWith(`,"${i}"]`))?.operation).toBe(operation);
    const attachment = fn('attachment', 'zoho.crm.attachFile("Deals",recordId,input.get("file"));');
    expect(
      edges(buildAutomationGraph({ ...empty(), functions: [attachment] }), 'writes'),
    ).toHaveLength(1);
  });
  it('uses related-module field updates and keeps actions on the owner island', () => {
    const action = fixtureInputs().rules[0].conditions[0].instantActions[1];
    if (action.kind !== 'fieldUpdate') throw new Error('Expected fixture field update');
    const g = buildAutomationGraph({
      ...empty(),
      rules: [
        rule('r', 'edit', [
          {
            ...action,
            relatedModule: { apiName: 'Contacts', label: 'Contacts' },
            field: { apiName: 'Status', label: 'Status' },
          },
        ]),
      ],
    });
    expect(g.nodes.get('action:r/0/i/0')?.moduleApiName).toBe('Deals');
    expect(edges(g, 'writes')[0]?.to).toBe('field:Contacts.Status');
  });
  it('keeps inactive and unknown schedules, blueprints and approvals outside active scope', () => {
    const inputs = fixtureInputs();
    const g = buildAutomationGraph({
      ...inputs,
      functions: [],
      rules: [],
      buttons: [],
      schedules: inputs.schedules.map((s) => ({ ...s, active: null })),
      transitions: inputs.transitions.map((t) => ({ ...t, blueprintActive: false })),
      approvals: inputs.approvals.map((a) => ({ ...a, active: false })),
    });
    expect([...g.nodes.values()].some((n) => n.inActiveScope)).toBe(false);
  });
  it('the demo org contains a real possible cascade loop and shared function hubs', () => {
    const g = fixtureGraph();
    expect(
      g.edges.some(
        (e) => e.from === 'function:f-003' && e.to === 'rule:rule-003' && e.kind === 'cascades',
      ),
    ).toBe(true);
    expect(
      g.edges.some(
        (e) =>
          e.from === 'action:rule-003/0/i/0' && e.to === 'function:f-003' && e.kind === 'invokes',
      ),
    ).toBe(true);
    expect(g.nodes.get('function:f-000')).toMatchObject({ moduleApiName: null });
    const hub = g.nodes.get('function:f-001');
    expect(hub?.kind === 'function' && hub.inDegree > 5).toBe(true);
  });
});

it('keeps literal-field partial-confidence relationship writes in the possible-writer lens', () => {
  const f = fn(
    'f',
    'zoho.crm.updateRelatedRecord("Contacts",recordId,"Deals",recordId,{"Email":"person@example.invalid"});',
  );
  const g = buildAutomationGraph({ ...empty(), functions: [f] });
  const lens = fieldWriters(g, 'Contacts', 'Email');
  expect(lens.writers).toHaveLength(0);
  expect(lens.possibleWriters).toEqual([
    expect.objectContaining({
      to: 'field:Contacts.Email',
      confidence: 'partial',
      operation: 'relate',
    }),
  ]);
});

it('joins unjoined blueprint and approval function actions only by unique exact API name', () => {
  const inputs = fixtureInputs();
  const graphFor = (functions: FunctionInput[], action = call('shared', 'none')) =>
    buildAutomationGraph({
      ...empty(),
      functions,
      transitions: [{ ...inputs.transitions[0], blueprintActive: true, actions: [action] }],
      approvals: [{ ...inputs.approvals[0], active: true, actions: [action] }],
    });
  const f = fn('target', '', 'shared');
  const g = graphFor([f]);
  expect(edges(g, 'invokes').map((e) => e.to)).toEqual(['function:target', 'function:target']);
  expect(g.nodes.get('function:target')).toMatchObject({
    inActiveScope: true,
    entryKinds: ['approval', 'transition'],
  });
  expect(edges(graphFor([f, fn('ambiguous', '', 'shared')]), 'invokes')).toHaveLength(0);
  expect(edges(graphFor([f], call(null, 'none')), 'invokes')).toHaveLength(0);
});

it('keeps subform row writes on the subform field with their full paths', () => {
  const f = fn('f', 'zoho.crm.updateRecord("Deals",1,{"Items":[{"Status":"X","Quantity":2}]});');
  const g = buildAutomationGraph({ ...empty(), functions: [f] });
  expect(edges(g, 'writes').every((e) => e.to === 'field:Deals.Items')).toBe(true);
  expect(
    edges(g, 'writes')
      .filter((e) => e.subformPath)
      .map((e) => e.subformPath),
  ).toEqual([
    ['Items', '[]', 'Quantity'],
    ['Items', '[]', 'Status'],
  ]);
  const lens = fieldWriters(g, 'Deals', 'Status');
  expect([...lens.writers, ...lens.possibleWriters, ...lens.unresolvedWriters]).toHaveLength(0);
  expect(fieldWriters(g, 'Deals', 'Items').writers).toHaveLength(3);
});

it.each([
  'connection-org-unknown',
  'unknown',
] as const)('keeps %s writes possible and excludes local cascades', (destinationScope) => {
  const f = fn(
    'f',
    'zoho.crm.updateRecord("Deals",1,{"Stage":"Review"},{"trigger":["workflow"]},"remote");',
  );
  const w = f.effects?.writes[0];
  if (!w) throw new Error('Expected analyzer write');
  expect(w.destinationScope).toBe('connection-org-unknown');
  w.destinationScope = destinationScope;
  const g = buildAutomationGraph({ ...empty(), functions: [f], rules: [rule('r')] });
  const lens = fieldWriters(g, 'Deals', 'Stage');
  expect(lens.writers).toHaveLength(0);
  expect(lens.possibleWriters).toEqual([expect.objectContaining({ destinationScope })]);
  expect(edges(g, 'cascades')).toHaveLength(0);
});

it('always supplies function display labels from name, API name or short identity', () => {
  const f = fn('123456789');
  f.summary.display_name = '  ';
  f.summary.api_name = 'fallback_api';
  expect(
    buildAutomationGraph({ ...empty(), functions: [f] }).nodes.get('function:123456789')?.label,
  ).toBe('fallback_api');
  f.summary.api_name = null;
  expect(
    buildAutomationGraph({ ...empty(), functions: [f] }).nodes.get('function:123456789')?.label,
  ).toBe('Unnamed function · 456789');
});

it('separates non-field record mutations, including unresolved modules, from every writer tier', () => {
  const fs = [
    fn('delete', 'zoho.crm.invokeConnector("crm.delete",{"module":"Deals","id":1});'),
    fn('unknownDelete', 'zoho.crm.deleteRecord(input.module,1);'),
    fn('attach', 'zoho.crm.attachFile("Deals",1,input.file);'),
    fn(
      'tags',
      'r = invokeurl [ url : "https://www.zohoapis.com/crm/v8/Deals/actions/add_tags" type : POST body : {"ids":["1"],"tags":[{"name":"review"}]}.toString() ];',
    ),
    fn('writer', 'zoho.crm.updateRecord(input.module,1,{"Stage":"Review"});'),
  ];
  const g = buildAutomationGraph({ ...empty(), functions: fs });
  const lens = fieldWriters(g, 'Deals', 'Stage');
  expect([...lens.writers, ...lens.possibleWriters]).toHaveLength(0);
  expect(lens.unresolvedWriters.map((e) => e.from)).toEqual(['function:writer']);
  expect(new Set(lens.otherRecordChanges.map((e) => e.from))).toEqual(
    new Set(['function:delete', 'function:attach', 'function:tags']),
  );
});

it('labels task field mappings with their create behavior', () => {
  const g = fixtureGraph();
  const task = g.edges.find((e) => e.kind === 'writes' && e.to === 'field:Tasks.Subject');
  expect(task?.note).toBe('Task created (field mapping)');
});

it('ranks fields using the same distinct scoped writers as the lens', async () => {
  const queries = await import('../src/content/automation-map/graph/queries');
  const f = fn(
    'f',
    'zoho.crm.updateRecord("Deals",1,{"Stage":"A"}); zoho.crm.updateRecord("Deals",1,{"Stage":"B"});',
  );
  const g = buildAutomationGraph({ ...empty(), functions: [f] });
  const ranked = queries.mostWrittenFields(g, filters(), 5);
  expect(ranked.find((r) => r.field.id === 'field:Deals.Stage')?.count).toBe(1);
  for (const scope of ['active', 'everything'] as const) {
    for (const row of queries.mostWrittenFields(fixtureGraph(), filters({ scope }), 1000)) {
      const lens = fieldWriters(
        fixtureGraph(),
        row.field.moduleApiName ?? '',
        row.field.fieldApiName,
      );
      const expected = new Set(
        [...lens.writers, ...lens.possibleWriters, ...lens.unresolvedWriters]
          .filter((e) => scope === 'everything' || e.inActiveScope)
          .map((e) => lens.writerEntityIds?.get(e.from) ?? e.from),
      ).size;
      expect(row.count).toBe(expected);
    }
  }
});

it.each([
  'delete',
  'attach',
  'add-tags',
  'remove-tags',
  'convert',
  'update-related',
] as const)('keeps %s without field mappings out of known and unresolved writer groups', (op) => {
  for (const resolved of [true, false]) {
    const f = fn('record-change', 'zoho.crm.updateRecord("Deals",1,{"Stage":"Review"});');
    const effect = f.effects?.writes[0];
    if (!effect || !f.effects) throw new Error('Missing analyzer effect');
    f.effects.writes = [
      {
        ...effect,
        op,
        fields: [],
        unknownFields: false,
        fieldsConfidence: 'not-applicable',
        module: {
          ...effect.module,
          value: resolved ? 'Deals' : null,
          confidence: resolved ? 'exact' : 'unknown',
        },
      },
    ];
    const lens = fieldWriters(
      buildAutomationGraph({ ...empty(), functions: [f] }),
      'Deals',
      'Stage',
    );
    expect([...lens.writers, ...lens.possibleWriters, ...lens.unresolvedWriters]).toHaveLength(0);
    expect(lens.otherRecordChanges).toHaveLength(resolved ? 1 : 0);
  }
});

it('counts owning entities once in their strongest lens group, preserving evidence', async () => {
  const { lensCounts, fieldWriterCount, mostWrittenFields } = await import(
    '../src/content/automation-map/graph/queries'
  );
  const inputs = fixtureInputs();
  const taskRule = inputs.rules.find((r) =>
    r.conditions.some((c) => c.instantActions.some((a) => a.kind === 'task')),
  );
  if (!taskRule) throw new Error('Missing task fixture');
  const duplicated = {
    ...taskRule,
    conditions: taskRule.conditions.map((c) => ({
      ...c,
      instantActions: [...c.instantActions, ...c.instantActions],
    })),
  };
  const g = buildAutomationGraph({
    ...empty(),
    rules: [duplicated],
    functions: [
      fn(
        'multi',
        'zoho.crm.updateRecord("Tasks",1,{"Subject":"A"}); zoho.crm.updateRecord("Tasks",1,input.fields); zoho.crm.updateRecord(input.module,1,input.fields);',
      ),
    ],
  });
  const lens = fieldWriters(g, 'Tasks', 'Subject');
  expect(lens.writers.length).toBeGreaterThan(2);
  const counts = lensCounts(lens);
  expect(counts.total).toBe(2);
  expect(counts.groups).toEqual({
    declared: 1,
    exact: 1,
    partial: 0,
    unknownFields: 0,
    unresolved: 0,
  });
  expect([...counts.entityGroups.keys()].sort()).toEqual(
    ['function:multi', `rule:${taskRule.id}`].sort(),
  );
  expect(Object.values(counts.groups).reduce((n, count) => n + count, 0)).toBe(counts.total);
  expect(fieldWriterCount(lens, 'everything')).toBe(counts.total);
  expect(
    mostWrittenFields(g, filters({ scope: 'everything' }), 100).find(
      (r) => r.field.id === 'field:Tasks.Subject',
    )?.count,
  ).toBe(2);
  expect(lens.possibleWriters.length + lens.unresolvedWriters.length).toBeGreaterThan(0);
});
