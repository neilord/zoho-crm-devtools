import { findEditorSurfaces } from '../zoho/selectors';

export const INDENT_GUIDES_ENABLED_ATTR = 'data-zcdt-indent-guides';

export function applyIndentGuidesPreference(enabled: boolean, root: ParentNode = document): number {
  const editorSurfaces = findEditorSurfaces(root);

  for (const editorSurface of editorSurfaces) {
    if (enabled) {
      editorSurface.setAttribute(INDENT_GUIDES_ENABLED_ATTR, 'true');
    } else {
      editorSurface.removeAttribute(INDENT_GUIDES_ENABLED_ATTR);
    }
  }

  return editorSurfaces.length;
}
