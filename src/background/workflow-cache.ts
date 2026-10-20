import { browser, isOwnSender, registerWorkerMessages } from '../shared/browser';
import { packWorkflowCache, unpackWorkflowCache } from '../shared/workflow-cache-codec';
import {
  isPackedWorkflowCache,
  isWorkflowCache,
  isWorkflowCacheMessage,
  type PackedWorkflowCache,
  type WorkflowCache,
  workflowCacheKey,
} from '../shared/workflow-cache-protocol';

/** Compressed bounded bucket: three partitions / 3MB each and 6MB total. */
const KEY = 'zcdt-workflow-caches-v1';
export function registerWorkflowCache(ready: Promise<void>): void {
  let queue = ready;
  registerWorkerMessages((message, sender, respond) => {
    if (!isOwnSender(sender) || !isWorkflowCacheMessage(message)) return false;
    const operation = queue
      .then(() => ready)
      .then(async () => {
        const stored = await browser.storage.local.get([KEY]);
        const buckets = (stored[KEY] ?? {}) as Record<string, WorkflowCache | PackedWorkflowCache>;
        const key = workflowCacheKey(message.origin, message.orgId);
        if (message.type === 'workflows:readCache') return unpackWorkflowCache(buckets[key]);
        const entries = Object.entries(buckets).filter(
          ([k, v]) => k !== key && (isWorkflowCache(v) || isPackedWorkflowCache(v)),
        );
        const decoded = await unpackWorkflowCache(message.value);
        if (!decoded) throw new Error('Invalid workflow cache');
        entries.push([key, await packWorkflowCache(decoded)]);
        entries.sort((a, b) => b[1].savedAt - a[1].savedAt);
        const retained = entries.slice(0, 3);
        while (
          new TextEncoder().encode(JSON.stringify(Object.fromEntries(retained))).length > 6_000_000
        )
          retained.pop();
        await browser.storage.local.set({ [KEY]: Object.fromEntries(retained) });
        return null;
      });
    queue = operation.then(
      () => {},
      () => {},
    );
    void operation.then(
      (value) => respond({ ok: true, value }),
      (error: unknown) => {
        if (import.meta.env.MODE === 'development')
          console.warn('Zoho CRM DevTools: workflow cache operation failed', error);
        respond({ ok: false, error: 'Workflow cache unavailable' });
      },
    );
    return true;
  });
}
