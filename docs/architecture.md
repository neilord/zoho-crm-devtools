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
- The build fails unless each CRXJS loader imports the chunk built from its own entry (a guard in
  `vite.config.ts`); entry files with the same basename once made the worker load content code.
- `npm run build:local` writes production code to `dist-local` with the pinned unpacked key, so a
  locally loaded copy keeps the id the account API allowlists (ADR 0012). A plain `dist` loaded
  unpacked gets a path-derived id whose API calls fail CORS. Never zip `dist-local`.
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

`src/background/worker.ts` registers the production MV3 worker. The development entry statically
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
`account.getEntitlement` helper and export controller perform that one follow-up automatically. Entitlement retains the backend's six required fields:
`plan: string`, `entitled: boolean`, `status: string`, `currentPeriodEnd: string|null`,
`cancelAtPeriodEnd: boolean`, `checkedAt: string`, plus optional `features: string[]` capability keys.
An invalid optional list (anything other than an array of non-empty strings) is treated as absent;
the six required fields remain strictly validated. No email, Stripe objects or tokens cross this
API. Treat `entitled && plan !== 'free'` as paid (ADR 0023); the server owns trial expiry, subscription grace,
and cancellation semantics. Scheduled cancellation can still be entitled. Accept any non-empty plan key, including future entitled paid keys; invalid
responses resolve to Free. Do not reconstruct entitlement from local dates or status strings.
For tiered features, `hasPlanFeature(entitlement: Entitlement, featureId: string): boolean` first
requires a resolved paid plan, then prefers a server `features` list (including `[]`), falls back
to a known plan's contract features, or grants only `exportFunctions`/`workflowSearch` for an unknown
paid key without a list (ADR 0025). The server resolves capabilities from its contract only when
entitled. Export and workflow search retain their existing any-paid gate independently of lists.
The worker router and persistent cache preserve the complete snapshot, as does the popup account
API. The popup's display-only view model projects plan/status without carrying capabilities;
feature checks use the original entitlement rather than this view.

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
`EXPORT_FUNCTIONS_GATE_ENFORCED = true` and `WORKFLOW_SEARCH_GATE_ENFORCED = true` control
the existing any-paid gates (ADRs 0019/0024). The beta `automationMap` feature uses
`AUTOMATION_MAP_GATE_ENFORCED = true` and the capability check: contract fallback allows only
Pro/Max. `isFeatureAvailable` accepts a resolved snapshot synchronously; existing free callers
need no network.

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
exported artifact (version 0.2.0); update it from that source, never hand-edit plan facts.
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

## 11. Workflow search data layer

`src/content/workflows` owns the normalized rule/condition/schedule/action graph, progressive
`WorkflowIndex`, related function identity joins and rule-identity-cached literal search documents with
match provenance. The frozen frontend contract is `types.ts`, `workflow-store.ts` and `search.ts`.
The dashboard and bootstrap render progressive snapshots without pre-filtering their rule arrays.
The store preserves unchanged rule identities and exposes nullable expected stage totals; the UI
uses those totals for coverage. Search retains only the latest query/scope match set per rule. The Zoho route/anchor observer and
native handoffs live under `src/content/zoho/workflows-page.ts`.

Shared CRM context, status retries/timeouts and an abort-aware request budget live under
`src/content/zoho`; Functions retains compatibility imports and Export reuses the transport/budget.
The workflow store checks paid entitlement before cache or API reads. `requestWorkflowSearchAccess`
opens a feature-configured upgrade modal, resolves on upgrade, and supports caller cancellation;
Export's existing event adapter remains the default. `workflowSearch` enforces the any-paid gate
without changing the global planned-feature switch. Development builds may set
`VITE_WORKFLOW_SEARCH_UNLOCK=true`; the compile-time development-mode guard (also used by billing diagnostics) ignores it in production.

Workflow snapshots use a separate validated worker-only local cache channel partitioned by origin
and org, with version/size/eviction bounds. Cache and CRM traffic never enter billing requests.
Coverage, retry and invalidation contracts and observed endpoints live in `zoho-integration.md`.

