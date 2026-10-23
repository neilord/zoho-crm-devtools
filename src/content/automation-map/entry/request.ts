/** Small content-world UX event. It carries identity only; the store still owns access checks. */
export const OPEN_AUTOMATION_MAP_EVENT = 'zcdt:openAutomationMap';
export interface OpenAutomationMapOptions {
  entry: 'settings' | 'toolbar' | 'rule' | 'hash';
  focus?: { ruleId?: string; moduleApiName?: string };
  initialHash?: string;
}
export function requestAutomationMap(options: OpenAutomationMapOptions): void {
  document.dispatchEvent(new CustomEvent(OPEN_AUTOMATION_MAP_EVENT, { detail: options }));
}
export const AUTOMATION_MAP_HASH_PREFIX = '#zcdt-map=';
/** Match the canonical UI codec format; a native fragment containing a map key is unrelated. */
export function hasAutomationMapHash(hash: string): boolean {
  return hash.startsWith(AUTOMATION_MAP_HASH_PREFIX);
}
