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
- `src/content/promo`: the one-time Zoho CRM AI Assistant promo card and its show/snooze policy
- `src/settings`: setting schema, defaults, storage, and migrations
- `src/themes`: theme metadata, theme-local palette variables, and the shared Zoho variable mapping
- `src/syntax`: syntax-enhancement styles and toggles
- `src/features`: stable feature registry, release metadata, and pure function-export serializers
- `src/background`: production account message router and sole API client owner
- `src/billing`: OAuth, entitlement, public-safe contract artifact, and session lifecycle
- `src/popup/account`: thin account API and replaceable render hook
- `src/internal`: development-only infrastructure that is not part of the product feature surface
- `src/shared`: browser and utility abstractions
- `src/popup`: minimal extension popup
- `public/zcdt-function-edit-bridge.js`: main-world bridge for calling Zoho's page-owned editor
  globals from the isolated extension world

The production content script coordinates these modules from `src/content/index.ts`. Development
helpers under `src/internal` are compiled only for development mode and are not product features.

## 4. Data and ownership

- User preferences are typed by `src/settings/schema.ts` and persisted through Chrome extension
  storage. Optional accounts and billing live in a separate private service. The promo card keeps its own `promoAiAssistant`
  sync-storage record, separate from `settings`, so a settings reset does not resurrect it.
- Zoho CRM remains the source of truth for Deluge functions. Cross-function search reads Zoho's
  same-origin internal endpoints and keeps a per-org warm function cache in local extension storage.
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

Chrome 116 is the minimum supported browser (ADR 0020), including long-running interactive
OAuth and export abort-signal composition. Refresh is on demand; no scheduler or alarms permission.

- Vite and CRXJS build production output to `dist`; `npm run zip` packages that directory for a
  manual Chrome Web Store release. Release mechanics live in [`conventions.md`](conventions.md) §4.
- `npm run build:dev` writes a separate unpacked build to `dist-dev`. It retains the production background worker and adds dev reload handling,
  a hidden self-reload control (`[data-zcdt-dev-reload-extension]`), and a CSS experimentation
  bridge. Production builds omit the development handler and both hidden controls.
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

- Manifest permissions are `storage` only, with content scripts on supported Zoho
  CRM/Portal domains and no required or optional API host permissions. Permission and data-flow changes are product/privacy changes.
- Zoho DOM selectors, internal endpoints, cookies, and page globals are undocumented external
  contracts. Their observed shapes and known fragility live in
  [`zoho-integration.md`](zoho-integration.md).
- The extension communicates across the isolated/main-world boundary with a namespaced
  `window.postMessage` contract and a manifest-declared web-accessible bridge.

## 9. Optional accounts and entitlement (Stage 1)

`src/background/index.ts` registers the production MV3 worker. The development entry statically
imports this worker alongside the reload listener; no dynamic imports run in the service worker. Popup and content scripts call
`billingMessage(type)` from `src/shared/browser.ts`. Chrome supplies the sender id; the router
accepts only its own extension contexts and exact one-field `{ type }` envelopes, never URLs,
headers, tokens, or arbitrary fetch options. There is no external-message listener.

| Message type | Success value |
| --- | --- |
| `billing:getEntitlement` | `{ signedIn, entitlement }` |
| `billing:signIn` | Same snapshot after interactive OAuth |
| `billing:signOut` | `null` after local clear and best-effort revoke |
| `billing:openUpgrade` | `null`; opens website `/pricing` |
| `billing:openAccount` | `null`; opens website `/app/account` |
| `billing:getNotice` | `{ pending }` |
| `billing:dismissNotice` | `null`; persists explicit dismissal |

Responses are `{ ok: true, value }` or `{ ok: false, error }`; the typed helper unwraps success
and throws a sanitized error. An optional `signedOutPending: true` on account snapshots means
Free/checking sign-in; call `getEntitlement` once more to finish the storage recovery. The popup
`account.getEntitlement` helper and export controller perform that one follow-up automatically. Entitlement is the backend's exact six-field snapshot:
`plan: string`, `entitled: boolean`, `status: string`, `currentPeriodEnd: string|null`,
`cancelAtPeriodEnd: boolean`, `checkedAt: string`. No email, Stripe objects or tokens cross this
API. Treat `entitled && plan !== 'free'` as paid (ADR 0023); the server owns trial expiry, subscription grace,
and cancellation semantics. Scheduled cancellation can still be entitled. Accept any non-empty plan key, including future entitled paid keys; invalid
responses resolve to Free. Do not reconstruct entitlement from local dates or status strings.

`billingPendingSignIn` in trusted `storage.session` holds state, verifier, exact redirect, auth-tab
and opener ids, and a ten-minute expiry across worker restarts. Repeated clicks focus/reuse the
pending tab. The UI polls short `billing:signInStatus` messages while sign-in is pending, so worker restarts do not break a ten-minute message port. Tab closure/expiry resolves callers with `cancelled: true`; provider and exchange failures return
`failed: true`, with distinct popup/modal copy. Native worker fetch is bound to its global receiver;
dev builds log only credential-free stage/error categories. Expired state is also
removed on the next worker event after suspension. A callback consumes the pending state before
exchange so duplicates cannot replay it. Successful completion focuses the opener, displays a short
confirmation, then closes the callback tab. The callback page is web-accessible only to the two
first-party HTTPS origins, with `use_dynamic_url: false` because the provider requires a stable URL.
No tabs, identity, alarms or API host permission is needed (ADR 0021).

