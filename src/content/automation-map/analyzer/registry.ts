import type { WriteEffect } from './types';

interface Task {
  op: WriteEffect['op'];
  module: number;
  target?: number;
  payload?: number;
  options?: number;
  connection?: number;
  parent?: number;
  min: number;
}
/** Zero-based roles; optional argument placeholders never shift these positions. */
export const TASKS: Record<string, Task> = {
  createRecord: { op: 'create', module: 0, payload: 1, options: 2, connection: 3, min: 2 },
  updateRecord: {
    op: 'update',
    module: 0,
    target: 1,
    payload: 2,
    options: 3,
    connection: 4,
    min: 3,
  },
  bulkCreate: { op: 'bulk-create', module: 0, payload: 1, options: 2, connection: 3, min: 2 },
  bulkUpdate: { op: 'bulk-update', module: 0, payload: 1, options: 2, connection: 3, min: 2 },
  upsert: { op: 'upsert', module: 0, payload: 1, options: 2, connection: 3, min: 2 },
  updateRelatedRecord: {
    op: 'update-related',
    module: 0,
    target: 1,
    parent: 2,
    payload: 4,
    connection: 5,
    min: 5,
  },
  attachFile: { op: 'attach', module: 0, target: 1, connection: 3, min: 3 },
  convertLead: { op: 'convert', module: -1, target: 0, payload: 1, connection: 2, min: 2 },
};
export const NATIVE_DEFAULTS: Partial<Record<WriteEffect['op'], string[]>> = {
  create: ['approval', 'blueprint', 'orchestration'],
  update: ['approval', 'blueprint', 'orchestration'],
  'bulk-create': ['approval', 'blueprint'],
  'bulk-update': ['approval', 'blueprint'],
  upsert: ['approval', 'blueprint'],
};
/** Exact reviewed authorities only. Explicit current-context origin can extend this. */
export const CRM_HOSTS = new Set(['www.zohoapis.com']);
export const SERVICE_HOSTS: Record<string, string> = {
  'books.zoho.com': 'books',
  'desk.zoho.com': 'desk',
  'cliq.zoho.com': 'cliq',
  'mail.zoho.com': 'mail',
};
export const RESERVED = new Set([
  'settings',
  'functions',
  'coql',
  'org',
  'users',
  'bulk',
  'actions',
  'notifications',
]);
