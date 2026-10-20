import { afterEach, describe, expect, it, vi } from 'vitest';
import { FREE } from '../src/billing/entitlement';
import type { UpgradeModalDependencies } from '../src/content/billing/upgrade-hook';
import {
  hasWorkflowSearchAccess,
  requestWorkflowSearchAccess,
  workflowSearchDevOverride,
} from '../src/content/workflows/controller';
import { getFeature, isFeatureAvailable, PREMIUM_GATE_ENABLED } from '../src/features/registry';
import { paid } from './fixtures/workflows';

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.replaceChildren();
});
describe('workflow paid gate', () => {
  it('enforces its registry gate without changing the global switch', () => {
    expect(PREMIUM_GATE_ENABLED).toBe(false);
    expect(isFeatureAvailable(getFeature('workflowSearch'), FREE)).toBe(false);
    expect(isFeatureAvailable(getFeature('workflowSearch'), paid.entitlement)).toBe(true);
  });
  it('uses any entitled paid key and fails closed offline', async () => {
    const send = vi.fn().mockResolvedValue(paid);
    expect(await hasWorkflowSearchAccess(send)).toBe(true);
    send.mockResolvedValue({ ...paid, entitlement: FREE });
    expect(await hasWorkflowSearchAccess(send)).toBe(false);
    send.mockRejectedValue(new Error());
    expect(await hasWorkflowSearchAccess(send)).toBe(false);
  });
  it('completes one pending entitlement recovery', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ signedIn: false, signedOutPending: true })
      .mockResolvedValueOnce(paid);
    expect(await hasWorkflowSearchAccess(send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('permits override only in development mode; production ignores the same override', () => {
    vi.stubEnv('VITE_WORKFLOW_SEARCH_UNLOCK', 'true');
    vi.stubEnv('MODE', 'development');
    expect(workflowSearchDevOverride()).toBe(true);
    vi.stubEnv('MODE', 'production');
    expect(workflowSearchDevOverride()).toBe(false);
  });
  it('shows neutral paid copy, resumes after upgrade, and restores focus', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const send = vi.fn().mockResolvedValue({ signedIn: false, entitlement: FREE });
    const allowed = requestWorkflowSearchAccess(button, undefined, {
      send,
    } as UpgradeModalDependencies);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('included in every paid plan'),
    );
    send.mockResolvedValue(paid);
    document.querySelector<HTMLButtonElement>('[data-zcdt-upgrade-action="sign-in"]')?.click();
    expect(await allowed).toBe(true);
    expect(document.activeElement).toBe(button);
    await Promise.resolve();
    expect(document.querySelector('[data-zcdt-upgrade-modal]')).toBeNull();
  });
  it('resolves false on dismissal or abort', async () => {
    const send = vi.fn().mockResolvedValue({ signedIn: false, entitlement: FREE });
    const invoker = document.createElement('button');
    document.body.append(invoker);
    const result = requestWorkflowSearchAccess(invoker, undefined, {
      send,
    } as UpgradeModalDependencies);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-zcdt-upgrade-action="close"]')).not.toBeNull(),
    );
    document.querySelector<HTMLButtonElement>('[data-zcdt-upgrade-action="close"]')?.click();
    expect(await result).toBe(false);
    expect(document.activeElement).toBe(invoker);
    const abort = new AbortController();
    const second = requestWorkflowSearchAccess(document.body, abort.signal, {
      send,
    } as UpgradeModalDependencies);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-zcdt-upgrade-modal]')).not.toBeNull(),
    );
    abort.abort();
    expect(await second).toBe(false);
  });
});
