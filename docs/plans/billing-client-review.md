# PR draft — Optional accounts and premium function export

Adds optional OAuth sign-in and server-resolved entitlement, plus a new premium Export functions
capability. Existing editor/search tools remain free without an account. Export checks Pro/current
trial entitlement before fetching fresh Zoho function data, then downloads JSON, CSV or one combined
Markdown document locally. No function data goes to the account service. The new export gate is
enforced by `EXPORT_FUNCTIONS_GATE_ENFORCED = true`; other planned gates retain Stage 1 defaults.

## Frontend integration

Use `account` from `src/popup/account`, or `billingMessage(type)` from `src/shared/browser`:

- `billing:getEntitlement` and `billing:signIn` return `{ signedIn, entitlement }`, optionally
  `signedOutPending: true` after uncertain rotation. Call getEntitlement once more to finish its
  stored-pair recovery. The popup account helper and export controller do this automatically.
  Treat pending as signed out/Free.
- `billing:signOut`, `billing:openUpgrade`, `billing:openAccount` return `null`.
- `billing:getNotice` returns `{ pending }`; `billing:dismissNotice` persists dismissal and returns
  `null`. Keep the disclosure visible on popup opens until explicit dismissal.

Wire envelope is exactly `{ type }`. Responses are `{ ok: true, value }` or
`{ ok: false, error }`; the helper unwraps/throws. Never include tokens, Zoho data or request options in billing messages. The dedicated callback message sends its URL only from the validated own extension callback page. Entitlement has exactly the six backend DTO fields. The separate
local-only functions cache channel preserves existing warm search despite trusted token storage.

The combined candidate is on `feat/billing-frontend`, built from popup commits through `0d8b03f`
and content UI `79a5142`. Popup provides account/plan states and the persistent disclosure. The
Functions page provides a toolbar export menu immediately after Search All Functions, progress/completion/retry feedback, and
a modal with signed-out, Free, sign-in and checkout states. Successful entitled sign-in/recheck
resumes the requested format; dismissal prevents later automatic resumption. Prices/trial copy
come from the shared contract; checkout rechecks respect the five-minute entitlement cache.

Export DOM hooks and control lifecycle are documented in `docs/architecture.md` §10. The
`functions:exportRequested`, `functions:exportState` and `billing:upgradeRequired` contracts remain
compatible; `billing:accountChanged` refreshes the control's resolved plan state. No tokens or function data
enter DOM events or billing messages.

## Validation and contract findings

- Plumbing passed `npm run verify` with 174 tests before export work began. Final export gate
  passes Biome, TypeScript, 209 Vitest tests, and the production build.
  Five pre-existing Biome warnings remain in the unchanged public main-world bridge.
- Development build inspected separately: static development entry imports the account worker and
  dev reload listener. Production omits dev controls and reload handling.
- Main production manifest: `permissions: ["storage"]`; no `host_permissions`,
  `optional_host_permissions`, `background`, or `key`.
- Branch production manifest: `permissions: ["storage"]`;
  `background: { "service_worker": "service-worker-loader.js", "type": "module" }`.
  Host/optional host permissions and key remain absent; CRM matches unchanged. Export needs no
  downloads permission, uses a Blob link and revokes its temporary URL.
- Dev key yields `lkgcneekmlnpcjcfeieehpokgmefpdde`; configure API `EXTENSION_DEV_IDS` before
  acceptance. Published id remains `mjcppmfgjpllmmoneiaegecjlcpbfgmi`.
- Backend audit verified that refresh reuse returns 400 invalid_grant and revokes all authorizations
  for the user+client across devices, plus access tokens. The worker serializes rotation, persists
  replacements before releasing callers, and never replays an uncertain refresh. Ambiguous failure
  reports Free/pending; one readback may recover a committed replacement, otherwise sign out.
- Signed continuation may replay for 600 seconds. Exact redirect and PKCE bind the authorization;
  each sign-in attempt gets fresh state/verifier scoped only to that attempt.
- Entitlement is the six-field DTO, not a billing envelope; the server owns trial, expiry and grace.
  There is no email field. Shared public contract artifact 0.1.0 is regenerated with the extension callback URI and copied, with no
  private dependencies/server code/credentials in this public repository.
- JSON retains exact metadata/source; CSV adds spreadsheet-safe apostrophes to dangerous cells;
  Markdown fences source safely. Partial downloads explicitly list unreadable functions; failed lists, zero readable sources or navigation prevent download (ADR 0022).

## Remaining acceptance / release work

Frontend implementation is integrated; combined automated verification passes with 243 tests.
Browser security policy blocked Chrome extensions-page access, so candidate loading and all
visual/live acceptance remain pending. Load `dist-dev` from the combined worktree manually.
Conductor: signed-out free Zoho regression, export through actual
Zoho endpoints for both toolbar variants, downloads in all three formats, Pro/trial/Free gate,
OAuth/refresh/revoke/CORS for published and pinned dev ids, Extension Update Testing Tool.
Store operator: authentication/account-data declarations, in-app purchases and preinstall paid
export disclosure, reviewer account/instructions, terms/refund/seller details.
No live Zoho checks run by this implementer, per task scope.

