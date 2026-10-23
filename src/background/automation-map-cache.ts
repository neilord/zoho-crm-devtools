import {
  AUTOMATION_MAP_BUCKET_LIMIT,
  AUTOMATION_MAP_PARTITIONS,
  automationMapCacheKey,
  isAutomationMapCacheMessage,
  packAutomationMapCache,
  unpackAutomationMapCache,
} from '../shared/automation-map-cache-protocol';
import { isOwnSender, registerWorkerMessages } from '../shared/browser';
import type { PackedWorkflowCache } from '../shared/workflow-cache-protocol';

export type CacheEntry = { key: string; value: PackedWorkflowCache };
/** One atomic replacement; implementations must preserve the old bucket on failure. */
export interface AutomationMapCacheStorage {
  read(): Promise<CacheEntry[]>;
  replace(entries: CacheEntry[]): Promise<void>;
}
export class IndexedDbAutomationMapStorage implements AutomationMapCacheStorage {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('zcdt-automation-map-v1', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('partitions', { keyPath: 'key' });
      request.onerror = () => reject(new Error('Map cache unavailable'));
      request.onblocked = () => reject(new Error('Map cache blocked'));
      request.onsuccess = () => resolve(request.result);
    });
  }
  async read(): Promise<CacheEntry[]> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('partitions', 'readonly');
        const request = transaction.objectStore('partitions').getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () =>
          reject(new Error('Map cache read failed'));
      });
    } finally {
      db.close();
    }
  }
  async replace(entries: CacheEntry[]): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('partitions', 'readwrite'),
          store = transaction.objectStore('partitions');
        store.clear();
        for (const entry of entries) store.put(entry);
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () =>
          reject(new Error('Map cache write failed'));
      });
    } finally {
      db.close();
    }
  }
}
export function registerAutomationMapCache(
  ready: Promise<void>,
  storage: AutomationMapCacheStorage = new IndexedDbAutomationMapStorage(),
): void {
  let queue = ready;
  registerWorkerMessages((message, sender, respond) => {
    if (!isOwnSender(sender) || !isAutomationMapCacheMessage(message)) return false;
    const operation = queue.then(async () => {
      await ready;
      const key = automationMapCacheKey(message.origin, message.orgId),
        entries = await storage.read();
      if (message.type === 'automationMap:readCache') {
        const decoded = await unpackAutomationMapCache(entries.find((e) => e.key === key)?.value);
        return decoded ? packAutomationMapCache(decoded) : null;
      }
      const value = await unpackAutomationMapCache(message.value);
      if (!value) throw new Error('Invalid map cache');
      const packed = await packAutomationMapCache(value);
      // Validate old entries too; corrupted partitions never consume retention budget.
      const retained: CacheEntry[] = [];
      for (const entry of entries) {
        if (entry.key !== key && (await unpackAutomationMapCache(entry.value).catch(() => null)))
          retained.push(entry);
      }
      retained.push({ key, value: packed });
      retained.sort((a, b) => b.value.savedAt - a.value.savedAt);
      retained.splice(AUTOMATION_MAP_PARTITIONS);
      while (
        new TextEncoder().encode(JSON.stringify(retained)).length > AUTOMATION_MAP_BUCKET_LIMIT
      )
        retained.pop();
      await storage.replace(retained);
      return null;
    });
    queue = operation.then(
      () => {},
      () => {},
    );
    void operation.then(
      (value) => respond({ ok: true, value }),
      () => respond({ ok: false, error: 'Automation Map cache unavailable' }),
    );
    return true;
  });
}
