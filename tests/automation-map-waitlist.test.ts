import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contract } from '../src/billing/config';
import { FREE } from '../src/billing/entitlement';
import {
  type AutomationMapEntryDependencies,
  startAutomationMapEntryPoints,
} from '../src/content/automation-map/bootstrap';
import { requestAutomationMap } from '../src/content/automation-map/entry/request';
import { showAutomationMapWaitlist } from '../src/content/automation-map/entry/waitlist';
import { closeUpgradeModals } from '../src/content/billing/upgrade-hook';
import {
  injectWorkflowSearchButton,
  WORKFLOW_SEARCH_BUTTON_ID,
} from '../src/content/workflows/toolbar-button';
import { resolveCrmContext } from '../src/content/zoho/crm-context';

// The switch is deliberately NOT mocked: these tests run against the shipped default (on).
const billing = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../src/shared/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/browser')>()),
  billingMessage: (...args: unknown[]) => billing.send(...args),
}));

const pro = contract.plans.find((plan) => plan.key === 'pro');
const account = (plan: string, signedIn = true, extra: Record<string, unknown> = {}) => ({
  signedIn,
  entitlement: { ...FREE, plan, entitled: plan !== 'free', checkedAt: '2026-10-25T00:00:00Z' },
  ...extra,
});
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
const modal = () => document.querySelector<HTMLElement>('[data-zcdt-waitlist]');
const act = (name: string) =>
  document.querySelector<HTMLButtonElement>(`[data-zcdt-waitlist-action="${name}"]`);
const text = () => modal()?.textContent ?? '';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  billing.send.mockReset();
  billing.send.mockResolvedValue(account('free', false));
  history.replaceState({}, '', '/crm/org123/settings/index');
  document.body.innerHTML = '';
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  closeUpgradeModals();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
});

function setup(extra: Partial<AutomationMapEntryDependencies> = {}) {
  const resolveUi = vi.fn(async () => {
    throw new Error('the map runtime must not load while gated');
  });
  const createStore = vi.fn();
  const entry = startAutomationMapEntryPoints({
    context: resolveCrmContext,
    isEnabled: async () => true,
    resolveUi,
    createStore,
    ...extra,
  });
  cleanups.push(entry.dispose);
  return { entry, resolveUi, createStore };
}

