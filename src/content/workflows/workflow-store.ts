import { workflowCacheMessage } from '../../shared/browser';
import {
  isWorkflowCache,
  type WorkflowCache,
  type WorkflowGraphCache,
} from '../../shared/workflow-cache-protocol';
import { type FetchLike, fetchAllFunctions, fetchFunctionDetail } from '../functions/api';
import type { CrmContext } from '../functions/crm-context';
import type { ZohoFunctionSummary } from '../functions/types';
import { retryRequest } from '../zoho/api-client';
import { parseOrgId } from '../zoho/crm-context';
import { zohoRequestPool } from '../zoho/request-pool';
import { isWorkflowsListLocation } from '../zoho/workflows-page';
import { type ResourceType, resourceTypes, WorkflowApi } from './api';
import { hasWorkflowSearchAccess } from './controller';
import {
  array,
  type FieldLabels,
  normalizeAction,
  normalizeCriteria,
  normalizeField,
  normalizeRule,
  normalizeTemplate,
  object,
  resourceKinds,
  string,
} from './normalize';
import { functionJoinIdentity, joinFunction } from './related-functions';
import type {
  WorkflowAction,
  WorkflowFailureTarget,
  WorkflowIndexFailure,
  WorkflowIndexProgress,
  WorkflowIndexSnapshot,
  WorkflowRule,
} from './types';

export type WorkflowIndexListener = (snapshot: WorkflowIndexSnapshot) => void;
export interface WorkflowIndexDependencies {
  context: Readonly<CrmContext>;
  fetch: typeof fetch;
  /** Map composition owns access, route lifetime and its all-function source pool. */
  hasAccess?: () => Promise<boolean>;
  isCurrentRoute?: () => boolean;
  getCatalogue?: () => Promise<ZohoFunctionSummary[]>;
  getFunctionSource?: (summary: ZohoFunctionSummary) => Promise<string | null>;
}
const initialProgress = (): WorkflowIndexProgress => ({
  phase: 'idle',
  rulesTotal: null,
  ruleDetailsTotal: null,
  actionResourcesTotal: null,
  templatesTotal: null,
  functionSourcesTotal: null,
  functionSourcesFailed: 0,
  rulesListed: 0,
  ruleDetailsLoaded: 0,
  ruleDetailsFailed: 0,
  actionResourcesLoaded: 0,
  actionResourcesFailed: 0,
  templatesLoaded: 0,
  templatesFailed: 0,
  functionSourcesAvailable: 0,
  functionSourcesUnavailable: 0,
  functionSourcesUncertain: 0,
  isComplete: false,
  failures: [],
});
interface Job {
  target: WorkflowFailureTarget;
  owners: string[];
  run(): Promise<void>;
}

