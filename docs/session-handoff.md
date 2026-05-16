# Session Handoff

## Read First

1. `docs/product.md`
2. `docs/architecture.md`
3. `docs/development-workflow.md`
4. `docs/debugging-playbook.md`
5. `docs/testing.md`
6. This file

## Current Milestone

Developer workflow now supports self-reloading the unpacked extension during local iteration, on top
of the already-complete native custom-theme injection slice.

## Last Completed Task

Added a development-only extension reload command so local assistants can rebuild, trigger an extension
self-reload from the Zoho tab, reload the tab, and continue verification without routinely asking for
manual `chrome://extensions` interaction.

## Current Branch

`codex/dev-extension-reload`

## What Works

- Custom options are injected into Zoho's native theme dropdown without replacing the native UX.
- `VS Code Dark` delegates to native `vs-dark`; `VS Code Light` delegates to native `vs-light`.
- Custom selection persists, updates the visible dropdown label, and keeps the custom checkmark
  selected while Zoho still owns the underlying light/dark switch.
- The proof-theme CSS uses theme-local `--zcdt-theme-*` palette variables mapped onto Zoho's
  editor-facing `--dre-*` variables.
- Logged-in Chrome live-debug path is verified.
- Local unpacked development extension loads from `dist-dev`, the popup opens locally, and the content
  script marks
  the live editor with `document.documentElement.dataset.zcdtReady === "true"`.
- `npm run build:dev` creates a development build with the internal reload command.
- With a Zoho tab focused, `Alt+Shift+R` asks the extension to call `chrome.runtime.reload()`.
- Production builds from `npm run build` write to `dist` and omit both the dev-only command and
  background worker.

## Durable Workflow Knowledge

- Use the self-reload command only for local development iteration; it is infrastructure, not a product
  feature.
- Keep production and local-development artifacts separate: `npm run verify` writes `dist`, while
  `npm run build:dev` writes `dist-dev`.
- `chrome://extensions` may still need one manual reload if the extension is not installed yet or the
  loaded copy is too broken to receive the event.
- After reloading the extension, reload the Zoho tab before verifying changed behavior.

## Known Fragile Selectors

- Theme dropdown: `lyte-dropdown[data-zcqa="dxDroptheme"]`
- Editor settings button: `[data-zcqa="delgv2sbsettings_click"]`
- Native fallback anchor: `lyte-drop-item[data-value="vs-dark"]`

## Failed Approaches Worth Remembering

- Do **not** unconditionally rewrite selected-state attributes/classes inside the mutation observer
  reconciliation path. That creates a self-feeding mutation loop and can crash the tab.
- Reconciliation must only mutate when state is actually wrong, and it should keep the hover guard
  before moving `lyteDropdownSelection` away from Zoho's native alias option.
- Do not add reload controls to product-facing UI just to support local iteration.
- A page-event bridge is a poor primary trigger for logged-in Chrome verification because the Chrome
  automation surface exposes read-only page evaluation; use a command that automation can trigger
  with a key chord instead.
- Do not assume browser automation can operate `chrome://extensions`; use the dev command once the
  unpacked extension is healthy enough to receive it.

## Exact Next Task

Resume the next product feature branch from `main`, using the local self-reload flow when iterative
browser verification is needed.
