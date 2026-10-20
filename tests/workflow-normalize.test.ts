import { describe, expect, it, vi } from 'vitest';
import {
  normalizeAction,
  normalizeCriteria,
  normalizeField,
  normalizeRule,
  normalizeTemplate,
  normalizeTrigger,
  triggerTypes,
} from '../src/content/workflows/normalize';
import { detail, functionResource, predicate } from './fixtures/workflows';

describe('workflow normalization with synthetic wire data', () => {
  it.each(triggerTypes.filter((t) => t !== 'unknown'))('preserves trigger %s', (type) => {
    expect(
      normalizeTrigger({
        type,
        details: {
          trigger_module: { api_name: 'Notes' },
          field: predicate.field,
          criteria: predicate,
          section_ids: ['8'],
          period: 'b_days',
          unit: 3,
          recur_cycle: 'once',
          execute_at: '09:00:00',
          repeat: false,
        },
      }),
    ).toMatchObject({ type, triggerModule: { apiName: 'Notes' }, repeat: false });
  });
  it('retains unknown trigger/action JSON visibly', () => {
    expect(normalizeTrigger({ type: 'future_event', details: { label: 'rain' } })).toMatchObject({
      type: 'unknown',
      rawType: 'future_event',
      jsonText: expect.stringContaining('rain'),
    });
    expect(normalizeAction({ type: 'future_action', details: { label: 'snow' } })).toMatchObject({
      kind: 'unknown',
      jsonText: expect.stringContaining('snow'),
    });
  });
  it.each([
    [
      'field_updates',
      'fieldUpdate',
      { field: predicate.field, value: `\${EXECUTION_DAY}+0`, type: 'expression' },
    ],
    [
      'tasks',
      'task',
      {
        field_mappings: [
          { field: { api_name: 'Subject' }, value: 'Pick pears', display_value: 'Pick pears' },
        ],
      },
    ],
    [
      'email_notifications',
      'emailNotification',
      { template: { id: '601', name: 'Harvest' }, recipients: { type: 'owner' } },
    ],
    [
      'webhooks',
      'webhook',
      { url: 'https://orchard.example.invalid/harvest', http_method: 'POST' },
    ],
    ['functions', 'function', functionResource],
    ['slack_notifications', 'slack', { message: 'Ready', notify_to: { type: 'channel' } }],
    ['assign_owner', 'assignOwner', { assign_to: [{ id: '44' }] }],
    [
      'add_tags',
      'addTags',
      { tags: [{ id: '45', name: 'Ripe', color_code: '#00ff00' }], over_write: false },
    ],
    [
      'convert',
      'convert',
      {
        field_mappings: [{ field: predicate.field, type: 'value', value: 'Pear' }],
        create_deal: false,
      },
    ],
  ])('normalizes %s without losing raw configuration', (type, kind, resource) => {
    const a = normalizeAction({ id: '301', name: 'Harvest', type, details: resource }, resource);
    expect(a).toMatchObject({ kind, state: 'loaded', resourceRaw: resource });
  });
  it('preserves recursion, related criteria, schedules and active drafts', () => {
    const raw = detail('101', [{ type: 'tasks', id: '301' }]);
    const r = normalizeRule(raw, raw);
    expect(r).toMatchObject({ active: true, category: 'draft', detailState: 'loaded' });
    expect(r.conditions[0]).toMatchObject({
      sequenceNumber: 1,
      criteria: { kind: 'group', operator: 'AND' },
      relatedCriteria: { module: { apiName: 'Baskets' } },
      scheduledActions: [{ offset: { period: 'minutes', unit: 5 }, actions: [{ kind: 'task' }] }],
    });
    expect(normalizeRule({ ...raw, conditions: null }).conditions).toEqual([]);
  });
  it('retains expressions and unknown criteria', () => {
    expect(normalizeCriteria({ ...predicate, value: { expression: `\${NOW}` } })).toMatchObject({
      value: { expression: `\${NOW}` },
    });
    expect(normalizeCriteria({ unexpected: 'snow' })).toMatchObject({
      kind: 'unknown',
      jsonText: '{"unexpected":"snow"}',
    });
  });
  it('uses exact field metadata labels and preserves date offsets', () => {
    const labels = new Map([['71', { id: '71', apiName: 'Fruit', label: 'Harvest Fruit' }]]);
    expect(normalizeField(predicate.field, labels).label).toBe('Harvest Fruit');
    expect(
      normalizeTrigger(
        {
          type: 'date_or_datetime',
          details: { unit: 340, period: 'b_days', field: predicate.field },
        },
        labels,
      ),
    ).toMatchObject({ offset: { unit: 340, period: 'b_days' }, field: { label: 'Harvest Fruit' } });
  });
  it('falls back to mail_content and retains text boundaries', () => {
    expect(
      normalizeTemplate({ id: '602', content: '', mail_content: '<p>First</p><p>Second</p>' })
        .bodyText,
    ).toBe('First\nSecond');
  });
  it('extracts inert template text without scripts or style', () => {
    const t = normalizeTemplate({
      id: '601',
      name: 'Harvest',
      subject: 'Ready',
      content: '<p>Pears &amp; apples</p><script>bad()</script><style>bad</style>',
    });
    expect(t.bodyText).toBe('Pears & apples');
    expect(document.querySelector('script')).toBeNull();
  });
});

it('keeps hostile template markup inside an inert parser wrapper without HTML injection sinks', () => {
  const sink = vi.spyOn(Element.prototype, 'innerHTML', 'set');
  try {
    const t = normalizeTemplate({
      id: '603',
      content:
        '</TeMpLaTe ><img src="https://example.invalid/pixel" onerror="bad()"><iframe src="https://example.invalid"></iframe><p>Harvest &lt;ready&gt;</p>',
    });
    expect(t.bodyText).toContain('Harvest <ready>');
    expect(sink).not.toHaveBeenCalled();
    expect(document.querySelector('img,iframe')).toBeNull();
  } finally {
    sink.mockRestore();
  }
});