Sign-in generates random state and a 43-character verifier, derives S256, and calls
a normal adjacent browser tab with `src/billing/oauth-callback.html` as its exact extension redirect. The worker validates its own callback page sender and pending tab, redirect, state,
error and issuer (`API_BASE + /v1/auth`) before a form-urlencoded code exchange. Every API call
omits credentials, rejects redirects, times out after five seconds, and has a fixed endpoint. The billing client never
receives Zoho request context, source code, records, cookies or page data. A separate local-only
worker cache channel holds existing search snapshots; it makes no network requests. Existing function-search
requests remain same-origin Zoho traffic; they do not flow into this account client.

`billingSession` in `chrome.storage.local` holds the opaque pair and expiry, a refresh-in-progress
journal, and a five-minute entitlement cache. Local storage is restricted with
`TRUSTED_CONTEXTS` before account operations; content scripts cannot read it. Account operations
serialize in the worker and entitlement callers share one in-memory promise. Refresh reuse invalidates all authorizations for the user+client across devices (ADR 0018).
An ambiguous rotation reports `{ signedIn: false, signedOutPending: true, entitlement: FREE }`.
The next read rechecks storage once: validate a different committed pair through an entitlement
call, or clear and sign out; never replay the old refresh. A restart with an interrupted journal
uses the same recovery. HTTP 400 `invalid_grant` clears immediately. Disconnect clears the entire session/cache before best-effort
revoke. A signed-out, offline, timed-out or failed entitlement read returns Free. Settings and
free-feature initialization have no dependency on these requests.

`PREMIUM_GATE_ENABLED = false` retains the Stage 1 default for other planned premium features.
For the new `exportFunctions` feature only, `EXPORT_FUNCTIONS_GATE_ENFORCED = true` controls
the default gate (ADR 0019, refining ADR 0015). `isFeatureAvailable` accepts a resolved snapshot
synchronously; existing free callers need no network.

`src/popup/account` exports the account methods and `mountAccount(root)`. Its account/plan card
renders loading, signed-out, Free, trial, actual paid plan name, scheduled cancellation, payment attention and error
states, with server-resolved entitlement and contract-derived price/trial copy. It renders a disclosure hook
`[data-billing-notice]`, pending until explicitly dismissed. Separate `billingNotice2026` local
state follows the promo card's independent persistence pattern so account/settings resets do
not resurrect it. This is one notice per browser profile, shown on popup opens until dismissal;
it sends no acknowledgement or telemetry to the service. Visual acceptance and existing-user visibility remain release checks.

Build constants `VITE_BILLING_API_BASE` and `VITE_BILLING_WEBSITE_BASE` default to
`https://api.devtools.zsetup.com` and `https://devtools.zsetup.com`. Local development may set
`http://localhost:3000` and `http://localhost:3001`; these are compile-time values, never message
parameters. `src/billing/product-contract.json` is copied unchanged from the cloud repository's
exported artifact (version 0.1.0); update it from that source, never hand-edit plan facts.
The dev-only manifest public key pins id `lkgcneekmlnpcjcfeieehpokgmefpdde`; allowlist it in the
API's `EXTENSION_DEV_IDS`. Production emits no key. The published id remains
`mjcppmfgjpllmmoneiaegecjlcpbfgmi`.

### Search cache isolation

The existing persisted search cache uses `zcdt-function-cache:<numeric-org-id>` local keys.
Because content scripts cannot read trusted local storage, `functionCacheStorage` in the browser
adapter sends `{ type: 'functions:readCache', orgId }` or
`{ type: 'functions:writeCache', orgId, value: { version: 1, records } }`. The separate worker
listener accepts only own-extension senders, exact message fields and numeric org ids; it can
address only those cache keys, never `billingSession` or arbitrary storage. Read returns a cache
or null, write returns null, in the same ok/value envelope. This channel is local-only and has no
connection to the billing API. Settings and free search do not wait for entitlement.

## 10. Export functions and frontend handoff

`src/features/function-export.ts` is a pure module. `serializeFunctionExport(records, format,
{ orgId, exportedAt }, skipped)` returns `{ filename, mediaType, content }`. Formats are `json`, `csv`,
`markdown`. JSON schema version 1 stores the metadata and exact summary/detail objects returned
by the shared API helpers (including unknown fields and Deluge code), plus a top-level `skipped`
array of `{ id, name, apiName, reason }`. CSV uses UTF-8 BOM, quoted
cells, CRLF rows, common metadata fields, full `metadata_json`, `code`, and `error`; skipped functions have identity/error rows; potentially executable
spreadsheet cells are prefixed with an apostrophe. Use JSON for exact source fidelity. Markdown is
one combined `.md` file with escaped headings, JSON metadata, adaptively fenced Deluge source,
and a "Not exported" section for skipped functions.
No ZIP dependency or extra permission is needed.

