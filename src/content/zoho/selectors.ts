export const zohoSelectors = {
  editorRoot: '#createfunctionpopdiv',
  editorSurface: '.CodeMirror-deluge-edit-task',
  editorSettingsButton: '[data-zcqa="delgv2sbsettings_click"]',
  themeDropdown: 'lyte-dropdown[data-zcqa="dxDroptheme"]',
  dropdownLabel: '.lyteDropdownLabel',
  dropdownTrigger: '.lyteDummyEventContainer',
  dropdownNoResult: '.lyteDropdownNoResult',
} as const;

export function findEditorRoot(root: ParentNode = document): Element | null {
  return root.querySelector(zohoSelectors.editorRoot);
}

export function findEditorSurfaces(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(zohoSelectors.editorSurface)];
}