Workflow search snapshots use a dedicated origin/org-partitioned worker cache channel. The version-2
wire graph is gzip/base64 compressed before write messaging and local storage (ADR 0024). Existing
raw versions remain readable. Validation bounds decoded JSON at 32 MB, compressed entries at 3 MB,
and the worker bucket at three partitions / 6 MB total, evicting oldest partitions. This retains
the `storage`-only permission model; cache failures are advisory and dev builds log read/write
failures and byte counts without source contents.

## 12. Automation Map

> **Gated (ADR 0035):** while `AUTOMATION_MAP_COMING_SOON` (`src/features/automation-map-gate.ts`) is
> true, `open()` shows the waitlist popup (`automation-map/entry/waitlist.ts`) before `resolveUi()`,
> so the runtime below is never loaded. The description of the runtime applies when the switch is off.

### Runtime, graph and UI

`automation-map/bootstrap.ts` registers entries from the isolated-world content script. On first
open, `resolveUi()` dynamically imports `automation-map/runtime.ts`, which wires the store,
analyzer, graph builder, port, Shadow DOM shell and Board/Trace canvases. Dagre is a separate
lazy chunk for small trace subgraphs; the estate board uses deterministic module lanes,
semantic zoom, hub collapse and portals. CRXJS declares the generated chunks as web-accessible
resources; they execute from the extension origin. Ordinary pages do not load the map runtime.

`AutomationMapStore` takes CRM context, fetch, entitlement and an injected `buildGraph(inputs)`.
It composes `WorkflowIndex` with shared catalogue/source providers, adds the other configuration
adapters, and publishes progressive snapshots. `subscribe()` delivers immediately; `start()`
loads once, `refreshAccess()` invalidates the access generation, `retry(id?)` retries failures,
`refresh()` forces revalidation, and `dispose()` aborts/detaches. Awaited reads and publications
check generation, abort and origin/org. All CRM reads share the four-request tab pool. Local
Deluge analysis is serialized, yields after roughly eight milliseconds and reuses matching
identity, non-null revision and analyzer version. Graph rebuilds are limited to twice a second.
Endpoint shapes, joins and Zoho quirks live in [`zoho-integration.md`](zoho-integration.md).

`createStorePort()` implements the UI's `MapDataPort` plus `dispose()`. The UI consumes snapshot,
subscription, source lookup, search, field-lens/ranking queries, trace, Retry/Refresh, upgrade and
native handoffs through that port. Search-index rebuilding is debounced 75 ms on graph changes;
readiness notifies subscribers independently of graph identity. Source/editor lookup is restricted
to published function identities. Billing receives only fixed account/checkout actions, never CRM
context or data. The Pro upgrade modal checks `hasPlanFeature(..., 'automationMap')`, uses
contract-derived prices and Pro checkout, then refreshes access after eligible sign-in/recheck.

Fields, Board, List, Trace and inspector share view state. Board and List derive the same visible
identities from scope, module, kind, trigger and flag filters; search intersects that set. The
inspector follows selection and closes when it leaves the visible graph or the lens pivots.
Show on map retains its target until loading supplies it, frames it once, and widens to
Everything once for an inactive rule unless user navigation has superseded the landing.

### Coverage and counts

`coverage.gaps` is the store-owned total of unique failed dependencies plus catalogue functions
whose analysis is not analyzed (pending counts once settled). Shared dependency failures count
once. `gapsProvisional` stays true until discovery/analysis settles; the UI announces readiness
only after completion, outside refresh, using the settled gap number. Category loaded, failed
and unsupported totals count dependency reads, including empty successes, rather than item counts.

`fieldWriters` maps action effects to their selectable owner rule/transition/approval through
`FieldLens.writerEntityIds`. `lensCounts(lens, scope?)` returns `total`, `groups` and
`entityGroups`, assigning each entity once to its strongest group: declared, exact, partial,
unknown fields, unresolved module. All evidence edges remain available. `fieldWriterCount` and
`mostWrittenFields` use the same definition. Target-module filters retain cross-module writers;
record-only mutations appear in `otherRecordChanges`, never field-writer totals.

