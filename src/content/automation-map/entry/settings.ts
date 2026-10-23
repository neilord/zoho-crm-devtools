import {
  AUTOMATION_MAP_NEW_BADGE_UNTIL,
  createSettingsMapEntry,
  isSettingsHomeLocation,
  isSettingsLocation,
  settingsMapAnchors,
} from '../../zoho/settings-page';

const STYLE_ID = 'zcdt-map-entry-style';
/** Called by the lifecycle observer; mutates only when the native anchor or our entry changes. */
export function reconcileSettingsMapEntry(onOpen: () => void, enabled = true): void {
  const anchors = settingsMapAnchors();
  for (const kind of ['home', 'nav'] as const) {
    const anchor =
      enabled && (kind === 'home' ? isSettingsHomeLocation() : isSettingsLocation())
        ? anchors[kind]
        : null;
    const existing = [...document.querySelectorAll<HTMLElement>(`[data-zcdt-map-entry="${kind}"]`)];
    const entry = existing.shift();
    for (const duplicate of existing) duplicate.remove();
    if (!anchor?.parentElement) {
      entry?.remove();
      continue;
    }
    if (entry && anchor.nextElementSibling === entry) {
      // A long-lived CRM tab can cross the deadline without remounting Settings.
      if (new Date().toISOString().slice(0, 10) > AUTOMATION_MAP_NEW_BADGE_UNTIL)
        entry.querySelector('.zcdt-map-new')?.remove();
      continue;
    }
    entry?.remove();
    anchor.after(createSettingsMapEntry(anchor, kind === 'nav', onOpen));
  }
  const present = document.querySelector('[data-zcdt-map-entry]');
  if (!present) {
    document.getElementById(STYLE_ID)?.remove();
    return;
  }
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `.zcdt-map-new-fallback{display:inline-block;position:relative;width:18px;height:18px}.zcdt-map-new-fallback::after{content:"";position:absolute;inset:0;width:18px;height:18px;background:center/18px 18px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath fill='%23e8505b' d='M9 1l2.2 5.8L17 9l-5.8 2.2L9 17l-2.2-5.8L1 9l5.8-2.2Z'/%3E%3C/svg%3E")}`;
    document.head.append(style);
  }
  for (const marker of document.querySelectorAll<HTMLElement>('.zcdt-map-new')) {
    const sparkle = marker.querySelector<HTMLElement>('.crmNewReleaseLoader');
    if (!sparkle) continue;
    // The fallback paints a pseudo-element, so it never masks the native loader's styles.
    // Recheck late-loaded native CSS without removing/readding classes in an observer loop.
    const images = [sparkle, ...sparkle.querySelectorAll('*')].map(
      (el) => getComputedStyle(el).backgroundImage,
    );
    const fallback = !images.some((image) => image && image !== 'none');
    if (marker.classList.contains('zcdt-map-new-fallback') !== fallback)
      marker.classList.toggle('zcdt-map-new-fallback', fallback);
  }
}
export function removeSettingsMapEntries(): void {
  for (const entry of document.querySelectorAll('[data-zcdt-map-entry]')) entry.remove();
  document.getElementById(STYLE_ID)?.remove();
}
