import { afterEach, describe, expect, it, vi } from 'vitest';
import { contract } from '../src/billing/config';
import { FREE } from '../src/billing/entitlement';
import {
  automationMapUpgradeCopy,
  mountUpgradeHook,
  UPGRADE_REQUIRED_EVENT,
} from '../src/content/billing/upgrade-hook';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  document.head.replaceChildren();
});
const account = (plan: string, signedIn = true) => ({
  signedIn,
  entitlement: { ...FREE, plan, entitled: plan !== 'free', checkedAt: '2026-10-24T00:00:00Z' },
});
const action = (name: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-zcdt-upgrade-action="${name}"]`,
  ) as HTMLButtonElement;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(initial = account('free', false)) {
  const send = vi.fn().mockResolvedValue(initial);
  const onEntitled = vi.fn();
  const dispose = mountUpgradeHook(
    document.createElement('div'),
    { send },
    { ...automationMapUpgradeCopy, onEntitled },
  );
  cleanups.push(dispose);
  document.dispatchEvent(
    new CustomEvent(UPGRADE_REQUIRED_EVENT, {
      detail: { featureId: 'automationMap', reason: 'paid-required' },
    }),
  );
  return { send, onEntitled, dispose };
}
describe('Automation Map Pro upgrade', () => {
  it('offers Log in while signed out, with Pro pricing and no Plus trial offer', async () => {
    const s = setup();
    await flush();
    const pro = contract.plans.find((p) => p.key === 'pro');
    expect(dialog().textContent).toContain('Automation Map is a Pro feature');
    expect(action('sign-in').textContent).toContain('Log in');
    expect(dialog().textContent).toContain(
      `$${pro?.introPriceUsdFirstMonth} for the first month, $${pro?.priceUsdMonthly}/month after`,
    );
    expect(dialog().textContent).not.toMatch(/trial|no card required/i);
    s.send.mockResolvedValue(account('plus'));
    action('sign-in').click();
    await flush();
    expect(s.send).toHaveBeenCalledWith('billing:signIn');
    expect(s.onEntitled).not.toHaveBeenCalled();
    expect(action('plans').textContent).toBe('Upgrade to Pro');
  });
  it.each([
    'free',
    'plus',
  ])('sends Pro checkout for %s and resumes only after Pro recheck', async (plan) => {
    const s = setup(account(plan));
    await flush();
    expect(action('plans').textContent).toBe('Upgrade to Pro');
    expect(dialog().textContent).not.toMatch(/trial/i);
    action('plans').click();
    await flush();
    expect(s.send).toHaveBeenCalledWith('billing:openCheckout', { plan: 'pro' });
    action('check').click();
    await flush();
    expect(s.onEntitled).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain('five minutes');
    s.send.mockResolvedValue(account('pro'));
    action('check').click();
    await flush();
    expect(s.onEntitled).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLElement>('[data-zcdt-upgrade-modal]')?.hidden).toBe(true);
  });
  it.each(['pro', 'max'])('accepts an existing %s capability without checkout', async (plan) => {
    const s = setup(account(plan));
    await flush();
    expect(s.onEntitled).toHaveBeenCalledOnce();
    expect(s.send).toHaveBeenCalledExactlyOnceWith('billing:getEntitlement');
  });
  it('does not resume a dismissed map when delayed sign-in completes', async () => {
    const s = setup();
    await flush();
    let finish!: (value: ReturnType<typeof account>) => void;
    s.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    action('sign-in').click();
    s.dispose();
    finish(account('pro'));
    await flush();
    expect(s.onEntitled).not.toHaveBeenCalled();
  });
});
