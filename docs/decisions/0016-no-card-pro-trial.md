# 0016 — No-card Pro trial

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Every new account starts a 14-day free trial granting Pro-level entitlement, with no card
required. The trial is product-local: it creates no billing-provider customer or subscription
object. The billing provider is involved only when the user checks out.

Allow one trial per account, non-renewable. Converting to paid during the trial must preserve
the remaining trial days. Resolve the trial grant server-side, never from a client-held date
or client clock, which the user controls.

The trial is an additional time-boxed grant above the subscription model in
[ADR 0011](0011-shared-plan-contract.md). On expiry, without an active paid subscription,
entitlement falls back to the same perpetual Free plan used for a missing or inactive
subscription; the trial does not replace that fallback.

## Rationale

Perpetual Free already lets people try the product. The trial lets them experience premium
capability before paying, which the Free tier alone cannot do. The shared internal libraries
already support a local, expiring trial with a configured tier and reminder cadence: this is
configuration, not new billing machinery.

The cost is trial state, expiry, and reminder email delivery that must work correctly,
including a scheduled job this product would otherwise not need.

## Consequences

- Trial-expiry reminders require a transactional mail provider with a verified sending domain
  and a scheduled job on the host, adding an operational dependency. Reminder delivery must
  be at-most-once.
- Pricing and in-extension copy must consistently say "14-day free trial, no card required".
- An expired trial must degrade to Free silently and never break a free feature, consistent
  with [ADR 0013](0013-entitlement-licence-check.md).
- Configure trial entitlement, expiry, and reminders in the private backend repository using
  the shared internal libraries; the extension consumes the server-resolved entitlement.
