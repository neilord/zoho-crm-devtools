import { contract } from '../../billing/config';
import { automationMapComingSoon } from '../../features/automation-map-gate';
import { closeIcon, el } from '../functions/dom';
import type { CrmContext } from '../zoho/crm-context';
import whatsNewCss from './whats-new-card.css?inline';

/**
 * The "What's new" announcement card (ADR 0034): a corner card in its own
 * shadow root whose hero previews each listed tool as its row is hovered or
 * focused. It owns no policy; the caller decides when to show it and what an
 * acknowledgement persists.
 */

export const WHATS_NEW_HOST_ID = 'zcdt-whats-new';

export interface WhatsNewCardHandle {
  host: HTMLDivElement;
  close(): void;
}

type CardContext = Pick<CrmContext, 'origin' | 'orgId'>;

interface Feature {
  title: string;
  description: string;
  /** Row label; "Coming soon" replaces "Beta" while the map is gated (ADR 0035). */
  badge?: 'beta' | 'soon';
  /** Path under the org's CRM URL. */
  path: string;
  icon: IconName;
}

type IconName = 'search' | 'map' | 'export';

const FEATURES: Feature[] = [
  {
    title: 'Search All Workflows',
    description: 'Find any criteria, action, field update or linked function across every rule.',
    path: 'settings/workflow-rules',
    icon: 'search',
  },
  {
    title: 'Automation Map',
    description: 'See how rules, field updates and functions connect on one zoomable map.',
    badge: 'beta',
    path: 'settings/workflow-rules#zcdt-map=v1',
    icon: 'map',
  },
  {
    title: 'Export functions',
    description: 'Download every function with its Deluge code as JSON, CSV or Markdown.',
    path: 'settings/functions',
    icon: 'export',
  },
];

