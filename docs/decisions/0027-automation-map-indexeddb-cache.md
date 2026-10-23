# 0027 — Automation Map cache in extension IndexedDB

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

Keep Automation Map persistence in extension-origin IndexedDB, opened only by the background
service worker through a narrow validated origin/org channel. Retain the existing workflow cache
unchanged. Reuse its gzip/base64 codec with an independently validated map payload in a versioned
wire carrier. Bound both decoded data and the retained compressed bucket; failures are advisory.
The concrete limits and implementation contracts live in architecture §12.

## Rationale

Chrome's extension-wide local-storage quota is approximately 10 MB without `unlimitedStorage`;
the workflow cache already permits 6 MB. All-function sources and analyzer effects need a separate
budget. IndexedDB provides that without changing permissions, exposing billing storage or moving
same-origin authenticated CRM requests into the worker. A small atomic storage interface makes
validation, eviction and failure recovery testable without browser persistence.

## Consequences

The worker serializes atomic bucket replacement and returns sanitized failures. Content code
cannot open the extension database or select arbitrary storage keys. Teaser mode never accesses
persistence. Fresh indexing remains usable when IndexedDB is disabled, full or unavailable;
packaged-extension acceptance must exercise real service-worker persistence and restart behavior.
