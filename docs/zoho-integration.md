# Zoho Integration

## Scope

The extension targets Zoho CRM only.

## Discovery Notes

- Inspect how Zoho handles a behavior natively before adding custom code.
- Prefer cloning or extending native controls when Zoho can manage state for us.
- Keep selector knowledge in `src/content/zoho`.
- Record unstable selectors and fallback strategies here when they are discovered.

## Live Findings

- The functions list is available at `/settings/functions/myFunctions`.
- Editable rows can expose a `Function Details` dialog with an `Edit Function` action.
- The current editor opens in-place with a left rail, editor canvas, and right metadata panel.
- The bottom-left gear opens a native `Settings` dialog.
- The current settings dialog has `General` and `Editor` groups with visible items:
  - `Theme`
  - `Syntax Assist`
  - `Font`
  - `Word Spacing`
- The theme page currently renders a `Color` panel with a native combobox showing `Light`.

## Known Open Questions

- Durable selectors for the current editor mount and settings trigger
- The exact DOM structure and classes behind the native theme combobox
- Best insertion point for custom theme options
- How native selected-state is derived and persisted
- Whether cloned native options can preserve native behavior across reopen/reload without extra reconciliation
