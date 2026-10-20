export interface Entitlement {
  plan: 'free' | 'pro';
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
    (e.plan !== 'free' && e.plan !== 'pro') ||
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

export function resolvedPlan(e: Entitlement): 'free' | 'pro' {
  return e.plan === 'pro' && e.entitled ? 'pro' : 'free';
}
