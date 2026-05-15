export const zohoSelectors = {
  editorRoot: '#createfunctionpopdiv',
  editorSettingsButton: '[data-zcqa="cf_editorSettings"]',
} as const;

export function findEditorRoot(root: ParentNode = document): Element | null {
  return root.querySelector(zohoSelectors.editorRoot);
}
