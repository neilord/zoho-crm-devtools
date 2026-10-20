// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingClient, type BillingPlatform } from '../src/billing/client';
import { API_BASE, contract, OAUTH_ISSUER } from '../src/billing/config';
import { FREE, parseEntitlement } from '../src/billing/entitlement';
import { authorizationCode, createPkce } from '../src/billing/oauth';
import { isBillingMessage } from '../src/billing/protocol';
import { getFeature, isFeatureAvailable } from '../src/features/registry';
import type { StorageArea } from '../src/shared/browser';

const pro = {
  plan: 'pro' as const,
  entitled: true,
  status: 'active',
  currentPeriodEnd: '2027-01-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  checkedAt: '2026-10-20T00:00:00Z',
};
const tokens = { access: 'opaque-access', refresh: 'opaque-refresh', expiresAt: 2_000_000 };
const tokenReply = {
  token_type: 'Bearer',
  access_token: 'next-access',
  refresh_token: 'next-refresh',
  expires_in: 900,
  scope: contract.extensionAuth.scopes.join(' '),
};
function fixture(initial: unknown = { tokens }) {
  const data: Record<string, unknown> = { billingSession: initial };
  const storage: StorageArea = {
    get: async <T extends Record<string, unknown>>() => structuredClone(data) as T,
    set: vi.fn(async (items) => {
      Object.assign(data, structuredClone(items));
    }),
  };
  const platform: BillingPlatform = {
    storage,
    redirectURL: () =>
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/billing/oauth-callback.html',
  };
  const request = vi.fn<typeof fetch>();
  const client = new BillingClient(platform, request, () => 1_000_000);
  return { data, storage, platform, request, client };
}
afterEach(() => {
  vi.useRealTimers();
});

describe('OAuth boundary', () => {
  it('generates independent S256 PKCE and unpredictable state', async () => {
    const first = await createPkce();
    const second = await createPkce();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first.state).toHaveLength(43);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.verifier).not.toBe(first.verifier);
    expect(second.state).not.toBe(first.state);
  });
  it('matches a known S256 vector for a deterministic verifier', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((value) => {
      (value as Uint8Array).fill(0);
      return value;
    });
    const pkce = await createPkce();
    spy.mockRestore();
    expect(pkce.verifier).toBe('A'.repeat(43));
    expect(pkce.challenge).toBe('DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo');
  });
  const redirect =
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/billing/oauth-callback.html';
  const valid = `${redirect}?code=single-use&state=random&iss=${encodeURIComponent(OAUTH_ISSUER)}`;
  it('accepts only the exact redirect, state and issuer', () => {
    expect(authorizationCode(valid, redirect, 'random', OAUTH_ISSUER)).toBe('single-use');
  });
  it.each([
    valid.replace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    valid.replace('oauth-callback.html?', 'other.html?'),
    valid.replace('state=random', 'state=wrong'),
    valid.replace('iss=', 'iss=wrong'),
    `${valid}&error=access_denied`,
    `${valid}#fragment`,
    `${valid}&code=duplicate`,
    `${valid}&state=random`,
    valid.replace('code=single-use', 'code='),
    valid.replace('&iss=', '&other='),
  ])('rejects invalid OAuth callback %s', (result) => {
    expect(() => authorizationCode(result, redirect, 'random', OAUTH_ISSUER)).toThrow();
  });
  it('uses the exact authorize and form token contract without exposing tokens', async () => {
    const f = fixture({ tokens: null });
    const pending = await f.client.beginSignIn();
    const u = new URL(pending.url);
    expect(u.origin + u.pathname).toBe(`${API_BASE}${contract.extensionAuth.authorizePath}`);
    expect(u.searchParams.get('scope')).toBe('entitlement:read offline_access');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.has('prompt')).toBe(false);
    const callback = `${pending.redirect}?code=single-use&state=${pending.state}&iss=${encodeURIComponent(OAUTH_ISSUER)}`;
    f.request
      .mockResolvedValueOnce(Response.json(tokenReply))
      .mockResolvedValueOnce(Response.json(pro));
    expect(await f.client.completeSignIn(callback, pending)).toEqual({
      signedIn: true,
      entitlement: pro,
    });
    const init = f.request.mock.calls[0][1];
    const form = init?.body as URLSearchParams;
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('single-use');
    expect(form.get('redirect_uri')).toBe(f.platform.redirectURL());
    expect(form.get('code_verifier')).toHaveLength(43);
    expect(form.has('client_secret')).toBe(false);
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    expect(new Request(API_BASE, init).headers.get('Content-Type')).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
    expect(JSON.stringify(await f.client.getEntitlement())).not.toContain('next-access');
  });
});