`coverage.modules` and teaser `totals.modules` count module metadata plus modules named by listed
rules. Graph islands can additionally reflect source/action targets; they do not establish extra
configured modules. `quietModules` aggregates inventory modules without list-visible automation.
Per-island function memberships can overlap and must not be summed as catalogue totals.

### Persistence and freshness

Only the background worker opens extension-origin IndexedDB `zcdt-automation-map-v1`. The exact
`automationMap:readCache` / `automationMap:writeCache` messages validate own-extension senders,
supported HTTPS CRM origins, numeric orgs and versioned payloads. Content code compresses through
the shared gzip/base64 codec before messaging. Bounds are 24 MB decoded and 3 MB encoded per
partition, three origin/org partitions and 9 MB encoded total, evicting the oldest saved partition.
Sources/effects are stored once per function; hydration re-normalizes action/trigger unions.
Storage failures are advisory. The independent workflow cache remains unchanged.

A full revalidation pass establishes **15-minute freshness when it settles, including failures**
(ADR 0032 supersedes this part of 0029). Fresh automatic opens make zero CRM requests. Expired
partitions, missing/invalid freshness metadata, future timestamps, analyzer-version changes and
explicit Refresh require revalidation; cached presence stays visible while refreshing. Failed
reads retain cached data and retryable identities/category outcomes. Reopening and targeted Retry
do not advance full-pass freshness; hydrated Retry reconstructs only failed dependency jobs from persisted identities and bounded
parent metadata. Per-dependency outcomes preserve category coverage across targeted retries. A
failed source refresh never certifies its new revision. `coverage.lastRevalidatedAt` supplies the
UI's Updated age; gaps remain visible even while fresh.

### Teaser boundary

Full cache/API access requires the `automationMap` capability. The separate teaser loader reads
only catalogue, rule and module lists plus one representative active rule chain: one rule detail,
at most two action resources and one exactly joined function source. It never reads fields,
buttons, schedules, blueprints, approvals, templates or either cache. Selection policy and endpoint
contracts live in `zoho-integration.md`; rationale lives in ADRs 0026/0028.

The published preview graph contains only the revealed flow and explicit catalogue projections.
Fog contains numeric counts and opaque slots, never hidden identities, labels or code; omitted
siblings count on the revealed module rather than becoming another fog island. Every selection,
hover, field, module, trace root and serialized hash is checked against the revealed graph on
initialization, state changes and graph replacement. Explicit entry options have no exemption.

### Entries, history and lifecycle

Settings home/nav open Fields; the Workflow Rules toolbar opens the Board overview (no selected
native-module hook is verified); dashboard Show on map supplies rule/module context. Canonical
`#zcdt-map=` links auto-open with decoded state. Selector and native marker contracts live only in
`zoho-integration.md`. NEW expires after UTC `2027-01-31`, without dismissal storage (ADR 0028).

The map owns one marked history entry. Opening pushes it (or adopts a matching existing entry);
state changes replace its hash with a 300 ms debounce bounded to one second. Copy link flushes
immediately and encodes validated state even if the history write fails. Until access resolves,
only view is written; teaser hashes retain only permitted state. Incoming hash edits/history
navigation apply decoded state. Back to a non-map hash closes in place; UI close pops only an
owned top entry, otherwise removes the hash by replacement. Writes stop after route departure.
The controller remembers the hash left by closing so the resulting pop cannot reopen it.
Detailed ownership rules and rationale live in ADR 0031.

There is one store/port/overlay per tab, including concurrent open requests. Opening closes
existing function/workflow search overlays and upgrade dialogs. Close, org/origin departure,
extension disable or controller disposal tears down the map. Route polling and adapter observers
repair native entry replacements. Development-only `VITE_AUTOMATION_MAP_UNLOCK=true` and
`VITE_AUTOMATION_MAP_FORCE_TEASER=true` select acceptance modes (force teaser wins); production
ignores both. Packaged and real-site acceptance procedures live in [`testing.md`](testing.md).
