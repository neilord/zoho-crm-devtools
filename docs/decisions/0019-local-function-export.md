# 0019 — Local function export as the first premium capability

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision

Select **Export functions** (`exportFunctions`) as an additive premium capability: download every
org function's metadata and Deluge source as full-fidelity JSON, CSV with a code column, or one
combined Markdown document. Reuse cross-function search's Zoho list/detail API helpers and keep
all function data in the browser/on the user's device. Do not send it to the billing backend.

After the green Stage 1 plumbing commit, enable this new feature's licence gate in this same
branch. `EXPORT_FUNCTIONS_GATE_ENFORCED = true` is its single configuration switch. Other
planned premium features retain the unlocked plumbing default; already-free features stay free.
This supersedes ADR 0015's delayed gate/release requirement **only for Export functions**, per
the owner's scope addition. No existing user loses a capability.

Refine ADR 0013's server-mediated candidate direction: this selected export is intentionally local,
so its entitlement check is a UX/licence gate in public MIT code, not server-enforced protection.
Remove only read-only function downloads from the product's bulk import/export non-goal. Import,
restore, GitHub sync and other bulk operations remain unapproved.

## Rationale

Local downloads reuse the existing Zoho integration without exposing Deluge source to another
service. A combined Markdown file avoids a ZIP dependency while preserving each function's code
and metadata. The existing search loader tolerates partial/stale details; export instead reads a
fresh list and every detail and refuses a partial backup. JSON preserves returned fields and code;
CSV guards spreadsheet formulas; Markdown uses safe code fences.

## Consequences

- Check resolved entitlement before fetching any Zoho export data. Pro and current Pro trials may
  export; signed-out, Free and unavailable entitlement emit `billing:upgradeRequired` to the
  upgrade hook. Cancellation scheduled for a still-entitled account does not block export.
- Function data never enters billing messages. Local Blob downloads require no new permission.
- Ship no button/modal styles in this implementation. Keep named mount points, format/request/
  progress/completion events and a plain upgrade hook for the frontend specialist. Place the
  unstyled mount adjacent to the existing verified Search integration; final dashboard bottom-left
  placement and modal/focus design belong to that specialist and require a live Zoho check.
- At most four details load concurrently. Missing/unreadable detail, malformed lists, cancellation
  or org/navigation change aborts without a download. API shape/anchor regression remains a live
  acceptance gate before release. Conductor owns that check; this branch is not merged/published.
