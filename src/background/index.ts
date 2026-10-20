import { BillingClient } from '../billing/client';
import { WEBSITE_BASE } from '../billing/config';
import { reportBillingFailure } from '../billing/diagnostics';
import { isBillingMessage } from '../billing/protocol';
import { TabSignIn } from '../billing/tab-sign-in';
import {
  authTabPlatform,
  billingPlatform,
  browser,
  isOwnSender,
  openWebsite,
  protectLocalStorage,
  registerWorkerMessages,
} from '../shared/browser';
import { registerFunctionCache } from './function-cache';

const ready = protectLocalStorage();
registerFunctionCache(ready);
const client = new BillingClient(billingPlatform);
const signIn = new TabSignIn(client, authTabPlatform);
const NOTICE_KEY = 'billingNotice2026';
registerWorkerMessages((message, sender, respond) => {
  if (message?.type === 'billing:oauthCallback') {
    if (
      !authTabPlatform.callbackSender(sender) ||
      typeof message.url !== 'string' ||
      Object.keys(message).length !== 2
    )
      return false;
    void ready
      .then(() => signIn.callback(message.url, sender.tab?.id))
      .then(
        () => respond({ ok: true }),
        (error) => {
          reportBillingFailure('callback', error);
          respond({ ok: false });
        },
      );
    return true;
  }
  if (!isOwnSender(sender) || !isBillingMessage(message)) return false;
  const type = message.type;
  void ready
    .then(async () => {
      switch (type) {
        case 'billing:getEntitlement':
          return client.getEntitlement();
        case 'billing:signIn':
          return signIn.start();
        case 'billing:signInStatus':
          return signIn.status();
        case 'billing:signOut':
          await signIn.abort();
          await client.signOut();
          return null;
        case 'billing:openUpgrade':
          await openWebsite(`${WEBSITE_BASE}/pricing`);
          return null;
        case 'billing:openAccount':
          await openWebsite(`${WEBSITE_BASE}/app/account`);
          return null;
        case 'billing:getNotice': {
          const data = await browser.storage.local.get([NOTICE_KEY]);
          return { pending: data[NOTICE_KEY] !== true };
        }
        case 'billing:dismissNotice':
          await browser.storage.local.set({ [NOTICE_KEY]: true });
          return null;
      }
    })
    .then(
      (value) => respond({ ok: true, value }),
      (error) => {
        reportBillingFailure(type, error);
        respond({
          ok: false,
          error: 'Account service unavailable. Free features remain available.',
        });
      },
    );
  return true;
});
