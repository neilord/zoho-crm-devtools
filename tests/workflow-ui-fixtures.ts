import type { WorkflowIndexLike } from '../src/content/workflows/overlay';
import type {
  WorkflowAction,
  WorkflowCondition,
  WorkflowCriteria,
  WorkflowIndexFailure,
  WorkflowIndexProgress,
  WorkflowIndexSnapshot,
  WorkflowRule,
  WorkflowTrigger,
} from '../src/content/workflows/types';

/** Entirely invented configuration for UI tests; shapes follow src/content/workflows/types.ts. */

const mod = (apiName: string, label = apiName) => ({ apiName, label });
const field = (apiName: string, label = apiName) => ({ apiName, label });

export const predicate = (apiName: string, label: string, value: string): WorkflowCriteria => ({
  kind: 'predicate',
  field: field(apiName, label),
  comparator: 'equal',
  value,
  raw: null,
});

export const fieldUpdateTrigger = (
  apiName: string,
  label: string,
  value: string,
): WorkflowTrigger => ({
  type: 'field_update',
  triggerModule: null,
  repeat: null,
  criteria: predicate(apiName, label, value),
  matchAll: null,
  raw: null,
});
export const createTrigger = (): WorkflowTrigger => ({
  type: 'create',
  triggerModule: null,
  repeat: null,
  raw: null,
});

const base = { id: null, module: null, state: 'loaded' as const, raw: null };
export const fieldUpdateAction = (
  name: string,
  apiName: string,
  value: string,
): WorkflowAction => ({
  ...base,
  id: `fu-${name}`,
  name,
  kind: 'fieldUpdate',
  field: field(apiName, apiName),
  value,
  valueType: 'value',
  relatedModule: null,
});
export const emailAction = (templateName: string, subject: string): WorkflowAction => ({
  ...base,
  id: `em-${templateName}`,
  name: 'Notify owner',
  kind: 'emailNotification',
  template: {
    id: 't1',
    name: templateName,
    subject,
    bodyText: 'Hello there',
    state: 'loaded',
    raw: null,
  },
  recipients: ['owner'],
});
export const webhookAction = (url: string): WorkflowAction => ({
  ...base,
  id: `wh-${url}`,
  name: 'Ping partner',
  kind: 'webhook',
  url,
  method: 'POST',
});
export const unknownAction = (): WorkflowAction => ({
  ...base,
  id: null,
  name: '',
  kind: 'unknown',
  rawType: 'mystery_action',
  jsonText: '{"type":"mystery_action","flavour":"sourdough"}',
});
export const SOURCE = [
  '// Synthetic helper',
  'void score_orchard(int id)',
  '{',
  '  resp = invokeurl',
  '  [',
  '    url :"https://hooks.example.test/score"',
  '    type :POST',
  '  ];',
  '  info resp;',
  '}',
].join('\n');
export const functionAction = (
  apiName: string,
  over: Partial<Extract<WorkflowAction, { kind: 'function' }>> = {},
): WorkflowAction => ({
  ...base,
  id: `fn-${apiName}`,
  name: apiName,
  kind: 'function',
  bindingName: apiName,
  apiName,
  crmFunctionId: '401',
  delugeFunctionId: '501',
  joinConfidence: 'exact',
  sourceState: 'available',
  sourceText: SOURCE,
  arguments: [{ name: 'orchardId', type: 'value', value: `$\{Orchards.Id}`, raw: null }],
  ...over,
});

export const condition = (
  instant: WorkflowAction[],
  over: Partial<WorkflowCondition> = {},
): WorkflowCondition => ({
  id: '1',
  sequenceNumber: 1,
  criteria: predicate('Fruit', 'Fruit', 'Pear'),
  relatedCriteria: null,
  instantActions: instant,
  scheduledActions: [],
  raw: null,
  ...over,
});

export function rule(over: Partial<WorkflowRule> & { id: string; name: string }): WorkflowRule {
  return {
    description: '',
    module: mod('Orchards', 'Orchards'),
    active: true,
    deprecated: false,
    category: null,
    trigger: createTrigger(),
    conditions: [condition([])],
    detailState: 'loaded',
    enrichmentState: 'loaded',
    failureIds: [],
    raw: null,
    modifiedTime: '2030-01-02T00:00:00Z',
    ...over,
  };
}

export const progress = (over: Partial<WorkflowIndexProgress> = {}): WorkflowIndexProgress => ({
  phase: 'complete',
  rulesTotal: null,
  ruleDetailsTotal: null,
  actionResourcesTotal: null,
  templatesTotal: null,
  functionSourcesTotal: null,
  functionSourcesFailed: 0,
  rulesListed: 0,
  ruleDetailsLoaded: 0,
  ruleDetailsFailed: 0,
  actionResourcesLoaded: 0,
  actionResourcesFailed: 0,
  templatesLoaded: 0,
  templatesFailed: 0,
  functionSourcesAvailable: 0,
  functionSourcesUnavailable: 0,
  functionSourcesUncertain: 0,
  isComplete: true,
  failures: [],
  ...over,
});

export function sampleRules(): WorkflowRule[] {
  return [
    rule({
      id: '1001',
      name: 'Ripeness check',
      description: 'Flags pears that ripen early',
      trigger: fieldUpdateTrigger('Stage', 'Stage', 'Ripe'),
      conditions: [
        condition([
          fieldUpdateAction('Stamp ripe date', 'Ripe_On', 'today'),
          functionAction('wf_score_orchard'),
        ]),
      ],
    }),
    rule({
      id: '1002',
      name: 'Basket welcome',
      module: mod('Baskets', 'Baskets'),
      active: false,
      conditions: [condition([emailAction('Welcome basket', 'Your basket is ready')])],
    }),
    rule({
      id: '1003',
      name: 'Partner ping',
      module: mod('Baskets', 'Baskets'),
      conditions: [
        condition([webhookAction('https://partner.example.test/hook'), unknownAction()]),
      ],
    }),
    rule({
      id: '1004',
      name: 'Still loading',
      detailState: 'loading',
      enrichmentState: 'not-requested',
      trigger: null,
      conditions: [],
    }),
  ];
}

export function snapshot(
  rules: WorkflowRule[] = sampleRules(),
  over: Partial<WorkflowIndexProgress> = {},
): WorkflowIndexSnapshot {
  return {
    rules,
    progress: progress({ rulesListed: rules.length, ruleDetailsLoaded: rules.length, ...over }),
  };
}

export function failure(id: string, retry = async () => {}): WorkflowIndexFailure {
  return {
    id,
    target: {
      kind: 'actionResource',
      actionKind: 'webhook',
      resourceId: `wh-https://partner.example.test/hook`,
    },
    ruleIds: ['1003'],
    message: 'Zoho configuration could not be read.',
    retry,
  };
}

export class FakeIndex implements WorkflowIndexLike {
  listeners = new Set<(s: WorkflowIndexSnapshot) => void>();
  disposed = false;
  loads = 0;
  retried = 0;
  loadError: Error | null = null;
  constructor(public current: WorkflowIndexSnapshot = snapshot()) {}
  subscribe(listener: (s: WorkflowIndexSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
  async load(): Promise<void> {
    this.loads++;
    if (this.loadError) throw this.loadError;
  }
  async retryFailed(): Promise<void> {
    this.retried++;
  }
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
  publish(next: WorkflowIndexSnapshot): void {
    this.current = next;
    for (const l of this.listeners) l(next);
  }
}
