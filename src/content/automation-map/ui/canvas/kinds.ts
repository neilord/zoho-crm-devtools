/** Per-kind presentation tables (UX spec §5). Pure data; no DOM. */
import type { MapNodeKind } from '../../types';
import type { MapIconName } from '../icons';

/** Board item kinds: graph kinds plus the three view-model kinds the canvas derives itself. */
export type ItemKind = MapNodeKind | 'event' | 'api' | 'portal';

export const KIND_LABEL: Record<ItemKind, string> = {
  event: 'Record event',
  button: 'Button',
  schedule: 'Schedule',
  api: 'REST API function',
  transition: 'Blueprint transition',
  approval: 'Approval process',
  rule: 'Workflow rule',
  action: 'Action',
  function: 'Function',
  template: 'Email template',
  external: 'External system',
  field: 'Field',
  module: 'Module',
  portal: 'Portal',
};

export const KIND_ICON: Record<ItemKind, MapIconName> = {
  event: 'trigger',
  button: 'cursor',
  schedule: 'clock',
  api: 'plug',
  transition: 'transition',
  approval: 'approval',
  rule: 'workflow',
  action: 'unknown',
  function: 'function',
  template: 'emailNotification',
  external: 'globe',
  field: 'field',
  module: 'module',
  portal: 'arrowR',
};

/** CSS custom property that carries each kind's colour (defined in the frozen tokens). */
export const KIND_VAR: Record<ItemKind, string> = {
  event: '--am-k-event',
  button: '--am-k-button',
  schedule: '--am-k-schedule',
  api: '--am-k-api',
  transition: '--am-k-transition',
  approval: '--am-k-approval',
  rule: '--am-k-rule',
  action: '--am-k-action',
  function: '--am-k-function',
  template: '--am-k-template',
  external: '--am-k-external',
  field: '--am-k-field',
  module: '--am-k-module',
  portal: '--am-k-portal',
};

export const ACTION_LABEL: Record<string, string> = {
  fieldUpdate: 'Field update',
  emailNotification: 'Email notification',
  task: 'Task',
  webhook: 'Webhook',
  function: 'Function call',
  slack: 'Cliq message',
  assignOwner: 'Assign owner',
  addTags: 'Add tags',
  convert: 'Convert',
};

const ACTION_ICONS = new Set<string>([
  'fieldUpdate',
  'emailNotification',
  'task',
  'webhook',
  'function',
  'slack',
  'assignOwner',
  'addTags',
  'convert',
]);

export function actionIcon(kind: string): MapIconName {
  return ACTION_ICONS.has(kind) ? (kind as MapIconName) : 'unknown';
}

export const EXTERNAL_LABEL: Record<string, string> = {
  webhookHost: 'Webhook host',
  urlHost: 'URL host',
  connection: 'Connection',
  zohoService: 'Zoho service',
  email: 'Email',
};

export const TRIGGER_LABEL: Record<string, string> = {
  create: 'Record created',
  edit: 'Record edited',
  create_or_edit: 'Created or edited',
  field_update: 'Field changed',
  date_or_datetime: 'Date or time',
  mail_sent: 'Email sent',
  mail_sent_opened: 'Email opened',
  mail_sent_bounced: 'Email bounced',
  email_received: 'Email received',
  section_update: 'Section updated',
  incoming_call_createedit: 'Incoming call',
  outgoing_call_createedit: 'Outgoing call',
  unknown: 'Trigger unknown',
};

/** Entry-lane order of record-event groups. */
export const TRIGGER_ORDER: Record<string, number> = {
  create: 0,
  edit: 1,
  create_or_edit: 2,
  field_update: 3,
  date_or_datetime: 4,
  section_update: 4.5,
  mail_sent: 5,
  mail_sent_opened: 5.1,
  mail_sent_bounced: 5.2,
  email_received: 5.3,
  incoming_call_createedit: 5.4,
  outgoing_call_createedit: 5.5,
  unknown: 6,
};