describe('worker session lifecycle', () => {
  it.each([
    undefined,
    'offline_access',
    'entitlement:read',
  ])('rejects incomplete token scope %s', async (scope) => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    f.request.mockResolvedValue(Response.json({ ...tokenReply, scope }));
    expect((await f.client.getEntitlement()).signedOutPending).toBe(true);
    expect((await f.client.getEntitlement()).signedIn).toBe(false);
    expect(f.request).toHaveBeenCalledOnce();
  });
  it('expires the cache exactly at five minutes and rejects clock rollback', async () => {
    for (const at of [700_000, 1_000_001]) {
      const f = fixture({ tokens, cache: { value: pro, at } });
      f.request.mockRejectedValue(new TypeError('offline'));
      expect((await f.client.getEntitlement()).entitlement).toEqual(FREE);
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.request.mock.calls[0][1]?.redirect).toBe('error');
    }
  });
  it('coalesces concurrent rotation, marks before sending, and persists the replacement atomically', async () => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    f.request
      .mockImplementationOnce(async (_url, init) => {
        expect(f.data.billingSession).toEqual({
          tokens: { ...tokens, expiresAt: 0 },
          refreshing: true,
        });
        expect((init?.body as URLSearchParams).get('refresh_token')).toBe('opaque-refresh');
        return Response.json(tokenReply);
      })
      .mockResolvedValueOnce(Response.json(pro));
    const results = await Promise.all(Array.from({ length: 10 }, () => f.client.getEntitlement()));
    expect(results.every((r) => r.entitlement.plan === 'pro')).toBe(true);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.data.billingSession).toMatchObject({
      tokens: { access: 'next-access', refresh: 'next-refresh' },
    });
    expect(await f.client.getEntitlement()).toEqual(results[0]);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('never replays an in-progress refresh after worker restart', async () => {
    const f = fixture({ tokens, refreshing: true, cache: { value: pro, at: 1_000_000 } });
    expect(await f.client.getEntitlement()).toEqual({ signedIn: false, entitlement: FREE });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.data.billingSession).toEqual({ tokens: null });
  });
  it('retains a successfully persisted replacement across worker restart', async () => {
    const f = fixture();
    f.request.mockResolvedValue(Response.json(pro));
    const restarted = new BillingClient(f.platform, f.request, () => 1_000_000);
    expect((await restarted.getEntitlement()).entitlement).toEqual(pro);
    expect(f.request.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer opaque-access' });
  });
  it('clears tokens immediately on invalid_grant and never replays', async () => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    f.request.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect(await f.client.getEntitlement()).toEqual({ signedIn: false, entitlement: FREE });
    await f.client.getEntitlement();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.data.billingSession).toEqual({ tokens: null });
  });
  it('returns signed-out-pending on ambiguous rotation then rechecks storage once, without replay', async () => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    f.request.mockRejectedValue(new TypeError('response lost after server rotation'));
    expect(await f.client.getEntitlement()).toEqual({
      signedIn: false,
      signedOutPending: true,
      entitlement: FREE,
    });
    expect(f.data.billingSession).toMatchObject({ refreshing: true });
    expect(await f.client.getEntitlement()).toEqual({ signedIn: false, entitlement: FREE });
    await f.client.getEntitlement();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.data.billingSession).toEqual({ tokens: null });
  });
  it('recovers a replacement pair that committed despite storage reporting failure', async () => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    const set = f.storage.set;
    f.storage.set = vi.fn(async (items) => {
      await set(items);
      if (
        (items.billingSession as { tokens?: { refresh: string } }).tokens?.refresh ===
        'next-refresh'
      ) {
        f.storage.set = set;
        throw new Error('write acknowledgement lost');
      }
    });
    f.request
      .mockResolvedValueOnce(Response.json(tokenReply))
      .mockResolvedValueOnce(Response.json(pro));
    expect((await f.client.getEntitlement()).signedOutPending).toBe(true);
    expect(await f.client.getEntitlement()).toEqual({ signedIn: true, entitlement: pro });
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer next-access' });
  });
  it('does not resolve refresh waiters until the replacement is durable', async () => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    let commit: () => void = () => {};
    let writing = false;
    const stored = f.storage.set;
    f.storage.set = async (items) => {
      if (
        (items.billingSession as { tokens?: { refresh: string } }).tokens?.refresh ===
          'next-refresh' &&
        !writing
      ) {
        writing = true;
        await new Promise<void>((resolve) => {
          commit = resolve;
        });
      }
      await stored(items);
    };
    f.request
      .mockResolvedValueOnce(Response.json(tokenReply))
      .mockResolvedValueOnce(Response.json(pro));
    let settled = false;
    const pending = f.client.getEntitlement().then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(writing).toBe(true));
    expect(settled).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
    commit();
    expect((await pending).entitlement).toEqual(pro);
  });
  it('uses a fresh OAuth state and verifier for each attempt', async () => {
    const f = fixture({ tokens: null });
    const first = await f.client.beginSignIn();
    const second = await f.client.beginSignIn();
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
    expect(f.request).not.toHaveBeenCalled();
  });
  it('resolves signed-out reads locally', async () => {
    const f = fixture({ tokens: null });
    expect((await f.client.getEntitlement()).entitlement).toEqual(FREE);
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('falls back to Free on HTTP %s', async (status) => {
    const f = fixture();
    f.request.mockResolvedValue(new Response(null, { status }));
    expect((await f.client.getEntitlement()).entitlement).toEqual(FREE);
  });
  it('does not serve an expired cache when offline', async () => {
    const f = fixture({ tokens, cache: { value: pro, at: 0 } });
    f.request.mockRejectedValue(new TypeError('offline'));
    expect((await f.client.getEntitlement()).entitlement).toEqual(FREE);
  });
  it('bounds network waits to five seconds', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementationOnce((ms) => {
      expect(ms).toBe(5000);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const f = fixture();
    f.request.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
        }),
    );
    const result = f.client.getEntitlement();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).entitlement).toEqual(FREE);
    vi.restoreAllMocks();
  });
  it.each([true, false])('revokes refresh and clears even on failure (%s)', async (fail) => {
    const f = fixture();
    f.request.mockImplementation(async (url, init) => {
      expect(f.data.billingSession).toEqual({ tokens: null });
      expect(url).toBe(`${API_BASE}${contract.extensionAuth.revokePath}`);
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      expect((init?.body as URLSearchParams).get('token')).toBe(tokens.refresh);
      expect((init?.body as URLSearchParams).get('token_type_hint')).toBe('refresh_token');
      if (fail) throw new Error('offline');
      return new Response(null, { status: 200 });
    });
    await f.client.signOut();
    expect(f.data.billingSession).toEqual({ tokens: null });
    expect((await f.client.getEntitlement()).signedIn).toBe(false);
  });
  it('serializes disconnect behind rotation so credentials cannot be resurrected', async () => {
    const f = fixture({ tokens: { ...tokens, expiresAt: 0 } });
    f.request
      .mockResolvedValueOnce(Response.json(tokenReply))
      .mockResolvedValueOnce(Response.json(pro))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await Promise.all([f.client.getEntitlement(), f.client.signOut()]);
    expect(f.data.billingSession).toEqual({ tokens: null });
    expect((f.request.mock.calls[2][1]?.body as URLSearchParams).get('token')).toBe('next-refresh');
  });
});

