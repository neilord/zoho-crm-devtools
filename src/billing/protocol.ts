import type { AccountState } from './client';
export const billingActions = [
  'billing:getEntitlement',
  'billing:signIn',
  'billing:signInStatus',
  'billing:signOut',
  'billing:openUpgrade',
  'billing:openAccount',
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
  'billing:getNotice': { pending: boolean };
  'billing:dismissNotice': null;
}
export type BillingReply<T> = { ok: true; value: T } | { ok: false; error: string };
export function isBillingMessage(value: unknown): value is { type: BillingAction } {
  return (
    !!value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    billingActions.includes((value as { type: BillingAction }).type)
  );
}
