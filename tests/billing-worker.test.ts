import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { account, mountNotice } from '../src/popup/account';

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let listener: Listener;
let listeners: Listener[];
let data: Record<string, unknown>;
let sendMessage: ReturnType<typeof vi.fn>;
let access: ReturnType<typeof vi.fn>;
let session: Record<string, unknown>;
let create: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  data = {};
  session = {};
  create = vi.fn(async () => ({ id: 5 }));
  listeners = [];
  access = vi.fn(async () => {});
  sendMessage = vi.fn(async () => ({
    ok: true,
    value: { pending: true, signedIn: false, entitlement: { plan: 'free' } },
  }));
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'own',
      getURL: (path: string) => `chrome-extension://own/${path}`,
      sendMessage,
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
          listeners.push(fn);
        },
      },
    },
    storage: {
      session: {
        get: async () => structuredClone(session),
        set: async (items: Record<string, unknown>) => {
          Object.assign(session, items);
        },
      },
      local: {
        get: async () => structuredClone(data),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        },
        setAccessLevel: access,
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 4, index: 2 }]),
      onRemoved: { addListener: vi.fn() },
      create,
    },
  });
  await import('../src/background/worker');
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function call(type: string, extra: object = {}) {
  return new Promise<{ ok: boolean; value: unknown }>((resolve) => {
    expect(listener({ type, ...extra }, { id: 'own' }, resolve)).toBe(true);
  });
}
it('restricts local token storage to trusted contexts and rejects foreign senders/extra fields', () => {
  expect(access).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  const reply = vi.fn();
  expect(listener({ type: 'billing:getEntitlement' }, { id: 'other' }, reply)).toBe(false);
  expect(listener({ type: 'billing:getEntitlement' }, {}, reply)).toBe(false);
  expect(
    listener({ type: 'billing:getEntitlement', url: 'https://evil.example' }, { id: 'own' }, reply),
  ).toBe(false);
  expect(reply).not.toHaveBeenCalled();
});
it('returns a signed-out Free snapshot without credentials', async () => {
  expect(await call('billing:getEntitlement')).toMatchObject({
    ok: true,
    value: { signedIn: false, entitlement: { plan: 'free' } },
  });
});
it('preserves capabilities through the worker response and popup account helper', async () => {
  const entitlement = {
    plan: 'pro',
    entitled: true,
    status: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    checkedAt: '2026-10-24T00:00:00Z',
    features: ['automationMap'],
  };
  data.billingSession = {
    tokens: { access: 'opaque-access', refresh: 'opaque-refresh', expiresAt: Date.now() + 100000 },
    cache: { at: Date.now(), value: entitlement },
  };
  const reply = await call('billing:getEntitlement');
  expect(reply).toEqual({ ok: true, value: { signedIn: true, entitlement } });
  sendMessage.mockResolvedValue(structuredClone(reply));
  expect(await account.getEntitlement()).toEqual({ signedIn: true, entitlement });
});
it('persists notice dismissal separately from settings and sessions', async () => {
  expect(await call('billing:getNotice')).toEqual({ ok: true, value: { pending: true } });
  await call('billing:dismissNotice');
  expect(data).toEqual({ billingNotice2026: true });
  await call('billing:signOut');
  expect(await call('billing:getNotice')).toEqual({ ok: true, value: { pending: false } });
});
it('renders a notice hook and persists an explicit dismissal', async () => {
  const root = document.createElement('section');
  document.body.append(root);
  mountNotice(root);
  await vi.waitFor(() => expect(root.querySelector('[data-billing-notice]')).not.toBeNull());
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Got it');
  button?.click();
  await vi.waitFor(() => expect(root.querySelector('[data-billing-notice]')).toBeNull());
  expect(sendMessage).toHaveBeenCalledWith({ type: 'billing:dismissNotice' });
});

it('preserves function caches through a separate channel that cannot address token keys', async () => {
  const cache = listeners[0];
  const value = {
    version: 1,
    records: [{ summary: { id: '1' }, detail: { id: '1', script: 'return 1;' } }],
  };
  const send = (message: unknown) =>
    new Promise((resolve) => {
      expect(cache(message, { id: 'own' }, resolve)).toBe(true);
    });
  await send({ type: 'functions:writeCache', orgId: '42', value });
  expect(await send({ type: 'functions:readCache', orgId: '42' })).toEqual({ ok: true, value });
  expect(data).toEqual({ 'zcdt-function-cache:42': value });
  expect(
    cache({ type: 'functions:readCache', orgId: 'billingSession' }, { id: 'own' }, vi.fn()),
  ).toBe(false);
  expect(
    cache(
      { type: 'functions:readCache', orgId: '42', key: 'billingSession' },
      { id: 'own' },
      vi.fn(),
    ),
  ).toBe(false);
  expect(cache({ type: 'functions:readCache', orgId: '42' }, { id: 'foreign' }, vi.fn())).toBe(
    false,
  );
});

