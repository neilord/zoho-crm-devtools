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

function promisifyStorage(area: chrome.storage.StorageArea): StorageArea {
  return {
    get<T extends Record<string, unknown>>(keys?: string[] | null) {
      return area.get(keys ?? null) as Promise<T>;
    },
    set(items: Record<string, unknown>) {
      return area.set(items);
    },
  };
}

export const browser: BrowserFacade = {
  storage: {
    sync: promisifyStorage(chrome.storage.sync),
    local: promisifyStorage(chrome.storage.local),
  },
  tabs: {
    query(queryInfo) {
      return chrome.tabs.query(queryInfo);
    },
  },
};
