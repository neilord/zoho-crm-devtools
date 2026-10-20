import { type Entitlement, resolvedPlan } from '../billing/entitlement';

export type FeatureTier = 'free' | 'premium';
export type FeatureStatus = 'planned' | 'beta' | 'released';

export interface FeatureDefinition {
  id:
    | 'editorThemes'
    | 'fontControls'
    | 'indentGuides'
    | 'syntaxEnhancement'
    | 'functionSearch'
    | 'workflowSearch'
    | 'exportFunctions'
    | 'githubSync'
    | 'bulkImportExport';
  tier: FeatureTier;
  status: FeatureStatus;
}

export const features: readonly FeatureDefinition[] = [
  { id: 'editorThemes', tier: 'free', status: 'planned' },
  { id: 'fontControls', tier: 'free', status: 'planned' },
  { id: 'indentGuides', tier: 'free', status: 'planned' },
  { id: 'syntaxEnhancement', tier: 'free', status: 'planned' },
  { id: 'functionSearch', tier: 'free', status: 'beta' },
  { id: 'workflowSearch', tier: 'premium', status: 'beta' },
  { id: 'exportFunctions', tier: 'premium', status: 'beta' },
  { id: 'githubSync', tier: 'premium', status: 'planned' },
  { id: 'bulkImportExport', tier: 'premium', status: 'planned' },
] as const;

export function getFeature(id: FeatureDefinition['id']): FeatureDefinition {
  const feature = features.find((candidate) => candidate.id === id);
  if (!feature) {
    throw new Error(`Unknown feature: ${id}`);
  }

  return feature;
}

// ADR 0015 retains unlocked plumbing for other planned capabilities.
export const PREMIUM_GATE_ENABLED = false;
// ADR 0019: owner-approved new Export functions is premium from first availability.
export const EXPORT_FUNCTIONS_GATE_ENFORCED = true;
// Search All Workflows is independently paid from launch.
export const WORKFLOW_SEARCH_GATE_ENFORCED = true;
export function isFeatureAvailable(
  feature: FeatureDefinition,
  entitlement: Entitlement,
  gateEnabled: boolean = feature.id === 'workflowSearch'
    ? WORKFLOW_SEARCH_GATE_ENFORCED
    : feature.id === 'exportFunctions'
      ? EXPORT_FUNCTIONS_GATE_ENFORCED
      : PREMIUM_GATE_ENABLED,
): boolean {
  return feature.tier === 'free' || !gateEnabled || resolvedPlan(entitlement) !== 'free';
}
