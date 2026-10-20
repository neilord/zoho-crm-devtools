import type { FetchLike } from '../functions/api';
import type { CrmContext } from './crm-context';
import { zohoRequestPool } from './request-pool';

export function buildRequestHeaders(context: CrmContext): Record<string, string> {
  return {
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Crm-Org': context.orgId,
    'X-Zcsrf-Token': context.csrfHeader,
  };
}
export function pause(ms: number, signal: AbortSignal): Promise<void> {
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
/** Retries remain inside the caller's slot, including Retry-After and jitter. */
export async function retryRequest(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (
      attempt >= 3 ||
      (response.status !== 429 && (response.status < 500 || response.status > 599))
    ) {
      // Keep the network body inside the slot too; fetch resolves when only headers arrive.
      if (response.ok && response.body) {
        const body = await response.arrayBuffer();
        signal.throwIfAborted();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      if (!response.ok) await response.body?.cancel();
      return response;
    }
    const header = response.headers.get('Retry-After');
    const seconds = header?.trim() ? Number(header) : NaN;
    const date = header ? Date.parse(header) : NaN;
    const minimum = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Number.isFinite(date)
        ? Math.max(0, date - Date.now())
        : 0;
    await response.body?.cancel();
    await pause(Math.max(minimum, 500 * 2 ** attempt + Math.random() * 250), signal);
  }
}
/** Fixed same-origin GET only. Bodies are consumed inside the global budget. */
export async function zohoGet(
  context: CrmContext,
  path: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<unknown> {
  const url = new URL(path, context.origin);
  if (url.origin !== context.origin || !url.pathname.startsWith('/crm/'))
    throw new Error('Invalid Zoho request');
  return zohoRequestPool.run(signal, async () => {
    const response = await retryRequest(
      url.href,
      {
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        headers: buildRequestHeaders(context),
      },
      fetchImpl,
      signal,
    );
    if (response.status === 204) return null;
    if (!response.ok) throw new Error('Zoho configuration unavailable');
    return response.json();
  });
}
