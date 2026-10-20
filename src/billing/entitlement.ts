export interface Entitlement {
  plan: string;
  entitled: boolean;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  checkedAt: string;
}
export const FREE: Entitlement = {
  plan: 'free',
  entitled: false,
  status: 'free',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  checkedAt: '',
};

export function parseEntitlement(value: unknown): Entitlement {
  if (!value || typeof value !== 'object') return FREE;
  const e = value as Partial<Entitlement>;
  if (
    typeof e.plan !== 'string' ||
    !e.plan.trim() ||
    typeof e.entitled !== 'boolean' ||
    typeof e.status !== 'string' ||
    !(
      e.currentPeriodEnd === null ||
      (typeof e.currentPeriodEnd === 'string' && Number.isFinite(Date.parse(e.currentPeriodEnd)))
    ) ||
    typeof e.cancelAtPeriodEnd !== 'boolean' ||
    typeof e.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(e.checkedAt))
  )
    return FREE;
  // Status and expiry/grace are resolved by the server, including scheduled cancellations.
  return {
    plan: e.plan,
    entitled: e.entitled,
    status: e.status,
    currentPeriodEnd: e.currentPeriodEnd,
    cancelAtPeriodEnd: e.cancelAtPeriodEnd,
    checkedAt: e.checkedAt,
  };
}

export function resolvedPlan(e: Entitlement): string {
  return e.entitled && e.plan !== 'free' ? e.plan : 'free';
}
