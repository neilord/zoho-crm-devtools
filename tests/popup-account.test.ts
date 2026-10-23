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
      plan: 'pro',
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

const cols = () => [
  ...root().querySelectorAll<HTMLButtonElement>('[data-account-action="checkout"]'),
];
const col = (plan: string) => root().querySelector<HTMLButtonElement>(`[data-plan="${plan}"]`);

describe('account card', () => {
  it('shows a skeleton while loading and never blocks', async () => {
    billingMessage.mockReturnValue(new Promise(() => {}));
    mountAccount(root());
    expect(root().querySelector('.skeleton')).not.toBeNull();
    expect(root().querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('signed out: Try Plus free, both buttons sign in, then trial pricing', async () => {
    await mount({ signedIn: false, entitlement: free });
    expect(root().textContent).toContain('Try Plus free');
    expect(root().textContent).toContain('14 days · no card required');
    expect(root().textContent).toContain('Export functions');
    expect(root().textContent).toContain('Then $9 for the first month, $23/month after.');
    expect(root().querySelectorAll('[data-account-action="sign-in"]')).toHaveLength(2);
    expect(root().textContent).toContain('Start free trial');
    expect(root().textContent).toContain('Log in');
    expect(root().textContent).not.toContain('Sign out');
    respond({ 'billing:signIn': signedIn({ ...base, status: 'trialing' }) });
    action('sign-in')?.click();
    await flush();
    expect(calls).toEqual(['billing:signIn']);
    expect((root().firstElementChild as HTMLElement).dataset.state).toBe('trial');
  });

  it('lists every paid plan from the contract as a column, never Free', async () => {
    await mount({ signedIn: false, entitlement: free });
    expect(cols().map((c) => c.dataset.plan)).toEqual(['plus', 'pro', 'max']);
    expect(cols().map((c) => c.textContent)).toEqual(['Plus$23/mo', 'Pro$57/mo', 'Max$143/mo']);
    expect(root().textContent).toContain(
      'Every paid plan includes Export functions and Search All Workflows.',
    );
    expect(cols().every((c) => !c.disabled)).toBe(true);
  });

  it('signed-out column click signs in, then opens checkout for that plan', async () => {
    await mount({ signedIn: false, entitlement: free });
    respond({ 'billing:signIn': signedIn(free), 'billing:openCheckout': null });
    col('pro')?.click();
    await flush();
    expect(calls).toEqual(['billing:signIn', 'billing:openCheckout']);
    expect(billingMessage).toHaveBeenLastCalledWith('billing:openCheckout', { plan: 'pro' });
    expect((root().firstElementChild as HTMLElement).dataset.state).toBe('free');
  });

  it('signed-out column click does not open checkout when sign-in is cancelled', async () => {
    await mount({ signedIn: false, entitlement: free });
    respond({ 'billing:signIn': { signedIn: false, entitlement: free, cancelled: true } });
    col('max')?.click();
    await flush();
    expect(calls).toEqual(['billing:signIn']);
    expect(root().textContent).toContain('Sign-in was cancelled');
  });

  it('free: tile plus plan columns that open checkout, and no other actions', async () => {
    await mount(signedIn(free));
    expect(root().textContent).toContain('Free plan');
    expect(root().textContent).toContain('Signed in');
    expect(cols()).toHaveLength(3);
    expect(action('upgrade')).toBeNull();
    expect(action('manage')).toBeNull();
    respond({ 'billing:openCheckout': null, 'billing:getEntitlement': signedIn(free) });
    col('plus')?.click();
    await flush();
    expect(calls).toEqual(['billing:openCheckout', 'billing:getEntitlement']);
    expect(billingMessage).toHaveBeenCalledWith('billing:openCheckout', { plan: 'plus' });
  });

  it('trialing: day progress, trial column stays clickable, Manage billing opens billing', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000 - 1000).toISOString();
    await mount(signedIn({ ...base, plan: 'plus', status: 'trialing', currentPeriodEnd: soon }));
    expect(root().textContent).toContain('Plus trial');
    expect(root().textContent).toContain('3 days left');
    expect(root().textContent).toContain('Day 11 of 14');
    expect(root().querySelector('[role="progressbar"]')).not.toBeNull();
    expect(col('plus')?.disabled).toBe(false);
    expect(col('plus')?.textContent).toContain('Trial');
    expect(col('pro')?.textContent).not.toContain('Trial');
    expect(action('upgrade')).toBeNull();
    respond({ 'billing:openBilling': null, 'billing:getEntitlement': signedIn(base) });
    action('manage')?.click();
    await flush();
    expect(calls[0]).toBe('billing:openBilling');
  });

  it('trial without an end date omits the progress bar', async () => {
    await mount(signedIn({ ...base, plan: 'plus', status: 'trialing', currentPeriodEnd: null }));
    expect(root().querySelector('[role="progressbar"]')).toBeNull();
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

  it('paid: current column is disabled and marked, others open checkout', async () => {
    await mount(signedIn(base));
    expect(col('pro')?.disabled).toBe(true);
    expect(col('pro')?.getAttribute('aria-current')).toBe('true');
    expect(col('pro')?.textContent).toContain('Current');
    expect(col('plus')?.disabled).toBe(false);
    expect(col('plus')?.hasAttribute('aria-current')).toBe(false);
  });

  it('pro active: badge, Active, renewal date, manage and sign out returns to signed out', async () => {
    await mount(signedIn(base));
    expect(root().querySelector('.badge')?.textContent).toBe('Pro');
    expect(root().textContent).toContain('Active');
    expect(root().textContent).toContain('Renews');
    expect(action('manage')?.className).toContain('btn-secondary');
    respond({
      'billing:signOut': null,
      'billing:getEntitlement': { signedIn: false, entitlement: free },
    });
    action('sign-out')?.click();
    await flush();
    expect(calls).toEqual(['billing:signOut', 'billing:getEntitlement']);
    expect(root().textContent).toContain('Start free trial');
  });

  it('paid without a renewal date shows no renewal line', async () => {
    await mount(signedIn({ ...base, currentPeriodEnd: null }));
    expect(root().textContent).not.toContain('Renews');
  });

  it('canceling: Ends date, resume note, primary Manage billing, current column disabled', async () => {
    await mount(signedIn({ ...base, cancelAtPeriodEnd: true }));
    expect(root().textContent).toContain('Canceling');
    expect(root().textContent).toMatch(/Ends .*2026/);
    expect(root().textContent).toContain("Won't renew. Resume anytime from Manage billing.");
    expect(action('manage')?.className).toContain('btn-primary');
    expect(col('pro')?.disabled).toBe(true);
  });

  it('past due: Update payment only, no plan columns', async () => {
    await mount(signedIn({ ...base, status: 'past_due' }));
    expect(root().textContent).toContain('Payment needs attention');
    expect(root().textContent).toContain('Editor tools are unaffected.');
    expect(root().textContent).toContain('Past due');
    expect(action('manage')?.textContent).toBe('Update payment');
    expect(action('manage')?.className).toContain('btn-primary');
    expect(cols()).toHaveLength(0);
  });

  it('never offers a Cancel or Switch plan action', async () => {
    for (const e of [
      { signedIn: false, entitlement: free },
      signedIn(free),
      signedIn({ ...base, status: 'trialing' }),
      signedIn(base),
      signedIn({ ...base, cancelAtPeriodEnd: true }),
      signedIn({ ...base, status: 'past_due' }),
    ]) {
      await mount(e);
      expect(root().textContent).not.toMatch(/\bcancel\b/i);
      expect(root().textContent).not.toContain('Switch plan');
    }
  });

  it('footer: privacy link and version', async () => {
    respond({ 'billing:getEntitlement': signedIn(base) });
    mountAccount(root(), { version: '2.4.0' });
    await flush();
    expect(root().querySelector<HTMLAnchorElement>('.foot a')?.href).toBe(PRIVACY_URL);
    expect(root().querySelector('.foot .v')?.textContent).toBe('v2.4.0');
  });

  it('error: reassures and Retry recovers', async () => {
    await mount(new Error('offline'));
    expect(root().textContent).toContain('Account unavailable');
    expect(root().textContent).toContain('Editor tools still work.');
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
    expect(host.textContent).toContain(
      'Everything you use today stays free. Signing in is optional. Plus, Pro and Max add function export and requires a current trial or paid plan.',
    );
    expect(host.textContent).toContain(
      'An account involves your email and sign-in tokens, handled by our account service. Your Zoho data is never sent to it.',
    );
    expect(host.textContent).toContain('New: optional account & paid plans');
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
