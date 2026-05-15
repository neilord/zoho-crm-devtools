import { describe, expect, it } from 'vitest';
import { getTheme } from '../src/themes/registry';

describe('theme registry', () => {
  it('returns theme metadata by id', () => {
    expect(getTheme('night-owl').label).toBe('Night Owl');
  });
});