Version remains 2.3.0 with an unreleased 2.4.0 changelog entry. Prepare both version bumps in a
separate `chore(release): prepare 2.4.0` commit once accepted. No merge, push or publication.
Fold/delete this draft after copying into the eventual PR and recording acceptance in STATE.

## Critical review and fix pass — 2026-10-20

Reviewed `git diff main...HEAD`, ADRs 0007 and 0009–0019, the backend architecture,
`apps/api/openapi.json`, and the exported public product contract (byte-identical to the client).
The supplied backend hardening does not change the client wire contract. The backend checkout's
architecture CORS prose is older than the observed deployment: live OPTIONS responses confirmed
non-credentialed CORS only on the extension API paths for both allowlisted extension ids.

| Severity | Location (after fixes) | Finding and disposition |
| --- | --- | --- |
| High | `src/billing/client.ts:64`, `src/content/functions/api.ts:49` | Default redirect following could forward an OAuth token form on 307/308 or send Zoho headers to an unexpected destination. Fixed with `redirect: 'error'`. |
| Medium | `src/content/functions/api.ts:89`, `src/content/functions/export-loader.ts:37` | Repeated full pages could loop indefinitely; silent duplicate normalization could hide an unstable export list. Fixed with progress checks and strict export id/duplicate validation. Search retains normal deduplication and short-page behavior. |
| Medium | `src/content/functions/api.ts:122` | The shared search detail helper synthesized a missing id and ignored additional records. Export could label an ambiguous source as the requested function. Fixed with explicit single-record/matching-id validation for export, retaining legacy search behavior. |
| Medium | `src/billing/client.ts:88` | Token responses did not validate granted scopes. Fixed by requiring both contract scopes before persisting credentials. |
| Medium | `manifest.config.ts:43` | No minimum browser version despite long-running worker OAuth and AbortSignal composition requirements. Fixed with Chrome 116 minimum; ADR 0020 records the compatibility tradeoff. |
| Medium | `src/features/function-export.ts:25` | Markdown fence calculation spread every backtick run into Math.max, causing stack overflow for large sources. Fixed with incremental scanning; 150,000-run regression passes. |
| Medium | `src/popup/account/model.ts:39`, `src/content/billing/upgrade-hook.ts` | Failed entitlement checks appeared as confirmed Free with an upsell; expired grace with status active appeared as ordinary Free. Fixed unavailable and payment-attention states; notice no longer implies sign-in alone grants Pro. |
| Low | `src/content/functions/api.ts:23`, `src/content/functions/types.ts` | Function ids were interpolated as paths; non-string script fields could mask valid workflow source. Fixed path-component encoding/dot-segment rejection and explicit string-source selection. |
| Release gate | `docs/STATE.md`, `docs/plans/billing-client-review.md` | Candidate installation, live OAuth/refresh/revoke, authenticated Zoho export/visual regression (both toolbars), notice visibility and Extension Update Testing Tool remain unverified. Browser policy rejected chrome://extensions access; no workaround attempted. Not fixed by unit tests. |

Security review found no token-bearing content-script messages/logs, arbitrary worker fetch proxy,
untrusted HTML insertion, or unsafe export filenames. Sender id and exact message validation are
covered. State/verifier are fresh per attempt and scoped to one authorization; exact issuer,
redirect origin/path, state, duplicate params and error validation precede exchange. Token/cache
storage is restricted to trusted contexts before account access. Restart-journal, ambiguous-write
recovery, concurrent rotation, persistence-before-release, and disconnect serialization tests pass.
Refresh is on demand; no worker timer or alarms permission is necessary. The backend's grant
generation is server-owned and requires no new client parameter; 401 and invalid_grant clear locally.

Export remains fresh, read-only, four details at a time, with 15-second request/body cancellation.
HTTP 429/5xx gets three bounded retries with exponential backoff, jitter and Retry-After support.
Persistent unreadable details are listed in JSON/CSV/Markdown alongside successful functions;
failed/malformed lists or zero readable sources prevent download. A 201-function
fixture crosses pagination and verifies the concurrency ceiling. CSV formula protection, quoted
Unicode/multiline cells, escaped Markdown headings/fences, numeric-org filenames and JSON source
fidelity pass. Export memory remains proportional to total metadata/source plus serialized output;
it is an in-memory download, not streaming or a transactionally consistent Zoho snapshot. Real
large-org performance and changes made during pagination remain live acceptance limitations.

`PRIVACY.md` now enumerates all fetches: Zoho list/detail and worker token/entitlement/revoke,
including cookies/headers/forms; authorize and website/Store navigation are identified separately.
No other production network transport or remote executable code was found. Contract copy is
$23/month and 14 days without a card; no import/restore/GitHub capability is advertised as shipped.
The disclosure is first in the popup and persists until explicit dismissal; visibility to users who
never open the popup and Chrome Web Store declarations/reviewer instructions remain release gates.

