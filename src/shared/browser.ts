import type { FunctionCache, FunctionCacheMessage } from './function-cache-protocol';
import { packWorkflowCache, unpackWorkflowCache } from './workflow-cache-codec';
export interface StorageArea {
  get<T extends Record<string, unknown>>(keys?: string[] | null): Promise<T>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface BrowserFacade {
  storage: {
    sync: StorageArea;
    local: StorageArea;
  };
  tabs: {
    query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  };
}

function getChromeApi(): typeof chrome {
  if (!globalThis.chrome) {
    throw new Error('Chrome extension APIs are unavailable in this environment.');
  }

  return globalThis.chrome;
}

function promisifyStorage(getArea: () => chrome.storage.StorageArea): StorageArea {
  return {
    get<T extends Record<string, unknown>>(keys?: string[] | null) {
      return getArea().get(keys ?? null) as Promise<T>;
    },
    set(items: Record<string, unknown>) {
      return getArea().set(items);
    },
  };
}

export const browser: BrowserFacade = {
  storage: {
    sync: promisifyStorage(() => getChromeApi().storage.sync),
    local: promisifyStorage(() => getChromeApi().storage.local),
  },
  tabs: {
    query(queryInfo) {
      return getChromeApi().tabs.query(queryInfo);
    },
  },
};

// Account credentials stay behind this worker-only adapter; callers receive only entitlement.
export const billingPlatform = {
  storage: browser.storage.local,
  redirectURL: () => getChromeApi().runtime.getURL('src/billing/oauth-callback.html'),
};
export async function billingMessage<A extends import('../billing/protocol').BillingAction>(
  type: A,
): Promise<import('../billing/protocol').BillingResults[A]> {
  const send = async (action: string) => {
    const reply = await getChromeApi().runtime.sendMessage({ type: action });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Account service unavailable');
    return reply.value;
  };
  let value = await send(type);
  // Short messages wake a restarted worker; no ten-minute runtime port or worker keepalive.
  if (type === 'billing:signIn') {
    while (value?.pending === true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      value = await send('billing:signInStatus');
    }
  }
  return value;
}

export function protectLocalStorage(): Promise<void> {
  return getChromeApi().storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
export function openWebsite(url: string) {
  return getChromeApi().tabs.create({ url });
}
export function registerWorkerMessages(
  handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
) {
  getChromeApi().runtime.onMessage.addListener(handler);
}
export function isOwnSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === getChromeApi().runtime.id;
}

async function cacheMessage(message: FunctionCacheMessage): Promise<FunctionCache | null> {
  const reply = await getChromeApi().runtime.sendMessage(message);
  if (!reply?.ok) throw new Error('Function cache unavailable');
  return reply.value;
}
function cacheOrg(key: string): string {
  const match = /^zcdt-function-cache:(\d+)$/.exec(key);
  if (!match) throw new Error('Invalid function cache key');
  return match[1];
}
/** Content scripts get cache access only; the worker never exposes arbitrary local keys. */
export const functionCacheStorage: StorageArea = {
  async get<T extends Record<string, unknown>>(keys?: string[] | null): Promise<T> {
    if (keys?.length !== 1) throw new Error('One function cache key required');
    const value = await cacheMessage({ type: 'functions:readCache', orgId: cacheOrg(keys[0]) });
    return (value ? { [keys[0]]: value } : {}) as T;
  },
  async set(items) {
    const keys = Object.keys(items);
    if (keys.length !== 1) throw new Error('One function cache key required');
    await cacheMessage({
      type: 'functions:writeCache',
      orgId: cacheOrg(keys[0]),
      value: items[keys[0]] as FunctionCache,
    });
  },
};

/** Local Blob download; no downloads permission or service upload. */
export function downloadTextFile(file: {
  content: string;
  filename: string;
  mediaType: string;
}): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mediaType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const authTabPlatform = {
  session: promisifyStorage(() => getChromeApi().storage.session),
  current: async () => (await getChromeApi().tabs.query({ active: true, currentWindow: true }))[0],
  create: (options: chrome.tabs.CreateProperties) => getChromeApi().tabs.create(options),
  focus: (id: number) => getChromeApi().tabs.update(id, { active: true }),
  onRemoved: (listener: (id: number) => void) =>
    getChromeApi().tabs.onRemoved.addListener(listener),
  callbackSender: (sender: chrome.runtime.MessageSender) =>
    isOwnSender(sender) &&
    !sender.frameId &&
    sender.url?.split('?')[0] === getChromeApi().runtime.getURL('src/billing/oauth-callback.html'),
};
export function sendOAuthCallback(url: string): Promise<{ ok: boolean }> {
  return getChromeApi().runtime.sendMessage({ type: 'billing:oauthCallback', url });
}

export async function workflowCacheMessage(
  message: import('./workflow-cache-protocol').WorkflowCacheMessage,
): Promise<import('./workflow-cache-protocol').WorkflowCache | null> {
  let payload = message;
  if (message.type === 'workflows:writeCache') {
    const decoded = await unpackWorkflowCache(message.value);
    if (!decoded) throw new Error('Invalid workflow cache');
    payload = { ...message, value: await packWorkflowCache(decoded) };
  }
  const reply = await getChromeApi().runtime.sendMessage(payload);
  if (!reply?.ok) throw new Error('Workflow cache unavailable');
  return unpackWorkflowCache(reply.value);
}

/** Open synchronously in the click gesture; sever the opener before navigating. */
export function openIsolatedTab(url: string): boolean {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return false;
  tab.opener = null;
  tab.location.replace(url);
  return true;
}
