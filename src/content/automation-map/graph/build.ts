import { functionJoinIdentity, joinFunction } from '../../workflows/related-functions';
import type {
  WorkflowAction,
  WorkflowActionLocation,
  WorkflowCriteria,
  WorkflowRule,
} from '../../workflows/types';
import type {
  AutomationGraph,
  AutomationGraphInputs,
  EntryKind,
  FunctionInput,
  FunctionNode,
  MapEdge,
  MapNode,
  ModuleNode,
  RuleNode,
} from '../types';
import { httpHost, mayRunWorkflows, operation, sourceSpans, urlHost } from './effects';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = <T>(values: readonly T[], key: (v: T) => string) =>
  [...values].sort((a, b) => compare(key(a), key(b)));
function criteriaFields(criteria: WorkflowCriteria | null): string[] {
  if (!criteria) return [];
  if (criteria.kind === 'predicate') return [criteria.field.apiName];
  return criteria.kind === 'group' ? criteria.children.flatMap(criteriaFields) : [];
}

/** Pure snapshot builder. Occurrence indexes are retained; catalogue namespaces never mix. */
export function buildAutomationGraph(inputs: AutomationGraphInputs): AutomationGraph {
  const nodes = new Map<string, MapNode>();
  const edgeMap = new Map<string, MapEdge>();
  const base = (
    id: string,
    label: string,
    moduleApiName: string | null,
    active: boolean | null = null,
  ) => ({ id, label, moduleApiName, active, inActiveScope: false });
  const edge = (
    kind: MapEdge['kind'],
    from: string,
    to: string,
    extra: Partial<MapEdge> = {},
    site = '',
  ) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    const id = JSON.stringify([kind, from, to, site]);
    if (!edgeMap.has(id))
      edgeMap.set(id, {
        id,
        kind,
        from,
        to,
        evidence: 'declared',
        confidence: null,
        inActiveScope: false,
        ...extra,
      });
  };
  const module = (api: string, label = api) => {
    const id = `module:${api}`;
    if (!nodes.has(id))
      nodes.set(id, {
        ...base(id, label, api),
        kind: 'module',
        apiName: api,
        counts: {
          rules: 0,
          activeRules: 0,
          buttons: 0,
          schedules: 0,
          functions: 0,
          fieldsWritten: 0,
        },
      });
  };
  for (const m of sorted(inputs.modules, (m) => m.apiName)) module(m.apiName, m.label);
  const labels = new Map(
    [...inputs.fields].map(([m, fields]) => [m, new Map(fields.map((f) => [f.apiName, f.label]))]),
  );
  const field = (m: string | null, f: string) => {
    const id = `field:${m ?? '*'}.${m ? f : '*'}`;
    if (!nodes.has(id)) {
      if (m) module(m);
      const label = labels.get(m ?? '')?.get(f);
      nodes.set(id, {
        ...base(id, label ?? (m ? f : 'Unknown module'), m),
        kind: 'field',
        fieldApiName: m ? f : '*',
        labelConfirmed: !!label,
        bucket: !m ? 'unknownModule' : f === '*' ? 'unknownFields' : 'field',
      });
    }
    return id;
  };
  const external = (kind: Extract<MapNode, { kind: 'external' }>['externalKind'], key: string) => {
    const id = `external:${kind}:${key}`;
    if (!nodes.has(id))
      nodes.set(id, { ...base(id, key, null), kind: 'external', externalKind: kind, key });
    return id;
  };
  const summaries = inputs.functions.map((f) => f.summary);
  const exactFunction = (api: string | null) => {
    if (!api) return null;
    const candidates = inputs.functions.filter((f) => f.summary.api_name === api);
    const ids = new Set(candidates.map((f) => f.delugeId));
    if (ids.size !== 1) return null;
    const candidate = candidates[0];
    if (
      inputs.functions.some(
        (f) =>
          f.delugeId === candidate.delugeId &&
          functionJoinIdentity(f.summary) !== functionJoinIdentity(candidate.summary),
      )
    )
      return null;
    return `function:${candidate.delugeId}`;
  };
  const functionInputs = new Map<string, FunctionInput>();
  for (const f of sorted(
    inputs.functions,
    (f) => `${f.delugeId}/${functionJoinIdentity(f.summary)}`,
  )) {
    const id = `function:${f.delugeId}`;
    if (nodes.has(id)) continue;
    const apiKey =
      f.summary.rest_api?.some((r) => r.active === true && r.type === 'zapikey') ?? false;
    const oauth = f.summary.rest_api?.some((r) => r.active === true && r.type === 'oauth') ?? false;
    nodes.set(id, {
      ...base(
        id,
        f.summary.display_name?.trim() ||
          f.summary.api_name?.trim() ||
          `Unnamed function · ${f.delugeId.slice(-6)}`,
        null,
        false,
      ),
      kind: 'function',
      delugeId: f.delugeId,
      apiName: f.summary.api_name ?? null,
      category: f.summary.category ?? null,
      entryKinds: apiKey || oauth ? ['restApi'] : [],
      restApi: apiKey || oauth ? { apiKey, oauth } : null,
      analysis:
        f.sourceState === 'unavailable'
          ? 'source-unavailable'
          : f.sourceState === 'failed'
            ? 'failed'
            : (f.effects?.analysis.status ?? 'pending'),
      effects: f.effects,
      inDegree: 0,
      summary: f.summary,
    });
    functionInputs.set(id, f);
  }
  const callerTargets = new Set<string>();
  const linkFunction = (
    owner: string,
    target: string | null,
    kind: 'starts' | 'invokes',
    caller = owner,
    extra: Partial<MapEdge> = {},
    site = '',
  ) => {
    if (!target || !nodes.has(target)) return;
    edge(kind, owner, target, extra, site);
    callerTargets.add(JSON.stringify([caller, target]));
  };
  const actions = (
    owner: MapNode,
    list: readonly WorkflowAction[],
    prefix: string,
    location: ((a: WorkflowAction, i: number) => WorkflowActionLocation) | null,
    timingLabel: string | null,
  ) => {
    list.forEach((a, i) => {
      const id = `${prefix}/${i}`;
      nodes.set(id, {
        ...base(id, a.name || a.kind, owner.moduleApiName, owner.active),
        kind: 'action',
        ownerId: owner.id,
        location: location?.(a, i) ?? null,
        timingLabel,
        action: a,
      });
      edge('starts', owner.id, id);
      if (a.kind === 'function') {
        // Adapters may not have a catalogue yet; resolve every occurrence here.
        const joined = joinFunction(a, summaries);
        if (joined.confidence === 'exact')
          linkFunction(id, exactFunction(a.apiName), 'invokes', owner.id);
      } else if (a.kind === 'emailNotification' && a.template) {
        const tid = `template:${a.template.id}`;
        if (!nodes.has(tid))
          nodes.set(tid, {
            ...base(tid, a.template.name, owner.moduleApiName),
            kind: 'template',
            templateId: a.template.id,
            subject: a.template.subject,
          });
        const template = nodes.get(tid);
        if (
          template?.kind === 'template' &&
          template.subject === null &&
          a.template.subject !== null
        )
          template.subject = a.template.subject;
        edge('uses', id, tid);
      } else if (a.kind === 'webhook') {
        const host = urlHost(a.url);
        if (host) edge('calls', id, external('webhookHost', host));
      } else if (a.kind === 'fieldUpdate') {
        const m = a.relatedModule?.apiName ?? a.module?.apiName ?? owner.moduleApiName;
        edge('writes', id, field(m, a.field?.apiName ?? '*'), { operation: 'update' });
      } else if (a.kind === 'task' || a.kind === 'convert') {
        // Task mappings create Tasks, not fields on the triggering record. Conversion's
        // destination is used only when the normalized action explicitly supplies it.
        const m = a.kind === 'task' ? 'Tasks' : (a.module?.apiName ?? null);
        for (const mapping of a.fieldMappings)
          edge('writes', id, field(m, mapping.field.apiName), {
            operation: a.kind === 'task' ? 'create' : 'convert',
            note:
              a.kind === 'task'
                ? 'Task created (field mapping)'
                : 'Record converted (field mapping)',
          });
      }
    });
  };
  for (const r of sorted(inputs.rules, (r) => r.id)) {
    module(r.module.apiName, r.module.label);
    const id = `rule:${r.id}`;
    const watchedFields = [
      ...new Set(r.trigger?.type === 'field_update' ? criteriaFields(r.trigger.criteria) : []),
    ].sort(compare);
    const n: RuleNode = {
      ...base(id, r.name, r.module.apiName, r.active),
      kind: 'rule',
      ruleId: r.id,
      triggerType: r.trigger?.type ?? null,
      watchedFields,
      rule: r,
    };
    nodes.set(id, n);
    const reacts = (criteria: WorkflowCriteria | null, m: string) => {
      for (const f of criteriaFields(criteria)) edge('reacts', field(m, f), id);
    };
    const triggerModule = r.trigger?.triggerModule?.apiName ?? r.module.apiName;
    if (r.trigger?.type === 'field_update') reacts(r.trigger.criteria, triggerModule);
    r.conditions.forEach((c, ci) => {
      reacts(c.criteria, r.module.apiName);
      if (c.relatedCriteria?.module)
        reacts(c.relatedCriteria.criteria, c.relatedCriteria.module.apiName);
      actions(
        n,
        c.instantActions,
        `action:${r.id}/${ci}/i`,
        (a, ai) => ({ conditionIndex: ci, actionIndex: ai, actionKind: a.kind, timing: 'instant' }),
        null,
      );
      c.scheduledActions.forEach((s, si) => {
        actions(
          n,
          s.actions,
          `action:${r.id}/${ci}/s${si}`,
          (a, ai) => ({
            conditionIndex: ci,
            actionIndex: ai,
            actionKind: a.kind,
            timing: 'scheduled',
            scheduleIndex: si,
          }),
          s.label,
        );
      });
    });
  }
  const plural = (label: string | null) => {
    const matches = inputs.modules.filter((m) => label !== null && m.pluralLabel === label);
    return matches.length === 1 ? matches[0].apiName : null;
  };
  const placeModule = (type: string, id: string) => {
    const modules = new Set(
      inputs.functions.flatMap((f) =>
        f.places
          .filter((p) => p.type === type && p.id === id)
          .map((p) => plural(p.modulePluralLabel)),
      ),
    );
    return modules.size === 1 ? [...modules][0] : null;
  };
  for (const b of sorted(inputs.buttons, (b) => b.id)) {
    module(b.moduleApiName);
    const id = `button:${b.id}`;
    nodes.set(id, {
      ...base(id, b.name, b.moduleApiName, true),
      kind: 'button',
      buttonId: b.id,
      placements: b.placements,
      actionType: b.actionType,
      raw: b.raw,
    });
    if (b.actionType === 'custom_function' && b.functionDelugeId)
      linkFunction(id, `function:${b.functionDelugeId}`, 'starts');
  }
  for (const s of sorted(inputs.schedules, (s) => s.id)) {
    const id = `schedule:${s.id}`;
    nodes.set(id, {
      ...base(id, s.name, placeModule('schedules', s.id), s.active),
      kind: 'schedule',
      scheduleId: s.id,
      recurrenceLabel: s.recurrenceLabel,
      raw: s.raw,
    });
    linkFunction(id, exactFunction(s.functionApiName), 'starts');
  }
  for (const t of sorted(inputs.transitions, (t) => `${t.blueprintId}/${t.transitionId}`)) {
    module(t.moduleApiName);
    const id = `transition:${t.blueprintId}/${t.transitionId}`;
    const n: MapNode = {
      ...base(id, t.name, t.moduleApiName, t.blueprintActive),
      kind: 'transition',
      blueprintId: t.blueprintId,
      blueprintName: t.blueprintName,
      transitionId: t.transitionId,
      duringInputFields: t.duringInputFields,
      raw: t.raw,
    };
    nodes.set(id, n);
    for (const f of t.duringInputFields)
      edge('writes', id, field(t.moduleApiName, f), {
        operation: 'update',
        note: 'entered during transition',
      });
    actions(n, t.actions, `action:${id}/0/i`, null, null);
  }
  for (const a of sorted(inputs.approvals, (a) => a.id)) {
    module(a.moduleApiName);
    const id = `approval:${a.id}`;
    const n: MapNode = {
      ...base(id, a.name, a.moduleApiName, a.active),
      kind: 'approval',
      approvalId: a.id,
      raw: a.raw,
    };
    nodes.set(id, n);
    actions(n, a.actions, `action:${id}/0/i`, null, null);
  }
  for (const [fid, f] of functionInputs) {
    for (const p of sorted(f.places, (p) => `${p.type}/${p.id}/${p.modulePluralLabel}`)) {
      const kind = (
        {
          workflow_rules: 'rule',
          custom_buttons: 'button',
          schedules: 'schedule',
          approvals: 'approval',
        } as Record<string, 'rule' | 'button' | 'schedule' | 'approval' | undefined>
      )[p.type];
      if (!kind || !p.id) continue;
      const owner = `${kind}:${p.id}`;
      const m = plural(p.modulePluralLabel);
      if (!nodes.has(owner)) {
        const raw = p.raw && typeof p.raw === 'object' ? (p.raw as Record<string, unknown>) : {};
        const active =
          kind === 'button' ? true : typeof raw.status === 'boolean' ? raw.status : null;
        const label = typeof raw.name === 'string' ? raw.name : p.id;
        if (m) module(m);
        const b = base(owner, label, m, active);
        if (kind === 'button')
          nodes.set(owner, {
            ...b,
            kind,
            buttonId: p.id,
            placements: [],
            actionType: 'custom_function',
            raw: p.raw,
          });
        if (kind === 'schedule')
          nodes.set(owner, { ...b, kind, scheduleId: p.id, recurrenceLabel: null, raw: p.raw });
        if (kind === 'approval') nodes.set(owner, { ...b, kind, approvalId: p.id, raw: p.raw });
        if (kind === 'rule') {
          const rule: WorkflowRule = {
            id: p.id,
            name: label,
            description: '',
            module: { apiName: m ?? '', label: p.modulePluralLabel ?? '' },
            active,
            deprecated: null,
            category: null,
            trigger: null,
            conditions: [],
            detailState: 'not-requested',
            enrichmentState: 'not-requested',
            failureIds: [],
            raw: p.raw,
          };
          nodes.set(owner, {
            ...b,
            kind,
            ruleId: p.id,
            triggerType: null,
            watchedFields: [],
            rule,
          });
        }
      }
      if (!callerTargets.has(JSON.stringify([owner, fid]))) linkFunction(owner, fid, 'starts');
    }
    if (!f.effects) continue;
    const spans = sourceSpans(f.sourceText ?? '');
    for (const w of f.effects.writes) {
      const m = w.module.confidence === 'exact' ? w.module.value : null;
      const extra: Partial<MapEdge> = {
        evidence: m ? 'inferred' : 'unresolved',
        confidence: w.confidence,
        operation: operation(w.op),
        destinationScope: w.destinationScope,
        triggers: w.trigger.requested,
        spans: spans([w.span]),
        note: `${w.via} · possible ${w.op}`,
      };
      // Preserve record mutations for the lens, but never imply that they set field values.
      const noFields =
        ['delete', 'attach', 'add-tags', 'remove-tags'].includes(w.op) ||
        ((w.op === 'convert' || (w.op === 'update-related' && !w.unknownFields)) &&
          !w.fields.length);
      if (noFields) {
        edge('writes', fid, field(m, '*'), { ...extra, setsFields: false }, w.id);
        continue;
      }
      if (!m) edge('writes', fid, field(null, '*'), extra, w.id);
      else {
        for (const f of w.fields) {
          // Row fields belong to the subform, never to a same-named record field.
          const subform = f.domain === 'subform';
          edge(
            'writes',
            fid,
            field(m, subform ? f.path[0] : f.apiName),
            subform ? { ...extra, subformPath: f.path } : extra,
            subform ? `${w.id}:${JSON.stringify(f.path)}` : w.id,
          );
        }
        if (w.unknownFields || w.fieldsConfidence === 'partial' || w.fieldsConfidence === 'unknown')
          edge('writes', fid, field(m, '*'), { ...extra, evidence: 'unresolved' }, w.id);
      }
      if (!m || w.destinationScope !== 'current-org' || !mayRunWorkflows(w.trigger)) continue;
      const op = operation(w.op);
      const writeSet = new Set(w.fields.map((f) => f.path[0]));
      for (const r of inputs.rules) {
        if (r.active !== true || (r.trigger?.triggerModule?.apiName ?? r.module.apiName) !== m)
          continue;
        const type = r.trigger?.type;
        const creates =
          (op === 'create' || op === 'upsert') && (type === 'create' || type === 'create_or_edit');
        const updates =
          (op === 'update' || op === 'upsert') &&
          (type === 'edit' ||
            type === 'create_or_edit' ||
            (type === 'field_update' &&
              (w.unknownFields ||
                w.fieldsConfidence !== 'exact' ||
                criteriaFields(r.trigger?.type === 'field_update' ? r.trigger.criteria : null)
                  .length === 0 ||
                criteriaFields(r.trigger?.type === 'field_update' ? r.trigger.criteria : null).some(
                  (f) => writeSet.has(f),
                ))));
        if (creates || updates)
          edge(
            'cascades',
            fid,
            `rule:${r.id}`,
            {
              ...extra,
              note: 'Possible workflow cascade; same-record updates from workflow-triggered functions can be suppressed.',
            },
            w.id,
          );
      }
    }
    for (const c of f.effects.calls) {
      if (
        c.kind !== 'crm-function' ||
        c.destinationScope !== 'current-org' ||
        c.resolution === 'ambiguous' ||
        c.qualifiedName.confidence !== 'exact'
      )
        continue;
      linkFunction(
        fid,
        exactFunction(c.apiName),
        'invokes',
        fid,
        {
          evidence: 'inferred',
          confidence: c.confidence,
          spans: spans([c.span]),
          note: 'Possible function call',
        },
        c.id,
      );
    }
    for (const c of f.effects.connections)
      edge(
        'calls',
        fid,
        external('connection', c.name.value ?? '*'),
        {
          evidence: c.name.value ? 'inferred' : 'unresolved',
          confidence: c.name.confidence,
          spans: spans([c.span]),
        },
        c.id,
      );
    for (const s of f.effects.services)
      edge(
        'calls',
        fid,
        external('zohoService', s.service),
        { evidence: 'inferred', confidence: s.confidence, spans: spans([s.span]) },
        s.id,
      );
    for (const e of f.effects.external) {
      const kind = e.kind === 'sendmail' ? 'email' : e.service ? 'zohoService' : 'urlHost';
      const key =
        e.kind === 'sendmail'
          ? 'email'
          : (e.service ?? httpHost(f.sourceText ?? '', e.span) ?? '*');
      edge(
        'calls',
        fid,
        external(kind, key),
        {
          evidence: key === '*' ? 'unresolved' : 'inferred',
          confidence: e.confidence,
          spans: spans([e.span]),
        },
        e.id,
      );
    }
  }
  // Propagate caller homes through function-call cycles to a fixed point. Unknown
  // caller homes remain unknown rather than being guessed from a write destination.
  const homes = new Map<string, Set<string | null>>();
  const callers = new Map<string, Set<string>>();
  for (const pair of callerTargets) {
    const [caller, target] = JSON.parse(pair) as [string, string];
    if (!callers.has(target)) callers.set(target, new Set());
    callers.get(target)?.add(caller);
  }
  for (const id of functionInputs.keys()) homes.set(id, new Set());
  const propagateHomes = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, set] of homes)
        for (const caller of callers.get(id) ?? []) {
          const values = homes.get(caller) ?? [nodes.get(caller)?.moduleApiName ?? null];
          for (const m of values)
            if (!set.has(m)) {
              set.add(m);
              changed = true;
            }
        }
    }
  };
  propagateHomes();
  // A rootless call cycle is org-level too. Propagate that uncertainty into
  // downstream functions even when they also have a known module caller.
  for (const set of homes.values()) if (!set.size) set.add(null);
  propagateHomes();
  for (const [id, set] of homes) {
    const n = nodes.get(id) as FunctionNode;
    n.moduleApiName = set.size === 1 ? [...set][0] : null;
    n.inDegree = callers.get(id)?.size ?? 0;
    const entries = new Set<EntryKind>(n.entryKinds);
    for (const c of callers.get(id) ?? []) {
      const kind = nodes.get(c)?.kind;
      if (
        kind === 'rule' ||
        kind === 'button' ||
        kind === 'schedule' ||
        kind === 'transition' ||
        kind === 'approval'
      )
        entries.add(kind);
    }
    n.entryKinds = [...entries].sort(compare);
  }
  const edges = [...edgeMap.values()].sort((a, b) => compare(a.id, b.id));
  const outgoing = new Map<string, MapEdge[]>(),
    incoming = new Map<string, MapEdge[]>();
  for (const id of [...nodes.keys()].sort(compare)) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const e of edges) {
    outgoing.get(e.from)?.push(e);
    incoming.get(e.to)?.push(e);
  }
  const queue: string[] = [];
  for (const n of nodes.values())
    if (
      (['rule', 'button', 'schedule', 'transition', 'approval'].includes(n.kind) &&
        n.active === true) ||
      (n.kind === 'function' && n.restApi)
    ) {
      n.inActiveScope = true;
      queue.push(n.id);
    }
  for (let i = 0; i < queue.length; i++)
    for (const e of outgoing.get(queue[i]) ?? []) {
      if (e.kind === 'reacts') continue;
      const target = nodes.get(e.to);
      if (target && !target.inActiveScope) {
        target.inActiveScope = true;
        queue.push(target.id);
      }
    }
  for (const e of edges)
    if (e.kind === 'reacts' && nodes.get(e.to)?.inActiveScope) {
      const n = nodes.get(e.from);
      if (n) n.inActiveScope = true;
    }
  for (const n of nodes.values()) {
    if (n.kind === 'function') n.active = n.inActiveScope;
    if (n.moduleApiName && n.inActiveScope) {
      const m = nodes.get(`module:${n.moduleApiName}`);
      if (m) m.inActiveScope = true;
    }
  }
  for (const e of edges)
    e.inActiveScope = !!nodes.get(e.from)?.inActiveScope && !!nodes.get(e.to)?.inActiveScope;
  const modules = [...nodes.values()].filter((n): n is ModuleNode => n.kind === 'module');
  for (const n of nodes.values()) {
    const m = nodes.get(`module:${n.moduleApiName}`);
    if (m?.kind !== 'module') continue;
    if (n.kind === 'rule') {
      m.counts.rules++;
      if (n.active) m.counts.activeRules++;
    }
    if (n.kind === 'function') m.counts.functions++;
    if (n.kind === 'button') m.counts.buttons++;
    if (n.kind === 'schedule') m.counts.schedules++;
    if (n.kind === 'field' && incoming.get(n.id)?.some((e) => e.kind === 'writes'))
      m.counts.fieldsWritten++;
  }
  const volume = (m: ModuleNode) =>
    m.counts.rules +
    m.counts.buttons +
    m.counts.schedules +
    m.counts.functions +
    m.counts.fieldsWritten;
  modules.sort((a, b) => volume(b) - volume(a) || compare(a.label, b.label) || compare(a.id, b.id));
  return {
    nodes: new Map([...nodes].sort(([a], [b]) => compare(a, b))),
    edges,
    outgoing,
    incoming,
    modules,
  };
}
