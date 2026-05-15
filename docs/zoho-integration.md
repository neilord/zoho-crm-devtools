# Zoho Integration

## Scope

The extension targets Zoho CRM only. Exact selectors will be recorded here after live inspection.

## Discovery Notes

- Inspect how Zoho handles a behavior natively before adding custom code.
- Prefer cloning or extending native controls when Zoho can manage state for us.
- Keep selector knowledge in `src/content/zoho`.
- Record unstable selectors and fallback strategies here when they are discovered.

## Known Open Questions

- Current Deluge editor mount selectors
- Current native settings popup structure
- Best insertion point for custom theme options
- How native selected-state is derived and persisted

