# 0007 — Search placement across Functions UI versions

- **Status:** Accepted
- **Date:** 2026-09-16

## Decision

Place Search All Functions immediately after the native search wrapper in the new Functions
table toolbar. Detect the new layout through its dedicated DOM hooks, while retaining the old
layout's existing search anchor, placement, styling, and Create Function fallback.

## Rationale

Grouping both search options keeps code search discoverable beside native name search and leaves
Create Function as the primary creation action. Organizations can switch versions independently;
URL or region detection would not reliably identify the layout. The existing button fits the new
flex toolbar without changing Zoho's controls or adding global CSS overrides.

## Consequences

The DOM adapter owns both versions' selectors. Regression coverage and live checks must preserve
placement across version switches, delayed toolbar rendering, and reloads. Observed DOM contracts
belong in `docs/zoho-integration.md`.
