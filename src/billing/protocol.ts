import type { AccountState } from './client';
export const billingActions = [
  'billing:getEntitlement',
  'billing:signIn',
  'billing:signInStatus',
  'billing:signOut',
  'billing:openUpgrade',
  'billing:openAccount',
  'billing:openBilling',
  'billing:openCheckout',
  'billing:getNotice',
  'billing:dismissNotice',
] as const;
export type BillingAction = (typeof billingActions)[number];
export interface BillingResults {
  'billing:getEntitlement': AccountState;
  'billing:signIn': AccountState;
  'billing:signInStatus': import('./tab-sign-in').SignInProgress;
  'billing:signOut': null;
  'billing:openUpgrade': null;
  'billing:openAccount': null;
  'billing:openBilling': null;
  'billing:openCheckout': null;
  'billing:getNotice': { pending: boolean };
  'billing:dismissNotice': null;
}
export type BillingReply<T> = { ok: true; value: T } | { ok: false; error: string };
/** Actions that carry a payload beyond `type`. Every other action is exactly `{ type }`. */
export interface BillingPayloads {
  'billing:openCheckout': { plan: string };
}
export type BillingMessage = { type: BillingAction; plan?: string };
export function isBillingMessage(value: unknown): value is BillingMessage {
  if (!value || typeof value !== 'object') return false;
  const { type, plan } = value as { type?: unknown; plan?: unknown };
  if (typeof type !== 'string' || !billingActions.includes(type as BillingAction)) return false;
  const keys = Object.keys(value);
  if (type === 'billing:openCheckout')
    return keys.length === 2 && typeof plan === 'string' && plan.length > 0;
  return keys.length === 1;
}
