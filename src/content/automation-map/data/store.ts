import type { AccountState } from '../../../billing/client';
import {
  type AutomationMapCache,
  isAutomationMapCache,
} from '../../../shared/automation-map-cache-protocol';
import { automationMapCacheMessage } from '../../../shared/browser';
import type { FetchLike } from '../../functions/api';
import type { ZohoFunctionSummary } from '../../functions/types';
import { resourceTypes, WorkflowApi } from '../../workflows/api';
import {
  array,
  normalizeAction,
  normalizeRule,
  normalizeTemplate,
  object,
  resourceKinds,
  string,
} from '../../workflows/normalize';
import { functionJoinIdentity, joinFunction } from '../../workflows/related-functions';
import type { WorkflowIndexSnapshot } from '../../workflows/types';
import { WorkflowIndex } from '../../workflows/workflow-store';
import { pause } from '../../zoho/api-client';
import { type CrmContext, parseOrgId } from '../../zoho/crm-context';
import { analyzeDelugeEffects, DELUGE_EFFECTS_VERSION } from '../analyzer';
import type {
  AutomationGraph,
  AutomationGraphInputs,
  AutomationMapSnapshot,
  CoverageState,
  FunctionInput,
  MapCoverage,
  MapFailure,
  ModuleInput,
  TeaserReason,
} from '../types';
import { hasAutomationMapAccess } from './access';
import { cacheInputs, hydrateInputs } from './cache';
import { AutomationMapApi, type RetryParent, retryParent } from './zoho-api';

export interface RevealedModuleCandidate {
  apiName: string;
  label: string;
  activeRules: number;
}
export function chooseRevealedModule(
  candidates: readonly RevealedModuleCandidate[],
): string | null {
  return (
    [...candidates]
      .filter((m) => m.activeRules >= 2 && m.activeRules <= 12)
      .sort(
        (a, b) =>
          b.activeRules - a.activeRules ||
          a.label.localeCompare(b.label) ||
          a.apiName.localeCompare(b.apiName),
      )[0]?.apiName ?? null
  );
}
export interface AutomationMapDependencies {
  context: Readonly<CrmContext>;
  fetch: FetchLike;
  getEntitlement(): Promise<AccountState>;
  buildGraph(inputs: AutomationGraphInputs): AutomationGraph;
  cache?: typeof automationMapCacheMessage;
  analyze?: typeof analyzeDelugeEffects;
  /** Defaults to guarding the live CRM origin+org; injectable in synthetic harnesses. */
  isCurrentContext?: () => boolean;
  signal?: AbortSignal;
}
const emptyInputs = (): AutomationGraphInputs => ({
  modules: [],
  fields: new Map(),
  rules: [],
  functions: [],
  buttons: [],
  schedules: [],
  transitions: [],
  approvals: [],
});
const emptyGraph = (): AutomationGraph => ({
  nodes: new Map(),
  edges: [],
  outgoing: new Map(),
  incoming: new Map(),
  modules: [],
});
const initialCoverage = (): MapCoverage => ({
  rules: { listed: 0, detailed: 0, failed: 0, total: null },
  functions: {
    listed: 0,
    analyzed: 0,
    limited: 0,
    unsupported: 0,
    sourceUnavailable: 0,
    pending: 0,
    failed: 0,
  },
  buttons: { loaded: 0, failed: 0, state: 'not-requested' },
  schedules: { loaded: 0, failed: 0, state: 'not-requested' },
  blueprints: { loaded: 0, failed: 0, state: 'not-requested' },
  approvals: { loaded: 0, failed: 0, state: 'not-requested' },
  gaps: 0,
  gapsProvisional: true,
  modules: 0,
  isComplete: false,
  refreshing: false,
  failures: [],
});
export const AUTOMATION_MAP_FRESHNESS_MS = 15 * 60 * 1000;

type Category = 'buttons' | 'schedules' | 'blueprints' | 'approvals';

