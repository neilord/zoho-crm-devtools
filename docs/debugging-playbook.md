# Debugging Playbook

## Before Coding

1. Observe the native Zoho behavior.
2. List at least two plausible implementation approaches when the problem is non-trivial.
3. Prefer the approach that reuses Zoho behavior with the smallest durable surface area.
4. If the live Zoho page is not available, ask the user for browser access or the smallest relevant source fragment before guessing.

## During Iteration

- Compare DOM, classes, attributes, and computed styles before and after each interaction.
- Capture screenshots when visual correctness matters.
- Verify reopen/reload behavior, not only the happy path immediately after insertion.
- If a failed approach teaches us something, record the lesson instead of erasing it from memory.
- When browser inspection is needed but unavailable, ask the user to enable the browser tool or provide the missing evidence.

## Escalate To The User When

- The issue is a product or UX tradeoff, not a technical fact.
- Multiple approaches work but imply different long-term behavior.
- A live authenticated state or business decision is missing.
- The assistant lacks the Zoho DOM evidence needed to proceed responsibly.
