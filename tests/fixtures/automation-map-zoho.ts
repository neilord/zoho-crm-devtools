// Invented configuration; only the Developer Hub structure comes from sanitized Q8 research. The
// marked sibling row mirrors a live-observed native NEW marker: the span follows the link-to, it
// is not inside the anchor (observed 2026-10-24).
export const settingsHtml = `<!doctype html><html><head><title>Synthetic CRM Setup</title></head>
<body style="font:14px system-ui"><h1>Setup</h1><div class="crmSetupHomeGroupCards" aria-label="Developer Hub">
<div class="listItems pL34" id="devSpace_functions"><link-to data-zcqa="devSpace_functions"><a class="setupMenulink ellipsistext dIB">Functions</a></link-to></div>
<div class="listItems pL34"><link-to><a class="setupMenulink ellipsistext dIB">Native item</a></link-to> <span class="dIB pR right0 top2"><crm-ui-loaders><div class="crmNewReleaseLoader"><div class="crmNewReleaseLoader_1"></div><div class="crmNewReleaseLoader_2"></div><div class="crmNewReleaseLoader_3"></div></div></crm-ui-loaders></span></div></div></body></html>`;
export const workflowsHtml =
  '<!doctype html><html><body><h1>Workflow Rules</h1><list-workflows><div><input id="wfSearchWithName1" placeholder="Search"></div></list-workflows></body></html>';