describe('Automation Map Coming soon gate', () => {
  it.each([
    ['toolbar', { entry: 'toolbar' }],
    ['settings', { entry: 'settings' }],
    ['rule', { entry: 'rule', focus: { ruleId: '1', moduleApiName: 'Deals' } }],
    ['hash', { entry: 'hash', initialHash: '#zcdt-map=v1;view=list' }],
  ] as const)('shows the waitlist for the %s entry without loading the map', async (_name, options) => {
    const s = setup();
    await flush();
    requestAutomationMap(options as never);
    await flush();
    expect(modal()).not.toBeNull();
    expect(s.resolveUi).not.toHaveBeenCalled();
    expect(s.createStore).not.toHaveBeenCalled();
  });

  it('keeps one popup at a time', async () => {
    const s = setup();
    await Promise.all([
      s.entry.openAutomationMap({ entry: 'toolbar' }),
      s.entry.openAutomationMap({ entry: 'settings' }),
    ]);
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    expect(document.querySelectorAll('[data-zcdt-waitlist]')).toHaveLength(1);
  });

  it('stays closed when disabled or outside a CRM org', async () => {
    const off = setup({ isEnabled: async () => false });
    await off.entry.openAutomationMap({ entry: 'toolbar' });
    expect(modal()).toBeNull();
    const none = setup({ context: () => null });
    await none.entry.openAutomationMap({ entry: 'toolbar' });
    expect(modal()).toBeNull();
  });

  it('opens from a map link, strips the hash, and neither a reload nor the reconcile loop reopens it', async () => {
    history.replaceState({}, '', '/crm/org123/settings/workflow-rules#zcdt-map=v1');
    const s = setup();
    await flush();
    expect(modal()).not.toBeNull();
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/crm/org123/settings/workflow-rules');
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelectorAll('[data-zcdt-waitlist]')).toHaveLength(1);
    act('close')?.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(modal()).toBeNull();
    expect(s.resolveUi).not.toHaveBeenCalled();
  });

  it('strips a hash that reappears while the popup is open when it closes', async () => {
    const s = setup();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    history.replaceState({}, '', '#zcdt-map=v1;view=list');
    act('close')?.click();
    expect(location.hash).toBe('');
  });

  it('closes with the upgrade-modal handoff and when the org changes', async () => {
    const s = setup();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    closeUpgradeModals();
    expect(modal()).toBeNull();
    await s.entry.openAutomationMap({ entry: 'toolbar' });
    expect(modal()).not.toBeNull();
    history.pushState({}, '', '/crm/org456/settings/index');
    await vi.advanceTimersByTimeAsync(300);
    expect(modal()).toBeNull();
  });

  it('puts the amber Coming soon pill on the toolbar button and a dot for narrow layouts', async () => {
    history.replaceState({}, '', '/crm/org123/settings/workflow-rules');
    document.body.innerHTML = '<div><input id="search"></div>';
    injectWorkflowSearchButton(document.getElementById('search') as HTMLElement, () => {});
    const s = setup();
    await flush();
    const button = document.getElementById(WORKFLOW_SEARCH_BUTTON_ID)
      ?.nextElementSibling as HTMLButtonElement;
    expect(button.querySelector('.zcdt-soon')?.textContent).toBe('Coming soon');
    expect(button.querySelector('.zcdt-beta')).toBeNull();
    expect(button.querySelector('.zcdt-soon-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Automation Map, coming soon');
    expect(button.title).toMatch(/coming soon/i);
    button.click();
    await flush();
    expect(modal()).not.toBeNull();
    expect(s.createStore).not.toHaveBeenCalled();
  });
});

