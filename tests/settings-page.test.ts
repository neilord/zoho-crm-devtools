import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: true }));
vi.mock('../src/features/automation-map-gate', () => ({
  AUTOMATION_MAP_COMING_SOON: true,
  automationMapComingSoon: () => gate.on,
}));

import {
  reconcileSettingsMapEntry,
  removeSettingsMapEntries,
} from '../src/content/automation-map/entry/settings';
import { isSettingsHomeLocation, settingsMapAnchors } from '../src/content/zoho/settings-page';

// Sanitized from Q8 research and the live Setup pass of 2026-10-24: no org identity, customer
// labels or route handlers. The marked native rows show where Zoho puts its own NEW marker: after
// the link on Setup home, inside the flex anchor (spaced by mL2) in the left navigation.
const sparkle =
  '<crm-ui-loaders><div class="crmNewReleaseLoader"><div class="crmNewReleaseLoader_1"></div><div class="crmNewReleaseLoader_2"></div><div class="crmNewReleaseLoader_3"></div></div></crm-ui-loaders>';
const home = `<div class="crmSetupHomeGroupCards" aria-label="Developer Hub"><div class="listItems pL34" id="devSpace_functions"><link-to data-zcqa="devSpace_functions"><a class="setupMenulink ellipsistext dIB">Functions</a></link-to></div><div class="listItems pL34"><link-to><a class="setupMenulink ellipsistext dIB">Native item</a></link-to> <span class="dIB pR right0 top2">${sparkle}</span></div></div>`;
const nav = `<crm-left-menu-setup><lyte-accordion-item><lyte-accordion-body><div class="setting-list-td lft-menu-settings"><div class="setupLeftMenuList lft-menu-modules"><link-to data-zcqa="devSpace_functions" class="w100_per"><a class="pR5 pT7 pB7 pL32 flexAlignCenter flexOne left-setup-menu"><lyte-text class="setup-menus-text">Functions</lyte-text></a></link-to></div></div><div class="setting-list-td lft-menu-settings"><div class="setupLeftMenuList lft-menu-modules"><link-to class="w100_per"><a class="pR5 pT7 pB7 pL32 flexAlignCenter flexOne left-setup-menu"><lyte-text class="setup-menus-text">Native item</lyte-text> <span class="dIB pR mL2">${sparkle}</span></a></link-to></div></div></lyte-accordion-body></lyte-accordion-item></crm-left-menu-setup>`;
beforeEach(() => {
  history.replaceState({}, '', '/crm/org123/settings/index');
  document.body.innerHTML = home;
});
afterEach(() => {
  removeSettingsMapEntries();
  document.body.replaceChildren();
});
describe('Settings Automation Map adapter', () => {
  it.each([
    '/crm/org123/settings',
    '/crm/org123/settings/',
    '/crm/org123/settings/index',
  ])('recognizes home %s', (pathname) => expect(isSettingsHomeLocation({ pathname })).toBe(true));
  it('inserts after Functions with native classes, accessible link and Zoho NEW marker', () => {
    const open = vi.fn();
    reconcileSettingsMapEntry(open);
    const tile = settingsMapAnchors().home?.nextElementSibling;
    expect(tile?.className).toBe('listItems pL34');
    const link = tile?.querySelector('a');
    expect(link?.className).toBe('setupMenulink ellipsistext dIB');
    expect(link?.textContent).toBe('Automation Map');
    // Zoho's own class names, so its stylesheet sizes (14/9/9px) and animates the twin sparkle.
    const badge = tile?.querySelector('.zcdt-map-new.dIB.pR.right0.top2');
    expect(link?.nextElementSibling).toBe(badge);
    const loader = badge?.querySelector('crm-ui-loaders > .crmNewReleaseLoader');
    expect(loader?.innerHTML).toBe(
      '<div class="crmNewReleaseLoader_1"></div><div class="crmNewReleaseLoader_2"></div><div class="crmNewReleaseLoader_3"></div>',
    );
    // Outside the link, like the native row: the link's 18px line height must not reach the badge
    // (it stretched the row from 32px to 50px), and the text space is Zoho's label-to-marker gap.
    expect(link?.querySelector('.zcdt-map-new')).toBeNull();
    expect(link?.nextSibling?.textContent).toBe(' ');
    expect(link?.nextSibling?.nextSibling).toBe(badge);
    expect(tile?.querySelector('.zcdt-map-new')?.textContent).toBe('');
    (link as HTMLElement).click();
    expect(open).toHaveBeenCalledOnce();
    expect(location.hash).toBe('');
    // Nothing of ours uses the short child class names that stacked the layers into one star.
    expect(tile?.querySelector('._1, ._2, ._3')).toBeNull();
    // The marker next to the label opens the map too (the native one is inert).
    (tile?.querySelector('.zcdt-map-new') as HTMLElement).click();
    expect(open).toHaveBeenCalledTimes(2);
  });
  it('deduplicates, repairs removals and re-renders, and removes on departure/disable', () => {
    reconcileSettingsMapEntry(vi.fn());
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelectorAll('[data-zcdt-map-entry]')).toHaveLength(1);
    document.querySelector('[data-zcdt-map-entry]')?.remove();
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelectorAll('[data-zcdt-map-entry]')).toHaveLength(1);
    document.body.innerHTML = home;
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelectorAll('[data-zcdt-map-entry]')).toHaveLength(1);
    history.pushState({}, '', '/crm/org123/tab/Leads');
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelector('[data-zcdt-map-entry]')).toBeNull();
    history.pushState({}, '', '/crm/org123/settings/index');
    reconcileSettingsMapEntry(vi.fn(), false);
    expect(document.querySelector('[data-zcdt-map-entry]')).toBeNull();
  });
  it('uses only the observed left-navigation Functions row on inner settings pages', () => {
    document.body.innerHTML = nav;
    history.pushState({}, '', '/crm/org123/settings/schedules');
    const open = vi.fn();
    reconcileSettingsMapEntry(open);
    reconcileSettingsMapEntry(open);
    expect(document.querySelectorAll('[data-zcdt-map-entry="nav"]')).toHaveLength(1);
    const link = document.querySelector<HTMLElement>('[data-zcdt-map-entry] a');
    expect(link?.classList.contains('left-setup-menu')).toBe(true);
    // As in Zoho's own nav rows: inside the flex link, spaced by mL2, no right0/top2 offsets.
    const badge = link?.querySelector('.zcdt-map-new');
    expect(badge?.classList.contains('right0') || badge?.classList.contains('top2')).toBe(false);
    for (const c of ['dIB', 'pR', 'mL2']) expect(badge?.classList.contains(c)).toBe(true);
    expect(
      badge?.querySelector('crm-ui-loaders > .crmNewReleaseLoader > .crmNewReleaseLoader_3'),
    ).not.toBeNull();
    // Gated: a short "Soon" pill follows the sparkle and the link name says why.
    expect(link?.textContent).toBe('Automation MapSoon');
    expect(link?.getAttribute('aria-label')).toBe('Automation Map, coming soon');
    expect(link?.querySelector('.zcdt-map-soon')?.textContent).toBe('Soon');
    // The label sits in Zoho's `.setup-menus-text` wrapper, which carries the dark label colour.
    expect(link?.querySelector(':scope > span.setup-menus-text')?.textContent).toBe(
      'Automation Map',
    );
    link?.click();
    expect(open).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-zcdt-map-entry="home"]')).toBeNull();
  });
  it('shows "Coming soon" after the sparkle on Setup home and keeps it past the NEW cutoff', () => {
    reconcileSettingsMapEntry(vi.fn());
    const item = document.querySelector('[data-zcdt-map-entry="home"]');
    const children = [...(item?.childNodes ?? [])].filter((n) => n.nodeType === 1);
    expect(children.map((n) => (n as HTMLElement).className.split(' ')[0])).toEqual([
      'setupMenulink',
      'zcdt-map-new',
      'zcdt-map-soon',
    ]);
    expect(item?.querySelector('.zcdt-map-soon')?.textContent).toBe('Coming soon');
    expect(item?.querySelector('a')?.getAttribute('aria-label')).toBe(
      'Automation Map, coming soon',
    );
  });
  it('falls back to the plain entry when the switch is off', () => {
    gate.on = false;
    try {
      reconcileSettingsMapEntry(vi.fn());
      const item = document.querySelector('[data-zcdt-map-entry="home"]');
      expect(item?.querySelector('.zcdt-map-soon')).toBeNull();
      expect(item?.querySelector('a')?.hasAttribute('aria-label')).toBe(false);
    } finally {
      gate.on = true;
    }
  });
  it('does not invent an anchor when Developer Hub or the Functions row is missing', () => {
    document.body.innerHTML = '<div class="crmSetupHomeGroupCards" aria-label="Automation"></div>';
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelector('[data-zcdt-map-entry]')).toBeNull();
  });
});

