import type { StorageArea } from '../shared/browser';
import { API_BASE, contract, OAUTH_ISSUER } from './config';
import { type Entitlement, FREE, parseEntitlement } from './entitlement';
import { authorizationCode, createPkce } from './oauth';

interface Tokens {
  access: string;
  refresh: string;
  expiresAt: number;
}
interface Session {
  tokens: Tokens | null;
  refreshing?: boolean;
  cache?: { value: Entitlement; at: number };
}
export interface AccountState {
  signedIn: boolean;
  cancelled?: true;
  failed?: true;
  entitlement: Entitlement;
  /** A rotation may have reached the server; next read checks storage once, never replays. */
  signedOutPending?: true;
}
export interface BillingPlatform {
  storage: StorageArea;
  redirectURL(): string;
}
class TokenExchangeError extends Error {
  constructor(readonly invalidGrant: boolean) {
    super('Token exchange failed');
  }
}

const KEY = 'billingSession';
const CACHE_MS = 5 * 60_000;

export class BillingClient {
  private queue: Promise<unknown> = Promise.resolve();
  private flight?: Promise<AccountState>;
  private uncertainRefresh?: string;
  constructor(
    private platform: BillingPlatform,
    // Native worker fetch requires its global receiver; instance-method calls throw in Chrome.
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
    private now = Date.now,
  ) {}

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async read(): Promise<Session> {
    const data = await this.platform.storage.get<{ billingSession?: Session }>([KEY]);
    return data.billingSession ?? { tokens: null };
  }
  private write(session: Session) {
    return this.platform.storage.set({ [KEY]: session });
  }
  private async http(path: string, init: RequestInit = {}): Promise<Response> {
    // The signal also bounds response-body reads.
    return this.request(`${API_BASE}${path}`, {
      ...init,
      credentials: 'omit',
      // A 307/308 could forward the token form body to another origin.
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  }
  private async token(fields: Record<string, string>): Promise<Tokens> {
    const response = await this.http(contract.extensionAuth.tokenPath, {
      method: 'POST',
      body: new URLSearchParams({ client_id: contract.extensionAuth.clientId, ...fields }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new TokenExchangeError(response.status === 400 && body?.error === 'invalid_grant');
    }
    const t = await response.json();
    if (
      t.token_type?.toLowerCase() !== 'bearer' ||
      typeof t.access_token !== 'string' ||
      !t.access_token ||
      typeof t.refresh_token !== 'string' ||
      !t.refresh_token ||
      typeof t.expires_in !== 'number' ||
      !Number.isFinite(t.expires_in) ||
      t.expires_in <= 0 ||
      typeof t.scope !== 'string' ||
      !contract.extensionAuth.scopes.every((scope) => t.scope.split(' ').includes(scope))
    )
      throw new Error('Invalid token response');
    return {
      access: t.access_token,
      refresh: t.refresh_token,
      expiresAt: this.now() + t.expires_in * 1000,
    };
  }
  async beginSignIn({ signUp = false }: { signUp?: boolean } = {}) {
    const pkce = await createPkce();
    const redirect = this.platform.redirectURL();
    const url = new URL(`${API_BASE}${contract.extensionAuth.authorizePath}`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: contract.extensionAuth.clientId,
      redirect_uri: redirect,
      scope: contract.extensionAuth.scopes.join(' '),
      state: pkce.state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      // Only picks the account site's sign-up page over login; the OAuth flow is otherwise identical.
      ...(signUp ? { screen_hint: 'signup' } : {}),
    }).toString();
    return { url: url.href, redirect, ...pkce };
  }
  completeSignIn(
    result: string,
    pending: { redirect: string; state: string; verifier: string },
  ): Promise<AccountState> {
    return this.serial(async () => {
      const code = authorizationCode(result, pending.redirect, pending.state, OAUTH_ISSUER);
      const tokens = await this.token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirect,
        code_verifier: pending.verifier,
      });
      await this.write({ tokens });
      this.uncertainRefresh = undefined;
      return this.resolve();
    });
  }
  getEntitlement(): Promise<AccountState> {
    if (!this.flight) {
      this.flight = this.serial(() => this.resolve()).finally(() => {
        this.flight = undefined;
      });
    }
    return this.flight;
  }
  private async resolve(): Promise<AccountState> {
    if (this.uncertainRefresh) {
      const used = this.uncertainRefresh;
      this.uncertainRefresh = undefined;
      return this.recoverStored(used);
    }
    let session = await this.read();
    if (session.refreshing) return this.recoverStored(session.tokens?.refresh);
    if (!session.tokens) return { signedIn: false, entitlement: FREE };
    if (session.tokens.expiresAt <= this.now() + 30_000) {
      const used = session.tokens.refresh;
      try {
        await this.write({ tokens: session.tokens, refreshing: true });
        const tokens = await this.token({ grant_type: 'refresh_token', refresh_token: used });
        session = { tokens };
        // Persist the rotated pair BEFORE resolving any callers or reading entitlement.
        await this.write(session);
      } catch (error) {
        if (error instanceof TokenExchangeError && error.invalidGrant) {
          await this.write({ tokens: null });
          return { signedIn: false, entitlement: FREE };
        }
        // Reuse revokes every authorization for this user+client, across devices. Never retry.
        // Leave the durable journal intact; a storage write may have committed despite rejection.
        this.uncertainRefresh = used;
        return { signedIn: false, signedOutPending: true, entitlement: FREE };
      }
    }
    return this.readEntitlement(session);
  }
  private async recoverStored(used: string | undefined): Promise<AccountState> {
    // One storage re-check only, also used when restarting with an interrupted journal.
    const stored = await this.read();
    if (stored.tokens && !stored.refreshing && stored.tokens.refresh !== used) {
      // Verify the saved replacement access token once, without another rotation or cached grant.
      const result = await this.readEntitlement({ tokens: stored.tokens });
      if (result.signedIn && result.entitlement.checkedAt) return result;
    }
    await this.write({ tokens: null });
    return { signedIn: false, entitlement: FREE };
  }
  private async readEntitlement(session: Session): Promise<AccountState> {
    try {
      if (
        session.cache &&
        this.now() >= session.cache.at &&
        this.now() - session.cache.at < CACHE_MS
      ) {
        return { signedIn: true, entitlement: session.cache.value };
      }
      const response = await this.http('/v1/entitlement', {
        headers: { Authorization: `Bearer ${session.tokens?.access}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          await this.write({ tokens: null });
          return { signedIn: false, entitlement: FREE };
        }
        throw new Error('Entitlement unavailable');
      }
      const entitlement = parseEntitlement(await response.json());
      await this.write({ ...session, cache: { value: entitlement, at: this.now() } });
      return { signedIn: true, entitlement };
    } catch {
      return { signedIn: true, entitlement: FREE };
    }
  }
  signOut(): Promise<void> {
    return this.serial(async () => {
      const session = await this.read();
      this.uncertainRefresh = undefined;
      // Clear first so even a worker interruption during revocation leaves us disconnected.
      await this.write({ tokens: null });
      if (session.tokens) {
        try {
          await this.http(contract.extensionAuth.revokePath, {
            method: 'POST',
            body: new URLSearchParams({
              client_id: contract.extensionAuth.clientId,
              token: session.tokens.refresh,
              token_type_hint: 'refresh_token',
            }),
          });
        } catch {
          /* Best effort; local disconnect is unconditional. */
        }
      }
    });
  }
}
