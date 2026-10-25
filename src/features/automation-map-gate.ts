/**
 * The single, reversible switch behind the Automation Map "Coming soon" gate (ADR 0035).
 *
 * While true, every way of opening the map (toolbar, Setup entries, `#zcdt-map=` links, the
 * What's new link, "Show on map") shows the Pro waitlist popup instead, and the badges say
 * "Coming soon". The map runtime stays in the repo but is never imported or run. Flip to `false`
 * to ship the map again; no other code needs to change. This is deliberately not
 * `FeatureStatus` in the registry, which nothing consumes for UI.
 */
export const AUTOMATION_MAP_COMING_SOON = true;

/**
 * A function so tests can substitute the switch without rebuilding the module graph. Development
 * builds only may turn it off with `VITE_AUTOMATION_MAP_COMING_SOON=off` (the map e2e does);
 * production ignores the variable, like the other dev-only flags.
 */
export function automationMapComingSoon(): boolean {
  if (
    import.meta.env.MODE === 'development' &&
    import.meta.env.VITE_AUTOMATION_MAP_COMING_SOON === 'off'
  )
    return false;
  return AUTOMATION_MAP_COMING_SOON;
}
