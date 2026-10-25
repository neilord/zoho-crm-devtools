# 0035 — Automation Map gated behind Coming soon / Pro waitlist before 2.4.0

- **Status:** Accepted
- **Date:** 2026-10-26

## Decision

Automation Map ships in 2.4.0 as **Coming soon**, not Beta. One compile-time switch,
`AUTOMATION_MAP_COMING_SOON` in `src/features/automation-map-gate.ts`, controls it:

- While it is `true`, every entry (Workflow Rules toolbar button, Setup home and nav entries,
  `#zcdt-map=` links including the What's new link, `requestAutomationMap`) goes through `open()`
  in `automation-map/bootstrap.ts`, which shows the **waitlist popup**
  (`automation-map/entry/waitlist.ts`) after the enabled/context checks and *before*
  `resolveUi()`/`createStore()`. The map runtime is never imported and no Zoho reads happen.
- The popup has a static, inert SVG preview, and the account state decides the call to action:
  signed out gets "Get Pro and join the waitlist" (sign-up, then Pro checkout) plus "Log in";
  Free/Plus get the same primary button (Pro checkout); Pro/Max (`hasPlanFeature(...,
  'automationMap')`) see "You're on the list". Prices come from the product contract. A failed
  entitlement check falls back to the signed-out call to action. Finishing checkout or sign-in
  never opens the map.
- A map hash is stripped with `history.replaceState` when the popup opens and closes.
- The Workflow Rules toolbar button, Setup entries and What's new row show an amber "Coming soon"
  label. The overlay header's Beta chip stays in the code but is unreachable.
- To ship the map, set the constant to `false`; Beta wording returns where it is still coded.
  Development builds can turn it off with `VITE_AUTOMATION_MAP_COMING_SOON=off` (the map e2e does).

The registry's `status: 'beta'` for `automationMap` is not used for this: nothing consumes it for UI.

## Rationale

The map was too unstable to ship even as Beta, but the work is large and accepted. A single switch
keeps the code, tests and pricing contract (`automationMap` stays a Pro/Max feature) intact, lets
Pro members be told they are on the waitlist, and turns the entry points into an upgrade path
instead of removing them. Gating at `open()` covers every route with one check.

## Consequences

- Store listing, privacy text and changelog describe the map as coming soon and say it reads
  nothing until released; revert them with the switch.
- The map unit tests mock the gate off; `npm run test:e2e:automation-map` builds with the
  dev-only override. Production builds ignore the override.
- Releasing the map needs a live pass (it has not run live since this gate) and a decision on
  whether waitlisted members get a notice.
