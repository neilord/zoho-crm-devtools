/** Node-kind metadata: labels, colours, icons and the legend shapes (UX spec §5). */
import type { WorkflowActionKind } from '../../workflows/types';
import type { MapNode, MapNodeKind, WriteOperation } from '../types';
import { svgEl } from './dom';
import { type MapIconName, mapIcon } from './icons';

/** Kinds that appear in the legend / "Show" filter, in legend order. */
export type LegendKind = Exclude<MapNodeKind, 'module'>;
export const LEGEND_ORDER: readonly LegendKind[] = [
  'button',
  'schedule',
  'transition',
  'approval',
  'rule',
  'action',
  'function',
  'template',
  'external',
  'field',
];

export const KIND_LABEL: Readonly<Record<MapNodeKind, string>> = {
  module: 'Module',
  field: 'Field',
  rule: 'Workflow rule',
  action: 'Action',
  template: 'Email template',
  function: 'Function',
  button: 'Button',
  schedule: 'Schedule',
  transition: 'Blueprint transition',
  approval: 'Approval process',
  external: 'External system',
};

export const KIND_PLURAL: Readonly<Record<MapNodeKind, string>> = {
  module: 'Modules',
  field: 'Fields',
  rule: 'Workflow rules',
  action: 'Actions',
  template: 'Email templates',
  function: 'Functions',
  button: 'Buttons',
  schedule: 'Schedules',
  transition: 'Blueprint transitions',
  approval: 'Approvals',
  external: 'External systems',
};

export const KIND_COLOR: Readonly<Record<MapNodeKind, string>> = {
  module: '--am-k-module',
  field: '--am-k-field',
  rule: '--am-k-rule',
  action: '--am-k-action',
  template: '--am-k-template',
  function: '--am-k-function',
  button: '--am-k-button',
  schedule: '--am-k-schedule',
  transition: '--am-k-transition',
  approval: '--am-k-approval',
  external: '--am-k-external',
};

const KIND_ICON: Readonly<Record<MapNodeKind, MapIconName>> = {
  module: 'module',
  field: 'field',
  rule: 'workflow',
  action: 'unknown',
  template: 'emailNotification',
  function: 'function',
  button: 'cursor',
  schedule: 'clock',
  transition: 'transition',
  approval: 'approval',
  external: 'globe',
};

export const ACTION_LABEL: Readonly<Record<WorkflowActionKind, string>> = {
  fieldUpdate: 'Field update',
  task: 'Task',
  emailNotification: 'Email notification',
  webhook: 'Webhook',
  function: 'Function call',
  slack: 'Cliq message',
  assignOwner: 'Assign owner',
  addTags: 'Add tags',
  convert: 'Convert',
  unknown: 'Other action',
};

export const OP_LABEL: Readonly<Record<WriteOperation, string>> = {
  update: 'Update',
  create: 'Create · sets initial value',
  upsert: 'Upsert',
  convert: 'Convert mapping',
  delete: 'Delete record',
  relate: 'Update related',
  attach: 'Attach',
  other: 'Change',
};

export const kindColorVar = (kind: MapNodeKind): string => `var(${KIND_COLOR[kind]})`;

export function nodeIconName(node: MapNode): MapIconName {
  return node.kind === 'action' ? node.action.kind : KIND_ICON[node.kind];
}
export const nodeIcon = (node: MapNode, size = 15): SVGSVGElement =>
  mapIcon(nodeIconName(node), size);
export const kindIcon = (kind: MapNodeKind, size = 15): SVGSVGElement =>
  mapIcon(KIND_ICON[kind], size);

export const nodeKindLabel = (node: MapNode): string =>
  node.kind === 'action' ? ACTION_LABEL[node.action.kind] : KIND_LABEL[node.kind];

type ShapeSpec = ReadonlyArray<readonly [tag: 'path' | 'rect', attrs: Record<string, string>]>;
const SHAPES: Partial<Record<MapNodeKind, ShapeSpec>> = {
  button: [
    ['rect', { x: '1', y: '1', width: '20', height: '13', rx: '3', class: 'sh' }],
    ['path', { d: 'M2 14.5h18', class: 'sh-thick' }],
  ],
  schedule: [['rect', { x: '1', y: '2', width: '20', height: '12', rx: '6', class: 'sh' }]],
  transition: [['path', { d: 'M1 1.5h15l5 6.5-5 6.5H1z', class: 'sh' }]],
  approval: [
    ['rect', { x: '1', y: '1.5', width: '20', height: '13', rx: '3', class: 'sh' }],
    ['rect', { x: '3.5', y: '4', width: '15', height: '8', rx: '1.5', class: 'sh-thin' }],
  ],
  rule: [
    ['rect', { x: '1', y: '1.5', width: '20', height: '13', rx: '3', class: 'sh' }],
    ['path', { d: 'M2.5 3v10', class: 'sh-stripe' }],
  ],
  action: [['rect', { x: '5', y: '3', width: '11', height: '10', rx: '2', class: 'sh' }]],
  function: [['path', { d: 'M5 1.5h12l4 6.5-4 6.5H5l-4-6.5z', class: 'sh' }]],
  template: [
    ['path', { d: 'M1.5 1.5h14l5 5v8h-19z', class: 'sh' }],
    ['path', { d: 'M15.5 1.5v5h5', class: 'sh-thin' }],
  ],
  external: [['path', { d: 'M5 1.5h16l-4 13H1z', class: 'sh' }]],
  field: [['rect', { x: '1', y: '3', width: '20', height: '10', rx: '5', class: 'sh' }]],
};

/** Miniature of the node's board shape, so the legend doubles as a shape key. */
export function legendShape(kind: MapNodeKind): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'lgsh';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.setProperty('--k', kindColorVar(kind));
  const svg = svgEl('svg', { width: 22, height: 16, viewBox: '0 0 22 16' });
  for (const [tag, attrs] of SHAPES[kind] ?? []) svg.appendChild(svgEl(tag, attrs));
  wrap.appendChild(svg);
  return wrap;
}
