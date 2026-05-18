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
- The theme page renders a native Lyte dropdown at `lyte-dropdown[data-zcqa="dxDroptheme"]`.
- The live native theme options currently observed are:
  - `vs-dark` → `Dark`
  - `vs-darkplus` → `Midnight Blue`
  - `vs-light` → `Light`
- Native theme selection updates the dropdown's `lt-prop-selected`, visible label text, and selected
  state on `lyte-drop-item` nodes while Zoho flips the page-level `deluge-theme`.
- A custom theme can preserve native behavior by acting as a managed alias of either `vs-dark` or
  `vs-light`: the extension presents the custom option, then delegates the real mode switch back to
  the matching native option.
- Because Zoho mutates dropdown DOM and selected-state attributes after interaction, custom options
  need lightweight reconciliation for injected nodes, visible labels, and checkmarks.
- The current visible Deluge editor is CodeMirror 5. Its live host carries
  `.CodeMirror-deluge-edit-task`; visible code lines render as `.CodeMirror-line` nodes and Zoho
  materializes editor-managed indentation as `.cm-tab` spans with `cm-text="\t"`.
- Indent-guide styling can stay native and width-safe by decorating those existing `.cm-tab` spans
  instead of estimating grid columns across the whole editor surface. The older public extension used
  the same `.cm-tab` idea globally; this codebase scopes it to the live Deluge CodeMirror host.
- A plain background on `.cm-tab` paints only the tab span's box, while Zoho's line rows include
  extra vertical padding; use a guide pseudo-element that bridges that padding when the rail must read
  as continuous instead of dashed.
- `#createfunctionpopdiv` still exists during live editing, but the visible CodeMirror host is not a
  descendant of it; keep using live inspection before scoping visual editor features to legacy mounts.
- Zoho can rewrite page-level state during setup, so one-time global flags are brittle for editor
  visuals. Reapply feature state when the live editor surface mounts instead.

## Known Open Questions

- Durable selectors for the current editor mount and settings trigger
- Whether editor-scoped `--dre-*` overrides are sufficient for all desired custom themes, or whether a
  small number of `--delg-*` variables are also needed for specific editor-owned surfaces
