export const zohoSelectors = {
  editorRoot: '#createfunctionpopdiv',
  editorSettingsButton: '[data-zcqa="delgv2sbsettings_click"]',
  themeDropdown: 'lyte-dropdown[data-zcqa="dxDroptheme"]',
  dropdownLabel: '.lyteDropdownLabel',
  dropdownTrigger: '.lyteDummyEventContainer',
  dropdownNoResult: '.lyteDropdownNoResult',
} as const;

export function findEditorRoot(root: ParentNode = document): Element | null {
  return root.querySelector(zohoSelectors.editorRoot);
}
