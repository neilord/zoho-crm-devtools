/** Entirely invented demo org. No configuration or source is copied from a customer. */
import { analyzeDelugeEffects } from '../../src/content/automation-map/analyzer';
import { buildAutomationGraph } from '../../src/content/automation-map/graph/build';
import type { AutomationGraphInputs, FunctionInput } from '../../src/content/automation-map/types';
import type {
  WorkflowAction,
  WorkflowCriteria,
  WorkflowRule,
  WorkflowTriggerType,
} from '../../src/content/workflows/types';

const moduleNames = [
  'Leads',
  'Contacts',
  'Accounts',
  'Deals',
  'Quotes',
  'Invoices',
  'Cases',
  'Partner_Reviews',
];
const names = [
  'Qualify new enquiries',
  'Keep contact preferences current',
  'Refresh account health',
  'Review large opportunities',
  'Prepare quote follow-up',
  'Flag overdue invoices',
  'Route priority cases',
  'Renew partner certification',
];
const statusField = (m: string) =>
  m === 'Deals' ? 'Stage' : m === 'Leads' ? 'Lead_Status' : 'Status';
const pad = (n: number) => String(n).padStart(3, '0');
const fid = (n: number) => `f-${pad(n)}`;
const api = (n: number) =>
  ['update_sales_health', 'synchronize_account', 'notify_operations'][n] ??
  `maintain_${moduleNames[n % 8].toLowerCase()}_${n}`;
const predicate = (field: string, value: string): WorkflowCriteria => ({
  kind: 'predicate',
  field: { apiName: field, label: field.replaceAll('_', ' ') },
  comparator: 'equal',
  value,
  raw: null,
});
const actionBase = (name: string) => ({
  id: `resource-${name.replaceAll(' ', '-')}`,
  name,
  module: null,
  state: 'loaded' as const,
  raw: null,
});
function functionAction(n: number): WorkflowAction {
  return {
    ...actionBase(`Run ${api(n)}`),
    kind: 'function',
    bindingName: api(n),
    apiName: api(n),
    crmFunctionId: `crm-${n}`,
    delugeFunctionId: fid(n),
    joinConfidence: 'exact',
    sourceState: 'available',
    sourceText: null,
    arguments: [
      {
        name: 'recordId',
        type: 'value',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Zoho merge expressions are configuration data.
        value: '${Deals.Deals Id}',
        raw: null,
      },
    ],
  };
}
function fieldAction(
  moduleApiName: string,
  field = statusField(moduleApiName),
  value = 'Review',
): WorkflowAction {
  return {
    ...actionBase(`Set ${field.replaceAll('_', ' ')}`),
    kind: 'fieldUpdate',
    module: { apiName: moduleApiName, label: moduleApiName },
    field: { apiName: field, label: field.replaceAll('_', ' ') },
    relatedModule: null,
    value,
    valueType: 'static',
  };
}
const taskAction = (): WorkflowAction => ({
  ...actionBase('Call customer after review'),
  kind: 'task',
  subject: 'Discuss next steps',
  fieldMappings: [
    {
      field: { apiName: 'Subject', label: 'Subject' },
      type: 'static',
      value: 'Discuss next steps',
      displayValue: null,
      raw: null,
    },
  ],
});
function source(n: number): string {
  const m = moduleNames[n % 8];
  if (n === 0)
    return '// Refresh sales health from several entry points\nstandalone.synchronize_account(recordId);\nzoho.crm.updateRecord("Deals",recordId,{"Health_Score":85});';
  if (n === 1)
    return 'standalone.notify_operations(recordId);\nzoho.crm.updateRecord("Accounts",recordId,{"Health_Score":90});';
  if (n === 2)
    return 'sendmail\n[\nfrom:zoho.adminuserid\nto:"operations@example.invalid"\nsubject:"Review ready"\nmessage:"A synthetic review is ready"\n];';
  if (n === 3)
    return '// Explicit workflow request forms a possible cycle\nstandalone.update_sales_health(recordId);\nzoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"},{"trigger":["workflow"]});';
  if (n === 4)
    return 'patch = {"Stage":"Review"};\npatch.putAll(input.get("patch"));\nzoho.crm.updateRecord("Deals",recordId,patch);';
  if (n === 5) return 'zoho.crm.updateRecord(input.get("module"),recordId,input.get("patch"));';
  if (n === 6)
    return 'response = invokeurl\n[\nurl:"https://sync.example.invalid/v1/reviews?region=east"\ntype:POST\nparameters:{"status":"ready"}\nconnection:"partner_sync"\n];\nzoho.books.getRecords("Contacts","fictional-org",{});\nzoho.crm.updateRecord("Accounts",recordId,{"Health_Score":91},{"trigger":[]},"account_sync");\nstandalone.notify_operations(recordId);';
  if (n === 7)
    return 'zoho.crm.createRecord("Cases",{"Subject":"Partner review"},{"trigger":["workflow"]});';
  if (n === 8)
    return 'zoho.crm.upsert("Contacts",{"Email":"person@example.invalid"},{"trigger":[]});';
  return `// ${names[n % 8]}\n${n % 7 === 0 ? 'standalone.update_sales_health(recordId);\n' : ''}zoho.crm.updateRecord("${m}",recordId,{"${statusField(m)}":"Review","Last_Automation":"${api(n)}"});`;
}

