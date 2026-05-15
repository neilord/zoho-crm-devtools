import { beforeEach, describe, expect, it } from 'vitest';
import { findEditorRoot } from '../src/content/zoho/selectors';

describe('Zoho editor detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the legacy editor root when present', () => {
    document.body.innerHTML = '<section id="createfunctionpopdiv"></section>';
    expect(findEditorRoot()).not.toBeNull();
  });

  it('returns null when the editor is absent', () => {
    expect(findEditorRoot()).toBeNull();
  });
});
