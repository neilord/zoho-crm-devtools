# Decisions — ADR log

Durable decisions live here as append-only Architecture Decision Records. Transient status belongs
in [`../STATE.md`](../STATE.md); working rules belong in [`../conventions.md`](../conventions.md).

## How to write one

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to the next `NNNN-short-title.md` number.
2. Fill in decision, rationale, and consequences; use `Proposed` only while discussion is open.
3. Add one line to the log below.

Accepted ADRs are immutable. Supersede a decision with a new ADR that references the old one and
mark the old entry `Superseded by NNNN`. If branches claim the same number, the later-merged ADR
renumbers.

## Log

- [`0001-tooling.md`](0001-tooling.md) — TypeScript/Vite/CRXJS build and Biome/Vitest/Playwright
  quality stack.
- [`0002-monetization.md`](0002-monetization.md) — free MVP and additive future premium features.
- [`0003-marketing-channels.md`](0003-marketing-channels.md) — Reddit for release updates; no new
  Zoho Forum topic per update.
- [`0004-docs-and-agent-workflow.md`](0004-docs-and-agent-workflow.md) — closed docs taxonomy and
  persistent agent-context pipeline.