function makeInputs(ruleCount: number, functionCount: number): AutomationGraphInputs {
  const modules = moduleNames.map((apiName) => ({
    apiName,
    label: apiName === 'Partner_Reviews' ? 'Partner Reviews' : apiName,
    pluralLabel: apiName === 'Partner_Reviews' ? 'Partner Reviews' : apiName,
  }));
  const catalogue = Array.from({ length: functionCount }, (_, n) => ({
    id: fid(n),
    apiName: api(n),
    category: 'standalone',
  }));
  const functions: FunctionInput[] = Array.from({ length: functionCount }, (_, n) => {
    const text = source(n);
    const sourceState =
      n === 57 ? 'pending' : n === 58 ? 'unavailable' : n === 59 ? 'failed' : 'available';
    return {
      delugeId: fid(n),
      summary: {
        id: fid(n),
        display_name:
          n < 3
            ? ['Update sales health', 'Synchronize account', 'Notify operations'][n]
            : `${names[n % 8]} helper ${n}`,
        api_name: api(n),
        category: n === 10 ? 'scheduler' : n === 11 ? 'button' : 'standalone',
        language: 'deluge',
        source: 'crm',
        rest_api:
          n === 12
            ? [
                { type: 'oauth', active: true },
                { type: 'zapikey', active: true },
              ]
            : [{ type: 'oauth', active: false }],
      },
      places:
        n === 10
          ? [
              {
                type: 'schedules',
                id: 'nightly-review',
                modulePluralLabel: 'Partner Reviews',
                raw: null,
              },
            ]
          : n === 11
            ? [
                {
                  type: 'custom_buttons',
                  id: 'review-partner',
                  modulePluralLabel: 'Partner Reviews',
                  raw: null,
                },
              ]
            : [],
      sourceState,
      sourceText: sourceState === 'available' ? text : null,
      effects:
        sourceState === 'available'
          ? analyzeDelugeEffects(text, { functionId: fid(n), parameters: ['recordId'], catalogue })
          : null,
    };
  });
  const triggerTypes: WorkflowTriggerType[] = [
    'create',
    'edit',
    'create_or_edit',
    'field_update',
    'date_or_datetime',
    'mail_sent',
    'mail_sent_opened',
    'mail_sent_bounced',
    'email_received',
    'section_update',
    'incoming_call_createedit',
    'outgoing_call_createedit',
  ];
  const rules: WorkflowRule[] = Array.from({ length: ruleCount }, (_, n) => {
    const m = moduleNames[n % 8],
      type = triggerTypes[n % triggerTypes.length];
    const tbase = { triggerModule: null, repeat: true, raw: null };
    const trigger =
      type === 'field_update'
        ? ({
            ...tbase,
            type,
            criteria: predicate(statusField(m), 'Review'),
            matchAll: false,
          } as const)
        : type === 'date_or_datetime'
          ? ({
              ...tbase,
              type,
              field: { apiName: 'Renewal_Date', label: 'Renewal Date' },
              offset: { unit: 2, period: 'days', raw: null },
              recurrence: 'yearly',
              executeAt: null,
            } as const)
          : type === 'section_update'
            ? ({ ...tbase, type, sectionIds: ['qualification'] } as const)
            : ({ ...tbase, type } as WorkflowRule['trigger']);
    const actions: WorkflowAction[] = [
      functionAction(
        n === 3 ? 3 : n % 3 === 0 ? 0 : n % 5 === 0 ? 1 : n % Math.max(1, functionCount),
      ),
      fieldAction(m),
    ];
    if (n % 5 === 0)
      actions.push({
        ...actionBase('Send review guide'),
        kind: 'emailNotification',
        template: {
          id: `guide-${n % 3}`,
          name: 'Customer review guide',
          subject: 'Your next steps',
          bodyText: 'Thanks for your interest. Arrange a product review with our team.',
          state: 'loaded',
          raw: null,
        },
        recipients: ['record_contact'],
      });
    if (n % 7 === 0)
      actions.push({
        ...actionBase('Notify partner service'),
        kind: 'webhook',
        url: 'https://hooks.example.invalid/crm/review?source=workflow',
        method: 'POST',
      });
    if (n % 11 === 0) actions.push(taskAction());
    if (n === 0)
      actions.push({
        ...actionBase('Convert qualified enquiry'),
        kind: 'convert',
        module: { apiName: 'Contacts', label: 'Contacts' },
        fieldMappings: [
          {
            field: { apiName: 'Lead_Source', label: 'Lead Source' },
            type: 'static',
            value: 'Partner',
            displayValue: null,
            raw: null,
          },
        ],
        configuration: null,
      });
    return {
      id: `rule-${pad(n)}`,
      name: `${names[n % 8]} ${Math.floor(n / 8) + 1}`,
      description: 'Keep CRM records consistent when the review process changes.',
      module: { apiName: m, label: modules[n % 8].label },
      active: n % 9 !== 8,
      deprecated: false,
      category: 'default',
      trigger,
      conditions: [
        {
          id: `condition-${n}`,
          sequenceNumber: 1,
          criteria: predicate(statusField(m), 'Review'),
          relatedCriteria:
            n % 6 === 0
              ? {
                  module: { apiName: 'Accounts', label: 'Accounts' },
                  moduleSelection: null,
                  criteria: predicate('Industry', 'Manufacturing'),
                  raw: null,
                }
              : null,
          instantActions: actions,
          scheduledActions:
            n % 4 === 0
              ? [
                  {
                    id: `reminder-${n}`,
                    label: '2 days after Renewal Date',
                    offset: { unit: 2, period: 'days', raw: null },
                    actions: [taskAction(), functionAction(2)],
                    raw: null,
                  },
                ]
              : [],
          raw: null,
        },
      ],
      detailState: 'loaded',
      enrichmentState: 'loaded',
      failureIds: [],
      raw: null,
    };
  });
  return {
    modules,
    fields: new Map(
      modules.map((m) => [
        m.apiName,
        [statusField(m.apiName), 'Health_Score', 'Last_Automation', 'Renewal_Date', 'Industry'].map(
          (apiName) => ({ apiName, label: apiName.replaceAll('_', ' ') }),
        ),
      ]),
    ),
    rules,
    functions,
    buttons: [
      {
        id: 'review-partner',
        name: 'Review partner',
        moduleApiName: 'Partner_Reviews',
        placements: ['view'],
        actionType: 'custom_function',
        functionDelugeId: fid(11),
        raw: null,
      },
      {
        id: 'partner-portal',
        name: 'Open partner portal',
        moduleApiName: 'Accounts',
        placements: ['view'],
        actionType: 'url',
        functionDelugeId: null,
        raw: null,
      },
      {
        id: 'check-details',
        name: 'Check contact details',
        moduleApiName: 'Contacts',
        placements: ['standard_view'],
        actionType: 'cscript',
        functionDelugeId: null,
        raw: null,
      },
    ],
    schedules: [
      {
        id: 'nightly-review',
        name: 'Nightly partner review',
        active: true,
        recurrenceLabel: 'Every day at 02:00',
        functionApiName: null,
        raw: null,
      },
      {
        id: 'legacy-cleanup',
        name: 'Legacy cleanup',
        active: false,
        recurrenceLabel: 'Every Sunday',
        functionApiName: api(9),
        raw: null,
      },
    ],
    transitions: [
      {
        blueprintId: 'sales-process',
        blueprintName: 'Opportunity review',
        blueprintActive: true,
        moduleApiName: 'Deals',
        transitionId: 'submit',
        name: 'Submit for review',
        duringInputFields: ['Amount', 'Closing_Date'],
        actions: [fieldAction('Deals', 'Stage', 'Review'), taskAction()],
        raw: null,
      },
      {
        blueprintId: 'case-process',
        blueprintName: 'Case resolution',
        blueprintActive: false,
        moduleApiName: 'Cases',
        transitionId: 'resolve',
        name: 'Resolve case',
        duringInputFields: ['Resolution'],
        actions: [fieldAction('Cases', 'Status', 'Closed')],
        raw: null,
      },
    ],
    approvals: [
      {
        id: 'discount-review',
        name: 'Approve exceptional discount',
        moduleApiName: 'Quotes',
        active: true,
        actions: [fieldAction('Quotes', 'Approval_Status', 'Approved'), functionAction(1)],
        raw: null,
      },
    ],
  };
}

