# Architecture

## Principles

- Prefer native Zoho behavior over recreating Zoho controls.
- Keep all fragile Zoho selectors behind a dedicated adapter layer.
- Keep browser APIs isolated so later browser portability is cheaper.
- Make settings typed, validated, and migration-ready from the start.

## Subsystems

- `src/content/zoho`: selectors and DOM adapters for Zoho CRM
- `src/content/editor`: editor lifecycle and injected integrations
- `src/settings`: setting schema, defaults, storage, and migrations
- `src/themes`: theme metadata and CSS variable payloads
- `src/syntax`: syntax-enhancement styles and toggles
- `src/features`: stable feature registry and release metadata
- `src/shared`: browser and utility abstractions
- `src/popup`: minimal extension popup

## Data Flow

1. Popup or native Zoho controls update typed settings.
2. Settings are persisted through the storage adapter.
3. Content scripts observe editor availability and react to setting changes.
4. Theme and editor modules update the live page through the Zoho adapter layer.

