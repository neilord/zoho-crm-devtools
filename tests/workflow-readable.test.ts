import { expect, it } from 'vitest';
import {
  normalizeAction,
  normalizeCriteria,
  normalizeRule,
} from '../src/content/workflows/normalize';
import { markRanges } from '../src/content/workflows/view-dom';
import {
  actionSummary,
  bestProvenance,
  describeProvenance,
  formatValue,
  predicateText,
} from '../src/content/workflows/view-model';
import { detail, predicate } from './fixtures/workflows';

it.each([
  ['equal', `\${EMPTY}`, false, 'Fruit is empty'],
  ['not_equal', `\${EMPTY}`, false, 'Fruit is not empty'],
  ['not_equal', `\${EMPTY}`, true, 'Fruit is modified to not empty'],
  [`\${ANYVALUE}`, `\${ANYVALUE}`, true, 'Fruit is modified to any value'],
  ['equal', `\${CLOSEDWON}`, false, 'Fruit is “Closed Won”'],
])('humanizes %s %s in native wording', (comparator, value, modified, expected) => {
  const c = normalizeCriteria({ ...predicate, comparator, value });
  if (c?.kind !== 'predicate') throw new Error();
  expect(predicateText(c, modified)).toBe(expected);
});
it('summarizes nested Slack resources, owner lists and email field recipients', () => {
  const users = [{ resource: { name: 'Synthetic User', id: '50', type: 'user' } }];
  expect(formatValue(users)).toBe('Synthetic User');
  expect(
    formatValue([
      { field: { api_name: 'Email' }, type: 'field' },
      { email: 'synthetic@example.invalid' },
    ]),
  ).toBe('Email, synthetic@example.invalid');
  expect(
    actionSummary(
      normalizeAction({
        type: 'slack_notifications',
        details: { message: 'Fruit ready', notify_to: users },
      }),
    ),
  ).toBe('Slack · Fruit ready · Synthetic User');
  expect(
    actionSummary(normalizeAction({ type: 'assign_owner', details: { assign_to: users } })),
  ).toBe('Assign owner: Synthetic User');
});
it('keeps a late email match visibly highlighted after readable summary truncation', () => {
  const raw = detail();
  const rule = normalizeRule(raw, raw);
  const action = {
    timing: 'instant' as const,
    conditionIndex: 0,
    actionIndex: 0,
    actionKind: 'emailNotification' as const,
  };
  const m = {
    location: 'emailTemplate' as const,
    action,
    snippet: `${'x'.repeat(60)}needle${'y'.repeat(100)}`,
    highlights: [{ start: 60, end: 66 }],
  };
  const view = describeProvenance(rule, m);
  const node = document.createElement('span');
  node.append(...markRanges(view.snippet, view.highlights));
  expect(node.querySelector('mark')?.textContent).toBe('needle');
  expect(view.highlights[0].start).toBeLessThanOrEqual(12);
  const code = {
    ...m,
    location: 'functionSource' as const,
    lineNumber: 1,
    action: { ...action, actionKind: 'function' as const },
  };
  expect(
    bestProvenance({ rule, matches: [code, m], score: 2 }, new Set(['emailNotification'])),
  ).toBe(m);
});

it('renders Slack HTML as inert decoded text with line breaks', () => {
  const action = normalizeAction({
    type: 'slack_notifications',
    details: {
      message:
        'Hello&nbsp;orchard<br />Next <b>step</b><script>bad()</script><img src="https://invalid.test/x">',
    },
  });
  expect(action.kind === 'slack' && action.message).toBe('Hello orchard\nNext step');
  expect(document.querySelector('img,script')).toBeNull();
});

it('unwraps email recipient details and formats merge-field paths', () => {
  expect(formatValue({ to: [{ details: `\${!Deals.Contact_Name.Email}` }] })).toBe(
    'to: Deals › Contact Name › Email',
  );
});

it('shows field update identity, field and value in readable provenance with valid highlights', () => {
  const raw = detail();
  const rule = normalizeRule(raw, raw);
  const action = normalizeAction({
    type: 'field_updates',
    name: 'Admin_Action_Empty',
    details: {
      name: 'Admin_Action_Empty',
      field: { api_name: 'Admin_Action', field_label: 'Admin Action' },
      value: 'Empty',
    },
  });
  rule.conditions[0].instantActions = [action];
  const snippet = '{"name":"Admin_Action_Empty","module":{"api_name":"Deals"}}';
  const start = snippet.indexOf('Admin_Action_Empty');
  const view = describeProvenance(rule, {
    location: 'action',
    action: {
      timing: 'instant',
      conditionIndex: 0,
      actionIndex: 0,
      actionKind: 'fieldUpdate',
    },
    snippet,
    highlights: [{ start, end: start + 'Admin_Action_Empty'.length }],
  });
  expect(view.snippet).not.toContain('{');
  expect(view.snippet).toContain('Admin Action');
  expect(view.snippet.slice(view.highlights[0].start, view.highlights[0].end)).toBe(
    'Admin_Action_Empty',
  );
});
