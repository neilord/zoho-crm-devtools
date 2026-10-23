import { type FetchLike, fetchFunctionDetail } from '../../functions/api';
import type { ZohoFunctionSummary } from '../../functions/types';
import { type ResourceType, resourceTypes } from '../../workflows/api';
import {
  array,
  normalizeAction,
  normalizeTemplate,
  object,
  string,
} from '../../workflows/normalize';
import { functionJoinIdentity } from '../../workflows/related-functions';
import type { WorkflowAction } from '../../workflows/types';
import { buildRequestHeaders, retryRequest } from '../../zoho/api-client';
import type { CrmContext } from '../../zoho/crm-context';
import { zohoRequestPool } from '../../zoho/request-pool';
import type {
  ApprovalInput,
  ButtonInput,
  FunctionInput,
  ModuleInput,
  ScheduleInput,
  TransitionInput,
} from '../types';

/** Tokenize JSON strings/numbers before parsing; never rewrite digits inside quoted source. */
export function patchLargeIntegers(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) =>
    /^-?\d{16,}$/.test(token) ? `"${token}"` : token,
  );
}
const nullable = (v: unknown) => (typeof v === 'string' && v ? v : null);
const active = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
function id(v: unknown): string {
  const value = string(v);
  if (!/^\d+$/.test(value)) throw new Error('Invalid configuration identity');
  return value;
}
export function catalogueInput(raw: unknown): FunctionInput {
  const r = object(raw);
  const summary: ZohoFunctionSummary = {
    id: id(r.id),
    display_name: string(r.display_name),
    category: string(r.category),
    api_name: nullable(r.api_name),
    language: nullable(r.language) ?? undefined,
    source: nullable(r.source) ?? undefined,
    description: string(r.description),
    updatedTime:
      typeof r.updatedTime === 'string' || typeof r.updatedTime === 'number'
        ? r.updatedTime
        : undefined,
    workflow:
      r.workflow == null
        ? null
        : {
            name: nullable(object(r.workflow).name) ?? undefined,
            namespace: nullable(object(r.workflow).namespace) ?? undefined,
          },
    associated_place: array(r.associated_place).map(object),
    rest_api: array(r.rest_api).map((raw) => {
      const api = object(raw);
      return { type: string(api.type), active: api.active === true };
    }),
    tasks:
      r.tasks == null
        ? null
        : {
            integrations: array(object(r.tasks).integrations).map((raw) => {
              const task = object(raw);
              return { service: string(task.service), function: string(task.function) };
            }),
          },
  };
  return {
    summary,
    delugeId: summary.id,
    places: array(r.associated_place).map((raw) => {
      const p = object(raw);
      return {
        type: string(p._type),
        id: string(p.id) || null,
        modulePluralLabel: nullable(p.module),
        raw,
      };
    }),
    sourceState: 'pending',
    sourceText: null,
    effects: null,
  };
}

/** All reads, including strict function detail, use the existing tab budget and retry policy. */
export type RetryParent = {
  id: string;
  name: string;
  module: { api_name: string };
  active: boolean | null;
  field: { api_name: string };
};
export type Settle = (
  key: string,
  work: () => Promise<void>,
  parent?: RetryParent,
) => Promise<void>;
export const retryParent = (raw: unknown): RetryParent => {
  const r = object(raw);
  return {
    id: id(r.id),
    name: string(r.name),
    module: { api_name: string(object(r.module).api_name) },
    active: active(r.active),
    field: { api_name: string(object(r.field).api_name) },
  };
};

