import { describe, expect, it } from 'vitest';
import { getFeature } from '../src/features/registry';

describe('feature registry', () => {
  it('keeps MVP editor themes free and released', () => {
    expect(getFeature('editorThemes')).toEqual({
      id: 'editorThemes',
      tier: 'free',
      status: 'released',
    });
  });

  it('keeps future search monetization separate from release state', () => {
    expect(getFeature('functionSearch')).toEqual({
      id: 'functionSearch',
      tier: 'premium',
      status: 'planned',
    });
  });
});
