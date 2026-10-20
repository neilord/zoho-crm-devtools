import { browser, isOwnSender, registerWorkerMessages } from '../shared/browser';
import { isFunctionCacheMessage } from '../shared/function-cache-protocol';

/** Local-only cache channel; never forwards data to the billing client or network. */
export function registerFunctionCache(ready: Promise<void>): void {
  registerWorkerMessages((message, sender, respond) => {
    if (!isOwnSender(sender) || !isFunctionCacheMessage(message)) return false;
    const key = `zcdt-function-cache:${message.orgId}`;
    void ready
      .then(async () => {
        if (message.type === 'functions:readCache') {
          const data = await browser.storage.local.get([key]);
          return data[key] ?? null;
        }
        await browser.storage.local.set({ [key]: message.value });
        return null;
      })
      .then(
        (value) => respond({ ok: true, value }),
        () => respond({ ok: false, error: 'Function cache unavailable' }),
      );
    return true;
  });
}
