# Testing

## Test Layers

- Unit tests for settings, feature metadata, theme metadata, and browser adapters
- DOM fixture tests for Zoho integration behavior
- Playwright extension tests for built-extension flows
- Real Zoho checks in an authenticated Chrome session

## Real-site Verification

Real-site checks are required for:

- Native settings integration
- Selected-state behavior
- Visual alignment
- Selector drift after Zoho UI changes

## Fixture Capture

When a live Zoho interaction reveals a stable structure worth testing, capture the smallest useful HTML fixture and document its origin in `docs/zoho-integration.md`.

