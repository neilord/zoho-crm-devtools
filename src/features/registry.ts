export type FeatureTier = 'free' | 'premium';
export type FeatureStatus = 'planned' | 'beta' | 'released';

export interface FeatureDefinition {
  id:
    | 'editorThemes'
    | 'fontControls'
    | 'indentGuides'
    | 'syntaxEnhancement'
    | 'functionSearch'
    | 'githubSync'
    | 'bulkImportExport';
  tier: FeatureTier;
  status: FeatureStatus;
}

export const features: readonly FeatureDefinition[] = [
  { id: 'editorThemes', tier: 'free', status: 'released' },
  { id: 'fontControls', tier: 'free', status: 'planned' },
  { id: 'indentGuides', tier: 'free', status: 'planned' },
  { id: 'syntaxEnhancement', tier: 'free', status: 'planned' },
  { id: 'functionSearch', tier: 'premium', status: 'planned' },
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
