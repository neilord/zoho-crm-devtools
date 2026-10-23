/** Small shared building blocks for the shell panels. */
import type { MapNode } from '../types';
import type { RegionEnv } from './actions';
import { button, el, text } from './dom';
import type { StatusView } from './format';
import { type MapIconName, mapIcon } from './icons';
import { KIND_COLOR, nodeIcon } from './kinds';

export const badge = (label: string, extra = ''): HTMLElement =>
  el('span', { className: `fs-badge${extra ? ` ${extra}` : ''}`, text: label });

export function kindTile(node: MapNode, size = 14): HTMLElement {
  const tile = el('span', { className: 'ic' }, [nodeIcon(node, size)]);
  tile.style.setProperty('--k', `var(${KIND_COLOR[node.kind]})`);
  return tile;
}

export function statusMark(status: StatusView): HTMLElement | null {
  if (status.tone === 'none' && status.label === '—') return null;
  const mark =
    status.tone === 'on' || status.tone === 'off'
      ? el('span', { className: `dot${status.tone === 'on' ? ' on' : ''}` })
      : status.tone === 'warn' || status.tone === 'bad'
        ? el('span', { className: `stw ${status.tone}` }, [mapIcon('warn', 13)])
        : status.tone === 'pending'
          ? el('span', { className: 'skel tiny' })
          : null;
  return mark;
}

export const infoLabel = (label: string): HTMLElement =>
  el('div', { className: 'fs-info-label' }, [text(label), el('span', { className: 'line' })]);

export function section(label: string, children: Array<Node | null>): HTMLElement | null {
  const kids = children.filter((c): c is Node => c !== null);
  return kids.length ? el('div', { className: 'sec' }, [infoLabel(label), ...kids]) : null;
}

export const note = (message: string, className = 'lens-empty'): HTMLElement =>
  el('div', { className, text: message });

export function warnBox(
  icon: MapIconName,
  children: Array<Node | null>,
  extra = '',
  spin = false,
): HTMLElement {
  return el(
    'div',
    { className: `wf-partial${extra ? ` ${extra}` : ''}`, attrs: { role: 'status' } },
    [mapIcon(icon, 14, spin ? 'spin' : undefined), el('div', {}, children)],
  );
}

export function emptyState(
  icon: MapIconName,
  title: string,
  body: string,
  actions: Array<HTMLElement | null> = [],
): HTMLElement {
  return el('div', { className: 'am-empty' }, [
    el('div', {}, [
      el('span', { className: 'ico' }, [mapIcon(icon, 24)]),
      el('h3', { text: title }),
      el('p', { text: body }),
      ...actions,
    ]),
  ]);
}

export function upgradeButton(env: RegionEnv, label = 'Upgrade to Pro'): HTMLButtonElement {
  return button('am-upgrade-btn', label, () => env.actions.upgrade(), [mapIcon('sparkle', 13)], {
    attrs: { 'data-fk': `upgrade:${label}` },
  });
}

/** Dashed Pro-coloured row that opens the upgrade modal. */
export function lockRow(env: RegionEnv, children: Array<Node | null>): HTMLElement {
  return el(
    'button',
    {
      className: 'lockrow',
      type: 'button',
      onClick: () => env.actions.upgrade(),
    },
    [mapIcon('lock', 14), el('span', {}, children)],
  );
}

export function lockPanel(env: RegionEnv, message: string): HTMLElement {
  return el('div', { className: 'lockpanel' }, [
    el('div', { className: 'big' }, [mapIcon('lock', 20)]),
    text(message),
    el('div', {}, [upgradeButton(env)]),
  ]);
}

export function skeletonBlock(lines = 3): HTMLElement {
  return el(
    'div',
    { className: 'dskel', attrs: { 'aria-hidden': 'true' } },
    Array.from({ length: lines }, () => el('span', { className: 'skel' })),
  );
}

export function kbd(...keys: string[]): HTMLElement[] {
  return keys.map((k) => el('span', { className: 'kbd', text: k }));
}
