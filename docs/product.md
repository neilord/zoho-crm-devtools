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

## Non-goals

- GitHub sync
- Bulk import/export (a future home for function export/backup)
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
