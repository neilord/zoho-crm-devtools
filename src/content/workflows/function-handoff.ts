import { openIsolatedTab } from '../../shared/browser';
import type { CrmContext } from '../functions/crm-context';
import { requestWorkflowEditInCrm } from '../functions/edit-in-crm';
import type { ZohoFunctionSummary } from '../functions/types';
import { findFunctionSearchControl } from '../zoho/functions-page';
import { resolveRelatedFunction } from '../zoho/workflows-page';

const PREFIX = '#zcdt-workflow-function=';
const TTL = 120_000;
interface Handoff {
  id: string;
  apiName: string;
  orgId: string;
  nonce: string;
  expires: number;
}
export function openWorkflowFunctionTab(
  context: CrmContext,
  summary: ZohoFunctionSummary,
): boolean {
  if (!/^\d+$/.test(summary.id) || !summary.api_name || !/^\d+$/.test(context.orgId)) return false;
  const marker: Handoff = {
    id: summary.id,
    apiName: summary.api_name,
    orgId: context.orgId,
    nonce: crypto.randomUUID(),
    expires: Date.now() + TTL,
  };
  return openIsolatedTab(
    `${context.origin}/crm/org${context.orgId}/settings/functions/myFunctions${PREFIX}${encodeURIComponent(JSON.stringify(marker))}`,
  );
}

/** Consume before any await. Reload/back cannot replay a handoff; no source is in the URL. */
export function consumeWorkflowFunctionHandoff(context: CrmContext): Handoff | null {
  if (!location.hash.startsWith(PREFIX)) return null;
  const hash = location.hash;
  history.replaceState(history.state, '', location.pathname + location.search);
  try {
    const m: Handoff = JSON.parse(decodeURIComponent(hash.slice(PREFIX.length)));
    if (
      Object.keys(m).sort().join(',') !== 'apiName,expires,id,nonce,orgId' ||
      context.origin !== location.origin ||
      m.orgId !== context.orgId ||
      !new RegExp(`^/crm/org${context.orgId}/settings/functions(?:/myFunctions)?/?$`).test(
        location.pathname,
      ) ||
      typeof m.id !== 'string' ||
      !/^\d+$/.test(m.id) ||
      typeof m.apiName !== 'string' ||
      !m.apiName.trim() ||
      m.apiName.length > 256 ||
      typeof m.nonce !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(m.nonce) ||
      !Number.isFinite(m.expires) ||
      m.expires <= Date.now() ||
      m.expires > Date.now() + TTL
    )
      throw new Error();
    const key = `zcdt-workflow-handoff:${m.nonce}`;
    if (sessionStorage.getItem(key)) throw new Error();
    sessionStorage.setItem(key, 'used');
    return m;
  } catch {
    throw new Error(
      'The function link is invalid or has expired. Open it again from Search All Workflows.',
    );
  }
}

export function startWorkflowFunctionHandoff(context: CrmContext): void {
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.style.cssText =
    'position:fixed;top:16px;right:24px;z-index:2147483647;background:white;color:#222;padding:16px;border:1px solid #aaa;border-radius:6px;max-width:420px';
  const run = async () => {
    const marker = consumeWorkflowFunctionHandoff(context);
    if (!marker) return;
    status.textContent = 'Opening workflow function in the native editor…';
    document.body.append(status);
    const signal = AbortSignal.timeout(30_000);
    while (!findFunctionSearchControl()) {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const detail = await resolveRelatedFunction(
      { id: marker.id, api_name: marker.apiName, display_name: '', category: '' },
      signal,
    );
    if (!detail || !(await requestWorkflowEditInCrm(detail, signal))) throw new Error();
    status.remove();
  };
  void run().catch(() => {
    status.setAttribute('role', 'alert');
    status.textContent =
      'Could not open this function in the editor. Return to Search All Workflows and try again, or use the native Functions search.';
    document.body.append(status);
  });
}
