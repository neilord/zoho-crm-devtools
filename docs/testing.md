# Testing

Reference for test layers and evidence requirements. The command gate lives only in
[`conventions.md`](conventions.md) §5.

## Test Layers

- Unit tests for settings, feature metadata, theme metadata, and browser adapters
- DOM fixture tests for Zoho integration behavior
- Playwright extension tests for built-extension flows
- Real Zoho checks in an authenticated Chrome session

## Test Scope By Stage

- Early feature slices should add the smallest useful tests that protect the behavior being built.
- Do not pause a feature to design the full future end-to-end test architecture unless the current task specifically requires it.
- Prefer focused unit or fixture coverage first when live behavior has become clear enough to encode.
- Add broader Playwright coverage incrementally as stable user flows emerge.
- Tests should prove the intent that matters, not merely assert that some markup exists.

For example, a theme integration test is stronger when it protects selected-state persistence or native
alias behavior than when it only checks that a custom option node was appended.

### Built-extension billing check

Run `npm run build:dev` then `npm run test:e2e` for the opt-in Playwright billing tests.
They launch isolated Chromium profiles with the unpacked extension, exercise the popup and
content modal against the production authorize/login endpoint, preserve OAuth query parameters,
and verify adjacent tabs, cancellation, trusted storage isolation and a synthetic invalid-code
callback. The callback must reach the real token endpoint and report failure, protecting native
worker fetch receiver binding. No credentials are entered or accounts created. Successful
callback/token persistence and restart/replay validation remain covered by unit tests; owner login
and actual Zoho downloads remain release acceptance checks.

### Built-extension workflow cache regression

Run `npm run test:e2e:workflows`. This builds an unlocked development extension and runs the
opt-in isolated Chromium check (skipped by the general billing E2E command). It
loads the actual extension and worker, intercepts all CRM traffic with synthetic responses,
and indexes 330 rules, 212 exact source dependencies, five name-only bindings and 92 HTML
templates. It includes an unrelated catalogue entry with `api_name:null`, the live cache-write
regression. It asserts persisted storage, close/reopen and page-reload coverage within two seconds,
bounded initial request counts and no repeated unchanged rule-detail reads. Every warm API
response is held until code, template-body and action-resource searches succeed, so refreshed
responses cannot mask missing cached matches. The badge must show cached gaps plus refreshing.
Catalogue timestamps cover unchanged-source skips and changed-source re-reads; unit tests cover
unknown timestamps and failed-refresh persistence. A controlled four-source
failure changes six durable gaps to ten; targeted retry returns to six. Content/worker consoles
are collected. It takes approximately 15 seconds; no real org/account access is needed.

### Workflow cache contract fixtures

`workflow-cache-shapes.test.ts` uses type-exhaustive action/trigger/load/join/source records to
roundtrip both cache schemas, including unknown variants, nullable/empty/namespaced IDs, Unicode
source and long HTML. Invalid envelopes assert indexed diagnostics and unchanged byte limits.
`workflow-joins.test.ts` tests every catalogue permutation and JSON hydration for exact, name-only,
ambiguous and conflicting duplicate identities. The store test also checks conflicts before
pagination deduplication. These tests run with the normal verification gate.

## Real-site Verification

Real-site checks are required for:

- Native settings integration
- Selected-state behavior
- Visual alignment
- Selector drift after Zoho UI changes

For repeated local browser checks after rebuilding the unpacked extension, use the development-only
self-reload flow in [`architecture.md`](architecture.md) §7, then reload the Zoho tab before
verifying the changed behavior.

Any hard-won integration fix keeps a focused regression test. In particular, tests must continue to
protect cursor measurement without rewriting CodeMirror text nodes, idempotent mutation
reconciliation, cookie parsing, API pagination/error handling, and the JSON-string handoff expected
by Zoho's native editor bridge.

## Fixture Capture

When a live Zoho interaction reveals a stable structure worth testing, capture the smallest useful HTML fixture and document its origin in `docs/zoho-integration.md`.

Do not try to mirror or download the full Zoho application. Fixtures should be focused snippets for the exact control or state under test.

If a feature depends on Zoho DOM the assistant cannot inspect directly, the assistant should ask the user for the smallest relevant source fragment or screenshot needed for that feature rather than inventing selectors from memory.

For example, a themes task may need the native theme-picklist DOM and selection-state classes so it can build focused fixture tests. It should not request broad page captures or unrelated material just to plan future end-to-end coverage.
