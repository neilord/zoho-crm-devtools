// Large synthetic org for the Automation Map visual-state screenshots (tests/e2e/automation-map.spec.ts,
// "automation map visual states"). Roughly the shape of a big real org: ~80 modules of which only
// a dozen carry automation, ~25 workflow rules, ~100 functions (org-wide schedules and API
// functions among them), writes that cross modules, and some function sources that cannot be read
// so the coverage banner shows gaps. Every name is invented; nothing here is real configuration.
import type { SyntheticResponse } from './automation-map-zoho';

const MODULE_COUNT = 80;
const FUNCTION_COUNT = 100;
const RULE_COUNT = 25;
const SCHEDULE_COUNT = 5;
const API_COUNT = 8;
/** Function indices whose source request fails: each becomes one gap in the coverage banner. */
const UNREADABLE = new Set([3, 17, 41, 58, 66, 77, 90]);

const standard = ['Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Calls', 'Products', 'Quotes'];
const apiNameOf = (m: number) => standard[m] ?? `Module_${m + 1}`;
const labelOf = (m: number) => standard[m] ?? `Module ${m + 1}`;
const modules = Array.from({ length: MODULE_COUNT }, (_, m) => ({
  id: String(5100 + m),
  api_name: apiNameOf(m),
  singular_label: labelOf(m).replace(/s$/, ''),
  plural_label: labelOf(m),
}));

/** The twelve modules that carry rules; the rest stay empty so the board has a long quiet tail. */
const RULE_MODULES = [0, 1, 2, 3, 4, 5, 8, 11, 17, 24, 33, 45];
const ruleModule = (r: number) => RULE_MODULES[r % RULE_MODULES.length];
/** Writes cross modules: a function writes into another rule module, sometimes a quiet one. */
const writeTargets = (f: number): number[] => {
  const first = RULE_MODULES[(f * 5 + 3) % RULE_MODULES.length];
  const out = [first];
  if (f % 3 === 0) out.push(RULE_MODULES[(f * 7 + 1) % RULE_MODULES.length]);
  if (f % 11 === 0) out.push(50 + (f % 25));
  return out;
};

const fnId = (f: number) => String(7100000000000000000n + BigInt(f));
const fnApi = (f: number) => `synthetic_fn_${f + 1}`;
const ruleId = (r: number) => String(1001 + r);
/** The first RULE_COUNT functions are each called by one rule; later ones are org-wide. */
const isSchedule = (f: number) => f >= RULE_COUNT && f < RULE_COUNT + SCHEDULE_COUNT;
const isApi = (f: number) =>
  f >= RULE_COUNT + SCHEDULE_COUNT && f < RULE_COUNT + SCHEDULE_COUNT + API_COUNT;

const catalogue = Array.from({ length: FUNCTION_COUNT }, (_, f) => ({
  id: fnId(f),
  display_name: `Synthetic function ${f + 1}`,
  api_name: fnApi(f),
  language: 'deluge',
  source: 'crm',
  category: 'automation',
  updatedTime: '2030-01-01',
  associated_place:
    f < RULE_COUNT
      ? [{ _type: 'workflow_rules', id: ruleId(f), module: labelOf(ruleModule(f)) }]
      : [],
  rest_api: isApi(f) ? [{ type: f % 2 ? 'oauth' : 'zapikey', active: true }] : [],
  tasks: { integrations: [{ service: 'ZohoCRM', function: 'zoho.crm.updateRecord' }] },
}));

const triggers = ['create', 'edit', 'create_or_edit'];
const rules = Array.from({ length: RULE_COUNT }, (_, r) => ({
  id: ruleId(r),
  name: `Synthetic rule ${r + 1}`,
  module: { api_name: apiNameOf(ruleModule(r)) },
  status: { active: r % 6 !== 5 },
  modified_time: '2030-01-01',
  execute_when: { type: triggers[r % triggers.length], details: {} },
}));
const actionFor = (r: number) => [
  { id: String(4000 + r), type: 'functions' },
  ...(r % 2 ? [{ id: String(5000 + r), type: 'field_updates' }] : []),
];

