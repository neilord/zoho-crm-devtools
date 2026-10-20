import { contract } from '../../billing/config';
import { type Entitlement, resolvedPlan } from '../../billing/entitlement';

/** Everything the card can show. `status` strings are server-owned, so matching is defensive. */
export type AccountView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'signed-out' }
  | { kind: 'free' }
  | { kind: 'trial'; daysLeft: number | null }
  | { kind: 'pro'; renews: string | null }
  | { kind: 'pro-canceling'; until: string }
  | { kind: 'past-due' };

export const TRIAL_DAYS = contract.trial.days;
export const PRO_PRICE_USD = contract.plans.find((p) => p.key === 'pro')?.priceUsdMonthly ?? null;

const DAY_MS = 86_400_000;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function daysLeft(endIso: string | null, now = Date.now()): number | null {
  if (!endIso) return null;
  return Math.max(0, Math.ceil((Date.parse(endIso) - now) / DAY_MS));
}

export function deriveView(
  state: { signedIn: boolean; entitlement: Entitlement; signedOutPending?: true },
  now = Date.now(),
): AccountView {
  if (!state.signedIn || state.signedOutPending) return { kind: 'signed-out' };
  const e = state.entitlement;
  if (!e.checkedAt) return { kind: 'error' };
  const status = e.status.toLowerCase();
  const pastDue = status === 'past_due' || status === 'unpaid' || status === 'incomplete';
  if (resolvedPlan(e) !== 'pro')
    return pastDue || status === 'active' ? { kind: 'past-due' } : { kind: 'free' };
  if (pastDue) return { kind: 'past-due' };
  if (status === 'trialing') return { kind: 'trial', daysLeft: daysLeft(e.currentPeriodEnd, now) };
  if (e.cancelAtPeriodEnd && e.currentPeriodEnd) {
    return { kind: 'pro-canceling', until: formatDate(e.currentPeriodEnd) };
  }
  return { kind: 'pro', renews: e.currentPeriodEnd ? formatDate(e.currentPeriodEnd) : null };
}