it.each([
  ['2027-01-31T23:59:59Z', 1],
  ['2027-02-01T00:00:00Z', 0],
])('expires NEW without storage at %s', (now, badges) => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(now));
    history.replaceState({}, '', '/crm/org123/settings/index');
    document.body.innerHTML = home;
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelectorAll('.zcdt-map-new')).toHaveLength(badges);
  } finally {
    removeSettingsMapEntries();
    vi.useRealTimers();
  }
});

it('removes NEW in a still-open Settings tab after the deadline', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2027-01-31T23:59:59Z'));
    history.replaceState({}, '', '/crm/org123/settings/index');
    document.body.innerHTML = home;
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelector('.zcdt-map-new')).not.toBeNull();
    vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelector('.zcdt-map-new')).toBeNull();
  } finally {
    removeSettingsMapEntries();
    vi.useRealTimers();
  }
});

it('uses native sparkle styling when available and adds an 18px fallback only when absent', () => {
  const native = document.createElement('style');
  native.textContent =
    '.crmNewReleaseLoader div { background-image:url("native-sparkle.svg");width:14px;height:14px;position:absolute; }';
  document.head.append(native);
  try {
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelector('.zcdt-map-new-fallback')).toBeNull();
    expect(document.querySelector<HTMLElement>('.zcdt-map-new')?.style.top).toBe('');
    removeSettingsMapEntries();
    native.remove();
    reconcileSettingsMapEntry(vi.fn());
    const marker = document.querySelector('.zcdt-map-new-fallback');
    expect(marker).not.toBeNull();
    if (!marker) throw new Error('Missing marker');
    expect(getComputedStyle(marker).width).toBe('18px');
    const style = document.getElementById('zcdt-map-entry-style') as HTMLStyleElement;
    const paint = [...(style.sheet?.cssRules ?? [])].find((rule) =>
      (rule as CSSStyleRule).selectorText?.endsWith('::after'),
    ) as CSSStyleRule;
    expect(paint.style.getPropertyValue('content')).toBe('""');
    expect(paint.style.getPropertyValue('background')).toContain('data:image/svg+xml');
    document.head.append(native);
    reconcileSettingsMapEntry(vi.fn());
    expect(document.querySelector('.zcdt-map-new-fallback')).toBeNull();
  } finally {
    native.remove();
  }
});
