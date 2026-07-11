# Architecture

Reference for the system's shape. Product scope belongs in [`product.md`](product.md), durable
choices in [`decisions/`](decisions/), and current work in [`STATE.md`](STATE.md).

## 1. What this system is

Zoho CRM DevTools is a Chrome Manifest V3 extension that improves Zoho CRM's Deluge editor and
functions page without replacing the native editing experience or sending CRM data to a project
backend.

## 2. Principles

- Prefer native Zoho behavior over recreating Zoho controls.
- Keep all fragile Zoho selectors behind a dedicated adapter layer.
- Keep browser APIs isolated so later browser portability is cheaper.
- Make settings typed, validated, and migration-ready from the start.

## 3. Component map

- `src/content/zoho`: selectors and DOM adapters for Zoho CRM
- `src/content/editor`: editor lifecycle and injected integrations
- `src/settings`: setting schema, defaults, storage, and migrations
- `src/themes`: theme metadata, theme-local palette variables, and the shared Zoho variable mapping
- `src/syntax`: syntax-enhancement styles and toggles
- `src/features`: stable feature registry and release metadata
- `src/internal`: development-only infrastructure that is not part of the product feature surface
- `src/shared`: browser and utility abstractions
- `src/popup`: minimal extension popup
- `public/zcdt-function-edit-bridge.js`: main-world bridge for calling Zoho's page-owned editor
  globals from the isolated extension world

The production content script coordinates these modules from `src/content/index.ts`. Development
helpers under `src/internal` are compiled only for development mode and are not product features.

## 4. Data and ownership

- User preferences are typed by `src/settings/schema.ts` and persisted through Chrome extension
  storage. There is no project database or backend.
- Zoho CRM remains the source of truth for Deluge functions. Cross-function search reads Zoho's
  same-origin internal endpoints but does not persist function content.
- `src/features/registry.ts` owns stable feature identifiers and tier metadata.

## 5. Integration rules

- Keep theme palettes separate from the shared Zoho mapping layer so Zoho variable changes are handled
  once instead of copied into every theme.
- When Zoho does not expose a useful variable for a themeable surface, keep selector-based fallback
  overrides in one shared Zoho compatibility layer that consumes the same `--zcdt-theme-*` palette
  variables instead of duplicating selector rules in every theme file.

## 6. Data flow

1. Popup or native Zoho controls update typed settings.
2. Settings are persisted through the storage adapter.
3. Content scripts observe editor availability and react to setting changes.
4. Theme and editor modules update the live page through the Zoho adapter layer.

Cross-function search follows a separate read-only flow: the content script derives same-origin
request context, fetches function summaries/details from Zoho, renders an extension-owned overlay,
and uses the main-world bridge only when handing a selected function back to Zoho's editor.

## 7. Build and development infrastructure

- Vite and CRXJS build production output to `dist`; `npm run zip` packages that directory for a
  manual Chrome Web Store release. Release mechanics live in [`conventions.md`](conventions.md) §4.
- `npm run build:dev` writes a separate unpacked build to `dist-dev`. It adds a background worker,
  a hidden self-reload control (`[data-zcdt-dev-reload-extension]`), and a CSS experimentation
  bridge. Production builds omit all three.
- After rebuilding `dist-dev`, trigger the hidden reload control in the Zoho tab, then reload the
  tab before checking behavior. `chrome://extensions` may require one manual reload when the
  unpacked copy is first installed or too broken to receive the event.
- The CSS bridge accepts CSS and a style name through hidden `data-zcdt-dev-css-*` controls. It
  injects CSS only, never arbitrary JavaScript, and adds no extension permissions.

The controls are intentionally hidden automation surfaces. Trigger reload with
`document.querySelector('[data-zcdt-dev-reload-extension]')?.click()`. For CSS experiments, fill
`[data-zcdt-dev-css-input]` and `[data-zcdt-dev-css-name]`, then click
`[data-zcdt-dev-insert-css]`; use `[data-zcdt-dev-clear-css]` to remove the named style.

## 8. External contracts

- Manifest permissions are limited to Chrome storage and content-script access on supported Zoho
  CRM/Portal domains. Permission and data-flow changes are product/privacy changes.
- Zoho DOM selectors, internal endpoints, cookies, and page globals are undocumented external
  contracts. Their observed shapes and known fragility live in
  [`zoho-integration.md`](zoho-integration.md).
- The extension communicates across the isolated/main-world boundary with a namespaced
  `window.postMessage` contract and a manifest-declared web-accessible bridge.
