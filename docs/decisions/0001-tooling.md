# 0001 — Tooling

- **Status:** Accepted
- **Date:** 2026-05-15

## Decision

Use TypeScript, Vite, CRXJS, Biome, Vitest, and Playwright.

## Rationale

- TypeScript keeps extension behavior explicit as the project grows.
- Vite + CRXJS is a focused Chrome-first build setup without a larger framework layer.
- Biome provides one formatter/linter surface for a fresh repo.
- Vitest and Playwright cover fast unit work and real browser flows respectively.

## Consequences

- `npm run verify` is the common local and CI quality gate.
- Browser-extension behavior stays framework-light and Chrome-first.
- A replacement for any part of this stack requires a superseding ADR.