export function fixtureInputs(): AutomationGraphInputs {
  return makeInputs(45, 60);
}
export function fixtureGraph() {
  return buildAutomationGraph(fixtureInputs());
}
export function fixtureSources(): ReadonlyMap<string, string> {
  return new Map(
    fixtureInputs().functions.flatMap((f) =>
      f.sourceText === null ? [] : [[f.delugeId, f.sourceText] as const],
    ),
  );
}
/** Builds sources through the real analyzer; benchmark graph construction separately from analysis. */
export function generateLargeInputs(
  options: { rules: number; functions: number } = { rules: 330, functions: 920 },
): AutomationGraphInputs {
  return makeInputs(options.rules, options.functions);
}

/**
 * The demo org plus writers of Deals.Stage that make counts drift when they are not folded per
 * entity: Deals rules that update Stage twice (an instant and a delayed action), and functions
 * that write it exactly at several call sites, exactly and partially, exactly and to an unknown
 * module, only partially, and only to an unknown module.
 */
export function lensDupesInputs(): AutomationGraphInputs {
  const inputs = makeInputs(45, 60);
  const rules = inputs.rules.map((rule) =>
    rule.module?.apiName === 'Deals' && rule.active
      ? {
          ...rule,
          conditions: rule.conditions.map((condition) => ({
            ...condition,
            scheduledActions: [
              ...condition.scheduledActions,
              {
                id: `stage-followup-${rule.id}`,
                label: '2 days after Closing Date',
                offset: { unit: 2, period: 'days' as const, raw: null },
                actions: [
                  { ...fieldAction('Deals', 'Stage', 'Won'), id: 'resource-Set-Stage-followup' },
                ],
                raw: null,
              },
            ],
          })),
        }
      : rule,
  );
  const sources = [
    'zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"});\nzoho.crm.updateRecord("Deals",recordId,{"Stage":"Won"});',
    'zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"});\nzoho.crm.updateRecord("Deals",recordId,input.get("patch"));',
    'zoho.crm.updateRecord("Deals",recordId,{"Stage":"Review"});\nzoho.crm.updateRecord(input.get("module"),recordId,input.get("patch"));',
    'patch = {"Stage":"Review"};\npatch.putAll(input.get("patch"));\nzoho.crm.updateRecord("Deals",recordId,patch);',
    'zoho.crm.updateRecord(input.get("module"),recordId,input.get("patch"));',
  ];
  const catalogue = inputs.functions.map((f) => ({
    id: f.delugeId,
    apiName: f.summary.api_name ?? f.delugeId,
    category: 'standalone',
  }));
  const extra: FunctionInput[] = sources.map((text, i) => {
    const id = fid(200 + i);
    return {
      delugeId: id,
      summary: {
        id,
        display_name: `Stage gate ${i + 1}`,
        api_name: `stage_gate_${i + 1}`,
        category: 'standalone',
        language: 'deluge',
        source: 'crm',
        rest_api: [{ type: 'oauth', active: false }],
      },
      places: [],
      sourceState: 'available',
      sourceText: text,
      effects: analyzeDelugeEffects(text, { functionId: id, parameters: ['recordId'], catalogue }),
    };
  });
  return { ...inputs, rules, functions: [...inputs.functions, ...extra] };
}
