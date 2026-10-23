/**
 * Pure board view-model: islands, lane items and edges derived from the graph (UX spec §5, §6).
 *
 * - A node can have several instances: shared functions, templates and externals render once in
 *   every island that reaches them (`iid = island|nodeId`), so every drawn edge is intra-island.
 * - Record events ("Field changed: Stage · 4 rules") and REST API entry stubs are derived here.
 * - Writes into another module's fields become portal stubs with a partner in the target island.
 * - Hub functions collapse their incoming edges into a "Called by N" badge.
 * No DOM, no layout: `layout.ts` assigns geometry.
 */
import type {
  AutomationGraph,
  EdgeEvidence,
  FieldNode,
  FunctionNode,
  MapEdge,
  MapEdgeKind,
  MapNode,
  MapNodeId,
  RuleNode,
} from '../../types';
import { ensure, LANES, type LaneId } from './geometry';
import { ACTION_LABEL, EXTERNAL_LABEL, type ItemKind, TRIGGER_LABEL, TRIGGER_ORDER } from './kinds';
import { FLOW_KINDS, type Visibility } from './visibility';

export const ORG_ID = '__org';

export interface PortalInfo {
  dir: 'in' | 'out';
  /** Target module island for outgoing portals, source island for incoming ones. */
  otherIslandId: string;
  otherLabel: string;
  /** Field nodes written (out) or written from the source island (in). */
  fieldIds: readonly MapNodeId[];
  fieldLabels: readonly string[];
  /** Distinct write edges behind this stub; drives overview flow width and the hover tip. */
  writeCount: number;
  /** True when the stub stands for a module's "fields unknown" bucket. */
  unknownFields: boolean;
  /** iid of the partner stub in the other island, or null when that island is not shown. */
  partnerIid: string | null;
}

export interface BoardItem {
  iid: string;
  key: string;
  islandId: string;
  kind: ItemKind;
  lane: LaneId;
  node: MapNode | null;
  title: string;
  subtitle: string;
  active: boolean | null;
  /** Event: grouped rule ids. API stub: the function id. */
  members: readonly MapNodeId[];
  hub: { callers: number; here: number } | null;
  /** True for an item whose edge into a hub is collapsed into a port dot. */
  port: boolean;
  /** Function analysis gap: dashed border and warn glyph. */
  gap: boolean;
  /** Pending analysis: shimmer subtitle. */
  pending: boolean;
  /** Mini action icons on rule cards. */
  miniIcons: readonly string[];
  /** Short badge text on action cards ("+2 days"). */
  timing: string | null;
  portal: PortalInfo | null;
  /** Island-local geometry, assigned by layout. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sub-column inside a wrapped lane (0 for ordinary lanes). */
  col: number;
  /** Entry-lane ordering: record events by trigger, then buttons, transitions, schedules, APIs. */
  rank: number;
}

export type BoardEdgeKind = MapEdgeKind | 'trigger';

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  kind: BoardEdgeKind;
  evidence: EdgeEvidence;
  confidence: MapEdge['confidence'];
  source: MapEdge | null;
  /** Edge into a hub function: collapsed unless the hub or a caller is hovered or selected. */
  hub: boolean;
  /** Runs right-to-left (cascades, reacts); routed under the island. */
  back: boolean;
  /** Back edge that closes a cycle: labelled "↻". */
  loop: boolean;
  /** Bridges over nodes hidden by the kind filter. */
  bypass: boolean;
  /** Never part of the resting island drawing; shown only for hover and selection. */
  hover: boolean;
}

export interface BoardIsland {
  id: string;
  label: string;
  abbr: string;
  org: boolean;
  moduleApiName: string | null;
  items: BoardItem[];
  edges: BoardEdge[];
  byIid: Map<string, BoardItem>;
  stats: {
    rules: number;
    activeRules: number;
    functions: number;
    buttons: number;
    schedules: number;
    apis: number;
    fields: number;
    /** Modules that write into this island (incoming portal stubs). */
    writtenFrom: number;
  };
  /** Layout results. */
  present: LaneId[];
  laneX: Partial<Record<LaneId, number>>;
  laneCols: Partial<Record<LaneId, number>>;
  w: number;
  h: number;
  hasBack: boolean;
  x: number;
  y: number;
}

