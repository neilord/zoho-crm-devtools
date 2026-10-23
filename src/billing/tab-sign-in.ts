import type { authTabPlatform } from '../shared/browser';
import type { AccountState, BillingClient } from './client';
import { OAUTH_ISSUER } from './config';
import { reportBillingFailure } from './diagnostics';
import { FREE } from './entitlement';
import { authorizationCode } from './oauth';

type Pending = Awaited<ReturnType<BillingClient['beginSignIn']>> & {
  expiresAt: number;
  tabId?: number;
  openerTabId?: number;
};
const KEY = 'billingPendingSignIn';
const RESULT = 'billingSignInResult';
export type SignInProgress = AccountState | { pending: true };
const cancelled: AccountState = { signedIn: false, entitlement: FREE, cancelled: true };
const failed: AccountState = { signedIn: false, entitlement: FREE, failed: true };

/** Durable PKCE transaction and result; short UI polls survive worker restarts. */
export class TabSignIn {
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private client: BillingClient,
    private platform: typeof authTabPlatform,
    private now = Date.now,
  ) {
    platform.onRemoved((id) => {
      void this.serial(async () => {
        const pending = await this.read();
        if (pending?.tabId === id) await this.cancel();
      });
    });
    void this.serial(async () => {
      const pending = await this.read();
      if (pending) this.schedule(pending);
    });
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async read(): Promise<Pending | null> {
    const data = await this.platform.session.get<{ billingPendingSignIn?: Pending }>([KEY]);
    const pending = data.billingPendingSignIn;
    if (pending && pending.expiresAt <= this.now()) {
      await this.cancel();
      return null;
    }
    return pending ?? null;
  }
  private async clear() {
    clearTimeout(this.timer);
    await this.platform.session.set({ [KEY]: null });
  }
  private async cancel() {
    await this.clear();
    await this.platform.session.set({ [RESULT]: cancelled });
  }
  private schedule(pending: Pending) {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.serial(() => this.cancel());
      },
      Math.max(0, pending.expiresAt - this.now()),
    );
  }
  start(options: { signUp?: boolean } = {}): Promise<SignInProgress> {
    return this.serial(async () => {
      let pending = await this.read();
      if (pending?.tabId !== undefined) {
        try {
          await this.platform.focus(pending.tabId);
        } catch {
          await this.cancel();
          pending = null;
        }
      }
      if (pending && pending.tabId === undefined) {
        await this.cancel();
        pending = null;
      }
      if (!pending) {
        const current = await this.platform.current();
        pending = {
          ...(await this.client.beginSignIn(options)),
          expiresAt: this.now() + 600_000,
          openerTabId: current?.id,
        };
        await this.platform.session.set({ [KEY]: pending, [RESULT]: null });
        try {
          const tab = await this.platform.create({
            url: pending.url,
            ...(current?.id !== undefined
              ? { index: current.index + 1, openerTabId: current.id }
              : {}),
          });
          if (tab.id === undefined) throw new Error('Sign-in tab unavailable');
          pending.tabId = tab.id;
          await this.platform.session.set({ [KEY]: pending });
        } catch (error) {
          await this.cancel();
          throw error;
        }
      }
      this.schedule(pending);
      return { pending: true };
    });
  }
  status(): Promise<SignInProgress> {
    return this.serial(async () => {
      if (await this.read()) return { pending: true };
      const data = await this.platform.session.get<{ billingSignInResult?: AccountState }>([
        RESULT,
      ]);
      return data.billingSignInResult ?? cancelled;
    });
  }
  abort(): Promise<void> {
    return this.serial(() => this.cancel());
  }
  callback(url: string, tabId: number | undefined): Promise<AccountState> {
    return this.serial(async () => {
      const pending = await this.read();
      if (!pending || pending.tabId !== tabId || tabId === undefined)
        throw new Error('Stale sign-in');
      // Validate before consuming; an unrelated callback must not destroy the real transaction.
      const response = new URL(url);
      if (response.searchParams.has('error')) {
        // Validate the error's binding just as strictly as a successful code response.
        const errors = response.searchParams.getAll('error');
        if (errors.length !== 1) throw new Error('Invalid authorization response');
        response.searchParams.delete('error');
        response.searchParams.set('code', 'error-response');
        authorizationCode(response.href, pending.redirect, pending.state, OAUTH_ISSUER);
        await this.clear();
        await this.platform.session.set({
          [RESULT]: errors[0] === 'access_denied' ? cancelled : failed,
        });
        throw new Error(errors[0] === 'access_denied' ? 'Sign-in cancelled' : 'Sign-in failed');
      }
      authorizationCode(url, pending.redirect, pending.state, OAUTH_ISSUER);
      await this.clear(); // Consume BEFORE exchange, including on ambiguous network failure.
      // Persist failure first: an interrupted/failed exchange must never look like user cancellation.
      await this.platform.session.set({ [RESULT]: failed });
      let result: AccountState;
      try {
        result = await this.client.completeSignIn(url, pending);
        if (!result.signedIn) throw new Error('Sign-in failed');
      } catch (error) {
        reportBillingFailure('token exchange', error);
        throw error;
      }
      await this.platform.session.set({ [RESULT]: result });
      if (pending.openerTabId !== undefined)
        await this.platform.focus(pending.openerTabId).catch(() => undefined);
      return result;
    });
  }
}
