import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySyntaxEnhancementPreference,
  SYNTAX_ENHANCEMENT_ENABLED_ATTR,
} from '../src/syntax/syntax-highlighting';

describe('syntax highlighting enhancement', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="CodeMirror-deluge-edit-task"></div>';
  });

  it('enables syntax enhancement styling on the live Deluge editor surface', () => {
    expect(applySyntaxEnhancementPreference(true)).toBe(1);

    expect(
      document
        .querySelector('.CodeMirror-deluge-edit-task')
        ?.getAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR),
    ).toBe('true');
  });

  it('removes syntax enhancement styling when the preference is disabled', () => {
    const editorSurface = document.querySelector('.CodeMirror-deluge-edit-task');
    editorSurface?.setAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR, 'true');

    applySyntaxEnhancementPreference(false);

    expect(editorSurface?.hasAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR)).toBe(false);
  });

  it('handles pages without a live Deluge editor surface', () => {
    document.body.innerHTML = '<div></div>';

    expect(applySyntaxEnhancementPreference(true)).toBe(0);
  });
});
