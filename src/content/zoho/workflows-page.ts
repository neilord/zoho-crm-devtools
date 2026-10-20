import { type FetchLike, fetchAllFunctions, fetchFunctionDetail } from '../functions/api';
import type { ZohoFunctionSummary } from '../functions/types';
import { openWorkflowFunctionTab } from '../workflows/function-handoff';
import { retryRequest } from './api-client';
import { resolveCrmContext } from './crm-context';
import { zohoRequestPool } from './request-pool';

export function isWorkflowsListLocation(
  location: Pick<Location, 'pathname'> = window.location,
): boolean {
  return /^\/crm\/org\d+\/settings\/workflow-rules\/?$/.test(location.pathname);
}
export function findWorkflowSearchButtonAnchor(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    'list-workflows #wfSearchWithName1, list-workflows lyte-input[data-zcqa="wfSearchWithName1"]',
  );
}
/** Reports replaced/detached anchors and route departures; owns no UI. */
export function observeWorkflowSearchAnchor(
  onAnchor: (anchor: HTMLElement | null) => void,
): () => void {
  let last: HTMLElement | null | undefined,
    scheduled = false,
    disposed = false;
  const check = () => {
    scheduled = false;
    if (disposed) return;
    const anchor = isWorkflowsListLocation() ? findWorkflowSearchButtonAnchor() : null;
    if (anchor !== last) {
      last = anchor;
      onAnchor(anchor);
    }
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(check);
    }
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  // Lyte pushState can precede DOM mutations; polling also catches route-only transitions.
  const timer = setInterval(schedule, 250);
  check();
  return () => {
    disposed = true;
    observer.disconnect();
    clearInterval(timer);
    window.removeEventListener('popstate', schedule);
  };
}
export function openRuleInCrm(ruleId: string): void {
  const context = resolveCrmContext();
  if (!context || !/^\d+$/.test(ruleId)) throw new Error('Invalid workflow handoff');
  window.location.assign(
    `${context.origin}/crm/org${context.orgId}/settings/workflow-rules/${ruleId}`,
  );
}
export async function resolveRelatedFunction(
  summary: ZohoFunctionSummary,
  signal: AbortSignal = new AbortController().signal,
) {
  const context = resolveCrmContext();
  if (!context || !/^\d+$/.test(summary.id) || !summary.api_name) return null;
  const isCurrent = () => {
    signal.throwIfAborted();
    const current = resolveCrmContext();
    return current?.origin === context.origin && current.orgId === context.orgId;
  };
  const request: FetchLike = (url, init) =>
    zohoRequestPool.run(signal, () =>
      retryRequest(
        url,
        init ?? {},
        (input, options) => {
          if (!isCurrent()) throw new DOMException('CRM context changed', 'AbortError');
          return fetch(input, options);
        },
        signal,
      ),
    );
  // Normalized actions expose the Deluge ID, not the catalogue's source/language.
  // Re-resolve those enums instead of guessing `crm` for namespaced extension functions.
  const catalogue = await fetchAllFunctions(context, request);
  if (!isCurrent()) return null;
  const candidate = catalogue.find((item) => item.id === summary.id);
  if (!candidate || (summary.api_name && candidate.api_name !== summary.api_name)) return null;
  const detail = await fetchFunctionDetail(context, candidate, request, true);
  const source =
    typeof detail?.script === 'string'
      ? detail.script
      : typeof detail?.workflow === 'string'
        ? detail.workflow
        : null;
  if (!isCurrent() || !detail || !source?.trim()) return null;
  return detail;
}

export async function openRelatedFunctionInCrm(
  summary: ZohoFunctionSummary,
  signal = new AbortController().signal,
): Promise<boolean> {
  signal.throwIfAborted();
  const context = resolveCrmContext();
  return !!context && openWorkflowFunctionTab(context, summary);
}
