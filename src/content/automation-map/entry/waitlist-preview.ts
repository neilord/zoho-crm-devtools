/**
 * Static, synthetic illustration of the Automation Map for the waitlist popup. It is a fixed SVG
 * with invented node names: no real CRM data, no screenshot, no map runtime. It is decoration
 * only (aria-hidden, inert, pointer-events none) and scales with its box via the viewBox.
 */
const NS = 'http://www.w3.org/2000/svg';
const W = 720;
const H = 400;

type Attrs = Record<string, string | number>;
function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  for (const child of children) element.append(child);
  return element;
}

const KIND: Record<string, string> = {
  event: '#b7791f',
  schedule: '#ae3ec9',
  api: '#e8590c',
  rule: '#2f6df0',
  action: '#5c677d',
  template: '#d6336c',
  fn: '#6741d9',
  field: '#0c8599',
};

/** x, y, width, kind, title, subtitle, selected. Rule boxes are slightly wider than the artwork's first draft so no title clips. */
const NODES: Array<[number, number, number, string, string, string, boolean?]> = [
  [20, 86, 140, 'event', 'Deal created', 'Record event'],
  [20, 150, 140, 'event', 'Stage changed', 'Field event'],
  [20, 214, 140, 'schedule', 'Every Monday 9:00', 'Schedule'],
  [20, 278, 140, 'api', 'Website form', 'API / webform'],
  [178, 96, 156, 'rule', 'Assign new deals', '2 actions'],
  [178, 182, 156, 'rule', 'Closed-won follow-up', '4 actions', true],
  [178, 262, 156, 'rule', 'Weekly pipeline digest', '1 function'],
  [346, 80, 156, 'action', 'Owner = round robin', 'Field update'],
  [346, 146, 156, 'template', 'Notify account team', 'Email alert'],
  [346, 212, 156, 'action', 'Stage → Invoicing', 'Field update'],
  [346, 278, 156, 'action', 'Create onboarding task', 'Task'],
  [530, 120, 170, 'fn', 'sync_invoice()', 'Function · reacts to Stage'],
  [530, 200, 170, 'fn', 'score_deal()', 'Function · writes Amount'],
  [530, 280, 170, 'field', 'Deal · Amount', '3 writers · 2 reactors'],
];

const EDGES: Array<[string, string, number?, string?]> = [
  ['M150 108 C164 108 164 118 178 118', '#b3bccb'],
  ['M150 300 C170 300 160 118 178 118', '#b3bccb'],
  ['M150 172 C164 172 164 204 178 204', '#2f6df0', 2],
  ['M150 236 C164 236 164 284 178 284', '#b3bccb'],
  ['M334 118 C336 118 336 102 346 102', '#b3bccb'],
  ['M334 204 C336 204 336 168 346 168', '#2f6df0', 2],
  ['M334 204 C336 204 336 234 346 234', '#2f6df0', 2],
  ['M334 204 C340 204 336 300 346 300', '#2f6df0', 2],
  ['M502 234 C520 234 512 142 530 142', '#d97706', 2, '4 3'],
  ['M334 284 C340 284 508 222 530 222', '#b3bccb'],
  ['M615 244 L615 280', '#0c8599', 1.5, '3 3'],
];

const text = (content: string, attrs: Attrs, className = '') =>
  node('text', { class: `zw-t ${className}`.trim(), ...attrs }, [content]);

/** The small floating "chrome" panels (view switch, search, zoom) share one rounded, shadowed plate. */
const plate = (x: number, y: number, w: number, h: number, r = 9) =>
  node('rect', { x, y, width: w, height: h, rx: r, class: 'zw-plate', filter: 'url(#zw-shadow)' });