export class AutomationMapApi {
  private resources = new Map<string, Promise<unknown>>();
  constructor(
    private context: Readonly<CrmContext>,
    private fetch: FetchLike,
    private signal: AbortSignal,
  ) {}
  request: FetchLike = async (input, init) => {
    const url = new URL(input, this.context.origin);
    if (
      url.origin !== this.context.origin ||
      !url.pathname.startsWith('/crm/') ||
      (init?.method && init.method !== 'GET')
    )
      throw new Error('Invalid configuration request');
    return zohoRequestPool.run(this.signal, async () => {
      const response = await retryRequest(
        url.href,
        {
          method: 'GET',
          credentials: 'include',
          redirect: 'error',
          headers: buildRequestHeaders(this.context),
        },
        async (url, options) => {
          const response = await this.fetch(url, options);
          // retryRequest discards error bodies. Recognize only these observed button outcomes
          // inside its fetch seam, before that cancellation, without weakening other errors.
          if (
            response.status === 400 &&
            new URL(url).pathname === '/crm/v8/settings/custom_buttons'
          ) {
            const body = object(await response.clone().json());
            if (body.code === 'NOT_SUPPORTED' || body.code === 'NO_PERMISSION') {
              await response.body?.cancel();
              return new Response(JSON.stringify({ custom_buttons: [], unsupported: true }));
            }
          }
          return response;
        },
        this.signal,
      );
      this.signal.throwIfAborted();
      if (!response.ok || response.status === 204) return response;
      return new Response(patchLargeIntegers(await response.text()), {
        status: response.status,
        headers: response.headers,
      });
    });
  };
  async get(path: string): Promise<Record<string, unknown> | null> {
    const response = await this.request(path);
    if (response.status === 204) return null;
    if (!response.ok) throw new Error('Configuration unavailable');
    return object(await response.json());
  }
  async pages(path: string, key: string): Promise<unknown[]> {
    const result: unknown[] = [],
      seen = new Set<string>();
    for (let page = 1; page <= 1000; page++) {
      const body = await this.get(
        `${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=200`,
      );
      if (body === null) return result;
      if (!Array.isArray(body[key])) throw new Error('Invalid configuration list');
      let added = 0;
      for (const raw of array(body[key])) {
        const key = id(object(raw).id);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(raw);
          added++;
        }
      }
      if (object(body.info).more_records !== true) return result;
      // A fully filtered page can be empty while more_records remains true.
      if (array(body[key]).length && !added)
        throw new Error('Configuration pagination made no progress');
    }
    throw new Error('Configuration page limit exceeded');
  }
  async single(path: string, key: string, identity: string) {
    const values = array((await this.get(path))?.[key]);
    if (values.length !== 1 || string(object(values[0]).id) !== identity)
      throw new Error('Configuration identity mismatch');
    return values[0];
  }
  async catalogue(): Promise<FunctionInput[]> {
    const result = new Map<string, FunctionInput>();
    for (let start = 1; start <= 200_001; start += 200) {
      const body = await this.get(`/crm/v2/settings/functions?type=org&start=${start}&limit=200`);
      if (body === null) return [...result.values()];
      if (!Array.isArray(body.functions)) throw new Error('Invalid function catalogue');
      const batch = body.functions;
      let added = 0;
      for (const raw of batch) {
        const entry = catalogueInput(raw),
          old = result.get(entry.delugeId);
        if (old && functionJoinIdentity(old.summary) !== functionJoinIdentity(entry.summary))
          throw new Error('Conflicting catalogue identity');
        if (!old) {
          result.set(entry.delugeId, entry);
          added++;
        }
      }
      // This legacy endpoint has no info; short-page/204 is its documented exception.
      if (batch.length < 200 && object(body.info).more_records !== true)
        return [...result.values()];
      if (batch.length && !added) throw new Error('Catalogue pagination made no progress');
    }
    throw new Error('Catalogue page limit exceeded');
  }
  async source(summary: ZohoFunctionSummary): Promise<string | null> {
    const detail = await fetchFunctionDetail(this.context, summary, this.request, true);
    const source =
      typeof detail?.script === 'string'
        ? detail.script
        : typeof detail?.workflow === 'string'
          ? detail.workflow
          : null;
    return source?.trim() ? source : null;
  }
  async modules(): Promise<{ modules: ModuleInput[]; workflowModules: string[] }> {
    const [all, supported] = await Promise.all([
      this.get('/crm/v8/settings/modules'),
      this.get('/crm/v2.2/settings/modules?feature_name=workflow'),
    ]);
    if ((all && !Array.isArray(all.modules)) || (supported && !Array.isArray(supported.modules)))
      throw new Error('Invalid modules');
    return {
      modules: array(all?.modules).map((raw) => {
        const r = object(raw);
        return {
          apiName: string(r.api_name),
          label: string(r.singular_label ?? r.module_name ?? r.api_name),
          pluralLabel: nullable(r.plural_label),
        };
      }),
      workflowModules: array(supported?.modules)
        .map((raw) => string(object(raw).api_name))
        .filter(Boolean),
    };
  }
  async fields(module: string) {
    const values = await this.pages(
      `/crm/v8/settings/fields?module=${encodeURIComponent(module)}`,
      'fields',
    );
    return values.map((raw) => {
      const r = object(raw);
      return {
        apiName: string(r.api_name),
        label: string(r.field_label ?? r.display_label ?? r.api_name),
      };
    });
  }
  async buttons(module: string): Promise<{ buttons: ButtonInput[]; unsupported: boolean }> {
    const body = await this.get(
      `/crm/v8/settings/custom_buttons?module=${encodeURIComponent(module)}`,
    );
    if (body && !Array.isArray(body.custom_buttons)) throw new Error('Invalid buttons');
    return {
      unsupported: body?.unsupported === true,
      buttons: array(body?.custom_buttons).map((raw) => {
        const r = object(raw);
        return {
          id: id(r.id),
          name: string(r.name),
          moduleApiName: module,
          placements: Array.isArray(r.position)
            ? r.position.map(string)
            : [string(r.position)].filter(Boolean),
          actionType: string(r.action),
          functionDelugeId: nullable(object(object(r.details).custom_function).id),
          raw,
        };
      }),
    };
  }
  async schedules(): Promise<ScheduleInput[]> {
    return (await this.pages('/crm/v9/settings/automation/schedules', 'schedules')).map((raw) => {
      const r = object(raw);
      return {
        id: id(r.id),
        name: string(r.name),
        active: r.status === 'active' ? true : r.status === 'deactive' ? false : null,
        recurrenceLabel: nullable(object(r.frequency).type),
        functionApiName: nullable(object(r.function).api_name),
        raw,
      };
    });
  }
  async action(raw: unknown): Promise<WorkflowAction> {
    const r = object(raw),
      type = string(r.type) as ResourceType;
    if (!resourceTypes.includes(type)) return normalizeAction(raw);
    const identity = id(r.id ?? r.rid),
      key = `${type}:${identity}`;
    let promise = this.resources.get(key);
    if (!promise) {
      promise = this.single(
        `/crm/v8/settings/automation/${type}/${identity}`,
        type,
        identity,
      ).catch((error) => {
        this.resources.delete(key);
        throw error;
      });
      this.resources.set(key, promise);
    }
    const action = normalizeAction({ ...r, id: identity }, await promise);
    if (action.kind === 'emailNotification' && action.template) {
      const template = normalizeTemplate(
        await this.single(
          `/crm/v8/settings/email_templates/${id(action.template.id)}`,
          'email_templates',
          action.template.id,
        ),
      );
      return { ...action, template };
    }
    return action;
  }
  async blueprints(
    onTransition: (transition: TransitionInput) => void = () => {},
    settle: Settle = (_key, work) => work(),
    parents?: RetryParent[],
    onlyTransition?: string,
  ): Promise<TransitionInput[]> {
    const blueprints = parents ?? (await this.pages('/crm/v8/settings/blueprints', 'blueprints'));
    const result: TransitionInput[] = [];
    for (const raw of blueprints) {
      const b = object(raw),
        blueprintId = id(b.id);
      await settle(
        `blueprints:transitions:${blueprintId}`,
        async () => {
          const transitions = onlyTransition
            ? [{ id: onlyTransition }]
            : await this.pages(
                `/crm/v8/settings/blueprints/${blueprintId}/transitions`,
                'transitions',
              );
          for (const raw of transitions) {
            const transitionId = id(object(raw).id);
            await settle(
              `blueprints:transition:${transitionId}`,
              async () => {
                const r = object(
                  await this.single(
                    `/crm/v8/settings/blueprints/transitions/${transitionId}`,
                    'transitions',
                    transitionId,
                  ),
                );
                const fields = array(r.during_inputs)
                  .filter((v) => object(v).type === 'field')
                  .map((v) => string(object(object(v).field).api_name))
                  .filter(Boolean);
                // Every transition also moves the blueprint's stage field (available in its list).
                if (string(object(b.field).api_name)) fields.push(string(object(b.field).api_name));
                const transition: TransitionInput = {
                  blueprintId,
                  blueprintName: string(b.name),
                  blueprintActive: active(b.active),
                  moduleApiName: string(object(b.module).api_name),
                  transitionId,
                  name: string(r.name),
                  duringInputFields: [...new Set(fields)],
                  actions: await Promise.all(array(r.actions).map((a) => this.action(a))),
                  raw: r,
                };
                result.push(transition);
                onTransition(transition);
              },
              retryParent(b),
            );
          }
        },
        retryParent(b),
      );
    }
    return result;
  }
  async approvals(
    onApproval: (approval: ApprovalInput) => void = () => {},
    settle: Settle = (_key, work) => work(),
    parents?: RetryParent[],
  ): Promise<ApprovalInput[]> {
    const approvals =
      parents ?? (await this.pages('/crm/v9/settings/approval_process', 'approval_process'));
    const result: ApprovalInput[] = [];
    for (const raw of approvals) {
      const a = object(raw),
        identity = id(a.id);
      await settle(
        `approvals:process:${identity}`,
        async () => {
          const rules = await this.pages(
            `/crm/v9/settings/approval_process/${identity}/rules`,
            'rules',
          );
          const refs = rules.flatMap((raw) => {
            const r = object(raw);
            return [
              ...array(object(r.actions_upon_final_approval).actions),
              ...array(object(r.actions_upon_rejection).actions),
              ...array(r.approver_stages).flatMap((raw) => {
                const actions = object(object(raw).actions);
                return [...array(actions.on_approve), ...array(actions.on_approval_trigger)];
              }),
            ];
          });
          const approval: ApprovalInput = {
            id: identity,
            name: string(a.name),
            moduleApiName: string(object(a.module).api_name),
            active: active(a.active),
            actions: await Promise.all(refs.map((r) => this.action(r))),
            raw: { ...a, rules },
          };
          result.push(approval);
          onApproval(approval);
        },
        retryParent(a),
      );
    }
    return result;
  }
}
