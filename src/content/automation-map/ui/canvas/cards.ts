/**
 * Node card DOM (UX spec §5). Shared by the board and the trace flowchart.
 * Everything CRM-derived goes through `textContent`; shapes are CSS (clip-path/pseudo elements).
 */
import { h, type IconSprite } from './dom';
import { actionIcon, KIND_ICON, KIND_LABEL } from './kinds';
import type { BoardItem } from './model';

export interface CardOptions {
  sprite: IconSprite;
  /** Module label for the aria-label ("Deals"); omitted for org-wide items. */
  moduleLabel?: string | null;
  /** Trace layout positions the card itself. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Trace titles prefix the module for fields ("Deals · Stage"). */
  title?: string;
  className?: string;
  /** Trace cards are found through the view's own map; the iid embeds API names, so skip it. */
  omitIid?: boolean;
  /** Compact tier: icon and name only (no second line, tags or mini icons), so fewer elements. */
  compact?: boolean;
}

export function cardClass(item: BoardItem): string {
  const cls = ['amc-nd', `amc-k-${item.kind}`];
  if (item.kind === 'rule' && item.active !== true) cls.push('amc-inactive');
  if (item.gap) cls.push('amc-gap');
  if (item.portal?.dir === 'in') cls.push('amc-inport');
  if (item.node?.kind === 'field' && item.node.bucket !== 'field') cls.push('amc-bucket');
  return cls.join(' ');
}

function iconFor(item: BoardItem, sprite: IconSprite) {
  if (item.kind === 'action') {
    return sprite.icon(actionIcon(item.node?.kind === 'action' ? item.node.action.kind : ''), 13);
  }
  if (item.kind === 'portal')
    return sprite.icon(item.portal?.dir === 'in' ? 'arrowL' : 'arrowR', 14);
  return sprite.icon(KIND_ICON[item.kind], 16);
}

export function ariaLabelFor(item: BoardItem, moduleLabel?: string | null): string {
  const kind = KIND_LABEL[item.kind];
  const parts = [`${kind}: ${item.title}`];
  if (moduleLabel) parts.push(moduleLabel);
  if (item.kind === 'rule') parts.push(item.active === true ? 'active' : 'inactive');
  if (item.hub) parts.push(`called by ${item.hub.callers}`);
  return parts.join(', ');
}

export function createCard(item: BoardItem, opts: CardOptions): HTMLElement {
  const el = h('div', opts.className ? `${cardClass(item)} ${opts.className}` : cardClass(item), {
    role: 'button',
    tabindex: '-1',
    'data-iid': opts.omitIid ? null : item.iid,
  });
  el.style.cssText = `left:${opts.x}px;top:${opts.y}px;width:${opts.w}px;height:${opts.h}px`;
  el.setAttribute('aria-label', ariaLabelFor(item, opts.moduleLabel));

  const ic = h('span', 'amc-ic');
  ic.append(iconFor(item, opts.sprite));
  el.append(ic);

  const compact = opts.compact === true;
  // Compact actions are icon chips; the full name is in the aria-label and the hover tip.
  if (!(compact && item.kind === 'action')) {
    const t1 = h('span', 'amc-t1', null, opts.title ?? item.title);
    // Trigger labels list every watched field and can outgrow the card even on two lines: the
    // full text stays one hover away. The aria-label above already carries it for assistive tech
    // (a title here would only be announced twice).
    t1.title = opts.title ?? item.title;
    if (compact) {
      // One line only: no wrapper element (the render budget counts every node of a card).
      t1.classList.add('amc-t1-solo');
      el.append(t1);
    } else {
      const tx = h('span', 'amc-tx');
      tx.append(t1);
      if (item.subtitle || item.pending) {
        const t2 = h('span', item.pending ? 'amc-t2 amc-skel-line' : 'amc-t2', null, item.subtitle);
        tx.append(t2);
      }
      el.append(tx);
    }
  }

  if (compact) {
    appendBadges(el, item, opts);
    return el;
  }
  if (item.kind === 'rule') {
    if (item.miniIcons.length) {
      const mi = h('span', 'amc-mi');
      for (const kind of item.miniIcons) mi.append(opts.sprite.icon(actionIcon(kind), 13));
      el.append(mi);
    }
    if (item.active !== true) el.append(h('span', 'amc-tag', null, 'Inactive'));
  }
  if (item.kind === 'action' && item.timing) {
    const tag = h('span', 'amc-tag amc-tag-sch');
    tag.append(opts.sprite.icon('clock', 10), document.createTextNode(shortTiming(item.timing)));
    el.append(tag);
  }
  if (item.gap) {
    const warn = h('span', 'amc-warnic', { title: 'Not fully analysed' });
    warn.append(opts.sprite.icon('warn', 13));
    el.append(warn);
  }
  appendBadges(el, item, opts);
  return el;
}

/** Hub count badge and port dots: present at every tier. */
function appendBadges(el: HTMLElement, item: BoardItem, opts: CardOptions) {
  if (item.hub) {
    const hub = h('span', 'amc-hub');
    hub.append(h('span', null, null, `Called by ${item.hub.callers}`));
    if (item.hub.here && !opts.compact)
      hub.append(h('span', 'amc-hub-here', null, ` · ${item.hub.here} here`));
    el.append(hub);
  }
  if (item.port)
    el.append(
      h('span', 'amc-port', {
        title: 'Has links that stay hidden until you hover or select this node',
      }),
    );
  if (item.kind === 'api') el.append(h('span', 'amc-port amc-port-api'));
}

/** "2 days after Renewal Date" -> "+2 days" for the compact timing chip. */
export function shortTiming(label: string): string {
  const m = /^(\d+)\s+(\w+)/.exec(label);
  return m ? `+${m[1]} ${m[2]}` : label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

/** Placeholder card shown for "+N more" chips in the trace flowchart. */
export function createMoreChip(
  label: string,
  x: number,
  y: number,
  w: number,
  hh: number,
): HTMLElement {
  const el = h('div', 'amc-nd amc-more', { role: 'button', tabindex: '-1' }, label);
  el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
  return el;
}
