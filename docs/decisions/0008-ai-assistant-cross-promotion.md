# 0008 — In-extension cross-promotion of Zoho CRM AI Assistant

- **Status:** Accepted
- **Date:** 2026-09-18

## Decision

DevTools may promote sibling products we make inside Zoho CRM, but only as a **non-blocking corner
card** with these limits:

- Shown on any Zoho CRM page (not just Settings › Functions), a few seconds after load.
- At most **two impressions per user**, tracked in `chrome.storage.sync` so the state follows the
  Google account. The first "Remind me later" or an ignored card defers it by three days; the
  second impression ends it regardless of outcome. **Install** or **Close** end it immediately.
- Clearly attributed ("New from the makers of Zoho CRM DevTools"), two actions plus close, and an
  outbound link tagged with `utm_source=zoho-crm-devtools&utm_medium=extension`.
- No new permissions, no network calls, no analytics beyond the UTMs the destination sees. We do
  not try to detect whether the promoted extension is already installed.

The first promotion is for Zoho CRM AI Assistant (store item `fmkeihieagalignogegiehmcjbflglgk`).

## Rationale

The DevTools install base is the cheapest audience we have for a sibling launch, and every user
opens Zoho CRM. A modal or a per-session banner would read as an ad interrupt from a developer
tool and invite negative reviews and Chrome Web Store scrutiny; a one-time, dismissible,
attributed corner card is standard self-promotion and stays within store policy. Functions-page-
only placement would reach only the subset of users who visit that page and take weeks to cover
the base.

Detecting an existing install would need the `management` permission, which is a
privacy/review cost far larger than one extra dismissal.

DevTools users are admins and developers rather than sales reps, so the copy asks them to try the
assistant or suggest it to their reps rather than assuming they are the end user.

## Consequences

- Future cross-promotions reuse `src/content/promo` and this policy; they do not add a second
  concurrent card or loosen the impression cap without a superseding ADR.
- The card is a visual Zoho-page surface, so changes to it require the live Zoho check from
  `conventions.md` §5.
- Retiring the campaign is a code removal in a normal release; stored state can be left in place.
