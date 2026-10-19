# 0015 — Two store releases for the paid tier

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Ship the paid tier in two Chrome Web Store releases. First ship plumbing: token storage,
entitlement reads, and gated UI with everything still unlocked. Enable the premium gate in a
second release only once the new premium feature exists. Already-free features stay free under
ADRs 0002 and 0009; the first stage does not release a future premium capability as free.

## Rationale

[Chrome's review process](https://developer.chrome.com/docs/webstore/review-process) allows
review to take days to weeks and identifies significant code changes as a cause of closer review.
A new account layer compounds that change; violations found in a submission can trigger review
of the currently published version. Separating plumbing review from the revenue switch reduces
launch coupling compared with one large submission.

## Consequences

- Two submissions add release overhead and do not guarantee faster approval or immunity from
  re-review. The second release must be reviewed on its own merits.
- The implementation branch must update `PRIVACY.md`, store declarations, and existing-user
  disclosures when account/network behavior is introduced, including the plumbing release.
  This documentation-only branch must not rewrite the shipped privacy description early.
- Before submission, verify the installed-version update with Chrome's Extension Update Testing
  Tool and live-check signed-out free use in Zoho. Bundle feature logic in the extension;
  entitlement configuration must not fetch remote executable feature code.