const script = (f: number) =>
  writeTargets(f)
    .map(
      (m, i) =>
        `m${i} = Map(); m${i}.put("Stage", "synthetic"); m${i}.put("Notes", "n${f}");` +
        ` zoho.crm.updateRecord("${apiNameOf(m)}", ${f + 1}, m${i});`,
    )
    .join(' ');

const page = <T>(key: string, items: T[]) => ({
  body: { [key]: items, info: { more_records: false } },
});

export function largeOrgResponse(url: URL): SyntheticResponse | null {
  const path = url.pathname,
    id = path.split('/').at(-1) ?? '';
  if (path === '/crm/v2/settings/functions') return { body: { functions: catalogue } };
  if (path.startsWith('/crm/v2/settings/functions/')) {
    const f = Number(BigInt(id) - 7100000000000000000n);
    if (!Number.isInteger(f) || f < 0 || f >= FUNCTION_COUNT) return { status: 404 };
    if (UNREADABLE.has(f)) return { status: 404, body: { code: 'INVALID_DATA' } };
    return { body: { functions: [{ id, script: script(f) }] } };
  }
  if (path.endsWith('/workflow_rules')) return page('workflow_rules', rules);
  if (path.includes('/workflow_rules/')) {
    const r = Number(id) - 1001;
    if (!rules[r]) return { status: 404 };
    return {
      body: {
        workflow_rules: [
          {
            ...rules[r],
            conditions: [
              {
                id: `6${id}`,
                sequence_number: 1,
                instant_actions: { actions: actionFor(r) },
                scheduled_actions: [],
              },
            ],
          },
        ],
      },
    };
  }
  if (path.includes('/automation/functions/')) {
    const r = Number(id) - 4000;
    return {
      body: {
        functions: [{ id, name: `Call ${r + 1}`, function: { id: fnId(r), api_name: fnApi(r) } }],
      },
    };
  }
  if (path.includes('/automation/field_updates/')) {
    const r = Number(id) - 5000;
    return {
      body: {
        field_updates: [
          {
            id,
            name: `Declare ${r + 1}`,
            module: { api_name: apiNameOf(ruleModule(r)) },
            field: { api_name: 'Stage' },
            value: 'synthetic',
            type: 'value',
          },
        ],
      },
    };
  }
  if (path.endsWith('/modules')) return { body: { modules } };
  if (path.endsWith('/fields'))
    return {
      body: {
        fields: ['Stage', 'Notes', 'Amount', 'Status'].map((api, i) => ({
          id: String(70 + i),
          api_name: api,
          field_label: api,
        })),
        info: { more_records: false },
      },
    };
  if (path.endsWith('/custom_buttons')) {
    const m = modules.findIndex((x) => x.api_name === url.searchParams.get('module'));
    if (m < 0 || m % 9 !== 0) return { status: 204 };
    return {
      body: {
        custom_buttons: [
          {
            id: String(700 + m),
            name: `Synthetic button ${m + 1}`,
            position: ['detail'],
            action: 'function',
            details: { custom_function: { id: fnId(RULE_COUNT + SCHEDULE_COUNT + API_COUNT + m) } },
          },
        ],
      },
    };
  }
  if (path.endsWith('/automation/schedules'))
    return page(
      'schedules',
      Array.from({ length: SCHEDULE_COUNT }, (_, s) => ({
        id: String(800 + s),
        name: `Synthetic schedule ${s + 1}`,
        status: s === 4 ? 'deactive' : 'active',
        function: { api_name: fnApi(RULE_COUNT + s) },
        frequency: { type: 'daily' },
      })),
    );
  if (path.endsWith('/blueprints')) return page('blueprints', []);
  if (path.endsWith('/approval_process')) return page('approval_process', []);
  return null;
}

/** For assertions: whether a function index is an org-wide schedule or API function. */
export const largeOrgShape = {
  modules: MODULE_COUNT,
  rules: RULE_COUNT,
  functions: FUNCTION_COUNT,
  gaps: UNREADABLE.size,
  isSchedule,
  isApi,
};
