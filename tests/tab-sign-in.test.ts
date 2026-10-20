import { afterEach, expect, it, vi } from 'vitest';
import type { BillingClient } from '../src/billing/client';
import { OAUTH_ISSUER } from '../src/billing/config';
import { FREE } from '../src/billing/entitlement';
import { TabSignIn } from '../src/billing/tab-sign-in';
import type { authTabPlatform } from '../src/shared/browser';

const redirect =
  'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/billing/oauth-callback.html';
const success = { signedIn: true, entitlement: FREE };
function fixture() {
  const data: Record<string, unknown> = {};
  const removed: Array<(id: number) => void> = [];
  const platform = {
    session: {
      get: vi.fn(async () => structuredClone(data)),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(data, items);
      }),
    },
    current: vi.fn(async () => ({ id: 4, index: 2 })),
    create: vi.fn(async () => ({ id: 5 })),
    focus: vi.fn(async () => ({})),
    onRemoved: (fn: (id: number) => void) => removed.push(fn),
  };
  const client = {
    beginSignIn: vi.fn(async () => ({
      url: 'https://api.devtools.zsetup.com/authorize',
      redirect,
      state: 'state',
      verifier: 'verifier',
      challenge: 'challenge',
    })),
    completeSignIn: vi.fn(async () => success),
  };
  const coordinator = () =>
    new TabSignIn(
      client as unknown as BillingClient,
      platform as unknown as typeof authTabPlatform,
    );
  const callback = (state = 'state') =>
    `${redirect}?${new URLSearchParams({ code: 'code', state, iss: OAUTH_ISSUER })}`;
  return { data, platform, client, coordinator, callback, removed };
}
afterEach(() => vi.useRealTimers());
it('opens beside the opener, coalesces clicks, validates callbacks and consumes once', async () => {
  const f = fixture();
  const auth = f.coordinator();
  expect(await auth.start()).toEqual({ pending: true });
  expect(await auth.start()).toEqual({ pending: true });
  expect(f.platform.create).toHaveBeenCalledExactlyOnceWith({
    url: 'https://api.devtools.zsetup.com/authorize',
    index: 3,
    openerTabId: 4,
  });
  expect(f.platform.focus).toHaveBeenCalledWith(5);
  await expect(auth.callback(f.callback('wrong'), 5)).rejects.toThrow();
  await expect(auth.callback(f.callback(), 6)).rejects.toThrow();
  await expect(
    auth.callback(
      f.callback().replace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      5,
    ),
  ).rejects.toThrow();
  expect(f.client.completeSignIn).not.toHaveBeenCalled();
  await auth.callback(f.callback(), 5);
  expect(await auth.status()).toEqual(success);
  expect(f.platform.focus).toHaveBeenLastCalledWith(4);
  await expect(auth.callback(f.callback(), 5)).rejects.toThrow();
  expect(f.client.completeSignIn).toHaveBeenCalledOnce();
  expect(f.data.billingPendingSignIn).toBeNull();
});
it('resumes persisted PKCE and result polling after a worker restart', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.coordinator().start();
  const restarted = f.coordinator();
  expect(await restarted.status()).toEqual({ pending: true });
  await restarted.callback(f.callback(), 5);
  expect(f.client.completeSignIn).toHaveBeenCalledWith(
    f.callback(),
    expect.objectContaining({ verifier: 'verifier', state: 'state' }),
  );
  expect(await f.coordinator().status()).toEqual(success);
  vi.clearAllTimers();
});
it('resolves cancellation on tab close, ten-minute expiry and expiry after suspension', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const auth = f.coordinator();
  await auth.start();
  f.removed[0](5);
  expect(await auth.status()).toMatchObject({ cancelled: true });
  await auth.start();
  await vi.advanceTimersByTimeAsync(600_001);
  expect(await auth.status()).toMatchObject({ cancelled: true });
  await expect(auth.callback(f.callback(), 5)).rejects.toThrow();
  f.data.billingPendingSignIn = { expiresAt: Date.now() - 1, tabId: 5 };
  expect(await f.coordinator().status()).toMatchObject({ cancelled: true });
});
it('consumes provider cancellation and ambiguous failed exchanges without replay', async () => {
  const f = fixture();
  const auth = f.coordinator();
  await auth.start();
  await expect(
    auth.callback(f.callback().replace('code=code', 'error=access_denied'), 5),
  ).rejects.toThrow();
  expect(await auth.status()).toMatchObject({ cancelled: true });
  await auth.start();
  f.client.completeSignIn.mockRejectedValueOnce(new Error('offline'));
  await expect(auth.callback(f.callback(), 5)).rejects.toThrow('offline');
  await expect(auth.callback(f.callback(), 5)).rejects.toThrow();
  expect(await auth.status()).toMatchObject({ failed: true });
  expect(await auth.status()).not.toHaveProperty('cancelled');
  expect(f.client.completeSignIn).toHaveBeenCalledOnce();
});
it('abandons an interrupted tab creation and disconnect cancels pending auth', async () => {
  const f = fixture();
  f.data.billingPendingSignIn = { expiresAt: Date.now() + 600_000 };
  const auth = f.coordinator();
  await auth.start();
  expect(f.platform.create).toHaveBeenCalledOnce();
  await auth.abort();
  await expect(auth.callback(f.callback(), 5)).rejects.toThrow();
});

it('reports provider failures separately from access denial and rejects duplicate errors', async () => {
  const f = fixture();
  const auth = f.coordinator();
  await auth.start();
  const error = f.callback().replace('code=code', 'error=server_error');
  await expect(auth.callback(`${error}&error=access_denied`, 5)).rejects.toThrow();
  expect(await auth.status()).toEqual({ pending: true });
  await expect(auth.callback(error, 5)).rejects.toThrow('Sign-in failed');
  expect(await auth.status()).toMatchObject({ failed: true });
  expect(f.client.completeSignIn).not.toHaveBeenCalled();
});
