import type { AccountState } from '../../../billing/client';
import { hasPlanFeature } from '../../../billing/entitlement';

/** Same compile-time mode guard as workflow search; production ignores both flags. */
export function automationMapDevAccess(): 'full' | 'teaser' | null {
  if (import.meta.env.MODE === 'development') {
    if (import.meta.env.VITE_AUTOMATION_MAP_FORCE_TEASER === 'true') return 'teaser';
    if (import.meta.env.VITE_AUTOMATION_MAP_UNLOCK === 'true') return 'full';
  }
  return null;
}
export function hasAutomationMapAccess(account: AccountState | null): boolean {
  const override = automationMapDevAccess();
  if (override) return override === 'full';
  return (
    !!account?.signedIn && !account.failed && hasPlanFeature(account.entitlement, 'automationMap')
  );
}