describe('licence resolution and Stage 1', () => {
  it.each<[string, import('../src/billing/entitlement').Entitlement, boolean]>([
    ['free', FREE, false],
    ['pro', pro, true],
    ...['plus', 'max', 'future'].map<
      [string, import('../src/billing/entitlement').Entitlement, boolean]
    >((plan) => [plan, parseEntitlement({ ...pro, plan }), true]),
    ['free-entitled', { ...pro, plan: 'free' }, false],
    ...['plus', 'pro', 'max', 'future'].map<
      [string, import('../src/billing/entitlement').Entitlement, boolean]
    >((plan) => [plan, { ...pro, plan, entitled: false }, false]),
    ['trialing', { ...pro, status: 'trialing' }, true],
    ['past_due', { ...pro, plan: 'free' as const, entitled: false, status: 'past_due' }, false],
    ['canceled-but-active', { ...pro, cancelAtPeriodEnd: true }, true],
    ['unknown', parseEntitlement({ plan: 'future' }), false],
  ])('resolves %s from server entitlement with the gate on, keeps Stage 1 unlocked', (_label, entitlement, expected) => {
    expect(isFeatureAvailable(getFeature('githubSync'), entitlement, true)).toBe(expected);
    expect(isFeatureAvailable(getFeature('githubSync'), entitlement)).toBe(true);
    expect(isFeatureAvailable(getFeature('functionSearch'), entitlement, true)).toBe(true);
  });
  it('rejects old billing-status envelopes and malformed fields', () => {
    expect(parseEntitlement({ subscription: pro })).toEqual(FREE);
    expect(parseEntitlement({ ...pro, entitled: 'yes' })).toEqual(FREE);
    for (const plan of ['', '   ', 23, null])
      expect(parseEntitlement({ ...pro, plan })).toEqual(FREE);
  });
  it('accepts only the narrow message envelope', () => {
    expect(isBillingMessage({ type: 'billing:getEntitlement' })).toBe(true);
    expect(isBillingMessage({ type: 'billing:getEntitlement', url: 'https://evil.example' })).toBe(
      false,
    );
    expect(isBillingMessage({ type: 'fetch' })).toBe(false);
  });
});

it('binds the default fetch to the global receiver required by native Chrome workers', async () => {
  const f = fixture({ tokens: null });
  const native = vi.fn(function (this: unknown) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(Response.json(tokenReply));
  });
  vi.stubGlobal('fetch', native);
  try {
    const client = new BillingClient(f.platform);
    const pending = await client.beginSignIn();
    await client.completeSignIn(
      `${pending.redirect}?code=code&state=${pending.state}&iss=${encodeURIComponent(OAUTH_ISSUER)}`,
      pending,
    );
    expect(native).toHaveBeenCalled();
    expect(f.data.billingSession).toMatchObject({ tokens: { access: 'next-access' } });
  } finally {
    vi.unstubAllGlobals();
  }
});
