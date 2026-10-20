# 0023 — Paid entitlement and forward-compatible plan keys

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Refine ADRs 0011, 0016 and 0019: gate Export on server `entitled` and `plan !== 'free'`,
never on a list of paid plan names. Accept any non-empty plan key string verbatim while keeping
all other entitlement payload validation and the Free fallback. Unknown entitled keys unlock
paid features. Display contract names when known, otherwise capitalize the key's first character.
Do not reconstruct entitlement from status strings or local dates.

Sync the owner-approved contract ladder: Free, Plus ($23/month), Pro ($57/month), Max
($143/month). Only Plus has the no-card 14-day trial. Intro prices are $9/$35/$99 for the
first paid month of the account's first-ever subscription; never repeat the offer on a plan
change or later subscription. The backend owns offer eligibility. Use first-month wording,
never percentages. Keep version 2.4.0 because its first store submission is still pending.

## Rationale

The former $23 Pro plan is now Plus; Pro denotes a new $57 tier. Restricting the parser or
feature gate to `pro` silently downgrades entitled Plus/Max subscribers to Free. Future paid
keys should work without a store update. The server remains authoritative for expiry, grace
and scheduled cancellations; client status labels must not override a valid entitlement.

## Consequences

All current paid plans and the Plus trial unlock the same local Export feature. Per-tier
features require a future explicit capability contract. Invalid payloads, signed-out accounts,
Free and unentitled accounts keep the existing upgrade flow. No new data, permissions or
backend calls are introduced. Historical Pro wording in earlier ADRs describes the prior model.
