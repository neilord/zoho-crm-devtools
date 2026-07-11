# 0004 — Docs pipeline and agent workflow

- **Status:** Accepted
- **Date:** 2026-07-11

## Decision

Use a closed documentation taxonomy with one conventions document, append-only ADRs, one living
state document, curated reference documents, and temporary plans with a delete-when-done lifecycle.
Route agents into that pipeline through root `AGENTS.md` and `CLAUDE.md` entry points.

## Rationale

The previous repository mixed workflow rules across development and debugging docs, tracked current
work in both a roadmap and session handoff, and had no index or creation gate. That made facts easy
to duplicate or leave stale. One home per fact makes the repository's context small enough for each
agent to read and reliable enough to serve as long-term memory.

## Consequences

- Every agent reads the docs index, conventions, state, and relevant ADRs before working.
- Every session updates `STATE.md`; durable choices become ADRs.
- A new top-level `docs/*.md` requires an ADR and index entry.
- Completed plan and handoff files are folded into state/reference docs and deleted.