it('completes one pending storage recovery in the account helper', async () => {
  sendMessage
    .mockResolvedValueOnce({
      ok: true,
      value: { signedIn: false, signedOutPending: true, entitlement: { plan: 'free' } },
    })
    .mockResolvedValueOnce({ ok: true, value: { signedIn: false, entitlement: { plan: 'free' } } });
  expect(await account.getEntitlement()).toEqual({
    signedIn: false,
    entitlement: { plan: 'free' },
  });
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

it('polls short sign-in messages across worker restarts until completion or cancellation', async () => {
  vi.useFakeTimers();
  try {
    const { billingMessage } = await import('../src/shared/browser');
    sendMessage
      .mockResolvedValueOnce({ ok: true, value: { pending: true } })
      .mockResolvedValueOnce({ ok: true, value: { pending: true } })
      .mockResolvedValueOnce({
        ok: true,
        value: { signedIn: false, cancelled: true, entitlement: { plan: 'free' } },
      });
    const waiting = billingMessage('billing:signIn');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waiting).toMatchObject({ cancelled: true });
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'billing:signIn',
      'billing:signInStatus',
      'billing:signInStatus',
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it('accepts OAuth callback messages only from its own top-level callback page', () => {
  const message = {
    type: 'billing:oauthCallback',
    url: 'chrome-extension://own/src/billing/oauth-callback.html?code=untrusted',
  };
  for (const sender of [
    { id: 'other', url: 'chrome-extension://own/src/billing/oauth-callback.html' },
    { id: 'own', url: 'https://crm.zoho.com/' },
    { id: 'own', url: 'chrome-extension://own/src/popup/index.html' },
    { id: 'own', url: 'chrome-extension://own/src/billing/oauth-callback.html', frameId: 1 },
  ])
    expect(listener(message, sender, vi.fn())).toBe(false);
});

it('allows real content-script sender shapes to sign in, open plans and read only safe entitlement', async () => {
  vi.useFakeTimers();
  const { BillingClient } = await import('../src/billing/client');
  const begin = vi.spyOn(BillingClient.prototype, 'beginSignIn').mockResolvedValue({
    url: 'https://api.devtools.zsetup.com/authorize',
    redirect: 'chrome-extension://own/src/billing/oauth-callback.html',
    verifier: 'private-verifier',
    challenge: 'challenge',
    state: 'private-state',
  });
  const sender = {
    id: 'own',
    url: 'https://crm.zoho.com/crm/org123/settings/functions',
    tab: { id: 4, index: 2 } as chrome.tabs.Tab,
    frameId: 0,
  };
  const send = (type: string) =>
    new Promise((resolve) => {
      expect(listener({ type }, sender, resolve)).toBe(true);
    });
  try {
    data.billingSession = {
      tokens: {
        access: 'private-access',
        refresh: 'private-refresh',
        expiresAt: Date.now() + 100000,
      },
      cache: { at: Date.now(), value: { plan: 'pro', entitled: true } },
    };
    const snapshot = await send('billing:getEntitlement');
    expect(snapshot).toMatchObject({
      ok: true,
      value: { signedIn: true, entitlement: { plan: 'pro' } },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/private|tokens|verifier/);
    expect(await send('billing:signIn')).toEqual({ ok: true, value: { pending: true } });
    expect(create).toHaveBeenLastCalledWith({
      url: 'https://api.devtools.zsetup.com/authorize',
      openerTabId: 4,
      index: 3,
    });
    expect(await send('billing:openUpgrade')).toEqual({ ok: true, value: null });
    expect(create).toHaveBeenLastCalledWith({ url: 'https://devtools.zsetup.com/pricing' });
  } finally {
    data.billingSession = { tokens: null };
    await send('billing:signOut');
    begin.mockRestore();
    vi.useRealTimers();
  }
});

it('opens billing and checkout pages, rejecting unknown or Free plan keys', async () => {
  expect(await call('billing:openBilling')).toEqual({ ok: true, value: null });
  expect(create).toHaveBeenLastCalledWith({ url: 'https://devtools.zsetup.com/app/billing' });
  expect(await call('billing:openCheckout', { plan: 'max' })).toEqual({ ok: true, value: null });
  expect(create).toHaveBeenLastCalledWith({
    url: 'https://devtools.zsetup.com/app/billing?checkout=max',
  });
  create.mockClear();
  for (const plan of ['free', 'enterprise', 'pro&x=1', '__proto__']) {
    expect(await call('billing:openCheckout', { plan })).toMatchObject({ ok: false });
  }
  expect(create).not.toHaveBeenCalled();
});
