import { beforeEach, describe, expect, it } from 'vitest';
import { findEditorRoot, findEditorSurfaces } from '../src/content/zoho/selectors';

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

  it('finds the visible Deluge editor surface separately from the legacy root', () => {
    document.body.innerHTML = '<div class="CodeMirror-deluge-edit-task"></div>';

    expect(findEditorSurfaces()).toHaveLength(1);
  });
});
