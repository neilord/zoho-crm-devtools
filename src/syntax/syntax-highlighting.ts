import { findEditorSurfaces } from '../content/zoho/selectors';

export const SYNTAX_ENHANCEMENT_ENABLED_ATTR = 'data-zcdt-syntax-enhancement';

export function applySyntaxEnhancementPreference(
  enabled: boolean,
  root: ParentNode = document,
): number {
  const editorSurfaces = findEditorSurfaces(root);

  for (const editorSurface of editorSurfaces) {
    if (enabled) {
      editorSurface.setAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR, 'true');
    } else {
      editorSurface.removeAttribute(SYNTAX_ENHANCEMENT_ENABLED_ATTR);
    }
  }

  return editorSurfaces.length;
}
