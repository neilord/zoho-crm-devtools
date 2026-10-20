import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlement } from '../src/billing/entitlement';
import { mountAccount, mountNotice, PRIVACY_URL } from '../src/popup/account';
import { deriveView } from '../src/popup/account/model';

const billingMessage = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/browser', () => ({ billingMessage }));

const NOW = Date.parse('2026-11-01T12:00:00Z');
const base: Entitlement = {
  plan: 'pro',
  entitled: true,
  status: 'active',
  currentPeriodEnd: '2026-12-15T12:00:00Z',
  cancelAtPeriodEnd: false,
  checkedAt: '2026-11-01T12:00:00Z',
};
const free: Entitlement = {
  plan: 'free',
  entitled: false,
  status: 'free',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  checkedAt: '2026-11-01T12:00:00Z',
};
const signedIn = (e: Entitlement) => ({ signedIn: true, entitlement: e });

let calls: string[];
function respond(map: Record<string, unknown>) {
  calls = [];
  billingMessage.mockImplementation(async (type: string) => {
    calls.push(type);
    const v = map[type];
    if (v instanceof Error) throw v;
    return v ?? null;
  });
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const root = () => document.querySelector<HTMLElement>('[data-account]') as HTMLElement;
const action = (name: string) =>
  root().querySelector<HTMLButtonElement>(`[data-account-action="${name}"]`);

async function mount(entitlement: unknown) {
  respond({ 'billing:getEntitlement': entitlement });
  mountAccount(root());
  await flush();
}

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '<div data-notice></div><div data-account></div>';
  billingMessage.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('deriveView', () => {
  it('maps entitlement DTOs to account states', () => {
    expect(deriveView({ signedIn: false, entitlement: free }).kind).toBe('signed-out');
    expect(deriveView({ ...signedIn(base), signedOutPending: true }).kind).toBe('signed-out');
    expect(deriveView(signedIn(free)).kind).toBe('free');
    expect(deriveView(signedIn({ ...free, checkedAt: '' })).kind).toBe('error');
    expect(deriveView(signedIn({ ...free, status: 'active' })).kind).toBe('past-due');
    expect(deriveView(signedIn({ ...base, status: 'trialing' }), NOW)).toEqual({
      kind: 'trial',
      planName: 'Pro',
      daysLeft: 44,
    });
    expect(deriveView(signedIn(base), NOW).kind).toBe('paid');
    expect(deriveView(signedIn({ ...base, cancelAtPeriodEnd: true }), NOW).kind).toBe(
      'paid-canceling',
    );
    expect(deriveView(signedIn({ ...base, status: 'past_due' })).kind).toBe('past-due');
    expect(deriveView(signedIn({ ...free, status: 'past_due' })).kind).toBe('past-due');
  });
});

describe('account card', () => {
  it('shows a skeleton while loading and never blocks', async () => {
    billingMessage.mockReturnValue(new Promise(() => {}));
    mountAccount(root());
    expect(root().querySelector('.skeleton')).not.toBeNull();
    expect(root().querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('signed out: Free plan, Pro pitch, and both buttons sign in', async () => {
    await mount({ signedIn: false, entitlement: free });
    expect(root().textContent).toContain('Free plan');
    expect(root().textContent).toContain('Export all functions'.toLowerCase().replace('e', 'e'));
    expect(root().textContent).toContain('14-day free trial, no card');
    expect(root().querySelectorAll('[data-account-action="sign-in"]')).toHaveLength(2);
    expect(root().textContent).toContain('Start free trial');
    respond({ 'billing:signIn': signedIn({ ...base, status: 'trialing' }) });
    action('sign-in')?.click();
    await flush();
    expect(calls).toEqual(['billing:signIn']);
    expect((root().firstElementChild as HTMLElement).dataset.state).toBe('trial');
  });

  it('trialing: days left, Upgrade, Manage account, Sign out', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000 - 1000).toISOString();
    await mount(signedIn({ ...base, plan: 'plus', status: 'trialing', currentPeriodEnd: soon }));
    expect(root().textContent).toContain('Plus trial · 3 days left');
    expect(root().textContent).toContain('3 days left');
    respond({ 'billing:openUpgrade': null, 'billing:getEntitlement': signedIn(base) });
    action('upgrade')?.click();
    await flush();
    expect(calls).toEqual(['billing:openUpgrade', 'billing:getEntitlement']);
    respond({ 'billing:openAccount': null, 'billing:getEntitlement': signedIn(base) });
    action('manage')?.click();
    await flush();
    expect(calls[0]).toBe('billing:openAccount');
  });

  it.each([
    ['plus', 'Plus'],
    ['pro', 'Pro'],
    ['max', 'Max'],
    ['future', 'Future'],
  ])('shows actual plan %s', async (plan, name) => {
    await mount(signedIn({ ...base, plan }));
    expect(root().querySelector('.badge')?.textContent).toBe(name);
    expect(action('upgrade')).toBeNull();
  });

  it('pro active: badge, renewal date, manage and sign out returns to signed out', async () => {
    await mount(signedIn(base));
    expect(root().querySelector('.badge')?.textContent).toBe('Pro');
    expect(root().textContent).toContain('Renews');
    expect(action('upgrade')).toBeNull();
    respond({
      'billing:signOut': null,
      'billing:getEntitlement': { signedIn: false, entitlement: free },
    });
    action('sign-out')?.click();
    await flush();
    expect(calls).toEqual(['billing:signOut', 'billing:getEntitlement']);
    expect(root().textContent).toContain('Start free trial');
  });

  it('canceled but active: Pro until date, resume via Manage account', async () => {
    await mount(signedIn({ ...base, cancelAtPeriodEnd: true }));
    expect(root().textContent).toMatch(/Pro until .*2026/);
    expect(action('manage')?.className).toContain('btn-primary');
  });

  it('past due and free-after-trial prompt gently towards plans', async () => {
    await mount(signedIn({ ...base, status: 'past_due' }));
    expect(root().textContent).toContain('Payment needs attention');
    expect(action('upgrade')).toBeNull();
    expect(action('manage')?.textContent).toBe('Update payment');
    await mount(signedIn(free));
    expect(root().textContent).toContain('Free plan');
    expect(action('upgrade')?.textContent).toBe('Upgrade');
  });

  it('error: reassures and Retry recovers', async () => {
    await mount(new Error('offline'));
    expect(root().textContent).toContain('Your free editor and search tools keep working.');
    respond({ 'billing:getEntitlement': signedIn(base) });
    action('retry')?.click();
    await flush();
    expect(root().textContent).toContain('Renews');
  });

  it('a failed sign-in keeps the card and explains gently', async () => {
    await mount({ signedIn: false, entitlement: free });
    respond({ 'billing:signIn': new Error('Sign-in canceled') });
    action('sign-in')?.click();
    await flush();
    expect(root().textContent).toContain('Sign-in was cancelled');
    expect(action('sign-in')?.disabled).toBe(false);
  });
});

describe('existing-user notice', () => {
  it('stays hidden when not pending', async () => {
    respond({ 'billing:getNotice': { pending: false } });
    const host = document.querySelector<HTMLElement>('[data-notice]') as HTMLElement;
    mountNotice(host);
    await flush();
    expect(host.children).toHaveLength(0);
  });

  it('shows disclosure with privacy link and dismisses once persisted', async () => {
    respond({ 'billing:getNotice': { pending: true }, 'billing:dismissNotice': null });
    const host = document.querySelector<HTMLElement>('[data-notice]') as HTMLElement;
    mountNotice(host);
    await flush();
    expect(host.textContent).toContain('stays free');
    expect(host.textContent).toContain('never sent');
    expect(host.querySelector<HTMLAnchorElement>('a')?.href).toBe(PRIVACY_URL);
    host.querySelector<HTMLButtonElement>('[data-notice-dismiss]')?.click();
    await flush();
    expect(calls).toContain('billing:dismissNotice');
    expect(host.children).toHaveLength(0);
  });

  it('keeps the notice if dismissal fails to persist', async () => {
    respond({ 'billing:getNotice': { pending: true }, 'billing:dismissNotice': new Error('x') });
    const host = document.querySelector<HTMLElement>('[data-notice]') as HTMLElement;
    mountNotice(host);
    await flush();
    host.querySelector<HTMLButtonElement>('[data-notice-dismiss]')?.click();
    await flush();
    expect(host.querySelector('[data-billing-notice]')).not.toBeNull();
  });
});

it.each([
  [{ cancelled: true }, 'Sign-in was cancelled'],
  [{ failed: true }, 'Sign-in failed'],
])('explains a returned sign-in outcome %j', async (outcome, message) => {
  await mount({ signedIn: false, entitlement: free });
  respond({ 'billing:signIn': { signedIn: false, entitlement: free, ...outcome } });
  action('sign-in')?.click();
  await flush();
  expect(root().textContent).toContain(message);
  expect(action('sign-in')?.disabled).toBe(false);
});