describe('Automation Map waitlist popup', () => {
  function open(deps = { send: billing.send } as never) {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    const onClose = vi.fn();
    const handle = showAutomationMapWaitlist({ deps, invoker, onClose });
    cleanups.push(handle.close);
    return { handle, invoker, onClose };
  }

  it('is an accessible dialog with an inert, hidden preview', async () => {
    open();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const label = document.getElementById(dialog.getAttribute('aria-labelledby') as string);
    expect(label?.textContent).toBe('Automation Map is coming to Pro');
    const preview = dialog.querySelector('.zw-preview');
    expect(preview?.getAttribute('aria-hidden')).toBe('true');
    expect(preview?.hasAttribute('inert')).toBe(true);
    expect(text()).not.toMatch(/sneak peek/i);
    await flush();
  });

  it('shows a loading state, then the signed-out call to action with contract prices', async () => {
    open();
    expect(text()).toContain('Checking your account');
    expect(act('join')).toBeNull();
    await flush();
    expect(text()).toContain('COMING SOON');
    expect(text()).toContain('PRO');
    expect(act('join')?.textContent).toBe('Get Pro and join the waitlist');
    expect(act('sign-in')?.textContent).toBe('Log in');
    expect(text()).toContain(
      `$${pro?.introPriceUsdFirstMonth} first month, then $${pro?.priceUsdMonthly}/month`,
    );
    expect(text()).not.toContain('Beta');
  });

  it.each([
    ['a failed check', () => Promise.resolve(account('free', false, { failed: true }))],
    ['a rejected check', () => Promise.reject(new Error('offline'))],
  ])('falls back to the signed-out call to action after %s', async (_name, reply) => {
    billing.send.mockImplementation(reply);
    open();
    await flush();
    expect(act('join')?.textContent).toBe('Get Pro and join the waitlist');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(['free', 'plus'])('offers Pro checkout to a signed-in %s account', async (plan) => {
    billing.send.mockResolvedValue(account(plan));
    open();
    await flush();
    expect(act('join')?.textContent).toBe('Get Pro and join the waitlist');
    expect(act('sign-in')).toBeNull();
    expect(text()).toContain(`$${pro?.priceUsdMonthly}/month`);
    expect(text()).not.toContain('first month');
    billing.send.mockClear();
    act('join')?.click();
    await flush();
    expect(billing.send).toHaveBeenCalledOnce();
    expect(billing.send).toHaveBeenCalledWith('billing:openCheckout', { plan: 'pro' });
    expect(act('check')).not.toBeNull();
  });

  it('signs up, then opens Pro checkout, for a signed-out visitor', async () => {
    open();
    await flush();
    billing.send.mockClear();
    billing.send.mockResolvedValue(account('free'));
    act('join')?.click();
    await flush();
    expect(billing.send.mock.calls.map((call) => call[0])).toEqual([
      'billing:signUp',
      'billing:openCheckout',
    ]);
    expect(billing.send).toHaveBeenLastCalledWith('billing:openCheckout', { plan: 'pro' });
  });

  it('does not open checkout when sign-up is cancelled', async () => {
    open();
    await flush();
    billing.send.mockClear();
    billing.send.mockResolvedValue(account('free', false, { cancelled: true }));
    act('join')?.click();
    await flush();
    expect(billing.send).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/cancelled/i);
    expect(act('join')).not.toBeNull();
  });

  it('Log in signs in without jumping to checkout', async () => {
    open();
    await flush();
    billing.send.mockClear();
    billing.send.mockResolvedValue(account('free'));
    act('sign-in')?.click();
    await flush();
    expect(billing.send).toHaveBeenCalledOnce();
    expect(billing.send).toHaveBeenCalledWith('billing:signIn');
    expect(act('join')?.textContent).toBe('Get Pro and join the waitlist');
    expect(act('sign-in')).toBeNull();
  });

  it.each(['pro', 'max'])('shows the on-the-list state for %s with no upsell', async (plan) => {
    billing.send.mockResolvedValue(account(plan));
    open();
    await flush();
    expect(text()).toContain('ON THE WAITLIST');
    expect(text()).not.toContain('COMING SOON');
    expect(document.querySelector('.zw-title')?.textContent).toBe("You're on the list");
    expect(text()).toContain("It turns on here automatically when it's ready.");
    expect(act('join')).toBeNull();
    expect(act('sign-in')).toBeNull();
    expect(act('dismiss')?.textContent).toBe('Got it');
    expect(document.querySelector('.zw-benefits')).toBeNull();
  });

  it('refreshes into the on-the-list state after checkout, never opening the map', async () => {
    billing.send.mockResolvedValue(account('free'));
    const { onClose } = open();
    await flush();
    act('join')?.click();
    await flush();
    billing.send.mockResolvedValue(account('pro'));
    act('check')?.click();
    await flush();
    expect(text()).toContain('ON THE WAITLIST');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so plainly when the plan has not updated yet', async () => {
    billing.send.mockResolvedValue(account('free'));
    open();
    await flush();
    act('join')?.click();
    await flush();
    act('check')?.click();
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/not updated yet/i);
  });

  it('closes on Esc, backdrop and the close button, and returns focus', async () => {
    const first = open();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal()).toBeNull();
    expect(document.activeElement).toBe(first.invoker);
    expect(first.onClose).toHaveBeenCalledOnce();

    open();
    modal()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(modal()).toBeNull();

    open();
    act('close')?.click();
    expect(modal()).toBeNull();
  });

  it('traps Tab inside the dialog', async () => {
    billing.send.mockResolvedValue(account('free', false));
    open();
    await flush();
    const items = [...document.querySelectorAll<HTMLElement>('[data-zcdt-waitlist] button')];
    items[items.length - 1].focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it('ignores a late account reply after closing', async () => {
    let finish!: (value: unknown) => void;
    billing.send.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { handle } = open();
    handle.close();
    finish(account('pro'));
    await flush();
    expect(modal()).toBeNull();
  });
});