Final automated gate: `npm run verify` passes **257 tests in 26 files**, TypeScript, Biome
(with five existing bridge warnings), and production Vite build. `npm run zip` invokes another
`npm run build`; ZIP integrity passes (27 entries, 151,688 bytes). Manifest permissions are exactly
`["storage"]`, background is `{ "service_worker": "service-worker-loader.js", "type": "module" }`,
minimum Chrome is 116, host/optional host permissions and key are absent, content-script matches
are identical to main, and executable production assets contain no development controls.
ZIP SHA-256: `7ba91a4a268e14b1e771a9261280521c9b6a78c70d36e2432e1945b7703cf338`.
Version remains 2.3.0 pending the separate release bump. Review fixes are committed only on
`feat/billing-frontend`; no merge, push, publication, or backend changes.

## Owner polish — normal-tab OAuth and Export (2026-10-20)

ADR 0021 refines the immutable billing ADR: normal adjacent tab, exact extension callback page,
trusted session-stored PKCE/state/expiry, sender + tab binding, callback consumption before exchange,
restart recovery, duplicate/stale rejection, tab-close/ten-minute cancellation, repeated-click focus,
opener focus and short success confirmation. identity permission removed; callback WAR restricted
to first-party website/API origins with stable URL. Cloud ADR 0012 removes unused chromiumapp
redirects; regenerated product contract copied. Token refresh and isolation remain unchanged.
Export is directly right of Search All Functions in legacy/new/fallback toolbars, no PRO badge,
neutral tooltip, same format menu and upgrade modal. Final `npm run verify` passes 266 tests, TypeScript, production build and Biome (five existing bridge warnings).
`npm run build:dev` passed and the output was copied to the owner-loaded folder, preserving the
pinned dev id. Native Chrome reload succeeded; live legacy/new toolbar placement, neutral title,
no badge and menu visibility passed. The native new toolbar clips overflow, so the menu uses
fixed positioning clamped to the viewport; both controls remain at toolbar level. New view restored.
Final normal-tab OAuth happy path and real exports remain manual acceptance after reloading the
latest copied candidate; unit tests cover poll-based cancellation/restart and callback security.
Cloud source `952a913` is pushed to main, [deployment succeeded](https://github.com/zsetup/zoho-crm-devtools-cloud/actions/runs/39419136680), post-rollout readiness HTTP 200. Extension is not merged/published.

## Live auth bug follow-up — 2026-10-20

Native worker fetch was stored unbound and called with the BillingClient receiver, causing
`WorkerGlobalScope.fetch: Illegal invocation` on token exchange in real Chrome. The existing website
session made the callback/failure appear immediate; isolated signed-out profiles correctly waited
at login. Default fetch is now bound to globalThis. Exchange/provider failures persist a failed
outcome separately from tab-close/access-denial cancellation; popup/modal explain both. Dev logs
are credential-free. Own content senders already pass id validation; session storage stays trusted.

Focused receiver, sender/isolation, callback and UI regression tests bring verification to 273
passing tests in 27 files. Two built-extension Playwright checks pass against production from popup
and the content modal, verifying adjacent login/query preservation, cancellation, storage isolation
and synthetic invalid-code token HTTP 400. Curl confirms the registered pinned dev callback is
accepted (302 login); no cloud fix. Owner Chrome was reloaded with the refreshed build and the live
Zoho signed-out Export/JSON trial modal checked. Owner successful login/export acceptance remains.
Version stays 2.4.0; release ZIP regenerated, extension committed only on feat/billing-frontend.

## Export resilience review — 2026-10-20

The reported detail 503s exposed the all-or-nothing policy, superseded by ADR 0022. Search and
export use the same list-item source/language and request headers; search has six workers and a
warm cache, versus export's four fresh workers. No evidence supports switching `crm` to `extension`
for the same function or inventing a category endpoint. Original API history confirms verbatim source.

The loader preserves strict list/identity/source validation, four workers, fresh reads and timeout/
abort behavior. Retries remain in the worker slot. Errors in individual details cannot reject the
whole pool; safe skipped reasons omit server bodies and arbitrary exception text. Cancellation and
navigation still prevent download. UI completion carries only counts and filename, no identities/code.
The Export trigger keeps its size and label; a wrapped, anchored 320px status card contains progress,
result or persistent errors, with actions on their own row and six-second success dismissal.

Regression coverage includes 503 exhaustion, 429 recovery, seconds/date Retry-After, backoff
cancellation, 201-function pagination/concurrency, skipped format entries/formula protection,
partial completion counts and zero-success rejection. The isolated Playwright 1280px new-toolbar
harness checks unchanged trigger bounds, card geometry/action row, error persistence, retry,
915/918 partial completion and success dismissal. No real Zoho requests or customer writes run.
Real-org export and both live toolbar regressions remain release acceptance checks.
