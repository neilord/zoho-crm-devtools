import { resolvedPlan } from '../../billing/entitlement';
import { billingMessage } from '../../shared/browser';
import {
  mountUpgradeHook,
  UPGRADE_REQUIRED_EVENT,
  type UpgradeModalDependencies,
  workflowSearchUpgradeCopy,
} from '../billing/upgrade-hook';

/** Match the repo's build:dev/diagnostics mode guard; production discards this branch. */
export function workflowSearchDevOverride(): boolean {
  return (
    import.meta.env.MODE === 'development' && import.meta.env.VITE_WORKFLOW_SEARCH_UNLOCK === 'true'
  );
}
export async function hasWorkflowSearchAccess(
  send: UpgradeModalDependencies['send'] = billingMessage,
): Promise<boolean> {
  if (workflowSearchDevOverride()) return true;
  try {
    let account = await send('billing:getEntitlement');
    if (account.signedOutPending) account = await send('billing:getEntitlement');
    return account.signedIn && resolvedPlan(account.entitlement) !== 'free';
  } catch {
    return false;
  }
}
/** Resolves false on dismissal/abort; true on entitlement or completed upgrade. No CRM I/O. */
export async function requestWorkflowSearchAccess(
  invoker: HTMLElement = document.body,
  signal?: AbortSignal,
  deps: UpgradeModalDependencies = { send: billingMessage },
): Promise<boolean> {
  if (signal?.aborted) return false;
  const allowed = await hasWorkflowSearchAccess(deps.send);
  if (signal?.aborted) return false;
  if (allowed) return true;
  return new Promise((resolve) => {
    let entitled = false,
      settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      queueMicrotask(dispose);
      resolve(value);
    };
    const abort = () => finish(false);
    const dispose = mountUpgradeHook(invoker, deps, {
      ...workflowSearchUpgradeCopy,
      invoker,
      // close runs immediately before onEntitled; defer dismissal resolution to allow resume.
      onClose: () => queueMicrotask(() => finish(entitled)),
      onEntitled: () => {
        entitled = true;
        finish(true);
      },
    });
    signal?.addEventListener('abort', abort, { once: true });
    invoker.ownerDocument.dispatchEvent(
      new CustomEvent(UPGRADE_REQUIRED_EVENT, {
        detail: { featureId: 'workflowSearch', reason: 'paid-required' },
      }),
    );
  });
}
