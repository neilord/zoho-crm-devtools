# Testing

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

## Real-site Verification

Real-site checks are required for:

- Native settings integration
- Selected-state behavior
- Visual alignment
- Selector drift after Zoho UI changes

## Fixture Capture

When a live Zoho interaction reveals a stable structure worth testing, capture the smallest useful HTML fixture and document its origin in `docs/zoho-integration.md`.

Do not try to mirror or download the full Zoho application. Fixtures should be focused snippets for the exact control or state under test.

If a feature depends on Zoho DOM the assistant cannot inspect directly, the assistant should ask the user for the smallest relevant source fragment or screenshot needed for that feature rather than inventing selectors from memory.

For example, a themes task may need the native theme-picklist DOM and selection-state classes so it can build focused fixture tests. It should not request broad page captures or unrelated material just to plan future end-to-end coverage.
