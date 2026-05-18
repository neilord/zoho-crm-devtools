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
- Live theme auditing shows two styling paths inside the editor:
  - many editor surfaces and syntax colors respond to `--dre-*` / `--delg-*` variables
  - some surfaces, such as parts of the revision-history UI, are painted by compiled selector rules
    instead of a reusable variable layer
- The theme-polish work therefore needs both a low-level variable inventory and a small shared
  selector-override compatibility layer for surfaces Zoho does not expose through variables.

### Confirmed theme-surface inventory

The current custom-theme implementation keeps the palette in `src/themes/themes.css`, maps supported
Zoho variables in `src/themes/zoho-theme-mapping.css`, and keeps selector-only compatibility rules in
`src/themes/zoho-theme-overrides.css`.

| Surface family | Confirmed path | Notes |
| --- | --- | --- |
| editor canvas, gutters, syntax, active line, selection | `--dre-editor-*` | Native variable layer is reliable. |
| top bar, side rail, right rail, details pane, generic shell colors | `--delg-*` | Includes `--delg-topbar*`, `--delg-sidebar*`, `--delg-rightbar*`, `--delg-info*`, and `--delg-active*`. |
| left task pane, bottom bar, show/hide tooltip | `--dre-leftpane-*`, `--dre-bottombar-*` | The selected rail state is variable-driven through `--delg-activebg` / `--delg-activeborder`, not selector-only. |
| hints/autocomplete list, diff/merge surfaces, expression builder | `--dre-editor-hint-*`, `--dre-codemirror-merge-*`, `--dre-expr-builder-*` | Native variables cover the main surfaces well. |
| autocomplete documentation tooltip text | shared selector override | Zoho first uses the hint variables, then a later compiled rule hardcodes `.CodeMirror-Tern-hint-doc { color: #444; }`. |
| autocomplete divider, inline gutter edit button, inner editor status bar | shared selector override | `.hint-divider`, `.deluge-gutter-edit-btn`, and `.clientscript_status_bar` are small interaction surfaces that bypass the useful variable layer. |
| revision/history shell | shared selector override | `.csRH*`, `.dxe_widget_sidebar`, and `.dxe_version_history_container*` are compiled with hardcoded colors. |
| settings modal, editor toolbar selected state, some editor dropdown/input shells, console fragments | shared selector override | These use compiled rules such as `.ceEditorSettingModal*`, `.ceToolbar*`, `.ceInfoZDK*`, and `.csconsole*`. |

When a new untouched island appears, first inspect whether it already resolves through a low-level
Zoho variable. Only add a selector fallback after confirming that the compiled rule bypasses the
usable variable layer.

## Known Open Questions

- Durable selectors for the current editor mount and settings trigger
- Which less common editor-owned overlays outside the current audit states still bypass variables,
  especially rare error and helper popovers