/** Resolved per render so the switch can be flipped without touching the table. */
function featureCopy(feature: Feature): Feature {
  if (feature.icon !== 'map' || !automationMapComingSoon()) return feature;
  return {
    ...feature,
    badge: 'soon',
    description:
      'Coming soon to Pro: see how rules, field updates and functions connect on one map.',
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

type SvgChild = SVGElement | string;

function svgNode(tag: string, attrs: Record<string, string | number>, children: SvgChild[] = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

const path = (d: string, extra: Record<string, string | number> = {}) =>
  svgNode('path', { d, ...extra });

function strokeIcon(size: number, viewBox: string, className: string, shapes: SVGElement[]) {
  return svgNode(
    'svg',
    {
      class: className,
      width: size,
      height: size,
      viewBox,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    shapes,
  );
}

function featureIcon(name: IconName): SVGElement {
  const shapes: Record<IconName, SVGElement[]> = {
    search: [svgNode('circle', { cx: 10.5, cy: 10.5, r: 6 }), path('M15 15l5 5')],
    map: [
      svgNode('circle', { cx: 5.5, cy: 6, r: 2.3 }),
      svgNode('circle', { cx: 18.5, cy: 8.5, r: 2.3 }),
      svgNode('circle', { cx: 12, cy: 18.5, r: 2.3 }),
      path('M7.7 6.4l8.6 1.6M6.6 8l4.2 8.4M17.5 10.6l-4.4 6'),
    ],
    export: [path('M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14')],
  };
  return strokeIcon(18, '0 0 24 24', 'wn-ic', shapes[name]);
}

const arrowIcon = () =>
  strokeIcon(12, '0 0 16 16', 'wn-ic wn-arrow', [path('M3 8h9M8.5 4.5L12 8l-3.5 3.5')]);

/** The DevTools `</>` glyph; the PNG icon is not web-accessible, so it is drawn inline. */
function logo(): SVGElement {
  return svgNode(
    'svg',
    { class: 'wn-logo', width: 32, height: 32, viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    [
      svgNode('circle', { cx: 16, cy: 16, r: 15.5, fill: '#ffffff', stroke: '#e2e6ee' }),
      path('M13 11l-5 5 5 5M19 11l5 5-5 5', {
        fill: 'none',
        stroke: '#2f6df0',
        'stroke-width': 2.2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ],
  );
}

function searchPanel(): HTMLElement {
  const result = (dot: string, name: string, tag: string, tagClass = '') =>
    el('div', { className: 'wn-res' }, [
      el('i', { className: `wn-dot ${dot}` }),
      el('span', { className: 'wn-res-name', text: name }),
      el('span', { className: `wn-tag ${tagClass}`.trim(), text: tag }),
    ]);
  return el('div', { className: 'wn-panel' }, [
    el('div', { className: 'wn-search' }, [
      strokeIcon(12, '0 0 24 24', 'wn-ic', [
        svgNode('circle', { cx: 10.5, cy: 10.5, r: 6 }),
        path('M15 15l5 5'),
      ]),
      el('span', {}, [
        el('span', { className: 'wn-hit', text: 'Stage' }),
        document.createTextNode('__c'),
      ]),
    ]),
    result('wn-dot-accent', 'Deal stage → Negotiation alert', 'Criteria', 'wn-tag-green'),
    result('wn-dot-green', 'Set Stage to Won', 'Field update'),
    result('wn-dot-neutral', 'sync_stage()', 'Function'),
  ]);
}

function mapNode(x: number, y: number, w: number, kind: 'b' | 'g' | 'n', label: string) {
  const palette = {
    b: ['#eaf0fe', '#b9cdf8', '#2458c9'],
    g: ['#d5ece3', '#a9d5c4', '#0f6e56'],
    n: ['#f1f3f8', '#cfd6e4', '#3d4657'],
  }[kind];
  return [
    svgNode('rect', {
      x,
      y,
      width: w,
      height: 22,
      rx: 6,
      fill: palette[0],
      stroke: palette[1],
    }),
    svgNode(
      'text',
      {
        x: x + w / 2,
        y: y + 12,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: palette[2],
      },
      [label],
    ),
  ];
}

function mapPanel(): HTMLElement {
  const graph = svgNode(
    'svg',
    { class: 'wn-svg', viewBox: '0 0 290 76', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgNode('g', { transform: 'translate(0 8)' }, [
        path('M78 21C98 21 98 55 118 55M192 55C206 55 206 37 214 37M192 15C206 15 206 37 214 37', {
          fill: 'none',
          stroke: '#b7c0d0',
          'stroke-width': 1.3,
        }),
        path('M78 21C98 21 98 15 118 15', { fill: 'none', stroke: '#2f6df0', 'stroke-width': 1.6 }),
        ...mapNode(8, 10, 70, 'b', 'Deal alert'),
        ...mapNode(118, 4, 74, 'g', 'Stage = Won'),
        ...mapNode(118, 44, 74, 'n', 'sync_stage()'),
        ...mapNode(214, 26, 68, 'b', 'Won notice'),
      ]),
    ],
  );
  return el('div', { className: 'wn-panel' }, [graph as unknown as Node]);
}

function exportPanel(): HTMLElement {
  const file = (x: number, label: string, bg: string, fg: string) => {
    const wide = label.length > 3;
    return svgNode('g', { transform: `translate(${x} 12)` }, [
      path('M0 0H34L50 16V80H0Z', { fill: '#ffffff', stroke: '#d5dbe6' }),
      path('M34 0V16H50', { fill: '#f7f9fc', stroke: '#d5dbe6' }),
      svgNode('rect', { x: 6, y: 24, width: wide ? 32 : 28, height: 13, rx: 3, fill: bg }),
      svgNode(
        'text',
        {
          class: 'wn-mono',
          x: 6 + (wide ? 16 : 14),
          y: 31,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: fg,
        },
        [label],
      ),
      svgNode('rect', { x: 6, y: 44, width: 38, height: 3, rx: 1.5, fill: '#e2e6ee' }),
      svgNode('rect', { x: 6, y: 52, width: 28, height: 3, rx: 1.5, fill: '#e2e6ee' }),
      svgNode('rect', { x: 6, y: 60, width: 34, height: 3, rx: 1.5, fill: '#e2e6ee' }),
    ]);
  };
  const svg = svgNode(
    'svg',
    { class: 'wn-svg', viewBox: '0 0 290 76', 'aria-hidden': 'true', focusable: 'false' },
    [
      file(46, 'JSON', '#eaf0fe', '#2458c9'),
      file(120, 'CSV', '#d5ece3', '#0f6e56'),
      file(194, 'MD', '#f1f3f8', '#3d4657'),
    ],
  );
  return el('div', { className: 'wn-panel' }, [svg as unknown as Node]);
}

export function featureUrl(context: CardContext, feature: Pick<Feature, 'path'>): string {
  return `${context.origin}/crm/org${context.orgId}/${feature.path}`;
}

export function showWhatsNewCard(
  context: CardContext,
  onAcknowledge: () => void,
): WhatsNewCardHandle {
  document.getElementById(WHATS_NEW_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = WHATS_NEW_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = whatsNewCss;
  shadow.appendChild(style);

  let acknowledged = false;

  const close = (): void => {
    host.remove();
  };

  const acknowledge = (): void => {
    if (acknowledged) {
      return;
    }
    acknowledged = true;
    onAcknowledge();
  };

  // Used for buttons, which can leave immediately.
  const settle = (): void => {
    acknowledge();
    close();
  };

  // A link keeps its native same-tab navigation, which does not start if the
  // anchor is detached while the click is still being handled, so removal waits a tick.
  const settleLink = (): void => {
    acknowledge();
    setTimeout(close, 0);
  };

  const card = el('section', {
    className: 'wn-card',
    attrs: {
      role: 'complementary',
      'aria-label': "What's new in Zoho CRM DevTools",
      'data-active': '0',
    },
  });

  const setActive = (index: number): void => {
    card.dataset.active = String(index);
  };

  const rows = FEATURES.map(featureCopy).map((feature, index) => {
    const href = featureUrl(context, feature);
    const row = el('li', { className: 'wn-row', dataset: { i: String(index) } }, [
      el('span', { className: 'wn-tile' }, [featureIcon(feature.icon)]),
      el('div', {}, [
        el('div', { className: 'wn-row-title' }, [
          el('a', { className: 'wn-link', attrs: { href }, onClick: settleLink }, [
            el('span', { text: feature.title }),
            arrowIcon() as unknown as Node,
          ]),
          feature.badge === 'beta' ? el('span', { className: 'wn-beta', text: 'Beta' }) : null,
          feature.badge === 'soon'
            ? el('span', { className: 'wn-soon', text: 'Coming soon' })
            : null,
        ]),
        el('p', { className: 'wn-row-desc', text: feature.description }),
      ]),
    ]);
    row.addEventListener('pointerenter', () => setActive(index));
    row.addEventListener('focusin', () => setActive(index));
    // Touch has no hover: tapping the row background previews it, while the title link still navigates.
    row.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('a')) {
        setActive(index);
      }
    });
    return row;
  });

  const hero = el('div', { className: 'wn-hero', attrs: { 'aria-hidden': 'true' } }, [
    el('div', { className: 'wn-layer wn-layer-0' }, [searchPanel()]),
    el('div', { className: 'wn-layer wn-layer-1' }, [mapPanel()]),
    el('div', { className: 'wn-layer wn-layer-2' }, [exportPanel()]),
  ]);

  card.append(
    el(
      'button',
      {
        className: 'wn-close',
        type: 'button',
        title: 'Close',
        attrs: { 'aria-label': 'Close' },
        onClick: (event) => {
          event.preventDefault();
          settle();
        },
      },
      [closeIcon(16)],
    ),
    hero,
    el('div', { className: 'wn-content' }, [
      el('div', { className: 'wn-header' }, [
        logo() as unknown as Node,
        el('span', { className: 'wn-eyebrow', text: 'New in Zoho CRM DevTools' }),
      ]),
      el('h2', { className: 'wn-title', text: 'New tools for workflows and functions' }),
      el('ul', { className: 'wn-list' }, rows),
      el('div', { className: 'wn-actions' }, [
        el('a', {
          className: 'wn-primary',
          text: 'Try Search All Workflows',
          attrs: { href: featureUrl(context, FEATURES[0]) },
          onClick: settleLink,
        }),
        el('button', {
          className: 'wn-ghost',
          type: 'button',
          text: 'Got it',
          onClick: (event) => {
            event.preventDefault();
            settle();
          },
        }),
      ]),
      el('p', {
        className: 'wn-fine',
        text: `Included in paid plans · ${contract.trial.days}-day free trial`,
      }),
    ]),
  );

  shadow.appendChild(card);
  document.body.appendChild(host);

  return { host, close };
}
