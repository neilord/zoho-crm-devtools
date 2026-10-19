# 0010 — Private backend and website

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Keep the backend, website, and shared plan contract in a separate private backend repository.
This public repository holds only the extension's entitlement client: sign-in entry, entitlement
read, and upgrade UI. Server code and billing-provider integration stay outside it.

## Rationale

The shared internal libraries are private. CI here could not install them without exposing a
credential to the public build boundary, and colocating the backend would publish server code
and billing logic. A separate private repository reuses the existing libraries without making
this extension depend on private build inputs.

## Consequences

- Public CI must build the extension without private dependencies or credentials.
- Client/API contract changes require coordination across repositories; only public-safe contract
  artifacts may reach this repository.
- Operational details and billing-provider secrets remain outside the public documentation.
