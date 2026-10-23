# Product

## Goal

Zoho CRM DevTools improves the Zoho CRM Deluge editor while staying close to Zoho's own UI.

## MVP

- Theme packs
- Font family, size, weight, italics, ligatures, and line-height controls
- Indent guides
- Practical syntax-highlighting improvements based on Zoho's existing editor output
- Minimal popup with a master enable/disable switch

## Post-MVP features

- Cross-function search: a "Search All Functions" control on the Zoho functions page
  opens a search overlay across every Deluge function in the org, including their
  source, with an "Edit in CRM" handoff to Zoho's native editor. Shipped free.
- Search All Workflows: a control beside Zoho's native workflow search opens a local,
  progressive index of workflow rules and related function source, with coverage details and
  native rule/function handoffs. Implemented; pending release. Premium from launch under ADR 0024.
- Automation Map: a local overlay with a module board, searchable list, upstream/downstream trace
  and field lens showing possible writers with evidence and coverage gaps. Pro/Max unlock the
  full map; signed-out, Free and Plus users (including Plus trials) get a bounded one-flow fog
  teaser. Configuration reads and Deluge analysis stay in the browser; client-script analysis
  is out of scope. See ADRs [0025](decisions/0025-plan-feature-capabilities.md) and
  [0026](decisions/0026-automation-map.md).

## Non-goals

- GitHub sync
- Import/restore and bulk operations beyond the read-only function exports approved in ADR 0019
- Zoho products outside CRM
- Firefox support

## Monetization Direction

The extension launches free, and cross-function search ships free as well: it is
a growth feature meant to increase the user base rather than an early paywall.
Accounts, billing, and premium gates are in scope for additive paid capabilities
([ADR 0009](decisions/0009-additive-paid-tier.md)), superseding the former non-goal.
Nothing already free becomes paid. Premium features are additive and premium from
their first release; free use requires no account or subscription.
[ADR 0002](decisions/0002-monetization.md) remains in force.

Stage 1 adds optional account connection, server-resolved entitlement, website plan/account
links, and a persisted disclosure notice. New accounts receive a 14-day free Plus trial, no card
required, resolved by the server (ADRs 0016 and 0023).

**Export functions** is the selected first premium capability (ADR 0019): download all the org's
function metadata and Deluge source locally as JSON, CSV, or one combined Markdown document.
Any paid plan/current Plus trial entitlement permits export; Free/signed-out users see an upgrade hook. Its
configurable gate is enforced from first availability, refining the two-release direction for this
new feature only. Existing free editor/search capabilities remain free without an account.
Export sits beside Search All Functions in both toolbars (ADR 0021).
