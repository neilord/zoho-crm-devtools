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
