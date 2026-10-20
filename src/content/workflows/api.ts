import type { FetchLike } from '../functions/api';
import { zohoGet } from '../zoho/api-client';
import type { CrmContext } from '../zoho/crm-context';
import { array, object, string } from './normalize';

const root = '/crm/v8/settings/automation/';
export const resourceTypes = [
  'functions',
  'email_notifications',
  'tasks',
  'field_updates',
  'webhooks',
] as const;
export type ResourceType = (typeof resourceTypes)[number];
function idPath(id: string) {
  if (!/^\d+$/.test(id)) throw new Error('Invalid workflow resource id');
  return id;
}
export class WorkflowApi {
  constructor(
    private context: CrmContext,
    private fetch: FetchLike,
    private signal: AbortSignal,
  ) {}
  get(path: string) {
    return zohoGet(this.context, path, this.fetch, this.signal);
  }
  async list(onPage: (rules: unknown[]) => void): Promise<unknown[]> {
    const rules: unknown[] = [],
      seen = new Set<string>();
    for (let page = 1; ; page++) {
      const payload = await this.get(`${root}workflow_rules?page=${page}&per_page=200`);
      if (payload === null) {
        onPage([...rules]);
        return rules;
      }
      const body = object(payload);
      if (!Array.isArray(body.workflow_rules)) throw new Error('Invalid workflow list');
      const batch = array(body.workflow_rules),
        before = seen.size;
      for (const raw of batch) {
        const id = string(object(raw).id);
        idPath(id);
        if (!seen.has(id)) {
          seen.add(id);
          rules.push(raw);
        }
      }
      onPage([...rules]);
      const more = object(body.info).more_records;
      if (more === false || (more == null && batch.length < 200)) return rules;
      if (seen.size === before) throw new Error('Workflow pagination made no progress');
    }
  }
  private async single(path: string, key: string, id: string): Promise<unknown> {
    const values = array(object(await this.get(path))[key]);
    if (values.length !== 1 || string(object(values[0]).id) !== id)
      throw new Error('Invalid workflow detail');
    return values[0];
  }
  rule(id: string) {
    return this.single(`${root}workflow_rules/${idPath(id)}`, 'workflow_rules', id);
  }
  resource(type: ResourceType, id: string) {
    return this.single(`${root}${type}/${idPath(id)}`, type, id);
  }
  template(id: string) {
    return this.single(`/crm/v8/settings/email_templates/${idPath(id)}`, 'email_templates', id);
  }
  async fields(module: string) {
    const body = object(
      await this.get(`/crm/v8/settings/fields?module=${encodeURIComponent(module)}`),
    );
    if (!Array.isArray(body.fields)) throw new Error('Invalid field metadata');
    return body.fields;
  }
}