export interface FlowPair {
  from: string;
  to: string;
  count: number;
}

export interface BoardModel {
  islands: BoardIsland[];
  byIid: Map<string, BoardItem>;
  /** Every instance of a graph node. */
  byNode: Map<MapNodeId, BoardItem[]>;
  hubThreshold: number;
  flows: FlowPair[];
}

const LANE_OF: Partial<Record<MapNode['kind'], LaneId>> = {
  rule: 'rules',
  action: 'actions',
  function: 'resources',
  template: 'resources',
  external: 'resources',
  field: 'effects',
  button: 'entry',
  transition: 'entry',
  approval: 'entry',
  schedule: 'entry',
};

const ENTRY_RANK: Partial<Record<MapNode['kind'], number>> = {
  button: 7,
  transition: 7.2,
  approval: 7.3,
  schedule: 7.5,
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const EVIDENCE_RANK: Record<EdgeEvidence, number> = { declared: 0, inferred: 1, unresolved: 2 };

export function hubThresholdFor(graph: AutomationGraph): number {
  const degrees: number[] = [];
  for (const n of graph.nodes.values()) if (n.kind === 'function') degrees.push(n.inDegree);
  degrees.sort((a, b) => a - b);
  const p98 = degrees.length ? degrees[Math.floor(0.98 * (degrees.length - 1))] : 0;
  return Math.max(8, p98);
}

export function abbreviate(label: string): string {
  const words = label.split(/[\s_\-.]+/).filter(Boolean);
  if (!words.length) return '··';
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

export function triggerLabel(rule: RuleNode): string {
  const type = rule.triggerType ?? 'unknown';
  const base = TRIGGER_LABEL[type] ?? TRIGGER_LABEL.unknown;
  if (type === 'field_update' && rule.watchedFields.length)
    return `${base}: ${rule.watchedFields.join(', ')}`;
  const trigger = rule.rule.trigger;
  if (type === 'date_or_datetime' && trigger?.type === 'date_or_datetime' && trigger.field)
    return `${base}: ${trigger.field.label || trigger.field.apiName}`;
  return base;
}

function triggerSignature(rule: RuleNode): string {
  const type = rule.triggerType ?? 'unknown';
  if (type === 'field_update') return `${type}:${rule.watchedFields.join(',')}`;
  const trigger = rule.rule.trigger;
  if (type === 'date_or_datetime' && trigger?.type === 'date_or_datetime')
    return `${type}:${trigger.field?.apiName ?? ''}:${trigger.offset?.unit ?? ''}${trigger.offset?.period ?? ''}`;
  return type;
}

const ruleActionKinds = (rule: RuleNode): string[] => {
  const kinds: string[] = [];
  for (const c of rule.rule.conditions)
    for (const a of [...c.instantActions, ...c.scheduledActions.flatMap((s) => s.actions)])
      if (!kinds.includes(a.kind)) kinds.push(a.kind);
  return kinds;
};

const ruleActionCount = (rule: RuleNode): number =>
  rule.rule.conditions.reduce(
    (sum, c) =>
      sum + c.instantActions.length + c.scheduledActions.reduce((s, x) => s + x.actions.length, 0),
    0,
  );

function functionSubtitle(fn: FunctionNode): string {
  switch (fn.analysis) {
    case 'source-unavailable':
      return 'Source unavailable';
    case 'failed':
      return 'Could not be analysed';
    case 'unsupported':
      return 'Not analysed';
    case 'limited':
      return `${fn.apiName ?? 'Function'} · partly analysed`;
    case 'pending':
      return 'Analysing code…';
    default:
      return fn.apiName ?? 'Deluge function';
  }
}

const restLabel = (fn: FunctionNode) =>
  fn.restApi
    ? [fn.restApi.oauth ? 'OAuth' : null, fn.restApi.apiKey ? 'API key' : null]
        .filter(Boolean)
        .join(' / ')
    : '';

const iidOf = (islandId: string, key: string) => `${islandId}|${key}`;

type ItemInit = Partial<BoardItem> & Pick<BoardItem, 'key' | 'kind' | 'lane' | 'title'>;

export function makeBoardItem(islandId: string, init: ItemInit): BoardItem {
  return {
    iid: iidOf(islandId, init.key),
    islandId,
    node: null,
    subtitle: '',
    active: null,
    members: [],
    hub: null,
    port: false,
    gap: false,
    pending: false,
    miniIcons: [],
    timing: null,
    portal: null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    col: 0,
    rank: 0,
    ...init,
  };
}

export interface DescribeContext {
  islandId: string;
  islandLabel: string;
  moduleLabel(api: string | null): string;
}

/** The presentation record for a graph node (shared by the board and the trace flowchart). */
export function describeNode(n: MapNode, c: DescribeContext): BoardItem | null {
  const lane = LANE_OF[n.kind];
  if (!lane) return null;
  const make = (init: Omit<ItemInit, 'key' | 'kind' | 'lane'>) =>
    makeBoardItem(c.islandId, {
      key: n.id,
      kind: n.kind as ItemKind,
      lane,
      node: n,
      active: n.active,
      rank: ENTRY_RANK[n.kind] ?? 0,
      ...init,
    });
  switch (n.kind) {
    case 'rule':
      return make({
        title: n.label,
        subtitle: `${triggerLabel(n)} · ${ruleActionCount(n)} action${ruleActionCount(n) === 1 ? '' : 's'}`,
        miniIcons: ruleActionKinds(n).slice(0, 4),
      });
    case 'action':
      return make({
        title: n.label,
        subtitle: ACTION_LABEL[n.action.kind] ?? n.action.kind,
        timing: n.timingLabel,
        miniIcons: [n.action.kind],
      });
    case 'function':
      return make({
        title: n.label,
        subtitle: functionSubtitle(n),
        gap: n.analysis !== 'analyzed' && n.analysis !== 'pending',
        pending: n.analysis === 'pending',
      });
    case 'template':
      return make({ title: n.label, subtitle: n.subject ?? '' });
    case 'external':
      return make({ title: n.label, subtitle: EXTERNAL_LABEL[n.externalKind] ?? n.externalKind });
    case 'field':
      return make({
        title:
          n.bucket === 'unknownFields'
            ? `${c.islandLabel} · fields unknown`
            : n.bucket === 'unknownModule'
              ? 'Unresolved module'
              : n.label,
        subtitle:
          n.bucket === 'unknownFields'
            ? 'Fields not named in code'
            : n.bucket === 'unknownModule'
              ? 'Module chosen at run time'
              : n.fieldApiName,
      });
    case 'button':
      return make({
        title: n.label,
        subtitle: `${c.moduleLabel(n.moduleApiName)} · ${n.placements[0] ?? 'Button'}`,
      });
    case 'schedule':
      return make({ title: n.label, subtitle: n.recurrenceLabel ?? 'Schedule' });
    case 'transition':
      return make({ title: n.label, subtitle: `Blueprint · ${n.blueprintName}` });
    case 'approval':
      return make({ title: n.label, subtitle: 'Approval process' });
    default:
      return null;
  }
}

export interface BuildOptions {
  /** Include the shared functions/templates/externals that no entry point reaches. */
  includeLoose: boolean;
  /**
   * Teaser: every module except `keep` is locked, so portal stubs never print its name (the
   * revealed flow may write fields in a fogged module; the module itself stays unnamed).
   */
  redact?: { keep: string | null };
}

interface Draft {
  id: string;
  label: string;
  moduleApiName: string | null;
  org: boolean;
  seeds: MapNodeId[];
  closure: Set<MapNodeId>;
}

export function buildBoardModel(
  graph: AutomationGraph,
  vis: Visibility,
  options: BuildOptions,
): BoardModel {
  const nodes = graph.nodes;
  const moduleLabel = (api: string | null): string => {
    if (!api) return 'Org-wide';
    if (options.redact && api !== options.redact.keep) return 'Locked module';
    const m = nodes.get(`module:${api}`);
    return m ? m.label : api;
  };
  const hubThreshold = hubThresholdFor(graph);
  const drafts = new Map<string, Draft>();
  const draft = (id: string): Draft => {
    let d = drafts.get(id);
    if (!d) {
      const api = id === ORG_ID ? null : id;
      d = {
        id,
        label: moduleLabel(api),
        moduleApiName: api,
        org: id === ORG_ID,
        seeds: [],
        closure: new Set(),
      };
      drafts.set(id, d);
    }
    return d;
  };
  const moduleAllowed = (id: string) =>
    id === ORG_ID ? !vis.modules.size : !vis.modules.size || vis.modules.has(id);
  const homeOf = (n: MapNode): string => n.moduleApiName ?? ORG_ID;

  // 1. Seeds: every entry point opens its island; schedules and REST API functions live Org-wide.
  for (const id of vis.allowed) {
    const n = nodes.get(id);
    if (!n) continue;
    if (
      n.kind === 'rule' ||
      n.kind === 'button' ||
      n.kind === 'transition' ||
      n.kind === 'approval'
    )
      draft(homeOf(n)).seeds.push(id);
    else if (n.kind === 'schedule') draft(ORG_ID).seeds.push(id);
    else if (n.kind === 'function' && n.restApi) draft(ORG_ID).seeds.push(id);
  }

  const isLocalField = (f: FieldNode, d: Draft): boolean =>
    f.bucket === 'unknownModule' ||
    (d.moduleApiName !== null && f.moduleApiName === d.moduleApiName);

  const walk = (d: Draft, start: Iterable<MapNodeId>) => {
    const queue = [...start];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (d.closure.has(id)) continue;
      d.closure.add(id);
      for (const e of graph.outgoing.get(id) ?? []) {
        if (!FLOW_KINDS.has(e.kind) || !vis.allowed.has(e.to)) continue;
        const t = nodes.get(e.to);
        if (!t) continue;
        if (t.kind === 'field' && !isLocalField(t, d)) continue;
        if (!d.closure.has(e.to)) queue.push(e.to);
      }
    }
  };
  for (const d of [...drafts.values()]) walk(d, d.seeds);

  // Everything scope: functions, templates and externals nothing reaches belong Org-wide
  // (templates to their module) so "everything" really is everything.
  if (options.includeLoose) {
    const placed = new Set<MapNodeId>();
    for (const d of drafts.values()) for (const id of d.closure) placed.add(id);
    const loose = new Map<string, MapNodeId[]>();
    for (const id of vis.allowed) {
      if (placed.has(id)) continue;
      const n = nodes.get(id);
      if (!n) continue;
      if (n.kind === 'function' || n.kind === 'external') ensure(loose, ORG_ID, () => []).push(id);
      else if (n.kind === 'template') ensure(loose, homeOf(n), () => []).push(id);
    }
    for (const [islandId, ids] of loose) {
      const d = draft(islandId);
      d.seeds.push(...ids);
      walk(d, ids);
    }
  }

  // 2. Items.
  const model: BoardModel = {
    islands: [],
    byIid: new Map(),
    byNode: new Map(),
    hubThreshold,
    flows: [],
  };
  const islands = new Map<string, BoardIsland>();
  const blank = (d: Draft): BoardIsland => ({
    id: d.id,
    label: d.label,
    abbr: d.org ? 'ORG' : abbreviate(d.label),
    org: d.org,
    moduleApiName: d.moduleApiName,
    items: [],
    edges: [],
    byIid: new Map(),
    stats: {
      rules: 0,
      activeRules: 0,
      functions: 0,
      buttons: 0,
      schedules: 0,
      apis: 0,
      fields: 0,
      writtenFrom: 0,
    },
    present: [],
    laneX: {},
    laneCols: {},
    w: 0,
    h: 0,
    hasBack: false,
    x: 0,
    y: 0,
  });
  const register = (I: BoardIsland, item: BoardItem) => {
    I.items.push(item);
    I.byIid.set(item.iid, item);
    model.byIid.set(item.iid, item);
    if (item.node) {
      const list = model.byNode.get(item.node.id);
      if (list) list.push(item);
      else model.byNode.set(item.node.id, [item]);
    }
  };
  const makeItem = (I: BoardIsland, init: ItemInit): BoardItem => makeBoardItem(I.id, init);
  const describe = (I: BoardIsland, n: MapNode): BoardItem | null =>
    describeNode(n, { islandId: I.id, islandLabel: I.label, moduleLabel });

  const order = [...drafts.values()].sort((a, b) =>
    a.org === b.org ? compare(a.id, b.id) : a.org ? -1 : 1,
  );
  for (const d of order) {
    if (!moduleAllowed(d.id)) continue;
    const I = blank(d);
    islands.set(d.id, I);
    for (const id of d.closure) {
      if (!vis.visible.has(id)) continue;
      const n = nodes.get(id);
      if (!n) continue;
      // Org-wide hosts only the entry points that live there; module entries stay in their module.
      const item = describe(I, n);
      if (item) register(I, item);
    }
  }

  // 3. Flow edges between visible members, bridging over kind-hidden nodes.
  interface PortalDraft {
    fields: Set<MapNodeId>;
    entries: Array<{ from: BoardItem; edge: MapEdge; bypass: boolean }>;
  }
  const portalDrafts = new Map<string, Map<string, PortalDraft>>();
  for (const I of islands.values()) {
    const d = drafts.get(I.id);
    if (!d) continue;
    const byId = new Map<string, BoardEdge>();
    const pushEdge = (from: BoardItem, to: BoardItem, e: MapEdge, bypass: boolean) => {
      const id = `${from.iid}>${to.iid}:${e.kind}`;
      const existing = byId.get(id);
      if (existing) {
        if (EVIDENCE_RANK[e.evidence] < EVIDENCE_RANK[existing.evidence]) {
          existing.evidence = e.evidence;
          existing.confidence = e.confidence;
          existing.source = e;
        }
        return;
      }
      const edge: BoardEdge = {
        id,
        from: from.iid,
        to: to.iid,
        kind: e.kind,
        evidence: e.evidence,
        confidence: e.confidence,
        source: e,
        hub: false,
        back: false,
        loop: false,
        bypass,
        hover: false,
      };
      byId.set(id, edge);
      I.edges.push(edge);
    };
    for (const from of I.items) {
      if (!from.node) continue;
      const visited = new Set<MapNodeId>([from.node.id]);
      const stack: Array<{ edge: MapEdge; bypass: boolean }> = (
        graph.outgoing.get(from.node.id) ?? []
      )
        .filter((e) => FLOW_KINDS.has(e.kind))
        .map((edge) => ({ edge, bypass: false }));
      while (stack.length) {
        const { edge, bypass } = stack.pop() as { edge: MapEdge; bypass: boolean };
        const t = nodes.get(edge.to);
        if (!t || !vis.allowed.has(t.id)) continue;
        if (t.kind === 'field' && !isLocalField(t, d)) {
          // Out-of-island field write: collected into portal stubs below.
          if (!vis.visible.has(t.id) || !t.moduleApiName) continue;
          const byModule = ensure(portalDrafts, I.id, () => new Map<string, PortalDraft>());
          const p = ensure(byModule, t.moduleApiName, () => ({
            fields: new Set<MapNodeId>(),
            entries: [] as PortalDraft['entries'],
          }));
          p.fields.add(t.id);
          p.entries.push({ from, edge, bypass });
          continue;
        }
        if (!d.closure.has(t.id)) continue;
        if (vis.visible.has(t.id)) {
          const target = I.byIid.get(iidOf(I.id, t.id));
          if (target) pushEdge(from, target, edge, bypass);
          continue;
        }
        if (visited.has(t.id)) continue;
        visited.add(t.id);
        for (const e of graph.outgoing.get(t.id) ?? [])
          if (FLOW_KINDS.has(e.kind)) stack.push({ edge: e, bypass: true });
      }
    }
  }

  // 4. Record events and REST API stubs (Entry lane view nodes).
  for (const I of islands.values()) {
    const groups = new Map<string, { label: string; type: string; rules: BoardItem[] }>();
    for (const item of I.items) {
      if (item.node?.kind !== 'rule') continue;
      const rule = item.node;
      const sig = triggerSignature(rule);
      const g = ensure(groups, sig, () => ({
        label: triggerLabel(rule),
        type: rule.triggerType ?? 'unknown',
        rules: [] as BoardItem[],
      }));
      g.rules.push(item);
    }
    for (const [sig, g] of [...groups].sort(
      ([, a], [, b]) =>
        (TRIGGER_ORDER[a.type] ?? 9) - (TRIGGER_ORDER[b.type] ?? 9) || compare(a.label, b.label),
    )) {
      const event = makeItem(I, {
        key: `event:${sig}`,
        kind: 'event',
        lane: 'entry',
        title: g.label,
        rank: TRIGGER_ORDER[g.type] ?? 6,
        subtitle: `${g.rules.length} rule${g.rules.length === 1 ? '' : 's'}`,
        active: g.rules.some((r) => r.active === true),
        members: g.rules.map((r) => r.node?.id ?? ''),
      });
      register(I, event);
      for (const rule of g.rules)
        I.edges.push({
          id: `${event.iid}>${rule.iid}:trigger`,
          from: event.iid,
          to: rule.iid,
          kind: 'trigger',
          evidence: 'declared',
          confidence: null,
          source: null,
          hub: false,
          back: false,
          loop: false,
          bypass: false,
          hover: false,
        });
    }
    if (I.org) {
      for (const item of [...I.items]) {
        if (item.node?.kind !== 'function' || !item.node.restApi) continue;
        const api = makeItem(I, {
          key: `api:${item.node.id}`,
          kind: 'api',
          lane: 'entry',
          rank: 8,
          title: item.node.apiName ?? item.node.label,
          subtitle: `REST API · ${restLabel(item.node)}`,
          active: true,
          members: [item.node.id],
        });
        register(I, api);
        I.edges.push({
          id: `${api.iid}>${item.iid}:trigger`,
          from: api.iid,
          to: item.iid,
          kind: 'trigger',
          evidence: 'declared',
          confidence: null,
          source: null,
          hub: false,
          back: false,
          loop: false,
          bypass: false,
          hover: false,
        });
      }
    }
  }

  // 5. Portals: outgoing stubs, then incoming stubs (creating bare islands for write-only modules).
  const outStubs: Array<{ from: BoardIsland; stub: BoardItem; module: string }> = [];
  const MAX_SINGLE_PORTALS = 3;
  for (const [islandId, byModule] of portalDrafts) {
    const I = islands.get(islandId);
    if (!I) continue;
    let seq = 0;
    for (const [module, p] of [...byModule].sort(([a], [b]) => compare(a, b))) {
      const fields = [...p.fields]
        .map((id) => nodes.get(id))
        .filter((n): n is FieldNode => n?.kind === 'field');
      const groupAll = fields.length > MAX_SINGLE_PORTALS;
      const groups: FieldNode[][] = groupAll ? [fields] : fields.map((f) => [f]);
      for (const group of groups) {
        const ids = new Set(group.map((f) => f.id));
        const entries = p.entries.filter((en) => ids.has(en.edge.to));
        const unknown = group.length === 1 && group[0].bucket === 'unknownFields';
        const label = moduleLabel(module);
        const stub = makeItem(I, {
          // Opaque ordinal: the key reaches the DOM (data-iid) and must not carry module or
          // field API names (teaser: those belong to locked modules).
          key: `po:${seq++}`,
          kind: 'portal',
          lane: 'effects',
          title: groupAll
            ? `${label} · ${group.length} fields`
            : `${label} · ${unknown ? 'fields unknown' : group[0].label}`,
          portal: {
            dir: 'out',
            otherIslandId: module,
            otherLabel: label,
            fieldIds: group.map((f) => f.id),
            fieldLabels: group.map((f) => f.label),
            writeCount: entries.length,
            unknownFields: unknown,
            partnerIid: null,
          },
        });
        register(I, stub);
        outStubs.push({ from: I, stub, module });
        const seenWriters = new Set<string>();
        for (const { from, edge, bypass } of entries) {
          if (seenWriters.has(from.iid)) continue;
          seenWriters.add(from.iid);
          I.edges.push({
            id: `${from.iid}>${stub.iid}:writes`,
            from: from.iid,
            to: stub.iid,
            kind: 'writes',
            evidence: edge.evidence,
            confidence: edge.confidence,
            source: edge,
            hub: false,
            back: false,
            loop: false,
            bypass,
            hover: false,
          });
        }
      }
    }
  }
  interface IncomingStub {
    fields: Set<MapNodeId>;
    labels: string[];
    writes: number;
  }
  const incoming = new Map<string, Map<string, IncomingStub>>();
  for (const { from, stub, module } of outStubs) {
    const info = stub.portal;
    if (!info) continue;
    let J = islands.get(module);
    if (!J) {
      const node = nodes.get(`module:${module}`);
      if (!node || !moduleAllowed(module)) continue;
      const d: Draft = {
        id: module,
        label: node.label,
        moduleApiName: module,
        org: false,
        seeds: [],
        closure: new Set(),
      };
      J = blank(d);
      islands.set(module, J);
    }
    const bySource = ensure(incoming, J.id, () => new Map<string, IncomingStub>());
    const entry = ensure(bySource, from.id, () => ({
      fields: new Set<string>(),
      labels: [],
      writes: 0,
    }));
    for (const [i, id] of info.fieldIds.entries()) {
      if (entry.fields.has(id)) continue;
      entry.fields.add(id);
      entry.labels.push(info.fieldLabels[i]);
    }
    entry.writes += info.writeCount;
  }
  for (const [targetId, bySource] of incoming) {
    const J = islands.get(targetId);
    if (!J) continue;
    for (const [sourceId, entry] of [...bySource].sort(([a], [b]) => compare(a, b))) {
      const source = islands.get(sourceId);
      const stub = makeItem(J, {
        key: `pi:${sourceId}`,
        kind: 'portal',
        lane: 'entry',
        rank: 9,
        title: `From ${source?.label ?? sourceId} (${entry.fields.size})`,
        portal: {
          dir: 'in',
          otherIslandId: sourceId,
          otherLabel: source?.label ?? sourceId,
          fieldIds: [...entry.fields],
          fieldLabels: entry.labels,
          writeCount: entry.writes,
          unknownFields: false,
          partnerIid: null,
        },
      });
      register(J, stub);
    }
  }
  for (const { from, stub, module } of outStubs) {
    const partner = model.byIid.get(iidOf(module, `pi:${from.id}`));
    if (stub.portal && partner) {
      stub.portal.partnerIid = partner.iid;
      if (partner.portal && !partner.portal.partnerIid) partner.portal.partnerIid = stub.iid;
    }
  }
  const flowCount = new Map<string, FlowPair>();
  for (const { from, stub, module } of outStubs) {
    if (!stub.portal?.partnerIid) continue;
    const key = `${from.id}>${module}`;
    const f = flowCount.get(key);
    if (f) f.count += stub.portal.writeCount;
    else flowCount.set(key, { from: from.id, to: module, count: stub.portal.writeCount });
  }
  model.flows = [...flowCount.values()].sort((a, b) =>
    compare(`${a.from}>${a.to}`, `${b.from}>${b.to}`),
  );

  // 6. Hubs and port dots (edges into a hub are collapsed).
  for (const I of islands.values()) {
    const hubs = new Map<string, BoardItem>();
    for (const item of I.items)
      if (item.node?.kind === 'function' && item.node.inDegree >= hubThreshold)
        hubs.set(item.iid, item);
    if (!hubs.size) continue;
    const here = new Map<string, number>();
    for (const e of I.edges) {
      if (e.kind === 'trigger' || !hubs.has(e.to)) continue;
      e.hub = true;
      here.set(e.to, (here.get(e.to) ?? 0) + 1);
      const src = I.byIid.get(e.from);
      if (src) src.port = true;
    }
    for (const [iid, item] of hubs)
      if (item.node?.kind === 'function')
        item.hub = { callers: item.node.inDegree, here: here.get(iid) ?? 0 };
  }

  // 7. Cascades (function -> rule) and reactors (field -> rule), routed as back edges.
  // A cascade is drawn to the rule's record event ("Field changed: Stage"), not to every rule the
  // event starts: one edge replaces dozens in a large org, and the event's own trigger edges still
  // lead on to each rule, so chains, loops and the selection highlight read the same.
  const eventOf = new Map<string, BoardItem>();
  for (const I of islands.values())
    for (const e of I.edges) {
      if (e.kind !== 'trigger') continue;
      const event = I.byIid.get(e.from);
      if (event?.kind === 'event') eventOf.set(e.to, event);
    }
  const cascadeIndex = new Map<string, Map<string, BoardEdge>>();
  const addCascade = (I: BoardIsland, edge: BoardEdge) => {
    const index = ensure(cascadeIndex, I.id, () => new Map<string, BoardEdge>());
    const existing = index.get(edge.id);
    if (!existing) {
      index.set(edge.id, edge);
      I.edges.push(edge);
    } else if (EVIDENCE_RANK[edge.evidence] < EVIDENCE_RANK[existing.evidence]) {
      existing.evidence = edge.evidence;
      existing.confidence = edge.confidence;
      existing.source = edge.source;
    }
  };
  for (const e of graph.edges) {
    if (e.kind !== 'cascades' && e.kind !== 'reacts') continue;
    const fromItems = model.byNode.get(e.from);
    if (!fromItems) continue;
    for (const from of fromItems) {
      const I = islands.get(from.islandId);
      const to = I?.byIid.get(iidOf(from.islandId, e.to));
      if (I && to) {
        const target = e.kind === 'cascades' ? (eventOf.get(to.iid) ?? to) : to;
        const edge: BoardEdge = {
          id: `${from.iid}>${target.iid}:${e.kind}`,
          from: from.iid,
          to: target.iid,
          kind: e.kind,
          evidence: e.evidence,
          confidence: e.confidence,
          source: e,
          hub: false,
          back: true,
          loop: false,
          bypass: false,
          hover: e.kind === 'reacts',
        };
        addCascade(I, edge);
      } else if (e.kind === 'cascades') {
        // Cross-module cascade: the incoming portal stub of the rule's island reaches the rule's event.
        for (const rule of model.byNode.get(e.to) ?? []) {
          const J = islands.get(rule.islandId);
          const portal = J?.byIid.get(iidOf(rule.islandId, `pi:${from.islandId}`));
          if (!J || !portal) continue;
          const target = eventOf.get(rule.iid) ?? rule;
          addCascade(J, {
            id: `${portal.iid}>${target.iid}:cascades`,
            from: portal.iid,
            to: target.iid,
            kind: 'cascades',
            evidence: e.evidence,
            confidence: e.confidence,
            source: e,
            hub: false,
            back: false,
            loop: false,
            bypass: false,
            hover: false,
          });
        }
      }
    }
  }
  for (const I of islands.values()) {
    collapseLongHops(I);
    markLoops(I);
  }

  for (const I of islands.values()) {
    for (const item of I.items) {
      if (item.node?.kind === 'rule') {
        I.stats.rules++;
        if (item.node.active) I.stats.activeRules++;
      } else if (item.node?.kind === 'function') I.stats.functions++;
      else if (item.node?.kind === 'button') I.stats.buttons++;
      else if (item.node?.kind === 'schedule') I.stats.schedules++;
      else if (item.kind === 'api') I.stats.apis++;
      else if (item.portal?.dir === 'in') I.stats.writtenFrom++;
    }
    const fieldIds = new Set<string>();
    for (const item of I.items) {
      if (item.node?.kind === 'field') fieldIds.add(item.node.id);
      if (item.portal?.dir === 'out') for (const id of item.portal.fieldIds) fieldIds.add(id);
    }
    I.stats.fields = fieldIds.size;
  }
  model.islands = [...islands.values()];
  return model;
}

/** Marks cascade back edges that close a cycle: the rule's downstream reaches the writer. */
function markLoops(I: BoardIsland): void {
  const forward = new Map<string, string[]>();
  for (const e of I.edges) {
    if (e.back || e.hover) continue;
    ensure(forward, e.from, () => [] as string[]).push(e.to);
  }
  for (const e of I.edges) {
    if (e.kind !== 'cascades' || !e.back) continue;
    const seen = new Set<string>([e.to]);
    const queue = [e.to];
    for (let i = 0; i < queue.length && !e.loop; i++)
      for (const next of forward.get(queue[i]) ?? []) {
        if (next === e.from) {
          e.loop = true;
          break;
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
  }
}

/**
 * An edge that would run behind a populated lane (an action writing a field across the Resources
 * cards) reads as a link to whatever it passes under. Such hops are collapsed like hub links: not
 * drawn at rest, marked with a port dot on the source, and shown when either end is hovered or
 * selected.
 */
function collapseLongHops(I: BoardIsland): void {
  const populated = new Set<LaneId>(I.items.map((i) => i.lane));
  for (const e of I.edges) {
    if (e.back || e.hover || e.hub || e.kind === 'trigger' || e.kind === 'cascades') continue;
    const from = I.byIid.get(e.from);
    const to = I.byIid.get(e.to);
    if (!from || !to) continue;
    const a = LANES.indexOf(from.lane);
    const b = LANES.indexOf(to.lane);
    if (b - a < 2 || !LANES.slice(a + 1, b).some((lane) => populated.has(lane))) continue;
    e.hub = true;
    from.port = true;
  }
}
