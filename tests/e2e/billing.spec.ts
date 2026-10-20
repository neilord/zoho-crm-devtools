import { chromium, expect, test } from '@playwright/test';

// Opt-in live API check: build:dev first. CRM markup is sanitized; account entry is production.
for (const entry of ['popup', 'content'] as const) {
  test(`${entry}: opens production login adjacent, cancels, and exchanges a callback with native fetch`, async () => {
    const dist = new URL('../../dist-dev', import.meta.url).pathname;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const errors: string[] = [];
      worker.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
      });
      const id = new URL(worker.url()).host;
      expect(id).toBe('lkgcneekmlnpcjcfeieehpokgmefpdde');
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      if (entry === 'popup') {
        await page.goto(`chrome-extension://${id}/src/popup/index.html`);
      } else {
        await page.route('https://crm.zoho.com/**', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<html><body><div><input id="functionSearch"><button>Create Function</button></div></body></html>',
          }),
        );
        await page.goto('https://crm.zoho.com/crm/org123/settings/functions');
        await page.locator('[data-zcdt-export-run]').click();
        await page.locator('[data-zcdt-export-format="json"]').click();
      }
      if (entry === 'content') {
        const cdp = await context.newCDPSession(page);
        let isolatedWorld: number | undefined;
        cdp.on('Runtime.executionContextCreated', ({ context: world }) => {
          if (world.origin === `chrome-extension://${id}`) isolatedWorld = world.id;
        });
        await cdp.send('Runtime.enable');
        expect(isolatedWorld).toBeDefined();
        const access = await cdp.send('Runtime.evaluate', {
          contextId: isolatedWorld,
          awaitPromise: true,
          returnByValue: true,
          expression: `(async () => {
            const denied = async area => {
              try { await chrome.storage[area].get(null); return false; } catch { return true; }
            };
            return { local: await denied('local'), session: await denied('session') };
          })()`,
        });
        expect(access.result.value).toEqual({ local: true, session: true });
        await cdp.detach();
      }
      const start = () =>
        entry === 'popup'
          ? page.getByRole('button', { name: 'Sign in', exact: true }).click()
          : page.locator('[data-zcdt-upgrade-action="sign-in"]').click();
      const note = () => page.locator(entry === 'popup' ? '.acct-note' : '[role="alert"]');
      const firstOpened = context.waitForEvent('page');
      await start();
      const login = await firstOpened;
      await expect(login).toHaveURL(/^https:\/\/devtools\.zsetup\.com\/login\?/);
      const url = new URL(login.url());
      expect(url.searchParams.get('client_id')).toBe('zoho-crm-devtools-extension');
      expect(url.searchParams.get('redirect_uri')).toBe(
        `chrome-extension://${id}/src/billing/oauth-callback.html`,
      );
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toBe('entitlement:read offline_access');
      await expect(login.locator('input[type="email"]')).toBeVisible();
      const adjacent = await worker.evaluate(async () => {
        const { billingPendingSignIn: pending } = await chrome.storage.session.get<{
          billingPendingSignIn: {
            tabId: number;
            openerTabId: number;
            redirect: string;
            state: string;
          };
        }>('billingPendingSignIn');
        const opener = await chrome.tabs.get(pending.openerTabId);
        const auth = await chrome.tabs.get(pending.tabId);
        return auth.index === opener.index + 1 && auth.openerTabId === opener.id;
      });
      expect(adjacent).toBe(true);
      expect(errors).toEqual([]);
      await login.close();
      await expect(note()).toContainText('Sign-in was cancelled');
      const opened = context.waitForEvent('page');
      await start();
      const callback = await opened;
      await expect(callback).toHaveURL(/^https:\/\/devtools\.zsetup\.com\/login\?/);
      const response = context.waitForEvent('response', {
        predicate: (r) => r.url() === 'https://api.devtools.zsetup.com/v1/auth/oauth2/token',
      });
      // Invalid code exercises the real native fetch/CORS path without authenticating an account.
      const callbackURL = await worker.evaluate(async () => {
        const { billingPendingSignIn: pending } = await chrome.storage.session.get<{
          billingPendingSignIn: {
            tabId: number;
            openerTabId: number;
            redirect: string;
            state: string;
          };
        }>('billingPendingSignIn');
        return `${pending.redirect}?${new URLSearchParams({
          code: 'invalid-regression-probe',
          state: pending.state,
          iss: 'https://api.devtools.zsetup.com/v1/auth',
        })}`;
      });
      await callback.goto(callbackURL);
      expect((await response).status()).toBe(400);
      await expect(note()).toContainText('Sign-in failed');
      expect(errors.some((error) => error.includes('Illegal invocation'))).toBe(false);
      expect(errors).toContain('[billing] token exchange: Error: Token exchange failed');
      const outcome = await worker.evaluate(async () => {
        const data = await chrome.storage.session.get(null);
        return { pending: data.billingPendingSignIn, result: data.billingSignInResult };
      });
      expect(outcome.pending).toBeNull();
      expect(outcome.result).toMatchObject({ signedIn: false, failed: true });
      expect(outcome.result).not.toHaveProperty('cancelled');
    } finally {
      await context.close();
    }
  });
}
