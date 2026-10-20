import { contract } from './config';

export function planName(key: string): string {
  return (
    contract.plans.find((plan) => plan.key === key)?.name ??
    key.charAt(0).toUpperCase() + key.slice(1)
  );
}

export const trialPlan = contract.plans.find((plan) => plan.key === contract.trial.plan);
if (!trialPlan) throw new Error('Trial plan missing from product contract');
export const trialPriceCopy = `$${trialPlan.introPriceUsdFirstMonth} for the first month, $${trialPlan.priceUsdMonthly}/month after`;