/** One access-scoped owner. Every await and publish is guarded against obsolete runs. */
export class AutomationMapStore {
  private listeners = new Set<(snapshot: AutomationMapSnapshot) => void>();
  private snapshot: AutomationMapSnapshot = {
    access: { level: 'checking' },
    graph: emptyGraph(),
    teaser: null,
    coverage: initialCoverage(),
    phase: 'idle',
  };
  private controller = new AbortController();
  private generation = 0;
  private disposed = false;
  private running: Promise<void> | null = null;
  private index: WorkflowIndex | null = null;
  private inputs = emptyInputs();
  private workflow: WorkflowIndexSnapshot | null = null;
  private failures = new Map<string, MapFailure>();
  private parents = new Map<string, RetryParent>();
  private jobs = new Map<string, () => Promise<void>>();
  private states: Record<Category, CoverageState> = {
    buttons: 'not-requested',
    schedules: 'not-requested',
    blueprints: 'not-requested',
    approvals: 'not-requested',
  };
  private teaserModuleCounts: { rules: number; activeRules: number; functions: number } | null =
    null;
  private teaserReload: (() => Promise<void>) | null = null;
  private sourceJobs = new Map<string, Promise<string | null>>();
  private analysisQueue: Promise<unknown> = Promise.resolve();
  private lastYield = 0;
  private lastBuild = -Infinity;
  private graphTimer: ReturnType<typeof setTimeout> | undefined;
  private monitor: ReturnType<typeof setInterval> | undefined;
  private settled = false;
  private forceRefresh = false;
  private usedFreshCache = false;
  private lastRevalidatedAt: number | null = null;
  private cachedCoverage: AutomationMapCache['revalidation'] | undefined;
  private cachedFailures = new Set<string>();
  private outcomes = new Map<string, 'loaded' | 'unsupported' | 'failed'>();
  private context: Readonly<CrmContext>;
  private locationGuard: boolean;
  constructor(private deps: AutomationMapDependencies) {
    this.context = { ...deps.context };
    this.locationGuard = typeof location !== 'undefined' && parseOrgId(location.pathname) !== null;
    deps.signal?.addEventListener('abort', this.abort, { once: true });
    if (deps.signal?.aborted) this.abort();
  }
  private abort = () => {
    this.controller.abort();
    this.index?.dispose();
  };
  private guard(run = this.generation) {
    this.controller.signal.throwIfAborted();
    const liveOrg = typeof location !== 'undefined' ? parseOrgId(location.pathname) : null;
    const current = this.deps.isCurrentContext
      ? this.deps.isCurrentContext()
      : !this.locationGuard ||
        (location.origin === this.context.origin && liveOrg === this.context.orgId);
    if (this.disposed || run !== this.generation || !current) {
      if (run === this.generation) this.abort();
      throw new DOMException('Map load cancelled', 'AbortError');
    }
  }
  subscribe(listener: (snapshot: AutomationMapSnapshot) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }
  /** Read-only source seam for the map port; the port restricts it to published graph nodes. */
  sourceText(delugeId: string): string | null {
    if (this.disposed) return null;
    return this.inputs.functions.find((f) => f.delugeId === delugeId)?.sourceText ?? null;
  }
  start(): Promise<void> {
    if (this.disposed || this.controller.signal.aborted) return Promise.resolve();
    if (this.running) return this.running;
    if (this.settled) return Promise.resolve();
    const run = this.generation;
    this.monitor = setInterval(() => {
      try {
        this.guard(run);
      } catch {
        /* guard cancels reads */
      }
    }, 200);
    this.running = this.load(run)
      .catch(() => {
        if (run !== this.generation || this.disposed) return;
        this.snapshot = {
          ...this.snapshot,
          phase: this.controller.signal.aborted ? 'cancelled' : 'failed',
        };
        // An obsolete origin/org never gets another publication, even a cancellation snapshot.
      })
      .finally(() => {
        if (run !== this.generation) return;
        clearInterval(this.monitor);
        this.monitor = undefined;
        this.running = null;
        this.settled = true;
      });
    return this.running;
  }
  /** Explicit refresh bypasses the warm-cache window, retaining cached presence. */
  async refresh(): Promise<void> {
    this.forceRefresh = true;
    await this.refreshAccess();
  }
  async refreshAccess(): Promise<void> {
    if (this.disposed) return;
    try {
      this.guard();
    } catch {
      return;
    }
    this.abort();
    this.generation++;
    clearTimeout(this.graphTimer);
    this.graphTimer = undefined;
    clearInterval(this.monitor);
    this.controller = new AbortController();
    this.running = null;
    this.index = null;
    this.inputs = emptyInputs();
    this.workflow = null;
    this.failures.clear();
    this.outcomes.clear();
    this.cachedFailures.clear();
    this.cachedCoverage = undefined;
    this.lastRevalidatedAt = null;
    this.usedFreshCache = false;
    this.jobs.clear();
    this.parents.clear();
    this.sourceJobs.clear();
    this.teaserReload = null;
    this.teaserModuleCounts = null;
    this.states = {
      buttons: 'not-requested',
      schedules: 'not-requested',
      blueprints: 'not-requested',
      approvals: 'not-requested',
    };
    this.lastBuild = -Infinity;
    this.settled = false;
    this.snapshot = {
      access: { level: 'checking' },
      graph: emptyGraph(),
      teaser: null,
      phase: 'loading',
      coverage: initialCoverage(),
    };
    for (const listener of this.listeners) listener(this.snapshot);
    if (this.deps.signal?.aborted) this.abort();
    await this.start();
  }
  private coverage(): MapCoverage {
    const coverage = initialCoverage(),
      p = this.workflow?.progress;
    coverage.rules = {
      listed: this.inputs.rules.length,
      detailed: this.inputs.rules.filter((r) => r.detailState === 'loaded').length,
      failed:
        p?.ruleDetailsFailed ??
        [...new Set([...this.failures.keys(), ...this.cachedFailures])].filter(
          (k) => k.startsWith('rule:') || k.startsWith('workflow:rule:'),
        ).length,
      total:
        p?.rulesTotal ??
        (this.settled || this.snapshot.coverage.refreshing ? this.inputs.rules.length : null),
    };
    coverage.modules =
      this.snapshot.teaser?.totals.modules ??
      moduleInventory(this.inputs.modules, this.inputs.rules).length;
    coverage.gapsProvisional = !this.settled;
    coverage.functions.listed = this.inputs.functions.length;
    for (const f of this.inputs.functions) {
      if (f.sourceState === 'pending') coverage.functions.pending++;
      else if (f.sourceState === 'unavailable') coverage.functions.sourceUnavailable++;
      else if (f.sourceState === 'failed' || f.effects?.analysis.status === 'failed')
        coverage.functions.failed++;
      else if (f.effects?.analysis.status === 'limited') coverage.functions.limited++;
      else if (f.effects?.analysis.status === 'unsupported') coverage.functions.unsupported++;
      else if (f.effects) coverage.functions.analyzed++;
      else coverage.functions.pending++;
    }
    for (const key of ['buttons', 'schedules', 'blueprints', 'approvals'] as const) {
      // Count dependency reads on both sides of the fraction, including empty successes.
      // The category coordinator is not another read when it discovered child dependencies.
      const entries = [...this.outcomes].filter(([id]) => id === key || id.startsWith(`${key}:`));
      const reads = entries.some(([id]) => id !== key)
        ? entries.filter(([id]) => id !== key)
        : entries;
      coverage[key] = reads.length
        ? {
            loaded: reads.filter(([, state]) => state === 'loaded').length,
            failed: reads.filter(([, state]) => state === 'failed').length,
            unsupported: reads.filter(([, state]) => state === 'unsupported').length,
            state: reads.some(([, state]) => state === 'failed')
              ? 'failed'
              : reads.every(([, state]) => state === 'unsupported')
                ? 'unsupported'
                : this.states[key],
          }
        : (this.cachedCoverage?.categories[key] ?? coverage[key]);
    }
    coverage.failures = [
      ...this.failures.values(),
      ...(p?.failures ?? []).map((workflow) => ({
        id: `workflow:${workflow.id}`,
        message: workflow.message,
        workflow,
        retry: () => this.retry(`workflow:${workflow.id}`),
      })),
    ];
    const ids = new Set(coverage.failures.map((f) => this.dependencyId(f)));
    for (const id of this.cachedFailures) {
      if (ids.has(id)) continue;
      ids.add(id);
      coverage.failures = [
        ...coverage.failures,
        {
          id,
          message: 'Zoho configuration could not be read. Retry this dependency.',
          retry: () => this.retry(id),
        },
      ];
    }
    // A shared source/catalogue/metadata failure has one identity across both indexes.
    const unique = new Map(coverage.failures.map((f) => [this.dependencyId(f), f]));
    coverage.failures = [...unique].map(([id, failure]) => ({
      ...failure,
      id,
      retry: () => this.retry(id),
    }));
    const f = coverage.functions;
    coverage.gaps =
      unique.size +
      f.limited +
      f.unsupported +
      f.sourceUnavailable +
      f.failed +
      (this.settled ? f.pending : 0);
    coverage.lastRevalidatedAt = this.lastRevalidatedAt;
    coverage.refreshing = this.snapshot.coverage.refreshing;
    coverage.isComplete =
      this.settled &&
      this.snapshot.access.level === 'full' &&
      coverage.gaps === 0 &&
      Object.values(this.states).every((state) => state === 'loaded' || state === 'unsupported');
    return coverage;
  }
  private dependencyId(failure: MapFailure): string {
    const target = failure.workflow?.target;
    if (target?.kind === 'functionSource') return `source:${target.delugeFunctionId}`;
    if (target?.kind === 'functionCatalogue') return 'catalogue';
    if (target?.kind === 'metadata') return `fields:${target.moduleApiName}`;
    return failure.id;
  }
  private cacheValue(): AutomationMapCache {
    const c = this.coverage();
    return cacheInputs(this.inputs, {
      lastRevalidatedAt: this.lastRevalidatedAt,
      categories: {
        buttons: c.buttons,
        schedules: c.schedules,
        blueprints: c.blueprints,
        approvals: c.approvals,
      },
      failureIds: c.failures.map((f) => this.dependencyId(f)),
      dependencies: [...this.outcomes].map(([id, state]) => ({
        id,
        state,
        ...(this.parents.has(id) ? { parent: this.parents.get(id) } : {}),
      })),
    });
  }
  private emit(rebuild = true) {
    this.guard();
    if (rebuild && Date.now() - this.lastBuild < 500) {
      if (!this.graphTimer) {
        const run = this.generation;
        this.graphTimer = setTimeout(
          () => {
            this.graphTimer = undefined;
            try {
              this.guard(run);
              this.emit();
            } catch {
              /* obsolete run */
            }
          },
          500 - (Date.now() - this.lastBuild),
        );
      }
    } else if (rebuild) {
      this.lastBuild = Date.now();
      let graph = this.deps.buildGraph(this.inputs);
      if (this.snapshot.access.level === 'teaser')
        graph = revealedGraph(
          graph,
          this.snapshot.access.revealedModuleApiName,
          this.inputs.functions,
        );
      if (this.snapshot.access.level === 'teaser' && this.teaserModuleCounts) {
        const id = `module:${this.snapshot.access.revealedModuleApiName}`;
        const module = graph.nodes.get(id);
        if (module?.kind === 'module')
          graph = {
            ...graph,
            nodes: new Map(graph.nodes).set(id, {
              ...module,
              counts: { ...module.counts, ...this.teaserModuleCounts },
            }),
            modules: graph.modules.map((m) =>
              m.id === id ? { ...m, counts: { ...m.counts, ...this.teaserModuleCounts } } : m,
            ),
          };
      }
      this.snapshot = { ...this.snapshot, graph };
    }
    this.snapshot = { ...this.snapshot, coverage: this.coverage() };
    for (const listener of this.listeners) listener(this.snapshot);
  }
  private update(next: Partial<AutomationGraphInputs>) {
    this.inputs = { ...this.inputs, ...next };
    this.emit();
  }
  private async job(key: string, work: () => Promise<void>, run: number): Promise<void> {
    this.guard(run);
    this.jobs.set(key, work);
    try {
      await work();
      this.guard(run);
      this.failures.delete(key);
      this.cachedFailures.delete(key);
      if (this.outcomes.get(key) !== 'unsupported') this.outcomes.set(key, 'loaded');
    } catch {
      this.guard(run);
      this.outcomes.set(key, 'failed');
      this.failures.set(key, {
        id: key,
        message: 'Zoho configuration could not be read. Retry this dependency.',
        retry: () => this.retry(key),
      });
    }
    this.emit();
  }
  private async load(run: number) {
    this.snapshot = { ...this.snapshot, phase: 'loading' };
    this.emit(false);
    let account: AccountState | null = null;
    try {
      account = await this.deps.getEntitlement();
      if (account.signedOutPending) account = await this.deps.getEntitlement();
    } catch {
      /* unavailable gets metadata teaser */
    }
    this.guard(run);
    const full = hasAutomationMapAccess(account);
    const reason: TeaserReason =
      !account || account.failed
        ? 'unavailable'
        : !account.signedIn
          ? 'signed-out'
          : account.entitlement.plan === 'free' || !account.entitlement.entitled
            ? 'free'
            : 'lower-plan';
    this.snapshot = {
      ...this.snapshot,
      access: full ? { level: 'full' } : { level: 'teaser', revealedModuleApiName: null, reason },
    };
    this.emit(false);
    const request: FetchLike = (url, init) => {
      this.guard(run);
      return this.deps.fetch(url, init);
    };
    const api = new AutomationMapApi(this.context, request, this.controller.signal);
    if (full) await this.loadFull(api, run);
    else await this.loadTeaser(api, run);
    this.guard(run);
    this.settled = true;
    if (full && !this.usedFreshCache) this.lastRevalidatedAt = Date.now();
    this.snapshot = {
      ...this.snapshot,
      phase: this.failures.has('catalogue') || this.failures.has('list') ? 'failed' : 'complete',
      coverage: { ...this.snapshot.coverage, refreshing: false },
    };
    this.emit();
    if (this.graphTimer) {
      await pause(Math.max(0, 505 - (Date.now() - this.lastBuild)), this.controller.signal);
      this.guard(run);
    }
    if (full) {
      try {
        this.guard(run);
        await (this.deps.cache ?? automationMapCacheMessage)({
          type: 'automationMap:writeCache',
          origin: this.context.origin,
          orgId: this.context.orgId,
          value: this.cacheValue(),
        });
      } catch {
        this.guard(run);
      }
    }
  }
  private async loadFull(api: AutomationMapApi, run: number) {
    try {
      const cached = await (this.deps.cache ?? automationMapCacheMessage)({
        type: 'automationMap:readCache',
        origin: this.context.origin,
        orgId: this.context.orgId,
      });
      this.guard(run);
      if (isAutomationMapCache(cached)) {
        this.inputs = hydrateInputs(cached);
        this.cachedCoverage = cached.revalidation;
        for (const d of cached.revalidation?.dependencies ?? []) {
          this.outcomes.set(d.id, d.state);
          if (d.parent) this.parents.set(d.id, d.parent);
        }
        this.lastRevalidatedAt = cached.revalidation?.lastRevalidatedAt ?? null;
        this.cachedFailures = new Set(cached.revalidation?.failureIds ?? []);
        const age =
          this.lastRevalidatedAt === null ? Infinity : Date.now() - this.lastRevalidatedAt;
        if (
          cached.revalidation &&
          !this.forceRefresh &&
          age >= 0 &&
          age < AUTOMATION_MAP_FRESHNESS_MS &&
          this.inputs.functions.every(
            (f) => !f.effects || f.effects.analyzerVersion === DELUGE_EFFECTS_VERSION,
          )
        ) {
          for (const key of Object.keys(this.states) as Category[])
            this.states[key] = cached.revalidation.categories[key].state;
          this.usedFreshCache = true;
          this.emit();
          return;
        }
        this.snapshot = {
          ...this.snapshot,
          coverage: { ...this.snapshot.coverage, refreshing: true },
        };
        this.emit();
      }
    } catch {
      this.guard(run);
    }
    this.forceRefresh = false;
    const warm = new Map(this.inputs.functions.map((f) => [f.delugeId, f]));
    let catalogueError = false;
    const catalogue = this.job(
      'catalogue',
      async () => {
        const functions = await api.catalogue();
        this.guard(run);
        catalogueError = false;
        this.update({
          functions: functions.map((f) => {
            const old = warm.get(f.delugeId);
            // Presence survives revalidation, but only matching identity+revision certifies source.
            return old && functionJoinIdentity(old.summary) === functionJoinIdentity(f.summary)
              ? {
                  ...f,
                  sourceText: old.sourceText,
                  effects: old.effects,
                  sourceState: old.sourceState,
                }
              : f;
          }),
        });
        if (this.settled) await loadSources();
      },
      run,
    ).then(() => {
      catalogueError = this.failures.has('catalogue');
    });
    const getSource = (summary: ZohoFunctionSummary) => {
      const sourceKey = JSON.stringify([
        summary.id,
        functionJoinIdentity(summary),
        summary.updatedTime ?? null,
      ]);
      const existing = this.sourceJobs.get(sourceKey);
      if (existing) return existing;
      const promise = (async () => {
        const old = warm.get(summary.id);
        const unchanged =
          old &&
          summary.updatedTime != null &&
          summary.updatedTime === old.summary.updatedTime &&
          functionJoinIdentity(summary) === functionJoinIdentity(old.summary) &&
          (old.sourceState === 'available' || old.sourceState === 'unavailable');
        const sourceText = unchanged ? old.sourceText : await api.source(summary);
        this.guard(run);
        let effects =
          unchanged &&
          old.effects?.analyzerVersion === DELUGE_EFFECTS_VERSION &&
          old.effects.functionId === summary.id &&
          old.effects.sourceRevision === String(summary.updatedTime) &&
          old.effects.analysis.sourceLength === sourceText?.length
            ? old.effects
            : null;
        if (sourceText && !effects) {
          const analyze = this.analysisQueue.then(async () => {
            this.guard(run);
            if (performance.now() - this.lastYield >= 8) {
              await yieldToPage();
              this.guard(run);
              this.lastYield = performance.now();
            }
            return (this.deps.analyze ?? analyzeDelugeEffects)(sourceText, {
              functionId: summary.id,
              sourceRevision: String(summary.updatedTime ?? ''),
              language: summary.language,
              currentCrmOrigin: this.context.origin,
            });
          });
          this.analysisQueue = analyze.catch(() => {});
          effects = await analyze;
          this.guard(run);
        }
        this.updateFunction(summary.id, {
          sourceText,
          effects,
          sourceState: sourceText ? 'available' : 'unavailable',
        });
        return sourceText;
      })().catch((error) => {
        this.guard(run);
        this.sourceJobs.delete(sourceKey);
        this.updateFunction(summary.id, { sourceState: 'failed' });
        throw error;
      });
      this.sourceJobs.set(sourceKey, promise);
      return promise;
    };
    const loadSources = () =>
      bounded(
        this.inputs.functions,
        async (f) => {
          await this.job(
            `source:${f.delugeId}`,
            async () => {
              await getSource(f.summary);
            },
            run,
          );
        },
        () => this.guard(run),
      );
    this.index = new WorkflowIndex({
      context: this.context,
      fetch: requestAsFetch(this.deps.fetch, () => this.guard(run)),
      hasAccess: async () => {
        this.guard(run);
        return this.snapshot.access.level === 'full';
      },
      isCurrentRoute: () => run === this.generation && !this.controller.signal.aborted,
      getCatalogue: async () => {
        await catalogue;
        if (catalogueError) throw new Error('Catalogue unavailable');
        return this.inputs.functions.map((f) => f.summary);
      },
      getFunctionSource: getSource,
    });
    this.index.subscribe((snapshot) => {
      this.guard(run);
      this.workflow = snapshot;
      if (['complete', 'failed'].includes(snapshot.progress.phase)) {
        for (const id of this.cachedFailures)
          if (id.startsWith('workflow:')) this.cachedFailures.delete(id);
      }
      const { phase, rulesTotal, failures } = snapshot.progress;
      const listed =
        rulesTotal !== null &&
        !['idle', 'listing', 'failed', 'cancelled'].includes(phase) &&
        !failures.some((f) => f.target.kind === 'list');
      // The workflow cache is independent of the map cache. Partial/failed lists
      // may add presence, but only a successful complete listing can remove it.
      const present = new Map(this.inputs.rules.map((r) => [r.id, r]));
      const rules = snapshot.rules.map((r) => {
        const old = present.get(r.id);
        return old?.detailState === 'loaded' && r.detailState !== 'loaded' ? old : r;
      });
      this.update({
        rules: listed
          ? rules
          : [...new Map([...this.inputs.rules, ...rules].map((r) => [r.id, r])).values()],
      });
    });
    this.snapshot = { ...this.snapshot, phase: 'enriching' };
    const workflow = this.index.load(this.controller.signal);
    const modules = this.job(
      'modules',
      async () => {
        const result = await api.modules();
        this.guard(run);
        this.update({ modules: result.modules });
        this.states.buttons = 'loading';
        const buttonMap = new Map<string, Awaited<ReturnType<AutomationMapApi['buttons']>>>();
        await bounded(
          result.workflowModules,
          async (module) => {
            await Promise.all([
              this.job(
                `fields:${module}`,
                async () => {
                  const fields = await api.fields(module);
                  this.guard(run);
                  this.update({ fields: new Map([...this.inputs.fields, [module, fields]]) });
                },
                run,
              ),
              this.job(
                `buttons:${module}`,
                async () => {
                  const result = await api.buttons(module);
                  this.guard(run);
                  buttonMap.set(module, result);
                  this.outcomes.set(
                    `buttons:${module}`,
                    result.unsupported ? 'unsupported' : 'loaded',
                  );
                  this.update({
                    buttons: [
                      ...this.inputs.buttons.filter((b) => b.moduleApiName !== module),
                      ...result.buttons,
                    ],
                  });
                },
                run,
              ),
            ]);
          },
          () => this.guard(run),
        );
        this.states.buttons = [...this.failures.keys()].some((k) => k.startsWith('buttons:'))
          ? 'failed'
          : buttonMap.size > 0 && [...buttonMap.values()].every((b) => b.unsupported)
            ? 'unsupported'
            : 'loaded';
        this.emit();
      },
      run,
    );
    const categories = (['schedules', 'blueprints', 'approvals'] as const).map(async (key) => {
      this.states[key] = 'loading';
      this.emit(false);
      await this.job(
        key,
        async () => {
          const settle = (key: string, work: () => Promise<void>, parent?: RetryParent) => {
            if (parent) this.parents.set(key, parent);
            return this.job(key, work, run);
          };
          if (key === 'schedules') {
            const schedules = await api.schedules();
            this.guard(run);
            this.update({ schedules });
          } else if (key === 'blueprints') {
            const transitions = await api.blueprints((t) => {
              this.guard(run);
              this.update({
                transitions: [
                  ...this.inputs.transitions.filter(
                    (old) =>
                      old.blueprintId !== t.blueprintId || old.transitionId !== t.transitionId,
                  ),
                  t,
                ],
              });
            }, settle);
            this.guard(run);
            if (![...this.failures.keys()].some((k) => k.startsWith('blueprints:')))
              this.update({ transitions });
          } else {
            const approvals = await api.approvals((a) => {
              this.guard(run);
              this.update({
                approvals: [...this.inputs.approvals.filter((old) => old.id !== a.id), a],
              });
            }, settle);
            this.guard(run);
            if (![...this.failures.keys()].some((k) => k.startsWith('approvals:')))
              this.update({ approvals });
          }
          this.states[key] = 'loaded';
        },
        run,
      );
      if ([...this.failures.keys()].some((k) => k === key || k.startsWith(`${key}:`)))
        this.states[key] = 'failed';
      this.emit();
    });
    await Promise.all([workflow, modules, catalogue.then(loadSources), ...categories]);
    this.guard(run);
  }
  private updateFunction(id: string, next: Partial<FunctionInput>) {
    this.update({
      functions: this.inputs.functions.map((f) => (f.delugeId === id ? { ...f, ...next } : f)),
    });
  }
  private async loadTeaser(api: AutomationMapApi, run: number) {
    let functions: FunctionInput[] = [],
      rules: unknown[] = [],
      modules: readonly ModuleInput[] = [];
    await Promise.all([
      this.job(
        'catalogue',
        async () => {
          functions = await api.catalogue();
          this.guard(run);
        },
        run,
      ),
      this.job(
        'list',
        async () => {
          rules = await new WorkflowApi(
            this.context,
            (url, init) => {
              this.guard(run);
              return this.deps.fetch(url, init);
            },
            this.controller.signal,
          ).list(() => {});
          this.guard(run);
        },
        run,
      ),
      this.job(
        'modules',
        async () => {
          const result = await api.modules();
          this.guard(run);
          modules = result.modules;
        },
        run,
      ),
    ]);
    this.teaserReload = async () => {
      if (['catalogue', 'list', 'modules'].some((key) => this.failures.has(key))) return;
      const normalized = rules.map((r) => normalizeRule(r)),
        allModules = moduleInventory(modules, normalized);
      const revealed = chooseRevealedModule(
        allModules.map((m) => ({
          ...m,
          activeRules: normalized.filter((r) => r.module.apiName === m.apiName && r.active).length,
        })),
      );
      if (this.snapshot.access.level !== 'teaser') return;
      this.snapshot = {
        ...this.snapshot,
        access: { ...this.snapshot.access, revealedModuleApiName: revealed },
        phase: 'enriching',
      };
      const belongs = (f: FunctionInput, apiName: string) =>
        f.places.some(
          (p) =>
            p.modulePluralLabel !== null &&
            p.modulePluralLabel === allModules.find((m) => m.apiName === apiName)?.pluralLabel,
        );
      const candidates = normalized.filter((r) => r.module.apiName === revealed && r.active);
      // Reverse catalogue associations let us prefer a writing function without probing rules.
      const writingRuleIds = new Set(
        functions
          .filter((f) => catalogueWrites(f) > 0)
          .flatMap((f) => f.places.filter((p) => p.type === 'workflow_rules').map((p) => p.id)),
      );
      const chosen =
        candidates.find((r) => writingRuleIds.has(r.id)) ??
        candidates.find((r) =>
          r.conditions.some(
            (c) => c.instantActions.length || c.scheduledActions.some((a) => a.actions.length),
          ),
        ) ??
        candidates[0];
      this.teaserModuleCounts = {
        rules: normalized.filter((r) => r.module.apiName === revealed).length,
        activeRules: candidates.length,
        functions: functions.filter((f) => revealed && belongs(f, revealed)).length,
      };
      const assigned = functions.filter((f) => allModules.some((m) => belongs(f, m.apiName)));
      const fogged = allModules
        .filter((m) => m.apiName !== revealed)
        .map((m) => {
          const fs = functions.filter((f) => belongs(f, m.apiName));
          return {
            slot: 0,
            counts: {
              rules: normalized.filter((r) => r.module.apiName === m.apiName).length,
              functions: fs.length,
              buttons: associationCount(fs, 'custom_buttons', m.pluralLabel),
              schedules: associationCount(fs, 'schedules', m.pluralLabel),
            },
            recordWrites: fs.reduce((n, f) => n + catalogueWrites(f), 0),
          };
        })
        .filter((f) => Object.values(f.counts).some(Boolean) || f.recordWrites > 0);
      const quietModules = allModules.length - (revealed ? 1 : 0) - fogged.length;
      const unassigned = functions.filter((f) => !assigned.includes(f));
      if (unassigned.length)
        fogged.push({
          slot: 0,
          counts: { rules: 0, functions: unassigned.length, buttons: 0, schedules: 0 },
          recordWrites: unassigned.reduce((n, f) => n + catalogueWrites(f), 0),
        });
      // Revealed-module totals already include omitted siblings; fog contains other islands only.
      this.snapshot = {
        ...this.snapshot,
        teaser: {
          quietModules,
          fogged: fogged.map((f, slot) => ({ ...f, slot })),
          totals: { rules: rules.length, functions: functions.length, modules: allModules.length },
        },
      };
      this.inputs = {
        ...emptyInputs(),
        modules: allModules.filter((m) => m.apiName === revealed),
        rules: [],
        functions: [],
      };
      this.emit();
      const workflow = new WorkflowApi(
        this.context,
        (url, init) => {
          this.guard(run);
          return this.deps.fetch(url, init);
        },
        this.controller.signal,
      );
      if (!chosen) return;
      await this.job(
        `rule:${chosen.id}`,
        async () => {
          const detail = object(await workflow.rule(chosen.id));
          this.guard(run);
          // One rule + two resource reads + one source. Never probe another rule to find a nicer flow.
          const resources = new Map<string, unknown>();
          const allActions = array(detail.conditions).flatMap((raw) => {
            const c = object(raw);
            return [
              ...array(object(c.instant_actions).actions),
              ...array(c.scheduled_actions).flatMap((s) => array(object(s).actions)),
            ];
          });
          const firstFunction = allActions.find((raw) => object(raw).type === 'functions');
          // Reserve one resource slot for the function even when it follows other actions.
          const allowedResources = new Set<string>();
          for (const raw of [firstFunction, ...allActions]) {
            const a = object(raw),
              type = string(a.type);
            if (!(type in resourceKinds) || (type === 'functions' && raw !== firstFunction))
              continue;
            if (allowedResources.size < 2) allowedResources.add(`${type}:${string(a.id)}`);
          }
          let functionSeen = false;
          const trimActions = (actions: unknown[]) =>
            actions.filter((raw) => {
              const a = object(raw),
                type = string(a.type),
                key = `${type}:${string(a.id)}`;
              if (type === 'functions') {
                if (raw !== firstFunction || functionSeen) return false;
                functionSeen = true;
              }
              if (!(type in resourceKinds)) return true;
              if (!allowedResources.has(key)) return false;
              resources.set(key, undefined);
              return true;
            });
          const conditions = array(detail.conditions).map((raw) => {
            const c = object(raw);
            return {
              ...c,
              instant_actions: {
                ...object(c.instant_actions),
                actions: trimActions(array(object(c.instant_actions).actions)),
              },
              scheduled_actions: array(c.scheduled_actions).map((raw) => {
                const schedule = object(raw);
                return { ...schedule, actions: trimActions(array(schedule.actions)) };
              }),
            };
          });
          const limited = { ...detail, conditions };
          let rule = normalizeRule(chosen.raw, limited);
          for (const key of resources.keys()) {
            const [type, id] = key.split(':');
            resources.set(key, await workflow.resource(type as keyof typeof resourceKinds, id));
            this.guard(run);
          }
          let selectedFunction: FunctionInput | undefined;
          const enrich = (action: (typeof rule.conditions)[number]['instantActions'][number]) => {
            const raw = object(action.raw);
            let enriched = normalizeAction(
              action.raw,
              resources.get(`${string(raw.type)}:${string(raw.id)}`),
            );
            if (enriched.kind === 'function') {
              const join = joinFunction(
                enriched,
                functions.map((f) => f.summary),
              );
              if (join.confidence === 'exact' && join.summary) {
                selectedFunction = functions.find((f) => f.delugeId === join.summary?.id);
                enriched = {
                  ...enriched,
                  delugeFunctionId: join.summary.id,
                  joinConfidence: 'exact',
                  sourceState: 'loading',
                };
              }
            }
            return enriched;
          };
          rule = {
            ...rule,
            conditions: rule.conditions.map((c) => ({
              ...c,
              instantActions: c.instantActions.map(enrich),
              scheduledActions: c.scheduledActions.map((a) => ({
                ...a,
                actions: a.actions.map(enrich),
              })),
            })),
          };
          if (selectedFunction) {
            const f = selectedFunction;
            // Explicit projection: nested catalogue metadata can identify other fogged flows.
            this.inputs.functions = [
              {
                ...f,
                summary: {
                  id: f.summary.id,
                  display_name: f.summary.display_name,
                  api_name: f.summary.api_name,
                  category: f.summary.category,
                  language: f.summary.language,
                  source: f.summary.source,
                  updatedTime: f.summary.updatedTime,
                },
                places: f.places
                  .filter((p) => p.type === 'workflow_rules' && p.id === chosen.id)
                  .map((p) => ({ ...p, raw: null })),
              },
            ];
            await this.job(
              `source:${f.delugeId}`,
              async () => {
                let sourceText: string | null;
                try {
                  sourceText = await api.source(f.summary);
                } catch (error) {
                  this.guard(run);
                  this.updateFunction(f.delugeId, { sourceState: 'failed' });
                  throw error;
                }
                this.guard(run);
                const effects = sourceText
                  ? (this.deps.analyze ?? analyzeDelugeEffects)(sourceText, {
                      functionId: f.delugeId,
                      sourceRevision: String(f.summary.updatedTime ?? ''),
                      language: f.summary.language,
                      currentCrmOrigin: this.context.origin,
                    })
                  : null;
                this.updateFunction(f.delugeId, {
                  sourceText,
                  effects,
                  sourceState: sourceText ? 'available' : 'unavailable',
                });
              },
              run,
            );
          }
          const finish = (action: (typeof rule.conditions)[number]['instantActions'][number]) => {
            if (action.kind !== 'function' || !action.delugeFunctionId) return action;
            const f = this.inputs.functions.find((f) => f.delugeId === action.delugeFunctionId);
            return {
              ...action,
              sourceState:
                f?.sourceState === 'available' ? ('available' as const) : ('unavailable' as const),
            };
          };
          this.update({
            rules: [
              {
                ...rule,
                conditions: rule.conditions.map((c) => ({
                  ...c,
                  instantActions: c.instantActions.map(finish),
                  scheduledActions: c.scheduledActions.map((s) => ({
                    ...s,
                    actions: s.actions.map(finish),
                  })),
                })),
              },
            ],
          });
        },
        run,
      );
    };
    await this.teaserReload();
  }
  private async retryHydrated(key: string, run: number): Promise<void> {
    const api = new AutomationMapApi(
      this.context,
      (url, init) => {
        this.guard(run);
        return this.deps.fetch(url, init);
      },
      this.controller.signal,
    );
    const workflow = new WorkflowApi(
      this.context,
      requestAsFetch(this.deps.fetch, () => this.guard(run)),
      this.controller.signal,
    );
    const settle = (id: string, work: () => Promise<void>, parent?: RetryParent) => {
      if (parent) this.parents.set(id, parent);
      if (id !== key && this.outcomes.has(id) && this.outcomes.get(id) !== 'failed')
        return Promise.resolve();
      return this.job(id, work, run);
    };
    const transition = (t: AutomationGraphInputs['transitions'][number]) => {
      this.guard(run);
      this.update({
        transitions: [
          ...this.inputs.transitions.filter(
            (old) => old.blueprintId !== t.blueprintId || old.transitionId !== t.transitionId,
          ),
          t,
        ],
      });
    };
    const approval = (a: AutomationGraphInputs['approvals'][number]) => {
      this.guard(run);
      this.update({ approvals: [...this.inputs.approvals.filter((old) => old.id !== a.id), a] });
    };
    const [kind, part, identity] = key.split(':');
    if (kind === 'fields') {
      const fields = await api.fields(part);
      this.guard(run);
      this.update({ fields: new Map([...this.inputs.fields, [part, fields]]) });
    } else if (kind === 'buttons') {
      const result = await api.buttons(part);
      this.guard(run);
      this.outcomes.set(key, result.unsupported ? 'unsupported' : 'loaded');
      this.update({
        buttons: [
          ...this.inputs.buttons.filter((b) => b.moduleApiName !== part),
          ...result.buttons,
        ],
      });
    } else if (kind === 'schedules') {
      const schedules = await api.schedules();
      this.guard(run);
      this.update({ schedules });
    } else if (kind === 'blueprints') {
      let parent = this.parents.get(key);
      if (part && !parent) {
        // Older caches kept only IDs. Recover parent identity within this category,
        // without revalidating any other configuration or advancing freshness.
        for (const raw of await api.pages('/crm/v8/settings/blueprints', 'blueprints')) {
          const candidate = retryParent(raw);
          if (part === 'transitions' && candidate.id === identity) parent = candidate;
          if (part === 'transition') {
            const transitions = await api.pages(
              `/crm/v8/settings/blueprints/${candidate.id}/transitions`,
              'transitions',
            );
            if (transitions.some((t) => string(object(t).id) === identity)) parent = candidate;
          }
          if (parent) break;
        }
        this.guard(run);
        if (!parent) throw new Error('Missing blueprint retry identity');
        this.parents.set(key, parent);
      }
      // The transition-list wrapper is a coordinator when retrying one detail.
      const execute = (id: string, work: () => Promise<void>, p?: RetryParent) =>
        part === 'transition' && id.startsWith('blueprints:transitions:')
          ? work()
          : settle(id, work, p);
      await api.blueprints(
        transition,
        execute,
        parent ? [parent] : undefined,
        part === 'transition' ? identity : undefined,
      );
      if (this.failures.has(key)) throw new Error('Blueprint dependency unavailable');
    } else if (kind === 'approvals') {
      let parent = this.parents.get(key);
      if (part && !parent) {
        const raw = (await api.pages('/crm/v9/settings/approval_process', 'approval_process')).find(
          (a) => string(object(a).id) === identity,
        );
        this.guard(run);
        if (!raw) throw new Error('Missing approval retry identity');
        parent = retryParent(raw);
        this.parents.set(key, parent);
      }
      await api.approvals(approval, settle, parent ? [parent] : undefined);
      if (this.failures.has(key)) throw new Error('Approval dependency unavailable');
    } else if (kind === 'source') {
      const f = this.inputs.functions.find((f) => f.delugeId === part);
      if (!f) throw new Error('Missing function retry identity');
      const sourceText = await api.source(f.summary);
      this.guard(run);
      const effects = sourceText
        ? (this.deps.analyze ?? analyzeDelugeEffects)(sourceText, {
            functionId: f.delugeId,
            sourceRevision: String(f.summary.updatedTime ?? ''),
            language: f.summary.language,
            currentCrmOrigin: this.context.origin,
          })
        : null;
      this.updateFunction(part, {
        sourceText,
        effects,
        sourceState: sourceText ? 'available' : 'unavailable',
      });
      this.inputs = hydrateInputs(cacheInputs(this.inputs));
    } else if (kind === 'modules') {
      const result = await api.modules();
      this.guard(run);
      this.update({ modules: result.modules });
      for (const module of result.workflowModules) {
        for (const dependency of [`fields:${module}`, `buttons:${module}`]) {
          if (!this.outcomes.has(dependency))
            await settle(dependency, () => this.retryHydrated(dependency, run));
        }
      }
    } else if (kind === 'catalogue') {
      const functions = await api.catalogue();
      this.guard(run);
      const old = new Map(this.inputs.functions.map((f) => [f.delugeId, f]));
      this.update({ functions: functions.map((f) => old.get(f.delugeId) ?? f) });
      for (const f of functions)
        if (!old.has(f.delugeId))
          await settle(`source:${f.delugeId}`, () =>
            this.retryHydrated(`source:${f.delugeId}`, run),
          );
      this.inputs = hydrateInputs(cacheInputs(this.inputs));
    } else if (kind === 'workflow') {
      if (part === 'list') {
        const listed = await workflow.list(() => {});
        this.guard(run);
        const old = new Map(this.inputs.rules.map((r) => [r.id, r]));
        this.update({
          rules: listed.map((raw) => old.get(string(object(raw).id)) ?? normalizeRule(raw)),
        });
        for (const r of this.inputs.rules)
          if (!old.has(r.id))
            await settle(`workflow:rule:${r.id}`, () =>
              this.retryHydrated(`workflow:rule:${r.id}`, run),
            );
      } else if (part === 'rule') {
        const detail = await workflow.rule(identity);
        this.guard(run);
        this.update({
          rules: this.inputs.rules.map((r) =>
            r.id === identity ? normalizeRule(r.raw, detail) : r,
          ),
        });
        await this.enrichHydratedRule(identity, api, run);
      } else if (part === 'template') {
        const template = normalizeTemplate(await workflow.template(identity));
        this.guard(run);
        this.mapActions((a) =>
          a.kind === 'emailNotification' && a.template?.id === identity ? { ...a, template } : a,
        );
      } else if (resourceTypes.includes(part as (typeof resourceTypes)[number])) {
        const raw = await workflow.resource(part as (typeof resourceTypes)[number], identity);
        this.guard(run);
        this.mapActions((a) =>
          string(object(a.raw).type) === part && a.id === identity
            ? normalizeAction(a.raw, raw)
            : a,
        );
        this.inputs = hydrateInputs(cacheInputs(this.inputs));
      } else throw new Error('Unknown workflow dependency');
    } else throw new Error('Unknown retry dependency');
  }
  private mapActions(
    transform: (
      a: AutomationGraphInputs['rules'][number]['conditions'][number]['instantActions'][number],
    ) => AutomationGraphInputs['rules'][number]['conditions'][number]['instantActions'][number],
  ) {
    this.update({
      rules: this.inputs.rules.map((r) => ({
        ...r,
        conditions: r.conditions.map((c) => ({
          ...c,
          instantActions: c.instantActions.map(transform),
          scheduledActions: c.scheduledActions.map((s) => ({
            ...s,
            actions: s.actions.map(transform),
          })),
        })),
      })),
    });
  }
  private async enrichHydratedRule(id: string, api: AutomationMapApi, run: number) {
    const rule = this.inputs.rules.find((r) => r.id === id);
    if (!rule) return;
    const actions = rule.conditions.flatMap((c) => [
      ...c.instantActions,
      ...c.scheduledActions.flatMap((s) => s.actions),
    ]);
    for (const a of actions) {
      const type = string(object(a.raw).type);
      if (!resourceTypes.includes(type as (typeof resourceTypes)[number])) continue;
      await this.job(
        `workflow:${type}:${a.id}`,
        async () => {
          const enriched = await api.action(a.raw);
          this.guard(run);
          this.mapActions((old) =>
            old.id === a.id && string(object(old.raw).type) === type ? enriched : old,
          );
        },
        run,
      );
    }
    this.inputs = hydrateInputs(cacheInputs(this.inputs));
  }
  retry(id?: string): Promise<void> {
    if (this.running) return this.running.then(() => this.retry(id));
    const run = this.generation;
    this.running = this.retryWork(id).finally(() => {
      if (run === this.generation) this.running = null;
    });
    return this.running;
  }
  private async retryWork(id?: string): Promise<void> {
    this.guard();
    // Recheck capability on every full retry; a downgrade tears down full data first.
    if (this.snapshot.access.level === 'full') {
      let account: AccountState | null = null;
      try {
        account = await this.deps.getEntitlement();
      } catch {
        /* refresh access handles unavailable */
      }
      this.guard();
      if (!hasAutomationMapAccess(account)) return this.refreshAccess();
    }
    // Hydrated identities must reconstruct just their dependency, never certify a full pass.
    for (const key of this.cachedFailures) {
      if ((!id || key === id) && !this.jobs.has(key))
        this.jobs.set(key, () => this.retryHydrated(key, this.generation));
    }
    const run = this.generation;
    this.settled = false;
    this.emit(false);
    const keys = new Set(id ? [id] : [...this.failures.keys(), ...this.cachedFailures]);
    // One published failure can have consumers in both indexes. Retry both owners so a
    // successful source read cannot leave the other owner's stale failure counted forever.
    for (const workflow of this.workflow?.progress.failures ?? []) {
      const workflowId = `workflow:${workflow.id}`;
      const canonical = this.dependencyId({
        id: workflowId,
        workflow,
        message: workflow.message,
        retry: workflow.retry,
      });
      if (!id || id === workflowId || id === canonical) {
        if (this.failures.has(canonical)) keys.add(canonical);
        keys.add(workflowId);
      }
    }
    for (const key of keys) {
      this.guard(run);
      if (key.startsWith('workflow:') && !this.jobs.has(key)) {
        await this.workflow?.progress.failures.find((f) => `workflow:${f.id}` === key)?.retry();
        continue;
      }
      const work = this.jobs.get(key);
      if (work) {
        await this.job(key, work, run);
      }
      if (this.snapshot.access.level === 'teaser' && ['catalogue', 'list', 'modules'].includes(key))
        await this.teaserReload?.();
      const category = key.split(':')[0] as Category;
      if (category in this.states)
        this.states[category] = [...this.failures.keys()].some(
          (k) => k === category || k.startsWith(`${category}:`),
        )
          ? 'failed'
          : 'loaded';
    }
    this.guard(run);
    for (const category of Object.keys(this.states) as Category[]) {
      const reads = [...this.outcomes].filter(
        ([key]) => key === category || key.startsWith(`${category}:`),
      );
      if (reads.length)
        this.states[category] = reads.some(([, state]) => state === 'failed')
          ? 'failed'
          : reads.every(([, state]) => state === 'unsupported')
            ? 'unsupported'
            : 'loaded';
    }
    this.settled = true;
    this.snapshot = {
      ...this.snapshot,
      phase: this.failures.has('catalogue') || this.failures.has('list') ? 'failed' : 'complete',
    };
    this.emit();
    if (this.graphTimer)
      await pause(Math.max(0, 505 - (Date.now() - this.lastBuild)), this.controller.signal);
    this.guard(run);
    if (this.snapshot.access.level === 'full') {
      try {
        await (this.deps.cache ?? automationMapCacheMessage)({
          type: 'automationMap:writeCache',
          origin: this.context.origin,
          orgId: this.context.orgId,
          value: this.cacheValue(),
        });
      } catch {
        this.guard(run);
      }
    }
  }
  dispose(): void {
    this.disposed = true;
    this.abort();
    clearTimeout(this.graphTimer);
    clearInterval(this.monitor);
    this.deps.signal?.removeEventListener('abort', this.abort);
    this.listeners.clear();
  }
}
async function yieldToPage() {
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise((resolve) => setTimeout(resolve, 0));
}
async function bounded<T>(
  values: readonly T[],
  work: (value: T) => Promise<void>,
  guard: () => void,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, values.length) }, async () => {
      while (next < values.length) {
        guard();
        await work(values[next++]);
        guard();
      }
    }),
  );
}
function catalogueWrites(f: FunctionInput): number {
  return (
    f.summary.tasks?.integrations?.filter(
      (i) =>
        (i.service === 'ZohoCRM' ||
          i.service === 'crm' ||
          i.service === 'zoho.crm' ||
          i.function?.startsWith('zoho.crm.')) &&
        /^(updateRecord|createRecord|upsert|upsertRecord|deleteRecord|bulkUpdate|bulkCreate)$/.test(
          (i.function ?? '').replace(/^zoho\.crm\./, ''),
        ),
    ).length ?? 0
  );
}
function revealedGraph(
  graph: AutomationGraph,
  module: string | null,
  functions: readonly FunctionInput[],
): AutomationGraph {
  const ids = new Set(functions.map((f) => f.delugeId));
  const nodes = new Map(
    [...graph.nodes].filter(
      ([, n]) =>
        module !== null &&
        (n.moduleApiName === module || (n.kind === 'function' && ids.has(n.delugeId))),
    ),
  );
  const edges = graph.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  return {
    nodes,
    edges,
    modules: graph.modules.filter((m) => m.apiName === module),
    outgoing: new Map([...nodes.keys()].map((id) => [id, edges.filter((e) => e.from === id)])),
    incoming: new Map([...nodes.keys()].map((id) => [id, edges.filter((e) => e.to === id)])),
  };
}
/** WorkflowApi owns its pool; only add context guarding here, never nest pool slots. */
function requestAsFetch(fetch: FetchLike, guard: () => void): typeof globalThis.fetch {
  return (input, init) => {
    guard();
    return fetch(String(input), init);
  };
}

function associationCount(
  functions: readonly FunctionInput[],
  type: string,
  pluralLabel: string | null,
): number {
  return new Set(
    functions.flatMap((f) =>
      f.places
        .filter((p) => p.type === type && p.id !== null && p.modulePluralLabel === pluralLabel)
        .map((p) => p.id),
    ),
  ).size;
}

/** The same list-visible inventory in full and preview; source-only targets are graph islands. */
function moduleInventory(
  modules: readonly ModuleInput[],
  rules: AutomationGraphInputs['rules'],
): ModuleInput[] {
  const inventory = new Map(modules.filter((m) => m.apiName).map((m) => [m.apiName, m]));
  for (const rule of rules) {
    const api = rule.module.apiName;
    if (api && !inventory.has(api))
      inventory.set(api, { apiName: api, label: rule.module.label || api, pluralLabel: null });
  }
  return [...inventory.values()];
}
