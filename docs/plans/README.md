# `docs/plans/` — ephemeral working plans

Multi-step working plans may live here temporarily.

- Use one plan per file, named `plans/<area>-<thing>.md`.
- Plans hold temporary execution state, not durable facts.
- When work completes, fold current truth into `STATE.md`, record durable choices in an ADR, and
  delete the plan.
- Plans never live at the root of `docs/`.

An otherwise empty directory is the healthy default.
