# Session Handoff

## Read First

1. `docs/product.md`
2. `docs/architecture.md`
3. `docs/development-workflow.md`
4. `docs/debugging-playbook.md`
5. `docs/testing.md`
6. This file

## Current Milestone

First real feature slice implemented and live-verified.

## Last Completed Task

Implemented native custom-theme injection for the Zoho CRM Deluge editor and verified both dark and
light alias paths live in Zoho.

## Current Branch

`codex/theme-injection-core`

## What Works

- Custom options are injected into Zoho's native theme dropdown without replacing the native UX.
- `VS Code Dark` delegates to native `vs-dark`; `VS Code Light` delegates to native `vs-light`.
- Custom selection persists, updates the visible dropdown label, and keeps the custom checkmark
  selected while Zoho still owns the underlying light/dark switch.
- The proof-theme CSS now uses theme-local `--zcdt-theme-*` palette variables mapped onto Zoho's
  editor-facing `--dre-*` variables.

## Known Fragile Selectors

- Theme dropdown: `lyte-dropdown[data-zcqa="dxDroptheme"]`
- Editor settings button: `[data-zcqa="delgv2sbsettings_click"]`
- Native fallback anchor: `lyte-drop-item[data-value="vs-dark"]`

## Failed Approaches Worth Remembering

- Do **not** unconditionally rewrite selected-state attributes/classes inside the mutation observer
  reconciliation path. That creates a self-feeding mutation loop and can crash the tab.
- Reconciliation must only mutate when state is actually wrong, and it should keep the hover guard
  before moving `lyteDropdownSelection` away from Zoho's native alias option.

## Exact Next Task

Create a separate theme-catalog branch after theme research, then add curated real themes by extending
the registry and theme palettes without reopening the proven native-injection logic unless live
verification reveals a gap.
