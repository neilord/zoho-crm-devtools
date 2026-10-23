/** Automation Map icon set (20×20 stroke icons from the UX prototype); createElementNS only, never innerHTML. */

const NS = 'http://www.w3.org/2000/svg';
type Shape =
  | readonly ['path', string]
  | readonly ['circle', number, number, number]
  | readonly ['rect', number, number, number, number, number];

const SHAPES = {
  search: [
    ['circle', 8.5, 8.5, 5.5],
    ['path', 'M13 13 L17 17'],
  ],
  close: [['path', 'M5 5 L15 15 M15 5 L5 15']],
  refresh: [
    ['path', 'M16 10a6 6 0 1 1-1.9-4.4'],
    ['path', 'M16 3.5v3.3h-3.3'],
  ],
  check: [['path', 'M4.5 10.5 L8.5 14.5 L15.5 6']],
  warn: [
    ['path', 'M10 3 L18 16.5 H2 Z'],
    ['path', 'M10 8.5v4M10 14.4v.1'],
  ],
  external: [['path', 'M11 4h5v5M16 4l-7 7M14 12v4H4V6h4']],
  code: [['path', 'M7.5 5 L3 10 L7.5 15 M12.5 5 L17 10 L12.5 15']],
  chevron: [['path', 'M6 8 L10 12 L14 8']],
  chevronR: [['path', 'M8 6 L12 10 L8 14']],
  fieldUpdate: [
    ['path', 'M3 17l1-4 9.5-9.5a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L7 16z'],
    ['path', 'M11.5 5.5l3 3'],
  ],
  task: [
    ['rect', 3.5, 3.5, 13, 13, 2.5],
    ['path', 'M6.8 10.2l2.2 2.2 4.2-4.6'],
  ],
  emailNotification: [
    ['rect', 2.5, 4.5, 15, 11, 2],
    ['path', 'M3 5.5l7 5.5 7-5.5'],
  ],
  webhook: [
    ['path', 'M3 10h10M9.5 6.2L13.3 10l-3.8 3.8'],
    ['circle', 16, 10, 1.4],
  ],
  function: [
    [
      'path',
      'M8 3.5c-2 0-2.5 1-2.5 2.6v2c0 1.2-.8 1.9-2 1.9 1.2 0 2 .7 2 1.9v2c0 1.6.5 2.6 2.5 2.6M12 3.5c2 0 2.5 1 2.5 2.6v2c0 1.2.8 1.9 2 1.9-1.2 0-2 .7-2 1.9v2c0 1.6-.5 2.6-2.5 2.6',
    ],
  ],
  slack: [['path', 'M7.5 3l-1 14M13.5 3l-1 14M3.5 7.5h13.5M3 12.5h13.5']],
  assignOwner: [
    ['circle', 10, 7, 3.2],
    ['path', 'M3.8 16.5c.6-3 3-4.7 6.2-4.7s5.6 1.7 6.2 4.7'],
  ],
  addTags: [
    ['path', 'M3 3.5h6.2L17 11.3a1.5 1.5 0 0 1 0 2.1l-3.6 3.6a1.5 1.5 0 0 1-2.1 0L3.5 9.2z'],
    ['circle', 7, 7, 1.1],
  ],
  convert: [['path', 'M3.5 7h12M12.5 4l3 3-3 3M16.5 13h-12M7.5 10l-3 3 3 3']],
  unknown: [
    ['circle', 5, 10, 1.2],
    ['circle', 10, 10, 1.2],
    ['circle', 15, 10, 1.2],
  ],
  trigger: [['path', 'M11 2.5L4.5 11H9l-1 6.5L15.5 8.5H11z']],
  clock: [
    ['circle', 10, 10, 7],
    ['path', 'M10 6v4.2l2.8 1.8'],
  ],
  info: [
    ['circle', 10, 10, 7.2],
    ['path', 'M10 9v5M10 6.3v.1'],
  ],
  cursor: [
    ['path', 'M5 3.2l9.8 6.3-4.4 1.2-2.2 4.3z'],
    ['path', 'M10.4 10.7l3.4 4.6'],
  ],
  plug: [
    ['path', 'M7 2.8v4M13 2.8v4M5 6.8h10v2.7a5 5 0 0 1-10 0z'],
    ['path', 'M10 14.5v2.8'],
  ],
  globe: [
    ['circle', 10, 10, 7],
    ['path', 'M3 10h14M10 3c2.2 2 3.2 4.4 3.2 7s-1 5-3.2 7c-2.2-2-3.2-4.4-3.2-7s1-5 3.2-7z'],
  ],
  field: [
    ['rect', 2.5, 6, 15, 8, 2.5],
    ['path', 'M6.5 8.4v3.2'],
  ],
  workflow: [
    ['circle', 4.6, 5, 1.9],
    ['circle', 4.6, 15, 1.9],
    ['circle', 15.4, 10, 1.9],
    ['path', 'M6.5 5H9a3 3 0 0 1 3 3v2h1.5M6.5 15H9a3 3 0 0 0 3-3v-2'],
  ],
  map: [
    ['path', 'M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z'],
    ['path', 'M7.5 3.5v11M12.5 5.5v11'],
  ],
  module: [
    ['rect', 3, 3, 6, 6, 1.5],
    ['rect', 11, 3, 6, 6, 1.5],
    ['rect', 3, 11, 6, 6, 1.5],
    ['rect', 11, 11, 6, 6, 1.5],
  ],
  lock: [
    ['rect', 4.5, 9, 11, 8, 2],
    ['path', 'M7 9V6.5a3 3 0 0 1 6 0V9'],
  ],
  home: [['path', 'M3.5 9.5L10 4l6.5 5.5M5.5 8v8h9V8']],
  list: [
    ['path', 'M7.5 5.5h9M7.5 10h9M7.5 14.5h9'],
    ['circle', 4, 5.5, 0.9],
    ['circle', 4, 10, 0.9],
    ['circle', 4, 14.5, 0.9],
  ],
  board: [
    ['rect', 2.5, 3, 6.5, 6, 1.5],
    ['rect', 11, 3, 6.5, 9, 1.5],
    ['rect', 2.5, 11, 6.5, 6, 1.5],
    ['rect', 11, 14, 6.5, 3, 1],
  ],
  zoomIn: [['path', 'M10 5v10M5 10h10']],
  zoomOut: [['path', 'M5 10h10']],
  fit: [['path', 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4']],
  link: [
    [
      'path',
      'M8.5 11.5l3-3M7 9.5L5.2 11.3a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.8-1.8a2.5 2.5 0 0 0-3.5-3.5L9.5 7',
    ],
  ],
  trace: [
    ['circle', 4, 10, 2],
    ['circle', 16, 5, 2],
    ['circle', 16, 15, 2],
    ['path', 'M6 10h3.5L14 5.8M9.5 10l4.5 4.2'],
  ],
  filter: [['path', 'M3 4.5h14l-5.5 6.5v5l-3 1.5v-6.5z']],
  back: [['path', 'M12 5l-5 5 5 5']],
  minus: [['path', 'M6 10h8']],
  plus: [['path', 'M10 6v8M6 10h8']],
  loop: [
    ['path', 'M15.5 8.5A6 6 0 0 0 4.6 7M4.5 11.5A6 6 0 0 0 15.4 13'],
    ['path', 'M4.5 3.5V7h3.5M15.5 16.5V13H12'],
  ],
  arrowR: [['path', 'M4 10h11M11 6l4 4-4 4']],
  arrowL: [['path', 'M16 10H5M9 6l-4 4 4 4']],
  sparkle: [['path', 'M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z']],
  shapes: [
    ['circle', 6, 6, 3],
    ['rect', 11, 3, 6, 6, 1],
    ['path', 'M6 11l3.5 6h-7z'],
    ['rect', 11, 11, 6, 6, 3],
  ],
  keyboard: [
    ['rect', 2.5, 5, 15, 10, 2],
    ['path', 'M5.5 8h1M8.5 8h1M11.5 8h1M14 8h.5M6 12h8'],
  ],
  question: [
    ['circle', 10, 10, 7.2],
    ['path', 'M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14v.1'],
  ],
  cloud: [['path', 'M6 15.5h8.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1A3 3 0 0 0 6 15.5z']],
  eye: [
    ['path', 'M2.5 10s3-5.5 7.5-5.5S17.5 10 17.5 10s-3 5.5-7.5 5.5S2.5 10 2.5 10z'],
    ['circle', 10, 10, 2.3],
  ],
  target: [
    ['circle', 10, 10, 7],
    ['circle', 10, 10, 3.2],
    ['path', 'M10 1.8v3M10 15.2v3M1.8 10h3M15.2 10h3'],
  ],
  bolt: [['path', 'M11 2.5L4.5 11H9l-1 6.5L15.5 8.5H11z']],
  transition: [
    ['path', 'M3.5 6l4 4-4 4M9.5 6l4 4-4 4'],
    ['path', 'M16 4.5v11'],
  ],
  approval: [
    ['path', 'M7.2 3.5h5.6l-.9 5h3.6v3.2H4.5V8.5h3.6z'],
    ['path', 'M4.5 15.5h11'],
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type MapIconName = keyof typeof SHAPES;

export function mapIcon(name: MapIconName, size = 16, className?: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', className ? `am-i ${className}` : 'am-i');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const shape of SHAPES[name] as readonly Shape[]) {
    const node = document.createElementNS(NS, shape[0]);
    if (shape[0] === 'path') node.setAttribute('d', shape[1]);
    else if (shape[0] === 'circle') {
      node.setAttribute('cx', String(shape[1]));
      node.setAttribute('cy', String(shape[2]));
      node.setAttribute('r', String(shape[3]));
    } else {
      node.setAttribute('x', String(shape[1]));
      node.setAttribute('y', String(shape[2]));
      node.setAttribute('width', String(shape[3]));
      node.setAttribute('height', String(shape[4]));
      node.setAttribute('rx', String(shape[5]));
    }
    svg.append(node);
  }
  return svg;
}
