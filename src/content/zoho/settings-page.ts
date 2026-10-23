import { zohoSelectors } from './selectors';

export const AUTOMATION_MAP_NEW_BADGE_UNTIL = '2027-01-31';

export function isSettingsHomeLocation(
  location: Pick<Location, 'pathname'> = window.location,
): boolean {
  return /^\/crm\/org\d+\/settings(?:\/index)?\/?$/.test(location.pathname);
}
export function isSettingsLocation(
  location: Pick<Location, 'pathname'> = window.location,
): boolean {
  return /^\/crm\/org\d+\/settings(?:\/|$)/.test(location.pathname);
}
export function settingsMapAnchors(root: ParentNode = document): {
  home: HTMLElement | null;
  nav: HTMLElement | null;
} {
  const group = root.querySelector<HTMLElement>(zohoSelectors.settingsDeveloperHub);
  const home = group?.querySelector<HTMLElement>(zohoSelectors.settingsFunctionsTile) ?? null;
  // Anchor by the verified Functions link, never by translated header text or numeric row ids.
  const nav =
    root
      .querySelector(zohoSelectors.settingsNavFunctions)
      ?.closest<HTMLElement>('.setting-list-td') ?? null;
  return { home, nav };
}

/** Builds only inert native-looking markup; no Lyte route attributes/handlers are copied. */
export function createSettingsMapEntry(
  anchor: HTMLElement,
  nav: boolean,
  onOpen: () => void,
): HTMLElement {
  const doc = anchor.ownerDocument;
  const item = doc.createElement('div');
  item.className = anchor.className;
  item.dataset.zcdtMapEntry = nav ? 'nav' : 'home';
  const link = doc.createElement('a');
  link.className =
    anchor.querySelector('a')?.className ??
    (nav ? 'left-setup-menu' : 'setupMenulink ellipsistext dIB');
  link.href = '#zcdt-map=v1;view=fields';
  if (nav) {
    // Zoho wraps nav labels in `.setup-menus-text` (dark text); without it the label takes the
    // link colour, blue, unlike its neighbours. A span is enough: no custom element to upgrade.
    const label = doc.createElement('span');
    label.className = 'setup-menus-text';
    label.textContent = 'Automation Map';
    link.append(label);
  } else link.textContent = 'Automation Map';
  const badge = doc.createElement('span');
  // Zoho's own marker markup and class names, so its stylesheet sizes and animates the sparkle.
  // The two surfaces differ and the badge must follow each: on Setup home the native marker is a
  // sibling after the link (`right0 top2`), because the link's 18px line height would otherwise
  // stretch the row; in the left navigation it is a flex child of the link, spaced by `mL2`.
  badge.className = `zcdt-map-new dIB pR ${nav ? 'mL2' : 'right0 top2'}`;
  badge.setAttribute('aria-label', 'New');
  const sparkle = doc.createElement('div');
  sparkle.className = 'crmNewReleaseLoader';
  for (const n of [1, 2, 3]) {
    const layer = doc.createElement('div');
    layer.className = `crmNewReleaseLoader_${n}`;
    sparkle.append(layer);
  }
  // No Lyte bindings or loader configuration: this is the native marker's inert light DOM.
  const loader = doc.createElement('crm-ui-loaders');
  loader.append(sparkle);
  badge.append(loader);
  const showBadge = new Date().toISOString().slice(0, 10) <= AUTOMATION_MAP_NEW_BADGE_UNTIL;
  if (showBadge && nav) link.append(badge);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen();
  });
  if (nav) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'setupLeftMenuList lft-menu-modules';
    wrapper.append(link);
    item.append(wrapper);
  } else {
    item.append(link);
    if (showBadge) {
      // A text space, as in Zoho's own row: it is the native gap between label and sparkle.
      item.append(doc.createTextNode(' '), badge);
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', (event) => {
        event.preventDefault();
        onOpen();
      });
    }
  }
  return item;
}
