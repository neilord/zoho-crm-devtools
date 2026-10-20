import type { SkippedFunction } from '../../features/function-export';
import { type FetchLike, fetchAllFunctions, fetchFunctionDetail } from './api';
import type { CrmContext } from './crm-context';
import type { FunctionRecord } from './types';

export interface ExportProgress {
  loaded: number;
  total: number;
}
export interface ExportLoadResult {
  records: FunctionRecord[];
  skipped: SkippedFunction[];
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Fresh read-only export; unreadable details are explicitly accounted for in the file. */
export async function loadExportFunctions(
  context: CrmContext,
  onProgress: (value: ExportProgress) => void,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<ExportLoadResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const seen = new Set<string>();
  const request: FetchLike = async (url, init) => {
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      controller.signal.throwIfAborted();
      response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (
        attempt >= 3 ||
        (response.status !== 429 && response.status < 500) ||
        response.status > 599
      )
        break;
      // Keep each retry inside its pool slot; don't amplify Zoho overload with extra workers.
      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
      const date = retryAfter ? Date.parse(retryAfter) : NaN;
      const minimum = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Number.isFinite(date)
          ? Math.max(0, date - Date.now())
          : 0;
      await response.body?.cancel();
      await pause(Math.max(minimum, 500 * 2 ** attempt + Math.random() * 250), controller.signal);
    }
    if (
      response.ok &&
      response.status !== 204 &&
      new URL(url).pathname.endsWith('/settings/functions')
    ) {
      const body = await response.clone().json();
      if (
        !Array.isArray(body?.functions) ||
        !body.functions.every((item: unknown) => {
          if (!item || typeof item !== 'object') return false;
          const id = (item as { id?: unknown }).id;
          if (
            !(
              (typeof id === 'string' && /^\d+$/.test(id)) ||
              (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
            ) ||
            seen.has(String(id))
          )
            return false;
          seen.add(String(id));
          return true;
        })
      )
        throw new Error('Invalid functions list');
    }
    return response;
  };
  try {
    signal.throwIfAborted();
    const summaries = await fetchAllFunctions(context, request);
    controller.signal.throwIfAborted();
    const records: FunctionRecord[] = summaries.map((summary) => ({ summary, detail: null }));
    const failures = new Map<string, SkippedFunction>();
    let next = 0;
    let loaded = 0;
    onProgress({ loaded, total: records.length });
    await Promise.all(
      Array.from({ length: Math.min(4, records.length) }, async () => {
        while (next < records.length) {
          controller.signal.throwIfAborted();
          const record = records[next++];
          try {
            const detail = await fetchFunctionDetail(context, record.summary, request, true);
            controller.signal.throwIfAborted();
            if (
              !detail ||
              detail.id !== record.summary.id ||
              (typeof detail.script !== 'string' && typeof detail.workflow !== 'string')
            )
              throw new Error('A function source is unavailable');
            record.detail = detail;
          } catch (error) {
            controller.signal.throwIfAborted();
            // Never copy a response body or arbitrary exception into a customer download.
            const status =
              error instanceof Error
                ? /^Zoho function detail request failed with status (\d{3})$/.exec(
                    error.message,
                  )?.[1]
                : undefined;
            failures.set(record.summary.id, {
              id: record.summary.id,
              name: record.summary.display_name || record.summary.id,
              apiName: record.summary.api_name ?? '',
              reason: status
                ? `Zoho returned HTTP ${status}`
                : 'Zoho source unavailable or unreadable',
            });
          }
          onProgress({ loaded: ++loaded, total: records.length });
        }
      }),
    );
    controller.signal.throwIfAborted();
    const successful = records.filter((record) => record.detail !== null);
    if (successful.length === 0) throw new Error('No function sources could be read');
    return {
      records: successful,
      skipped: records.flatMap((record) => {
        const failure = failures.get(record.summary.id);
        return failure ? [failure] : [];
      }),
    };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
