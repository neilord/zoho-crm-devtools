import type { WorkflowActionKind } from './types';

/** Small inline-SVG icon set for the workflow dashboard; built with createElementNS, never innerHTML. */

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
  inbox: [
    ['path', 'M3 11l2-6h10l2 6v4.5H3z'],
    ['path', 'M3 11h4.2l.8 2h4l.8-2H17'],
  ],
  info: [
    ['circle', 10, 10, 7.2],
    ['path', 'M10 9v5M10 6.3v.1'],
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof SHAPES;

export function icon(name: IconName, size = 16, className?: string): SVGSVGElement {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 20 20');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', '1.4');
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  root.setAttribute('class', `i${className ? ` ${className}` : ''}`);
  for (const shape of SHAPES[name] as readonly Shape[]) {
    if (shape[0] === 'path') {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', shape[1]);
      root.appendChild(p);
    } else if (shape[0] === 'circle') {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(shape[1]));
      c.setAttribute('cy', String(shape[2]));
      c.setAttribute('r', String(shape[3]));
      root.appendChild(c);
    } else {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(shape[1]));
      r.setAttribute('y', String(shape[2]));
      r.setAttribute('width', String(shape[3]));
      r.setAttribute('height', String(shape[4]));
      r.setAttribute('rx', String(shape[5]));
      root.appendChild(r);
    }
  }
  return root;
}

export const kindIcon = (kind: WorkflowActionKind, size = 15): SVGSVGElement => icon(kind, size);
