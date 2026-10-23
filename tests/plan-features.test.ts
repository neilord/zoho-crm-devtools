import { describe, expect, it } from 'vitest';
import {
  type Entitlement,
  FREE,
  hasPlanFeature,
  parseEntitlement,
} from '../src/billing/entitlement';
import {
  AUTOMATION_MAP_GATE_ENFORCED,
  getFeature,
  isFeatureAvailable,
} from '../src/features/registry';

const paid: Entitlement = {
  plan: 'pro',
  entitled: true,
  status: 'active',
  currentPeriodEnd: '2027-01-01T00:00:00Z',
  cancelAtPeriodEnd: true,
  checkedAt: '2026-10-24T00:00:00Z',
};
const baseline = ['exportFunctions', 'workflowSearch'];

describe('optional entitlement capabilities', () => {
  it.each(
    [[], baseline, [...baseline, 'automationMap', 'futureFeature']].map((features) => ({
      features,
    })),
  )('preserves valid server lists verbatim: %j', ({ features }) => {
    const parsed = parseEntitlement({ ...paid, features });
    expect(parsed).toEqual({ ...paid, features });
    expect(parsed.features).not.toBe(features);
  });

  it.each(
    [undefined, null, 'automationMap', {}, [1], [''], ['  '], ['automationMap', null]].map(
      (features) => ({ features }),
    ),
  )('ignores invalid optional features without losing paid entitlement: %j', ({ features }) => {
    expect(parseEntitlement({ ...paid, features })).toEqual(paid);
  });

  it.each([
    { plan: '' },
    { entitled: 'true' },
    { status: null },
    { currentPeriodEnd: 'invalid' },
    { cancelAtPeriodEnd: 1 },
    { checkedAt: 'invalid' },
  ])('keeps every original required field validated: %j', (invalid) => {
    expect(parseEntitlement({ ...paid, ...invalid, features: ['automationMap'] })).toBe(FREE);
  });
});

describe('plan capability resolution', () => {
  it.each([
    ['free', false],
    ['plus', false],
    ['pro', true],
    ['max', true],
    ['futurePaid', false],
  ])('uses the synced contract or baseline fallback for %s', (plan, automationMap) => {
    const entitlement = { ...paid, plan };
    expect(hasPlanFeature(entitlement, 'automationMap')).toBe(automationMap);
    for (const feature of baseline) {
      expect(hasPlanFeature(entitlement, feature)).toBe(plan !== 'free');
    }
    expect(hasPlanFeature(entitlement, 'unregistered')).toBe(false);
  });

  it.each([
    'plus',
    'pro',
    'max',
    'futurePaid',
  ])('prefers the explicit server list, including an empty list, for %s', (plan) => {
    expect(hasPlanFeature({ ...paid, plan, features: [] }, 'automationMap')).toBe(false);
    expect(hasPlanFeature({ ...paid, plan, features: [] }, 'exportFunctions')).toBe(false);
    expect(hasPlanFeature({ ...paid, plan, features: ['automationMap'] }, 'automationMap')).toBe(
      true,
    );
    expect(hasPlanFeature({ ...paid, plan, features: ['futureFeature'] }, 'futureFeature')).toBe(
      true,
    );
  });

  it.each([
    'free',
    'plus',
    'pro',
    'max',
    'futurePaid',
  ])('never grants capabilities to an unentitled %s', (plan) => {
    const entitlement = { ...paid, plan, entitled: false, features: ['automationMap'] };
    for (const feature of [...baseline, 'automationMap']) {
      expect(hasPlanFeature(entitlement, feature)).toBe(false);
    }
  });

  it('does not promote free even when the server marks it entitled and lists capabilities', () => {
    expect(
      hasPlanFeature({ ...paid, plan: 'free', features: ['automationMap'] }, 'automationMap'),
    ).toBe(false);
  });

  it('keeps the Plus trial on baseline capabilities and trusts server expiry/cancellation', () => {
    const trial = { ...paid, plan: 'plus', status: 'trialing', currentPeriodEnd: null };
    expect(hasPlanFeature(trial, 'exportFunctions')).toBe(true);
    expect(hasPlanFeature(trial, 'workflowSearch')).toBe(true);
    expect(hasPlanFeature(trial, 'automationMap')).toBe(false);
  });
});

describe('Automation Map registry gate', () => {
  it('registers the wired beta as an enforced premium capability', () => {
    expect(getFeature('automationMap')).toEqual({
      id: 'automationMap',
      tier: 'premium',
      status: 'beta',
    });
    expect(AUTOMATION_MAP_GATE_ENFORCED).toBe(true);
  });

  it.each([
    'free',
    'plus',
    'pro',
    'max',
    'futurePaid',
  ])('applies tiered access for %s while preserving existing any-paid gates', (plan) => {
    const entitlement = { ...paid, plan };
    expect(isFeatureAvailable(getFeature('automationMap'), entitlement)).toBe(
      plan === 'pro' || plan === 'max',
    );
    expect(isFeatureAvailable(getFeature('automationMap'), { ...entitlement, features: [] })).toBe(
      false,
    );
    for (const id of ['exportFunctions', 'workflowSearch'] as const) {
      expect(isFeatureAvailable(getFeature(id), { ...entitlement, features: [] })).toBe(
        plan !== 'free',
      );
    }
    expect(isFeatureAvailable(getFeature('functionSearch'), entitlement)).toBe(true);
  });
});
