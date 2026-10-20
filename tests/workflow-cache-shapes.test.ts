import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeAction,
  normalizeField,
  normalizeRule,
  normalizeTrigger,
} from '../src/content/workflows/normalize';
import type {
  FunctionJoinConfidence,
  FunctionSourceState,
  WorkflowActionKind,
  WorkflowLoadState,
  WorkflowRule,
  WorkflowTriggerType,
} from '../src/content/workflows/types';
import { packWorkflowCache, unpackWorkflowCache } from '../src/shared/workflow-cache-codec';
import {
  isWorkflowCache,
  packedWorkflowCacheIssue,
  WORKFLOW_CACHE_LIMIT,
  WORKFLOW_PACKED_LIMIT,
  type WorkflowGraphCache,
  workflowCacheIssue,
} from '../src/shared/workflow-cache-protocol';
import { detail } from './fixtures/workflows';

// Records make union additions a compile-time reminder to extend the cache contract fixtures.
const actionPayloads: Record<WorkflowActionKind, unknown> = {
  fieldUpdate: {
    type: 'field_updates',
    details: { field: null, value: { expression: `\${NOW}` }, type: null },
  },
  task: { type: 'tasks', details: { field_mappings: [{ field: null, value: null }] } },
  emailNotification: {
    type: 'email_notifications',
    details: { template: { id: 'ext__template' }, recipients: null },
  },
  webhook: { type: 'webhooks', details: { url: '', http_method: null } },
  function: {
    type: 'functions',
    details: {
      function: { id: 'ext__fn', api_name: null },
      arguments: [{ name: '', value: null }],
    },
  },
  slack: { type: 'slack_notifications', details: { message: '<br>&nbsp;', notify_to: null } },
  assignOwner: { type: 'assign_owner', details: { assign_to: null } },
  addTags: { type: 'add_tags', details: { tags: [{ id: '', name: null }], over_write: null } },
  convert: {
    type: 'convert',
    details: { field_mappings: [{ field: '', value: { future: [null, ''] } }] },
  },
  unknown: {
    type: 'future_action',
    details: { future: null, nested: { html: '<img onerror="inert()">' } },
  },
};
const triggers: Record<WorkflowTriggerType, unknown> = {
  field_update: {
    criteria: {
      group_operator: 'AND',
      group: [
        { field: { api_name: 'Fruit' }, comparator: '', value: [null, ''] },
        { future: null },
      ],
    },
    match_all: null,
  },
  create: null,
  create_or_edit: {},
  edit: { repeat: null },
  date_or_datetime: { field: null, unit: '', period: null, recur_cycle: null },
  mail_sent: {},
  mail_sent_opened: {},
  mail_sent_bounced: {},
  email_received: {},
  section_update: { section_ids: ['', 'ext__section'] },
  incoming_call_createedit: {},
  outgoing_call_createedit: {},
  unknown: { future: null },
};
const loadStates: Record<WorkflowLoadState, true> = {
  'not-requested': true,
  loading: true,
  loaded: true,
  failed: true,
};
const joins: Record<FunctionJoinConfidence, true> = { exact: true, uncertain: true, none: true };
const sourceStates: Record<FunctionSourceState, true> = {
  'not-requested': true,
  loading: true,
  available: true,
  unavailable: true,
};
const html = `<html><body>${'<p>Orchard &amp; 🌳 reminder</p>'.repeat(5000)}</body></html>`;
function fixtures(): WorkflowRule[] {
  const rules: WorkflowRule[] = [];
  for (const [type, details] of Object.entries(triggers)) {
    const raw = {
      ...detail('ext__rule', Object.values(actionPayloads)),
      execute_when: { type: type === 'unknown' ? 'future_trigger' : type, details },
    };
    const rule = normalizeRule(raw, raw);
    expect(rule.trigger?.type).toBe(type);
    expect(rule.conditions[0].instantActions.map((a) => a.kind)).toEqual(
      Object.keys(actionPayloads),
    );
    rules.push(rule);
  }
  for (const state of Object.keys(loadStates) as WorkflowLoadState[])
    for (const joinConfidence of Object.keys(joins) as FunctionJoinConfidence[])
      for (const sourceState of Object.keys(sourceStates) as FunctionSourceState[]) {
        const rule = normalizeRule(detail());
        const action = normalizeAction(actionPayloads.function);
        if (action.kind !== 'function') throw new Error('Invalid fixture');
        rules.push({
          ...rule,
          detailState: state,
          enrichmentState: state,
          trigger: normalizeTrigger(null),
          conditions: [
            {
              ...normalizeRule(detail(), detail()).conditions[0],
              instantActions: [
                {
                  ...action,
                  state,
                  joinConfidence,
                  sourceState,
                  delugeFunctionId: 'ext__fn',
                  sourceText: sourceState === 'available' ? 'info "synthetic";' : null,
                },
                {
                  ...normalizeAction(actionPayloads.emailNotification),
                  kind: 'emailNotification',
                  recipients: null,
                  template: {
                    id: 'ext__template',
                    name: '',
                    subject: null,
                    bodyText: null,
                    state,
                    raw: { content: html },
                  },
                },
              ],
              scheduledActions: [],
            },
          ],
        });
      }
  // The normalizer's raw type is unknown; numeric, empty and absent IDs are not normalized strings on the wire.
  for (const raw of [null, {}, { id: 123 }, { id: '' }, { id: 'ext__fn' }, { id: null }])
    rules.push(normalizeRule(raw, raw));
  return rules;
}
const graph = (rules: WorkflowRule[]): WorkflowGraphCache => ({
  version: 2,
  savedAt: 1,
  summaries: rules.map((r) => r.raw),
  details: rules.map((r) => [r.id, r.detailRaw]),
  resources: Object.entries(actionPayloads),
  templates: [['ext__template', { content: html }]],
  fields: [
    [
      '',
      [
        ['', normalizeField(null)],
        ['ext__field', normalizeField({ api_name: '', field_label: '' })],
      ],
    ],
  ],
  catalogue: [
    { id: 'ext__fn', api_name: null, display_name: '', category: '' },
    { id: '', api_name: '', display_name: '', category: '' },
  ],
  sources: [
    ['ext__fn', 'info "synthetic";'],
    ['', null],
    ['unavailable', null],
    ['long', '🌳'.repeat(50000)],
  ],
});
afterEach(() => vi.unstubAllEnvs());
describe('workflow cache accepts the normalizer contract', () => {
  it('roundtrips every action, trigger, load, join and source state through both cache schemas', async () => {
    const rules = fixtures();
    for (const value of [{ version: 1 as const, savedAt: 1, rules }, graph(rules)]) {
      expect(workflowCacheIssue(value)).toBeNull();
      expect(isWorkflowCache(value)).toBe(true);
      const json = JSON.parse(JSON.stringify(value));
      expect(workflowCacheIssue(json)).toBeNull();
      expect(await unpackWorkflowCache(await packWorkflowCache(value))).toEqual(json);
    }
  });
  it.each([
    [{ ...graph([]), version: 99 }, '$.version'],
    [{ ...graph([]), savedAt: null }, '$.savedAt'],
    [{ ...graph([]), sources: [['ext__fn', false]] }, '$.sources[0][1]'],
    [{ ...graph([]), details: [['ext__rule']] }, '$.details[0]'],
    [{ ...graph([]), templates: [[123, null]] }, '$.templates[0][0]'],
    [{ ...graph([]), catalogue: [null] }, '$.catalogue[0]'],
    [
      { ...graph([]), catalogue: [{ id: 'ext__fn', api_name: { secret: 'never log' } }] },
      '$.catalogue[0].api_name',
    ],
    [
      { ...graph([]), fields: [['Orchards', [['Fruit', { apiName: 'Fruit', label: null }]]]] },
      '$.fields[0][1][0][1].label',
    ],
  ])('reports the failing structural path without values', async (value, path) => {
    expect(workflowCacheIssue(value)?.path).toBe(path);
    vi.stubEnv('MODE', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await unpackWorkflowCache(value)).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        'Zoho CRM DevTools: invalid workflow cache',
        expect.objectContaining({ path }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('never log');
    } finally {
      warn.mockRestore();
    }
  });
  it('keeps raw values out of production diagnostics', async () => {
    vi.stubEnv('MODE', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await unpackWorkflowCache({ ...graph([]), savedAt: null })).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

it('diagnoses decoded and encoded budgets without printing large contents', () => {
  const value = { ...graph([]), sources: [['ext__fn', 'x'.repeat(WORKFLOW_CACHE_LIMIT)]] };
  expect(workflowCacheIssue(value)?.path).toBe('$.byteLength');
  expect(
    packedWorkflowCacheIssue({
      encoding: 'gzip-base64',
      savedAt: 1,
      data: 'A'.repeat(WORKFLOW_PACKED_LIMIT + 1),
    })?.path,
  ).toBe('$.data.length');
});
it.each([
  [{ encoding: 'future', savedAt: 1, data: '' }, '$.encoding'],
  [{ encoding: 'gzip-base64', savedAt: 1, data: 'A' }, '$.data'],
  [{ encoding: 'gzip-base64', savedAt: 1, data: '<private>' }, '$.data'],
  [{ encoding: 'gzip-base64', savedAt: null, data: '' }, '$.savedAt'],
])('diagnoses invalid packed envelopes', async (value, path) => {
  vi.stubEnv('MODE', 'development');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await unpackWorkflowCache(value)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Zoho CRM DevTools: invalid workflow cache',
      expect.objectContaining({ path }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('<private>');
  } finally {
    warn.mockRestore();
  }
});