export const functionId = '7000000000000000501';
export const sourceNeedle = 'am_source_only_tangerine_947';
export const fogSecrets = [
  'Fogged sibling rule',
  'Vault policy',
  'Vault writer',
  'vault_writer',
  'Vault singular',
  'Vault plural',
  'Vaults',
  '7000000000000000502',
  '7000000000000000503',
];
const moduleWire = (api: string, singular: string, plural: string, id: string) => ({
  id,
  api_name: api,
  singular_label: singular,
  plural_label: plural,
});
const modules = [
  moduleWire('Orchards', 'Orchard', 'Orchards', '51'),
  moduleWire('Vaults', 'Vault singular', 'Vault plural', '52'),
  moduleWire('Empty', 'Empty', 'Empty', '53'),
];
const fn = (id: string, name: string, api: string, rule: string, module: string) => ({
  id,
  display_name: name,
  api_name: api,
  language: 'deluge',
  source: 'crm',
  category: 'automation',
  updatedTime: '2030-01-01',
  associated_place: [{ _type: 'workflow_rules', id: rule, module }],
  tasks: { integrations: [{ service: 'ZohoCRM', function: 'zoho.crm.updateRecord' }] },
});
const catalogue = [
  fn(functionId, 'Ripen orchard', 'ripen_orchard', '101', 'Orchards'),
  fn('7000000000000000502', 'Sibling function', 'sibling_function', '102', 'Orchards'),
  fn('7000000000000000503', 'Vault writer', 'vault_writer', '201', 'Vault plural'),
];
const rule = (id: string, name: string, module = 'Orchards') => ({
  id,
  name,
  module: { api_name: module },
  status: { active: true },
  modified_time: '2030-01-01',
  execute_when: { type: 'create', details: {} },
});
const rules = [
  rule('101', 'Harvest flow'),
  rule('102', 'Fogged sibling rule'),
  rule('201', 'Vault policy', 'Vaults'),
];
const action = (id: string, type: string) => ({ id, type });
const actions = new Map([
  ['101', [action('301', 'functions'), action('302', 'field_updates')]],
  [
    '102',
    [action('303', 'email_notifications'), action('304', 'webhooks'), action('305', 'tasks')],
  ],
  ['201', []],
]);
export interface SyntheticResponse {
  status?: number;
  body?: unknown;
  raw?: string;
}
export function automationMapResponse(url: URL): SyntheticResponse | null {
  const path = url.pathname,
    id = path.split('/').at(-1);
  if (path === '/crm/v2/settings/functions')
    // Exercise lossless numeric parsing before JSON.parse, rather than only string ids.
    return {
      raw: JSON.stringify({ functions: catalogue }).replace(
        /"id":"(700000000000000050[123])"/g,
        '"id":$1',
      ),
    };
  if (path.startsWith('/crm/v2/settings/functions/'))
    return {
      body: {
        functions: [
          {
            id,
            script: `m = Map(); m.put("Harvest", "ready"); zoho.crm.updateRecord("Orchards", 1, m); info "${sourceNeedle}";`,
          },
        ],
      },
    };
  if (path.endsWith('/workflow_rules'))
    return { body: { workflow_rules: rules, info: { more_records: false } } };
  if (path.includes('/workflow_rules/'))
    return {
      body: {
        workflow_rules: [
          {
            ...rules.find((r) => r.id === id),
            conditions: [
              {
                id: `6${id}`,
                sequence_number: 1,
                instant_actions: { actions: actions.get(id ?? '') ?? [] },
                scheduled_actions: [],
              },
            ],
          },
        ],
      },
    };
  if (path.endsWith('/automation/functions/301'))
    return {
      body: {
        functions: [
          { id, name: 'Ripen orchard call', function: { id: '401', api_name: 'ripen_orchard' } },
        ],
      },
    };
  if (path.endsWith('/field_updates/302'))
    return {
      body: {
        field_updates: [
          {
            id,
            name: 'Declare harvest',
            module: { api_name: 'Orchards' },
            field: { api_name: 'Harvest' },
            value: 'ready',
            type: 'value',
          },
        ],
      },
    };
  if (path.endsWith('/email_notifications/303'))
    return {
      body: {
        email_notifications: [{ id, name: 'Orchard notification', template: { id: '601' } }],
      },
    };
  if (path.endsWith('/webhooks/304'))
    return {
      body: {
        webhooks: [
          {
            id,
            name: 'Notify configuration',
            url: 'https://example.invalid/never-call',
            http_method: 'POST',
          },
        ],
      },
    };
  if (path.endsWith('/tasks/305'))
    return {
      body: {
        tasks: [
          {
            id,
            name: 'Inspect orchard',
            field_mappings: [
              { field: { api_name: 'Subject' }, value: 'Inspect fruit', type: 'value' },
            ],
          },
        ],
      },
    };
  if (path.endsWith('/email_templates/601'))
    return {
      body: {
        email_templates: [
          {
            id,
            name: 'Harvest notice',
            subject: 'Fruit ready',
            content: '<p>Synthetic template blossom</p>',
          },
        ],
      },
    };
  if (path.endsWith('/modules')) return { body: { modules } };
  if (path.endsWith('/fields'))
    return url.searchParams.get('module') === 'Empty'
      ? { status: 204 }
      : {
          body: {
            fields: [
              { id: '71', api_name: 'Harvest', field_label: 'Harvest status' },
              { id: '72', api_name: 'Stage', field_label: 'Stage' },
            ],
            info: { more_records: false },
          },
        };
  if (path.endsWith('/custom_buttons')) {
    const module = url.searchParams.get('module');
    if (module === 'Empty') return { status: 204 };
    if (module === 'Vaults') return { status: 400, body: { code: 'NOT_SUPPORTED' } };
    return {
      body: {
        custom_buttons: [
          {
            id: '701',
            name: 'Ripen button',
            position: ['detail'],
            action: 'function',
            details: { custom_function: { id: functionId } },
          },
        ],
      },
    };
  }
  if (path.endsWith('/automation/schedules'))
    return {
      body: {
        schedules: [
          {
            id: '801',
            name: 'Daily ripening',
            status: 'active',
            function: { api_name: 'ripen_orchard' },
            frequency: { type: 'daily' },
          },
        ],
        info: { more_records: false },
      },
    };
  if (path.endsWith('/blueprints'))
    return {
      body: {
        blueprints: [
          {
            id: '901',
            name: 'Orchard stages',
            active: true,
            module: { api_name: 'Orchards' },
            field: { api_name: 'Stage' },
          },
        ],
        info: { more_records: false },
      },
    };
  if (path.endsWith('/blueprints/901/transitions'))
    return { body: { transitions: [{ id: '902' }], info: { more_records: false } } };
  if (path.endsWith('/blueprints/transitions/902'))
    return {
      body: {
        transitions: [
          {
            id,
            name: 'Pick fruit',
            during_inputs: [{ type: 'field', field: { api_name: 'Harvest' } }],
            actions: [action('302', 'field_updates')],
          },
        ],
      },
    };
  if (path.endsWith('/approval_process'))
    return {
      body: {
        approval_process: [
          { id: '1001', name: 'Harvest approval', active: true, module: { api_name: 'Orchards' } },
        ],
        info: { more_records: false },
      },
    };
  if (path.endsWith('/approval_process/1001/rules'))
    return {
      body: {
        rules: [
          {
            id: '1002',
            actions_upon_final_approval: { actions: [action('302', 'field_updates')] },
          },
        ],
        info: { more_records: false },
      },
    };
  return null;
}
