import contract from './product-contract.json';

export interface Entitlement {
  plan: string;
  entitled: boolean;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  checkedAt: string;
  features?: string[];
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
    ...(Array.isArray(e.features) &&
    e.features.every((feature) => typeof feature === 'string' && feature.trim().length > 0)
      ? { features: [...e.features] }
      : {}),
  };
}

export function resolvedPlan(e: Entitlement): string {
  return e.entitled && e.plan !== 'free' ? e.plan : 'free';
}

/** Server capabilities take precedence, including an explicitly empty list (ADR 0025). */
export function hasPlanFeature(entitlement: Entitlement, featureId: string): boolean {
  const plan = resolvedPlan(entitlement);
  if (plan === 'free') return false;
  if (entitlement.features !== undefined) return entitlement.features.includes(featureId);
  const definition = contract.plans.find((candidate) => candidate.key === plan);
  if (definition) return definition.features.some((feature) => feature === featureId);
  // Future paid keys retain existing paid access but cannot implicitly unlock tiered features.
  return featureId === 'exportFunctions' || featureId === 'workflowSearch';
}