export function createWaitlistPreview(): HTMLElement {
  const svg = node('svg', {
    class: 'zw-svg',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMinYMin slice',
    focusable: 'false',
    'aria-hidden': 'true',
  });

  svg.append(
    node('defs', {}, [
      node('pattern', { id: 'zw-dots', width: 16, height: 16, patternUnits: 'userSpaceOnUse' }, [
        node('circle', { cx: 1, cy: 1, r: 1, fill: '#d9dfea' }),
      ]),
      node('filter', { id: 'zw-shadow', x: '-20%', y: '-40%', width: '140%', height: '190%' }, [
        node('feDropShadow', {
          dx: 0,
          dy: 4,
          stdDeviation: 6,
          'flood-color': '#0f172a',
          'flood-opacity': 0.1,
        }),
      ]),
      node(
        'filter',
        { id: 'zw-node-shadow', x: '-10%', y: '-30%', width: '120%', height: '170%' },
        [
          node('feDropShadow', {
            dx: 0,
            dy: 1,
            stdDeviation: 1,
            'flood-color': '#0f172a',
            'flood-opacity': 0.06,
          }),
        ],
      ),
    ]),
    node('rect', { width: W, height: H, fill: '#f3f5f9' }),
    node('rect', { width: W, height: H, fill: 'url(#zw-dots)' }),
  );

  for (const [d, stroke, width, dash] of EDGES)
    svg.append(
      node('path', {
        d,
        fill: 'none',
        stroke,
        'stroke-width': width ?? 1.5,
        ...(dash ? { 'stroke-dasharray': dash } : {}),
      }),
    );

  for (const [x, label] of [
    [22, 'TRIGGERS'],
    [180, 'RULES'],
    [348, 'ACTIONS'],
    [532, 'FUNCTIONS & FIELDS'],
  ] as const)
    svg.append(text(label, { x, y: 63 }, 'zw-col'));

  NODES.forEach(([x, y, w, kind, title, sub, selected], index) => {
    const clipId = `zw-clip-${index}`;
    svg.append(
      node('clipPath', { id: clipId }, [node('rect', { x: x + 24, y, width: w - 32, height: 44 })]),
      node('rect', {
        x: x + 0.5,
        y: y + 0.5,
        width: w - 1,
        height: 43,
        rx: 8,
        fill: '#fff',
        stroke: selected ? '#2f6df0' : '#dfe4ee',
        ...(selected ? { 'stroke-width': 1.5 } : {}),
        filter: 'url(#zw-node-shadow)',
      }),
    );
    if (selected)
      svg.append(
        node('rect', {
          x: x - 3,
          y: y - 3,
          width: w + 6,
          height: 50,
          rx: 11,
          fill: 'none',
          stroke: '#2f6df0',
          'stroke-opacity': 0.18,
          'stroke-width': 4,
        }),
      );
    svg.append(
      kind === 'field'
        ? node('rect', { x: x + 10, y: y + 18, width: 8, height: 8, rx: 2, fill: KIND[kind] })
        : node('circle', { cx: x + 14, cy: y + 22, r: 4, fill: KIND[kind] }),
      node('g', { 'clip-path': `url(#${clipId})` }, [
        text(title, { x: x + 26, y: y + 19 }, 'zw-ntitle'),
        text(sub, { x: x + 26, y: y + 33 }, 'zw-nsub'),
      ]),
    );
  });

  // Board / List / Fields switch.
  svg.append(
    plate(14, 12, 156, 28),
    node('rect', { x: 17, y: 15, width: 52, height: 22, rx: 6, fill: '#eaf1fe' }),
    text('Board', { x: 43, y: 26, 'text-anchor': 'middle' }, 'zw-tab zw-tab-on'),
    text('List', { x: 95, y: 26, 'text-anchor': 'middle' }, 'zw-tab'),
    text('Fields', { x: 140, y: 26, 'text-anchor': 'middle' }, 'zw-tab'),
  );

  // Search pill.
  svg.append(
    plate(200, 12, 230, 28),
    node(
      'g',
      {
        fill: 'none',
        stroke: '#5f687b',
        'stroke-width': 1.3,
        transform: 'translate(210 20) scale(.6)',
      },
      [node('circle', { cx: 9, cy: 9, r: 6 }), node('path', { d: 'M14 14l4 4' })],
    ),
    text('Search rules, functions, fields', { x: 228, y: 26 }, 'zw-search'),
  );

  // Module chip.
  svg.append(
    plate(546, 12, 108, 28),
    text('Deals', { x: 558, y: 26 }, 'zw-tab zw-tab-strong'),
    text('· 14 rules', { x: 597, y: 26 }, 'zw-search'),
  );

  // Minimap: a miniature of the board with the viewport outlined.
  svg.append(plate(14, 326, 104, 60, 8));
  const mini: Array<[number, number, string?]> = [
    [4, 6],
    [4, 16],
    [4, 26],
    [28, 10],
    [28, 22, '#9db8f6'],
    [52, 8],
    [52, 20],
    [74, 14],
  ];
  for (const [x, y, fill] of mini)
    svg.append(
      node('rect', {
        x: 20 + x,
        y: 332 + y,
        width: x === 74 ? 16 : 18,
        height: 5,
        rx: 2,
        fill: fill ?? '#dde3ee',
      }),
    );
  svg.append(
    node('rect', {
      x: 20.75,
      y: 334.75,
      width: 90.5,
      height: 34.5,
      rx: 4,
      fill: 'none',
      stroke: '#2f6df0',
      'stroke-width': 1.5,
    }),
  );

  // Zoom bar.
  svg.append(
    plate(608, 358, 98, 28),
    text('−', { x: 622, y: 372, 'text-anchor': 'middle' }, 'zw-zoom'),
    text('100%', { x: 657, y: 372, 'text-anchor': 'middle' }, 'zw-tab'),
    text('+', { x: 692, y: 372, 'text-anchor': 'middle' }, 'zw-zoom'),
  );

  const wrap = document.createElement('div');
  wrap.className = 'zw-preview';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.setAttribute('inert', '');
  wrap.append(svg);
  return wrap;
}
