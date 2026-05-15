# 0001 Tooling

## Decision

Use TypeScript, Vite, CRXJS, Biome, Vitest, and Playwright.

## Rationale

- TypeScript keeps extension behavior explicit as the project grows.
- Vite + CRXJS is a focused Chrome-first build setup without a larger framework layer.
- Biome provides one formatter/linter surface for a fresh repo.
- Vitest and Playwright cover fast unit work and real browser flows respectively.

