import type {
  WorkflowAction,
  WorkflowCriteria,
  WorkflowEmailTemplate,
  WorkflowField,
  WorkflowFieldMapping,
  WorkflowModule,
  WorkflowRule,
  WorkflowTrigger,
  WorkflowTriggerType,
} from './types';

export type Wire = Record<string, unknown>;
export const object = (v: unknown): Wire =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Wire) : {};
export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const string = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const nullable = (v: unknown) => string(v) || null;
const boolean = (v: unknown) => (typeof v === 'boolean' ? v : null);
export const json = (v: unknown): string => JSON.stringify(v) ?? '';
export type FieldLabels = ReadonlyMap<string, WorkflowField>;
export function normalizeModule(v: unknown): WorkflowModule {
  const r = object(v);
  const apiName = string(r.api_name ?? v);
  return {
    apiName,
    label: string(r.plural_label ?? r.display_label ?? r.name) || apiName,
    ...(r.id ? { id: string(r.id) } : {}),
  };
}
export function normalizeField(v: unknown, labels?: FieldLabels): WorkflowField {
  const r = object(v);
  const apiName = string(r.api_name ?? v);
  return (
    labels?.get(string(r.id)) ??
    labels?.get(apiName) ?? {
      apiName,
      label: string(r.field_label ?? r.display_label) || apiName,
      ...(r.id ? { id: string(r.id) } : {}),
    }
  );
}
export function normalizeCriteria(v: unknown, labels?: FieldLabels): WorkflowCriteria | null {
  if (v == null) return null;
  const r = object(v);
  if (Array.isArray(r.group) && /^(AND|OR)$/i.test(string(r.group_operator)))
    return {
      kind: 'group',
      operator: string(r.group_operator).toUpperCase() as 'AND' | 'OR',
      children: r.group
        .map((c) => normalizeCriteria(c, labels))
        .filter((c): c is WorkflowCriteria => c !== null),
      raw: v,
    };
  if (r.field && r.comparator)
    return {
      kind: 'predicate',
      field: normalizeField(r.field, labels),
      comparator: string(r.comparator),
      value: r.value,
      valueType: string(r.type),
      raw: v,
    };
  return { kind: 'unknown', jsonText: json(v), raw: v };
}
export const triggerTypes: readonly WorkflowTriggerType[] = [
  'field_update',
  'create',
  'create_or_edit',
  'edit',
  'date_or_datetime',
  'mail_sent',
  'mail_sent_opened',
  'mail_sent_bounced',
  'email_received',
  'section_update',
  'incoming_call_createedit',
  'outgoing_call_createedit',
  'unknown',
];
function offset(v: unknown) {
  if (v == null) return null;
  const r = object(v);
  return {
    unit: typeof r.unit === 'number' ? r.unit : nullable(r.unit),
    period: nullable(r.period),
    raw: v,
  };
}
export function normalizeTrigger(v: unknown, labels?: FieldLabels): WorkflowTrigger | null {
  if (v == null) return null;
  const r = object(v),
    d = object(r.details),
    type = string(r.type);
  const base = {
    triggerModule: d.trigger_module ? normalizeModule(d.trigger_module) : null,
    repeat: boolean(d.repeat),
    raw: v,
  };
  if (type === 'field_update')
    return {
      ...base,
      type,
      criteria: normalizeCriteria(d.criteria, labels),
      matchAll: boolean(d.match_all),
    };
  if (type === 'date_or_datetime')
    return {
      ...base,
      type,
      field: d.field ? normalizeField(d.field, labels) : null,
      offset: offset(d),
      recurrence: nullable(d.recur_cycle),
      executeAt: nullable(d.execute_at),
    };
  if (type === 'section_update')
    return { ...base, type, sectionIds: array(d.section_ids).map(string) };
  if (triggerTypes.includes(type as WorkflowTriggerType) && type !== 'unknown')
    return { ...base, type } as WorkflowTrigger;
  return { ...base, type: 'unknown', rawType: type, jsonText: json(v) };
}
function mappings(v: unknown, labels?: FieldLabels): WorkflowFieldMapping[] {
  return array(v).map((raw) => {
    const r = object(raw);
    return {
      field: normalizeField(r.field, labels),
      type: nullable(r.type),
      value: r.value,
      displayValue: r.display_value,
      raw,
    };
  });
}
export const resourceKinds = {
  functions: 'function',
  email_notifications: 'emailNotification',
  tasks: 'task',
  field_updates: 'fieldUpdate',
  webhooks: 'webhook',
} as const;
export function normalizeAction(
  v: unknown,
  resource?: unknown,
  labels?: FieldLabels,
): WorkflowAction {
  const r = object(v),
    d = object(resource ?? r.details),
    type = string(r.type);
  const base = {
    id: nullable(r.id),
    name: string(d.name ?? r.name),
    module: d.module ? normalizeModule(d.module) : null,
    state:
      resource !== undefined || !(type in resourceKinds)
        ? ('loaded' as const)
        : ('not-requested' as const),
    raw: v,
    ...(resource !== undefined ? { resourceRaw: resource } : {}),
  };
  switch (type) {
    case 'field_updates':
      return {
        ...base,
        kind: 'fieldUpdate',
        field: d.field ? normalizeField(d.field, labels) : null,
        value: d.value,
        valueType: nullable(d.type),
        relatedModule: d.related_module ? normalizeModule(d.related_module) : null,
      };
    case 'tasks':
      return {
        ...base,
        kind: 'task',
        subject: nullable(
          array(d.field_mappings)
            .map(object)
            .find((m) => object(m.field).api_name === 'Subject')?.value,
        ),
        fieldMappings: mappings(d.field_mappings, labels),
      };
    case 'email_notifications':
      return {
        ...base,
        kind: 'emailNotification',
        template: d.template
          ? {
              id: string(object(d.template).id),
              name: string(object(d.template).name),
              subject: null,
              bodyText: null,
              state: 'not-requested',
              raw: d.template,
            }
          : null,
        recipients: d.recipients,
      };
    case 'webhooks':
      return { ...base, kind: 'webhook', url: nullable(d.url), method: nullable(d.http_method) };
    case 'functions':
      return {
        ...base,
        kind: 'function',
        bindingName: base.name,
        apiName: nullable(object(d.function).api_name),
        crmFunctionId: nullable(object(d.function).id),
        delugeFunctionId: null,
        joinConfidence: 'none',
        sourceState: 'not-requested',
        sourceText: null,
        arguments: array(d.arguments).map((raw) => {
          const a = object(raw);
          return { name: string(a.name), type: nullable(a.type), value: a.value, raw };
        }),
      };
    case 'slack_notifications':
      return {
        ...base,
        kind: 'slack',
        message: d.message == null ? null : richTextToText(string(d.message)),
        notifyTo: d.notify_to,
      };
    case 'assign_owner':
      return { ...base, kind: 'assignOwner', assignTo: array(d.assign_to), configuration: d };
    case 'add_tags':
      return {
        ...base,
        kind: 'addTags',
        tags: array(d.tags).map((t) => {
          const tag = object(t);
          return {
            id: nullable(tag.id) ?? undefined,
            name: string(tag.name),
            colorCode: nullable(tag.color_code) ?? undefined,
          };
        }),
        overwrite: boolean(d.over_write),
      };
    case 'convert':
      return {
        ...base,
        kind: 'convert',
        fieldMappings: mappings(d.field_mappings, labels),
        configuration: d,
      };
    default:
      return { ...base, kind: 'unknown', rawType: type, jsonText: json(v) };
  }
}
const templateCache = new WeakMap<object, WorkflowEmailTemplate>();
export function normalizeTemplate(v: unknown): WorkflowEmailTemplate {
  if (v && typeof v === 'object') {
    const cached = templateCache.get(v);
    if (cached) return cached;
  }
  const r = object(v);
  const result: WorkflowEmailTemplate = {
    id: string(r.id),
    name: string(r.name),
    subject: nullable(r.subject),
    bodyText: richTextToText(string(r.content) || string(r.mail_content)),
    state: 'loaded',
    raw: v,
  };
  if (v && typeof v === 'object') templateCache.set(v, result);
  return result;
}
export function normalizeRule(v: unknown, detail?: unknown, labels?: FieldLabels): WorkflowRule {
  const r = object(detail ?? v);
  return {
    id: string(r.id),
    name: string(r.name),
    description: string(r.description),
    module: normalizeModule(r.module),
    active: boolean(object(r.status).active),
    deprecated: boolean(r.deprecated),
    category: nullable(r.category),
    createdBy:
      typeof r.created_by === 'string'
        ? r.created_by
        : r.created_by
          ? {
              id: nullable(object(r.created_by).id) ?? undefined,
              name: nullable(object(r.created_by).name) ?? undefined,
              raw: r.created_by,
            }
          : undefined,
    modifiedTime:
      typeof r.modified_time === 'number'
        ? r.modified_time
        : (nullable(r.modified_time) ?? undefined),
    trigger: normalizeTrigger(r.execute_when, labels),
    conditions: array(r.conditions).map((raw) => {
      const c = object(raw),
        cd = object(c.criteria_details),
        related = object(cd.relational_criteria);
      return {
        id: nullable(c.id),
        sequenceNumber: typeof c.sequence_number === 'number' ? c.sequence_number : null,
        criteria: normalizeCriteria(cd.criteria, labels),
        relatedCriteria: cd.relational_criteria
          ? {
              module: related.module ? normalizeModule(related.module) : null,
              moduleSelection: related.module_selection,
              criteria: normalizeCriteria(related.criteria, labels),
              raw: cd.relational_criteria,
            }
          : null,
        instantActions: array(object(c.instant_actions).actions).map((a) =>
          normalizeAction(a, undefined, labels),
        ),
        scheduledActions: array(c.scheduled_actions).map((raw) => {
          const s = object(raw);
          return {
            id: nullable(s.id),
            offset: offset(s.execute_after),
            label: json(s.execute_after),
            actions: array(s.actions).map((a) => normalizeAction(a, undefined, labels)),
            raw,
          };
        }),
        raw,
      };
    }),
    detailState: detail === undefined ? 'not-requested' : 'loaded',
    enrichmentState: 'not-requested',
    failureIds: [],
    raw: v,
    ...(detail === undefined ? {} : { detailRaw: detail }),
  };
}

/** Parse only in an inert template; return text nodes, never attach CRM markup. */
export function richTextToText(value: string): string {
  const markup = value.replace(/<\/template(?=[\t\n\f\r />])/gi, '&lt;/template');
  const parsed = new DOMParser().parseFromString(`<template>${markup}</template>`, 'text/html');
  const content = (parsed.querySelector('template') as HTMLTemplateElement).content;
  for (const node of content.querySelectorAll('script,style')) node.remove();
  for (const node of content.querySelectorAll('br,p,div,li,tr,h1,h2,h3'))
    node.append(document.createTextNode('\n'));
  return content.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
}
