import { describe, expect, it } from 'vitest';
import { getFeature } from '../src/features/registry';

describe('feature registry', () => {
  it('keeps MVP editor themes free while they are still planned', () => {
    expect(getFeature('editorThemes')).toEqual({
      id: 'editorThemes',
      tier: 'free',
      status: 'planned',
    });
  });

  it('ships cross-function search as a free feature', () => {
    expect(getFeature('functionSearch')).toEqual({
      id: 'functionSearch',
      tier: 'free',
      status: 'beta',
    });
  });
});