/** Scoped graph owner. Unchanged rules keep identity; earlier snapshots remain immutable. */
export class WorkflowIndex {
  private ruleCache = new Map<string, WorkflowRule>();
  private listeners = new Set<WorkflowIndexListener>();
  private snapshot: WorkflowIndexSnapshot = { rules: [], progress: initialProgress() };
  private controller = new AbortController();
  private disposed = false;
  private running: Promise<void> | null = null;
  private summaries: unknown[] = [];
  private details = new Map<string, unknown>();
  private resources = new Map<string, unknown>();
  private templates = new Map<string, unknown>();
  private fields = new Map<string, FieldLabels>();
  private catalogue: ZohoFunctionSummary[] | null = null;
  private sources = new Map<string, string | null>();
  private refreshed = new Set<string>();
  private revalidating = false;
  private warmGraph = false;
  private hasFullList = false;
  private jobs = new Map<string, Job>();
  private failures = new Map<string, WorkflowIndexFailure>();
  private context: Readonly<CrmContext>;
  private locationGuard: boolean;
  private routeGuard: boolean;
  constructor(private dependencies: WorkflowIndexDependencies) {
    this.context = { ...dependencies.context };
    // Pure injected contexts work in harnesses; real CRM instances guard origin+org on every await.
    this.locationGuard = typeof location !== 'undefined' && parseOrgId(location.pathname) !== null;
    this.routeGuard = this.locationGuard && isWorkflowsListLocation();
  }
  private fetch: typeof fetch = (input, init) => {
    this.guard();
    return this.dependencies.fetch(input, init);
  };
  private guard(): void {
    this.controller.signal.throwIfAborted();
    if (
      this.disposed ||
      (this.dependencies.isCurrentRoute
        ? !this.dependencies.isCurrentRoute()
        : this.routeGuard && !isWorkflowsListLocation()) ||
      (this.locationGuard &&
        (location.origin !== this.context.origin ||
          parseOrgId(location.pathname) !== this.context.orgId))
    ) {
      this.controller.abort();
      this.controller.signal.throwIfAborted();
    }
  }
  private monitorContext(): () => void {
    const timer = setInterval(() => {
      try {
        this.guard();
      } catch {
        /* guard aborts the owned signal */
      }
    }, 200);
    return () => clearInterval(timer);
  }
  subscribe(listener: WorkflowIndexListener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
  private rules(): WorkflowRule[] {
    return this.summaries.map((raw) => {
      const id = string(object(raw).id),
        detail = this.details.get(id);
      const cached = this.ruleCache.get(id);
      if (cached) return cached;
      const rule = normalizeRule(
        raw,
        detail,
        this.fields.get(string(object(object(raw).module).api_name)),
      );
      const enrich = (action: WorkflowAction): WorkflowAction => {
        const type = string(object(action.raw).type),
          key = `${type}:${action.id}`;
        const resource = this.resources.get(key),
          moduleName = string(object(object(resource).module).api_name) || rule.module.apiName;
        let next = normalizeAction(action.raw, resource, this.fields.get(moduleName));
        if (this.failures.has(key) && resource === undefined) next = { ...next, state: 'failed' };
        if (next.kind === 'emailNotification' && next.template) {
          const template = this.templates.get(next.template.id);
          next = {
            ...next,
            template: template
              ? normalizeTemplate(template)
              : {
                  ...next.template,
                  state: this.failures.has(`template:${next.template.id}`)
                    ? 'failed'
                    : 'not-requested',
                },
          };
        }
        if (next.kind === 'function' && this.catalogue) {
          const join = joinFunction(next, this.catalogue),
            source = join.summary ? this.sources.get(join.summary.id) : undefined;
          next = {
            ...next,
            delugeFunctionId: join.summary?.id ?? null,
            joinConfidence: join.confidence,
            sourceState:
              join.confidence !== 'exact'
                ? 'unavailable'
                : this.failures.has(`source:${join.summary?.id}`) && !source
                  ? 'unavailable'
                  : source === undefined
                    ? 'loading'
                    : source === null
                      ? 'unavailable'
                      : 'available',
            sourceText: join.confidence === 'exact' ? (source ?? null) : null,
          };
        }
        return next;
      };
      const failureIds = [...this.failures.values()]
        .filter((f) => f.ruleIds.includes(id) || f.target.kind === 'list')
        .map((f) => f.id);
      const enriched: WorkflowRule = {
        ...rule,
        detailState:
          this.failures.has(`rule:${id}`) && detail === undefined ? 'failed' : rule.detailState,
        failureIds,
        enrichmentState: failureIds.length
          ? 'failed'
          : this.snapshot.progress.phase === 'complete'
            ? 'loaded'
            : 'loading',
        conditions: rule.conditions.map((c) => ({
          ...c,
          relatedCriteria: c.relatedCriteria
            ? {
                ...c.relatedCriteria,
                criteria: normalizeCriteria(
                  c.relatedCriteria.criteria?.raw,
                  this.fields.get(c.relatedCriteria.module?.apiName ?? ''),
                ),
              }
            : null,
          instantActions: c.instantActions.map(enrich),
          scheduledActions: c.scheduledActions.map((s) => ({
            ...s,
            actions: s.actions.map(enrich),
          })),
        })),
      };
      this.ruleCache.set(id, enriched);
      return enriched;
    });
  }
  private publish(phase = this.snapshot.progress.phase): void {
    this.guard();
    if ((phase === 'complete') !== (this.snapshot.progress.phase === 'complete'))
      this.ruleCache.clear();
    this.snapshot = { ...this.snapshot, progress: { ...this.snapshot.progress, phase } };
    const rules = this.rules(),
      functions = new Map<string, Extract<WorkflowAction, { kind: 'function' }>>();
    for (const r of rules)
      for (const a of actions(r))
        if (a.kind === 'function' && a.state === 'loaded') functions.set(a.id ?? a.bindingName, a);
    const failures = [...this.failures.values()];
    const uncertain = [...functions.values()].filter(
      (a) => a.joinConfidence === 'uncertain',
    ).length;
    const unresolved = [...functions.values()].some(
      (a) => a.joinConfidence === 'none' || a.sourceState !== 'available',
    );
    const allActions = rules.flatMap(actions);
    const resourceKeys = new Set(
      allActions
        .filter((a) => a.id && resourceTypes.includes(string(object(a.raw).type) as ResourceType))
        .map((a) => `${string(object(a.raw).type)}:${a.id}`),
    );
    const templateIds = new Set(
      allActions.flatMap((a) =>
        a.kind === 'emailNotification' && a.template ? [a.template.id] : [],
      ),
    );
    const sourceKeys = new Set(
      [...functions.values()].map((a) =>
        a.joinConfidence === 'exact'
          ? `source:${a.delugeFunctionId}`
          : `binding:${a.id ?? a.bindingName}`,
      ),
    );
    const listed = this.hasFullList || !['idle', 'listing', 'failed'].includes(phase);
    const detailsKnown =
      listed && rules.every((r) => this.details.has(r.id) || this.failures.has(`rule:${r.id}`));
    const resourcesKnown =
      detailsKnown &&
      [...resourceKeys].every((key) => this.resources.has(key) || this.failures.has(key));
    // Count the current dependency set, not stale cached sources. A failed re-read
    // of a cached null is one retryable failure, not also a second unavailable gap.
    const exactIds = new Set(
      [...functions.values()]
        .filter((a) => a.joinConfidence === 'exact')
        .map((a) => a.delugeFunctionId),
    );
    const available = [...exactIds].filter(
      (id) => typeof this.sources.get(id ?? '') === 'string',
    ).length;
    const missing = [...exactIds].filter(
      (id) => this.sources.get(id ?? '') === null && !this.failures.has(`source:${id}`),
    ).length;
    const unmatched = this.catalogue
      ? [...functions.values()].filter((a) => a.joinConfidence === 'none').length
      : 0;
    const progress: WorkflowIndexProgress = {
      ...initialProgress(),
      phase,
      refreshing: this.revalidating && this.warmGraph,
      rulesTotal: listed ? rules.length : null,
      ruleDetailsTotal: listed ? rules.length : null,
      actionResourcesTotal: detailsKnown ? resourceKeys.size : null,
      templatesTotal: resourcesKnown ? templateIds.size : null,
      functionSourcesTotal:
        resourcesKnown && (this.catalogue !== null || functions.size === 0)
          ? sourceKeys.size
          : null,
      functionSourcesFailed: failures.filter((f) => f.target.kind === 'functionSource').length,
      rulesListed: rules.length,
      ruleDetailsLoaded: this.details.size,
      ruleDetailsFailed: failures.filter((f) => f.target.kind === 'ruleDetail').length,
      actionResourcesLoaded: this.resources.size,
      actionResourcesFailed: failures.filter((f) => f.target.kind === 'actionResource').length,
      templatesLoaded: this.templates.size,
      templatesFailed: failures.filter((f) => f.target.kind === 'template').length,
      functionSourcesAvailable: available,
      functionSourcesUnavailable: missing + unmatched,
      functionSourcesUncertain: uncertain,
      failures,
      isComplete:
        phase === 'complete' &&
        !failures.length &&
        !unresolved &&
        rules.every(
          (r) =>
            r.detailState === 'loaded' &&
            actions(r).every(
              (a) =>
                a.state === 'loaded' &&
                (a.kind !== 'emailNotification' || !a.template || a.template.state === 'loaded'),
            ),
        ),
    };
    if (phase === 'complete' && import.meta.env.MODE === 'development')
      console.debug('Zoho CRM DevTools: workflow coverage', {
        available,
        missing,
        unmatched,
        uncertain,
        // Only categories/counts, never CRM names, ids, source or template content.
        failures: failures.reduce<Record<string, number>>((counts, failure) => {
          counts[failure.target.kind] = (counts[failure.target.kind] ?? 0) + 1;
          return counts;
        }, {}),
      });
    this.snapshot = { rules, progress };
    for (const listener of this.listeners) listener(this.snapshot);
  }
  private updateOwners(key: string, owners: string[]): void {
    const ruleIds = [...new Set(owners)];
    const failure = this.failures.get(key);
    if (failure) this.failures.set(key, { ...failure, ruleIds });
    const job = this.jobs.get(key);
    if (job) job.owners = ruleIds;
  }
  private invalidate(owners: readonly string[]): void {
    for (const id of owners) this.ruleCache.delete(id);
  }
  private async job(
    key: string,
    target: WorkflowFailureTarget,
    owners: string[],
    run: () => Promise<void>,
  ): Promise<void> {
    const job = { target, owners, run };
    this.jobs.set(key, job);
    try {
      this.guard();
      await run();
      this.guard();
      this.failures.delete(key);
      this.refreshed.add(key);
    } catch {
      this.guard();
      this.failures.set(key, {
        id: key,
        target,
        ruleIds: [...owners],
        message: 'Zoho configuration could not be read. Retry this dependency.',
        retry: () => this.retryKeys([key]),
      });
    }
    // A dependency only invalidates the rules that own it. Catalogue/metadata owners
    // include every affected rule, including shared scheduled occurrences.
    if (target.kind === 'list') this.ruleCache.clear();
    else for (const id of owners) this.ruleCache.delete(id);
    this.publish();
  }
  load(signal: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed) return Promise.reject(new Error('Workflow index disposed'));
    const cancel = () => this.controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const stopMonitoring = this.monitorContext();
    this.running = this.loadIndex().finally(() => {
      stopMonitoring();
      signal.removeEventListener('abort', cancel);
      this.running = null;
    });
    return this.running;
  }
  private async loadIndex(): Promise<void> {
    try {
      this.guard();
      if (!(await (this.dependencies.hasAccess ?? hasWorkflowSearchAccess)()))
        throw new Error('Paid workflow access required');
      this.guard();
      let cached: WorkflowRule[] = [];
      let graph: WorkflowGraphCache | null = null;
      try {
        const cache = await workflowCacheMessage({
          type: 'workflows:readCache',
          origin: this.context.origin,
          orgId: this.context.orgId,
        });
        this.guard();
        if (isWorkflowCache(cache)) {
          if (cache.version === 1) cached = cache.rules;
          else graph = cache;
        }
      } catch (error) {
        if (import.meta.env.MODE === 'development')
          console.warn('Zoho CRM DevTools: workflow cache read failed', error);
        this.guard();
      }
      // Warm data is advisory; use only wire nodes, never executable or unchecked normalized trees.
      this.resources.clear();
      this.templates.clear();
      this.sources.clear();
      this.fields.clear();
      this.catalogue = null;
      this.failures.clear();
      this.jobs.clear();
      const warmCatalogue = new Map<string, ZohoFunctionSummary>();
      for (const r of cached) {
        for (const c of array(r.conditions).map(object)) {
          const warmActions = [
            ...array(c.instantActions),
            ...array(c.scheduledActions).flatMap((s) => array(object(s).actions)),
          ];
          for (const raw of warmActions) {
            const a = object(raw),
              occurrence = object(a.raw),
              type = string(occurrence.type);
            if (resourceTypes.includes(type as ResourceType) && a.resourceRaw)
              this.resources.set(`${type}:${string(occurrence.id)}`, a.resourceRaw);
            if (a.kind === 'emailNotification' && object(a.template).raw)
              this.templates.set(string(object(a.template).id), object(a.template).raw);
            const normalized = normalizeAction(a.raw, a.resourceRaw);
            if (
              normalized.kind === 'function' &&
              normalized.apiName &&
              a.joinConfidence === 'exact' &&
              /^\d+$/.test(string(a.delugeFunctionId))
            ) {
              const id = string(a.delugeFunctionId);
              warmCatalogue.set(id, {
                id,
                api_name: normalized.apiName,
                display_name: normalized.name,
                category: '',
              });
              if (a.sourceState === 'available' && typeof a.sourceText === 'string')
                this.sources.set(id, a.sourceText);
              else if (a.sourceState === 'unavailable') this.sources.set(id, null);
            }
          }
        }
      }
      if (warmCatalogue.size) this.catalogue = [...warmCatalogue.values()];
      this.refreshed.clear();
      this.revalidating = true;
      this.ruleCache.clear();
      this.summaries = cached.map((r) => r.raw);
      this.details = new Map(cached.filter((r) => r.detailRaw).map((r) => [r.id, r.detailRaw]));
      if (graph) {
        this.summaries = graph.summaries;
        this.details = new Map(graph.details);
        this.resources = new Map(graph.resources);
        this.templates = new Map(graph.templates);
        this.fields = new Map(graph.fields.map(([name, fields]) => [name, new Map(fields)]));
        this.catalogue = graph.catalogue;
        this.sources = new Map(graph.sources);
        cached = this.rules();
      }
      this.hasFullList = graph !== null || cached.length > 0;
      this.warmGraph = this.hasFullList;
      this.publish('listing');
      const api = new WorkflowApi(this.context, this.fetch, this.controller.signal);
      await this.job('list', { kind: 'list' }, [], async () => {
        const listed = await api.list((raw) => {
          this.guard();
          // Keep the full warm view while paginating; a partial list must not shrink coverage.
          if (!cached.length) {
            this.ruleCache.clear();
            this.summaries = raw;
            this.publish('listing');
          }
        });
        this.summaries = listed;
        this.hasFullList = true;
        const keep = new Map<string, unknown>();
        for (const raw of this.summaries) {
          const r = object(raw),
            old = cached.find((c) => c.id === string(r.id));
          if (old?.detailRaw && r.modified_time != null && old.modifiedTime === r.modified_time)
            keep.set(old.id, old.detailRaw);
        }
        for (const id of keep.keys()) this.refreshed.add(`rule:${id}`);
        const ids = new Set(this.summaries.map((r) => string(object(r).id)));
        this.details = new Map([...this.details].filter(([id]) => ids.has(id)));
        // Keep advisory data visible. Freshness is tracked separately from presence.
        this.ruleCache.clear();
      });
      if (this.failures.has('list')) {
        this.revalidating = false;
        this.publish(this.warmGraph ? 'complete' : 'failed');
        return;
      }
      await this.enrich(api);
    } catch (error) {
      if (this.controller.signal.aborted) {
        if (
          !this.disposed &&
          (!this.dependencies.isCurrentRoute || this.dependencies.isCurrentRoute()) &&
          (!this.routeGuard || this.dependencies.isCurrentRoute || isWorkflowsListLocation()) &&
          (!this.locationGuard ||
            (location.origin === this.context.origin &&
              parseOrgId(location.pathname) === this.context.orgId))
        ) {
          this.snapshot = {
            ...this.snapshot,
            progress: { ...this.snapshot.progress, phase: 'cancelled', isComplete: false },
          };
          for (const listener of this.listeners) listener(this.snapshot);
        }
      }
      throw error;
    }
  }
  private async enrich(api: WorkflowApi): Promise<void> {
    this.publish('details');
    await Promise.all(
      this.summaries.map((raw) => {
        const id = string(object(raw).id);
        return (this.revalidating ? this.refreshed.has(`rule:${id}`) : this.details.has(id)) ||
          this.failures.has(`rule:${id}`)
          ? undefined
          : this.job(`rule:${id}`, { kind: 'ruleDetail', ruleId: id }, [id], async () => {
              const detail = await api.rule(id);
              this.guard();
              this.details.set(id, detail);
              this.invalidate([id]);
            });
      }),
    );
    this.publish('actions');
    const refs = new Map<string, { type: ResourceType; id: string; owners: string[] }>();
    for (const r of this.rules())
      for (const a of actions(r)) {
        const type = string(object(a.raw).type) as ResourceType;
        if (!a.id || !resourceTypes.includes(type)) continue;
        const key = `${type}:${a.id}`,
          ref = refs.get(key) ?? { type, id: a.id, owners: [] };
        if (!ref.owners.includes(r.id)) ref.owners.push(r.id);
        refs.set(key, ref);
      }
    for (const [key, ref] of refs) this.updateOwners(key, ref.owners);
    await Promise.all(
      [...refs].map(([key, ref]) =>
        (this.revalidating ? this.refreshed.has(key) : this.resources.has(key)) ||
        this.failures.has(key)
          ? undefined
          : this.job(
              key,
              { kind: 'actionResource', actionKind: resourceKinds[ref.type], resourceId: ref.id },
              ref.owners,
              async () => {
                const raw = await api.resource(ref.type, ref.id);
                this.guard();
                this.resources.set(key, raw);
                this.invalidate(ref.owners);
              },
            ),
      ),
    );
    const templateOwners = new Map<string, string[]>(),
      modules = new Map<string, string[]>();
    const module = (name: string, id: string) => {
      if (name) modules.set(name, [...new Set([...(modules.get(name) ?? []), id])]);
    };
    for (const r of this.rules()) {
      module(r.module.apiName, r.id);
      module(r.trigger?.triggerModule?.apiName ?? '', r.id);
      for (const c of r.conditions) module(c.relatedCriteria?.module?.apiName ?? '', r.id);
      for (const a of actions(r)) {
        module(a.module?.apiName ?? '', r.id);
        if (a.kind === 'fieldUpdate') module(a.relatedModule?.apiName ?? '', r.id);
        if (a.kind === 'emailNotification' && a.template)
          templateOwners.set(a.template.id, [
            ...new Set([...(templateOwners.get(a.template.id) ?? []), r.id]),
          ]);
      }
    }
    for (const [id, owners] of templateOwners) this.updateOwners(`template:${id}`, owners);
    for (const [name, owners] of modules) this.updateOwners(`metadata:${name}`, owners);
    this.publish('templates');
    await Promise.all(
      [...templateOwners].map(([id, owners]) =>
        (this.revalidating ? this.refreshed.has(`template:${id}`) : this.templates.has(id)) ||
        this.failures.has(`template:${id}`)
          ? undefined
          : this.job(`template:${id}`, { kind: 'template', templateId: id }, owners, async () => {
              const raw = await api.template(id);
              this.guard();
              this.templates.set(id, raw);
              this.invalidate(owners);
            }),
      ),
    );
    await Promise.all(
      [...modules].map(([name, owners]) =>
        (this.revalidating ? this.refreshed.has(`metadata:${name}`) : this.fields.has(name)) ||
        this.failures.has(`metadata:${name}`)
          ? undefined
          : this.job(
              `metadata:${name}`,
              { kind: 'metadata', moduleApiName: name },
              owners,
              async () => {
                const raw = await api.fields(name);
                const labels = new Map();
                for (const f of raw) {
                  const field = normalizeField(f);
                  labels.set(field.apiName, field);
                  if (field.id) labels.set(field.id, field);
                }
                this.guard();
                this.fields.set(name, labels);
                this.invalidate(owners);
              },
            ),
      ),
    );
    this.publish('sources');
    const bindings = this.rules().flatMap((r) =>
      actions(r)
        .filter((a) => a.kind === 'function')
        .map((a) => ({ rule: r.id, action: a as Extract<WorkflowAction, { kind: 'function' }> })),
    );
    const catalogueIdentities = new Map<string, string>();
    const request: FetchLike = (url, init) =>
      zohoRequestPool.run(this.controller.signal, async () => {
        const response = await retryRequest(url, init ?? {}, this.fetch, this.controller.signal);
        if (
          response.ok &&
          response.status !== 204 &&
          new URL(url).pathname.endsWith('/settings/functions')
        ) {
          const body = object(await response.clone().json());
          if (
            !Array.isArray(body.functions) ||
            !body.functions.every((f) => /^\d+$/.test(string(object(f).id)))
          )
            throw new Error('Invalid function catalogue');
          // fetchAllFunctions deduplicates IDs. Detect conflicting duplicate identities
          // before that first-page-wins projection can make workflow joins order-dependent.
          for (const raw of body.functions as ZohoFunctionSummary[]) {
            const id = string(raw.id),
              identity = functionJoinIdentity(raw);
            const previous = catalogueIdentities.get(id);
            if (previous !== undefined && previous !== identity)
              throw new Error('Conflicting function catalogue identities');
            catalogueIdentities.set(id, identity);
          }
        }
        return response;
      });
    if (
      bindings.length &&
      (this.revalidating ? !this.refreshed.has('catalogue') : !this.catalogue) &&
      !this.failures.has('catalogue')
    )
      await this.job(
        'catalogue',
        { kind: 'functionCatalogue' },
        [...new Set(bindings.map((b) => b.rule))],
        async () => {
          const catalogue = await (this.dependencies.getCatalogue?.() ??
            fetchAllFunctions(this.context, request));
          this.guard();
          const previous = new Map(this.catalogue?.map((entry) => [entry.id, entry]));
          for (const entry of catalogue) {
            const old = previous.get(entry.id);
            // A timestamp is evidence only for the same catalogue identity. Missing
            // timestamps (including legacy caches) must trigger a fresh source read.
            if (old && functionJoinIdentity(old) === functionJoinIdentity(entry)) {
              if (
                entry.updatedTime != null &&
                old.updatedTime === entry.updatedTime &&
                this.sources.has(entry.id)
              )
                this.refreshed.add(`source:${entry.id}`);
            } else this.sources.delete(entry.id);
          }
          this.catalogue = catalogue;
          this.invalidate(bindings.map((b) => b.rule));
        },
      );
    const sources = new Map<string, { summary: ZohoFunctionSummary; owners: string[] }>();
    for (const b of bindings) {
      const join = joinFunction(b.action, this.catalogue ?? []);
      if (join.confidence !== 'exact' || !join.summary) continue;
      const ref = sources.get(join.summary.id) ?? { summary: join.summary, owners: [] };
      ref.owners.push(b.rule);
      sources.set(join.summary.id, ref);
    }
    for (const [id, ref] of sources) this.updateOwners(`source:${id}`, ref.owners);
    await Promise.all(
      [...sources].map(([id, ref]) =>
        (this.revalidating ? this.refreshed.has(`source:${id}`) : this.sources.has(id)) ||
        this.failures.has(`source:${id}`)
          ? undefined
          : this.job(
              `source:${id}`,
              { kind: 'functionSource', delugeFunctionId: id },
              [...new Set(ref.owners)],
              async () => {
                const source = this.dependencies.getFunctionSource
                  ? await this.dependencies.getFunctionSource(ref.summary)
                  : await fetchFunctionDetail(this.context, ref.summary, request, true).then(
                      (detail) =>
                        typeof detail?.script === 'string'
                          ? detail.script
                          : typeof detail?.workflow === 'string'
                            ? detail.workflow
                            : null,
                    );
                this.guard();
                this.sources.set(id, source?.trim() ? source : null);
                this.invalidate(ref.owners);
              },
            ),
      ),
    );
    this.resources = new Map([...this.resources].filter(([key]) => refs.has(key)));
    this.templates = new Map([...this.templates].filter(([id]) => templateOwners.has(id)));
    this.sources = new Map([...this.sources].filter(([id]) => sources.has(id)));
    this.revalidating = false;
    this.ruleCache.clear();
    this.publish('complete');
    try {
      await workflowCacheMessage({
        type: 'workflows:writeCache',
        origin: this.context.origin,
        orgId: this.context.orgId,
        value: this.cacheSnapshot(),
      });
    } catch (error) {
      // Cache failure never blocks fresh data, but must be visible during acceptance.
      if (import.meta.env.MODE === 'development')
        console.warn('Zoho CRM DevTools: workflow cache write failed', error);
    }
    this.guard();
  }
  private cacheSnapshot(): WorkflowCache {
    return {
      version: 2,
      savedAt: Date.now(),
      summaries: this.summaries,
      details: [...this.details],
      resources: [...this.resources],
      templates: [...this.templates],
      fields: [...this.fields].map(([name, fields]) => [name, [...fields]]),
      catalogue:
        this.catalogue?.map((entry) => ({
          id: entry.id,
          // Zoho returns api_name:null for legacy/unbound functions despite the typed API.
          // One unrelated nullable entry must not invalidate the entire org's warm graph.
          api_name: typeof entry.api_name === 'string' ? entry.api_name : undefined,
          display_name: entry.display_name,
          language: entry.language,
          source: entry.source,
          category: entry.category,
          // A failed refresh leaves the old source readable, but must not certify
          // it with the new catalogue timestamp on the next warm start.
          updatedTime: this.failures.has(`source:${entry.id}`) ? undefined : entry.updatedTime,
          // Name-only joins also use workflow.name; preserve their identity on hydration.
          workflow: entry.workflow,
        })) ?? null,
      sources: [...this.sources],
    };
  }
  private retryKeys(keys: string[]): Promise<void> {
    // Completion is published before the asynchronous cache write finishes. A click
    // on the now-visible Retry control must queue the retry, not silently drop it.
    if (this.running) return this.running.then(() => this.retryKeys(keys));
    const stopMonitoring = this.monitorContext();
    this.running = (async () => {
      this.guard();
      if (!(await (this.dependencies.hasAccess ?? hasWorkflowSearchAccess)()))
        throw new Error('Paid workflow access required');
      this.guard();
      await Promise.all(
        keys.map((key) => {
          const job = this.jobs.get(key);
          return job ? this.job(key, job.target, job.owners, job.run) : undefined;
        }),
      );
      if (!this.failures.has('list'))
        await this.enrich(new WorkflowApi(this.context, this.fetch, this.controller.signal));
    })().finally(() => {
      stopMonitoring();
      this.running = null;
    });
    return this.running;
  }
  retryFailed(): Promise<void> {
    return this.retryKeys([...this.failures.keys()]);
  }
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    this.listeners.clear();
  }
}
export function actions(rule: WorkflowRule): WorkflowAction[] {
  return rule.conditions.flatMap((c) => [
    ...c.instantActions,
    ...c.scheduledActions.flatMap((s) => s.actions),
  ]);
}
