import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyIndentGuidesPreference,
  INDENT_GUIDES_ENABLED_ATTR,
} from '../src/content/editor/indent-guides';

describe('indent guides', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="CodeMirror-deluge-edit-task"></div>';
  });

  it('enables indent-guide styling on the live Deluge editor surface', () => {
    expect(applyIndentGuidesPreference(true)).toBe(1);

    expect(
      document
        .querySelector('.CodeMirror-deluge-edit-task')
        ?.getAttribute(INDENT_GUIDES_ENABLED_ATTR),
    ).toBe('true');
  });

  it('removes indent-guide styling when the preference is disabled', () => {
    const editorSurface = document.querySelector('.CodeMirror-deluge-edit-task');
    editorSurface?.setAttribute(INDENT_GUIDES_ENABLED_ATTR, 'true');

    applyIndentGuidesPreference(false);

    expect(editorSurface?.hasAttribute(INDENT_GUIDES_ENABLED_ATTR)).toBe(false);
  });
});