`runFunctionExport(context, format, deps, signal)` checks account entitlement first and completes
one pending stored-pair recovery read if needed. Missing/failed/signed-out entitlement is Free.
Only then does `loadExportFunctions` reuse search's list/detail helpers, with a fresh paginated
list (unique numeric ids; repeated pages fail), fresh source details with explicit matching ids, up to four parallel requests, and a 15-second per-request timeout.
There is no function-cache read/write on the export path. HTTP 429/5xx responses get up to three
retries inside the same pool slot, with exponential backoff (500ms base) plus up to 250ms jitter,
and Retry-After seconds/date as a minimum wait. After retries, unreadable/missing/ambiguous details
are skipped with sanitized reasons. The loader returns `{ records, skipped }` in list order;
progress counts settled functions, including skipped ones. List failure/malformed lists or zero
readable details abort without a download. Partial exports explicitly list every skipped identity
in all formats (ADR 0022). An org/location change, explicit unmount or
cancellation prevents downloading. Zoho requests remain same-origin; billing gets no context,
source or metadata. The local browser adapter downloads a Blob and revokes its temporary URL.

### Mount points

The Functions bootstrap mounts `#zcdt-function-export[data-zcdt-function-export]` immediately
after Search All Functions in both Zoho toolbar layouts, including the Create Function fallback.
The format menu opens below its trigger with viewport-clamped fixed positioning because Zoho's toolbar clips overflow. Progress, result and error feedback use a separate 320px fixed-position white popover below the
trigger, with wrapped text and a separate action row. The Export button retains its label/size.
Errors stay until dismissed; success (including explicit partial counts) dismisses after six seconds.
The status follows scroll/resize and stays viewport-clamped. It has a neutral “Export functions” tooltip and no plan
badge; the existing entitlement gate and upgrade modal explain paid plans after interaction. It mounts
only on the enabled Functions route and removes/cancels on departure.
`mountFunctionExport(root)` returns a disposer for controls, modal and listeners.

| Selector | Hook |
| --- | --- |
| `[data-zcdt-export-format]` | Format menu items, with value `json`, `csv`, or `markdown` |
| `[data-zcdt-export-run]` | Export menu trigger, disabled during export |
| `[data-zcdt-export-status]` | Live progress, completion/filename, or sanitized error with retry |
| `[data-zcdt-upgrade-modal]` | Body-mounted backdrop containing a labelled modal dialog |
| `[data-zcdt-upgrade-action="sign-in"]` | OAuth sign-in; resumes the requested format when entitled |
| `[data-zcdt-upgrade-action="plans"]` | Opens plans, then offers an explicit entitlement recheck |
| `[data-zcdt-upgrade-action="account"]` | Opens account management |
| `[data-zcdt-upgrade-action="close"]` | Dismisses and restores focus |

The format menu handles arrows, Escape, Tab and outside clicks. The upgrade modal distinguishes
checking, signed-out, signing-in, unavailable, Free and awaiting-checkout states. It traps keyboard focus and
supports Escape, close button and backdrop dismissal. Closing/unmounting invalidates pending UI
work so a later sign-in result cannot resume a dismissed export. Trial/price copy comes from the
shared contract; entitlement remains server-resolved. A plan recheck uses the normal five-minute
cache, which the awaiting-checkout message explains.

### Events (content-script DOM hooks, no credentials/source)

- Dispatch `functions:exportRequested` **on the export root**, with `detail: { format }`, to request
  export. The format menu and retry controls use this same path. Invalid formats and duplicate requests
  while busy are ignored. Billing and route checks still run for every attempt.
- Root emits bubbling `functions:exportState` with a discriminated `detail` (`ExportState` in
  `export-controller.ts`): `{ status: 'checking-entitlement', format }`,
  `{ status: 'loading', format, loaded, total }`,
  `{ status: 'complete', format, count, total, skipped, filename }`, `{ status: 'upgrade-required', format }`, or
  `{ status: 'error', format, message }`. The root mirrors `status` in `data-export-state` and sets
  `aria-busy="true|false"`. Before the first request the state is `idle`. No records/code in events.
- A blocked attempt emits bubbling `billing:upgradeRequired` with exactly
  `{ featureId: 'exportFunctions', reason: 'paid-required' }`. `mountUpgradeHook(host)` listens at
  `document`, opens the upgrade modal and returns a disposer. An entitled sign-in/recheck closes
  the dialog and resumes the requested export. `billing:accountChanged` bubbles from the root
  after account changes so its plan state refreshes.

These DOM hooks are UX APIs, not authentication boundaries: page code can dispatch DOM events.
Every actual export rechecks entitlement and never accepts tokens, arbitrary URLs, org ids or
source records from an event. Existing popup `account` and disclosure hooks remain unchanged.
