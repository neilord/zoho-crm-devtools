# 0002 — Monetization

- **Status:** Accepted
- **Date:** 2026-05-15

## Decision

Launch the MVP free. Keep stable feature IDs and model pricing separately with `free` and `premium` tiers.

## Rationale

Moving existing free features behind a future paywall would be poor user experience. Future premium features should be additive and premium from launch.

## Consequences

- Existing free features remain free.
- Any paid feature is introduced as a new premium capability and keeps its tier explicit in the
  feature model.
