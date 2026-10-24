# 0034 — One-time "What's new" announcement card

- **Status:** Accepted
- **Date:** 2026-10-25

## Decision

DevTools may announce its own new features with a **"What's new" corner card**, built on the
`src/content/promo` surface and placement from ADR 0008, with a different lifetime rule:

- The card shows on any Zoho CRM org page a few seconds after load and **keeps showing on later
  page loads until the user acknowledges it**. There is no auto-hide, no "Remind me later" and no
  impression cap.
- Acknowledging means **Got it**, the **close** button, or **clicking any link** in the card. The
  acknowledgement is stored in `chrome.storage.sync` under a per-campaign key, so it follows the
  Google account. Other open tabs remove their copy when the key changes.
- **One corner card at a time.** While an announcement is unacknowledged, the cross-promotion card
  (ADR 0008) does not show. It resumes with its own schedule once the announcement is acknowledged.
- Links are same-tab navigations to the user's own org (origin and org id from the current page).
  They lead to the feature itself, where the normal paywall explains paid access. The card only
  carries a one-line "Included in paid plans · N-day free trial" note, taking N from the product
  contract.
- No new permissions, network calls or analytics. The card is skipped when the extension is
  disabled or the page has no org id.

The first campaign announces Search All Workflows, Automation Map (Beta) and Export functions, with
an interactive hero that previews each tool as its row is hovered or focused.

## Rationale

This card announces DevTools' own features, not another product, so it isn't the ad interruption
that ADR 0008 guards against. Snoozes and a two-impression cap would let most users miss it after
one glance at a busy page. A card the user dismisses with one click, that never comes back after
that, is the usual pattern for product news.

Two corner cards at once would stack in the same spot and look like spam, so one waits for the
other. The announcement goes first because it is time-bound to the release.

Treating a link click as acknowledgement avoids showing the card again to someone who already
acted on it.

## Consequences

- Each future announcement uses a new storage key, so it shows even to users who acknowledged
  earlier ones. Retiring a campaign means removing the code; stored keys can stay.
- Changing the lifetime rule (adding a cap or a snooze) or showing two cards at once needs a
  superseding ADR.
- The card is a visual Zoho-page surface, so changes require the live Zoho check from
  `conventions.md` §5.
