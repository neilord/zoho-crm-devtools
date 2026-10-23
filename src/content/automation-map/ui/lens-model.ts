/**
 * Field lens view-model (UX spec §7): groups a `FieldLens` into the fixed writer tiers, resolves
 * the entry paths that reach each writer, classifies reactors and derives cascade annotations.
 * Pure over the graph so it is unit-testable without a DOM.
 */
import { describeTrigger } from '../../workflows/view-model';
import { lensCounts } from '../graph/queries';
import type {
  AutomationGraph,
  FieldLens,
  FieldNode,
  MapEdge,
  MapFilters,
  MapNode,
  MapNodeId,
  MapNodeKind,
  RuleNode,
} from '../types';
import {
  type EvidenceTier,
  evidenceTier,
  foreignDestination,
  moduleLabel,
  restApiLabel,
} from './format';
import { ACTION_LABEL } from './kinds';

export type GroupKey =
  | 'declared'
  | 'exact'
  | 'partial'
  | 'unknownFields'
  | 'unresolved'
  | 'recordChanges';

export interface PathChip {
  nodeId: MapNodeId | null;
  kind: MapNodeKind | 'trigger' | 'restApi';
  label: string;
  title: string;
}

export type CascadeNote =
  | { kind: 'possible'; explicit: boolean }
  | { kind: 'not-requested' }
  | { kind: 'unknown' }
  | { kind: 'declared'; owner: 'workflow' | 'blueprint' | 'approval'; label: string };

export interface WriterEntry {
  edge: MapEdge;
  source: MapNode;
  /** What a click selects: the rule/transition/approval that owns an action, else the source. */
  selectId: MapNodeId;
  group: GroupKey;
  tier: EvidenceTier;
  /** Entry paths, each a chip list from the entry point towards the writer. */
  paths: PathChip[][];
  cascade: CascadeNote;
  /** One-based source lines of the write sites (inferred writers only). */
  lines: number[];
  reached: boolean;
  foreign: boolean;
}

export interface WriterGroup {
  key: GroupKey;
  title: string;
  sub: string | null;
  tier: 'declared' | 'inferred' | 'unresolved' | 'record';
  /** Empty while a collapsible group is collapsed: its cards are not built until asked for. */
  items: WriterEntry[];
  /**
   * Distinct entities behind the group: one function with three call sites is one entity, and a
   * rule with two writing actions is one rule. Each entity is counted only in its strongest group,
   * so the writer groups add up to `LensModel.writerCount`. `items` can hold more cards than this
   * (one per write), never fewer.
   */
  sources: number;
  /** Noise by nature (unresolved modules, record-only changes): one line, expanded on demand. */
  collapsible: boolean;
  expanded: boolean;
  summary: string | null;
}

export interface EffectChip {
  targetId: MapNodeId;
  label: string;
  /** Null for the "fields unknown" buckets, which cannot be pivoted to. */
  pivot: { moduleApiName: string; fieldApiName: string } | null;
  cross: boolean;
  loop: boolean;
  cascade: 'none' | 'possible' | 'unknown';
  /** What the declaring action is, from the edge note ("Task created (field mapping)"). */
  via: string | null;
}

export interface ReactorEntry {
  edge: MapEdge;
  rule: RuleNode;
  group: 'trigger' | 'criteria';
  effects: EffectChip[];
  extraEffects: number;
}

export interface LensModel {
  moduleApiName: string;
  fieldApiName: string;
  /** Null when no automation references the field, so the graph has no node for it. */
  field: FieldNode | null;
  moduleName: string;
  fieldLabel: string;
  groups: WriterGroup[];
  writerCount: number;
  triggerReactors: ReactorEntry[];
  criteriaReactors: ReactorEntry[];
  reactorCount: number;
  cascades: number;
  hasLoop: boolean;
}

const WALK_KINDS = new Set(['starts', 'invokes']);
const MAX_PATHS = 6;
const MAX_DEPTH = 8;
const MAX_EFFECTS = 8;

const spanKey = (edge: MapEdge): string =>
  JSON.stringify((edge.spans ?? []).map((s) => [s.start, s.end]));

function entryChip(node: MapNode): PathChip[] {
  switch (node.kind) {
    case 'rule':
      return [
        {
          nodeId: null,
          kind: 'trigger',
          label: node.rule.trigger ? describeTrigger(node.rule.trigger, node.rule) : 'Trigger',
          title: 'Runs when',
        },
        { nodeId: node.id, kind: 'rule', label: node.label, title: `Workflow rule: ${node.label}` },
      ];
    case 'button':
      return [
        { nodeId: node.id, kind: 'button', label: `Button · ${node.label}`, title: node.label },
      ];
    case 'schedule':
      return [
        { nodeId: node.id, kind: 'schedule', label: `Schedule · ${node.label}`, title: node.label },
      ];
    case 'transition':
      return [
        {
          nodeId: node.id,
          kind: 'transition',
          label: `Blueprint · ${node.blueprintName}`,
          title: `Transition: ${node.label}`,
        },
      ];
    case 'approval':
      return [
        { nodeId: node.id, kind: 'approval', label: `Approval · ${node.label}`, title: node.label },
      ];
    case 'function':
      return [{ nodeId: node.id, kind: 'function', label: `ƒ ${node.label}`, title: node.label }];
    default:
      return [{ nodeId: node.id, kind: node.kind, label: node.label, title: node.label }];
  }
}

/** Entry → … → start paths, following the declared "reaches" edges upstream. */
export function entryPaths(
  graph: AutomationGraph,
  startId: MapNodeId,
  limit = MAX_PATHS,
): MapNodeId[][] {
  const paths: MapNodeId[][] = [];
  const walk = (id: MapNodeId, trail: MapNodeId[]): void => {
    if (paths.length >= limit) return;
    const parents = (graph.incoming.get(id) ?? []).filter((e) => WALK_KINDS.has(e.kind));
    const next = parents.filter((e) => !trail.includes(e.from));
    if (next.length === 0 || trail.length >= MAX_DEPTH) {
      paths.push([id, ...trail]);
      return;
    }
    for (const edge of next) walk(edge.from, [id, ...trail]);
  };
  walk(startId, []);
  return paths;
}

function chipsFor(graph: AutomationGraph, writer: MapNode, path: MapNodeId[]): PathChip[] {
  const chips: PathChip[] = [];
  // The card's first line already names its owner (an action's rule, a function, a button): a
  // chip with that node repeats the title, so only what leads to it is shown ("Field changed: ...").
  const ownerId = writer.kind === 'action' ? writer.ownerId : writer.id;
  for (const id of path) {
    const node = graph.nodes.get(id);
    if (!node || node.kind === 'action') continue;
    chips.push(...entryChip(node).filter((chip) => chip.nodeId !== ownerId));
  }
  return chips;
}

function writerPaths(graph: AutomationGraph, writer: MapNode): PathChip[][] {
  const paths = entryPaths(graph, writer.id).map((p) => chipsFor(graph, writer, p));
  const unique = new Map<string, PathChip[]>();
  for (const chips of paths) unique.set(chips.map((c) => c.label).join('›'), chips);
  const out = [...unique.values()].filter((c) => c.length > 0);
  if (writer.kind === 'function' && writer.restApi)
    out.push([
      {
        nodeId: writer.id,
        kind: 'restApi',
        label: `REST API · ${restApiLabel(writer.restApi)}`,
        title: 'Callable over REST',
      },
    ]);
  return out;
}

export function cascadeFor(graph: AutomationGraph, edge: MapEdge, source: MapNode): CascadeNote {
  if (source.kind === 'function') {
    const key = spanKey(edge);
    const cascades = (graph.outgoing.get(source.id) ?? []).some(
      (x) => x.kind === 'cascades' && spanKey(x) === key,
    );
    if (cascades)
      return { kind: 'possible', explicit: edge.triggers?.includes('workflow') === true };
    if (edge.triggers && !edge.triggers.includes('workflow')) return { kind: 'not-requested' };
    return { kind: 'unknown' };
  }
  const owner = source.kind === 'action' ? graph.nodes.get(source.ownerId) : source;
  return {
    kind: 'declared',
    owner:
      owner?.kind === 'transition'
        ? 'blueprint'
        : owner?.kind === 'approval'
          ? 'approval'
          : 'workflow',
    label: declaredLabel(graph, edge, source),
  };
}

/** Mirrors the query's rule: a delete, attach or flagged effect sets no field value. */
const isRecordChange = (edge: MapEdge): boolean =>
  edge.operation === 'delete' || edge.operation === 'attach' || edge.setsFields === false;

const sentence = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * What a declared write is, in the words the data layer recorded on the edge ("Task created
 * (field mapping)"). Only a real field-update action is a "field update"; labelling every
 * declared write that way called a Task's field mapping a workflow field update.
 */
export function declaredLabel(graph: AutomationGraph, edge: MapEdge, source: MapNode): string {
  const owner = source.kind === 'action' ? graph.nodes.get(source.ownerId) : source;
  const ownerName =
    owner?.kind === 'transition'
      ? 'Blueprint update'
      : owner?.kind === 'approval'
        ? 'Approval update'
        : 'Workflow field update';
  if (source.kind === 'action' && source.action.kind === 'fieldUpdate') return ownerName;
  if (edge.note) return sentence(edge.note);
  if (source.kind === 'action') return ACTION_LABEL[source.action.kind] ?? source.label;
  return ownerName;
}

type Origin = 'writers' | 'possible' | 'unresolved' | 'record';

/** The same tiers as the query's `lensCounts`, so a card's group is its entity's counted group. */
function groupOf(edge: MapEdge, from: Origin): GroupKey {
  if (from === 'unresolved') return 'unresolved';
  if (from === 'record') return 'recordChanges';
  if (from === 'writers') return edge.evidence === 'declared' ? 'declared' : 'exact';
  return edge.to.endsWith('.*') ? 'unknownFields' : 'partial';
}

export interface LensOptions {
  scope: MapFilters['scope'];
  teaser: boolean;
  /** Collapsible groups whose cards the user asked for; everything else stays a summary line. */
  expanded?: ReadonlySet<GroupKey>;
}

/**
 * A write to another or unknown org is never an exact local writer. The query already keeps those
 * out of `writers`; this holds the line for any lens handed in, so the cards and the counts agree.
 */
function withoutForeignExact(lens: FieldLens): FieldLens {
  if (!lens.writers.some(foreignDestination)) return lens;
  return {
    ...lens,
    writers: lens.writers.filter((e) => !foreignDestination(e)),
    possibleWriters: [...lens.possibleWriters, ...lens.writers.filter(foreignDestination)],
  };
}

export function buildLensModel(
  graph: AutomationGraph,
  rawLens: FieldLens,
  moduleApiName: string,
  fieldApiName: string,
  options: LensOptions,
): LensModel {
  const lens = withoutForeignExact(rawLens);
  const field = lens.field;
  const moduleName = moduleLabel(graph, moduleApiName, options.teaser);
  const fieldLabel = field?.label ?? fieldApiName;
  const keep = (edge: MapEdge) => options.scope === 'everything' || edge.inActiveScope;
  // Every count on screen comes from here: the header, the field card and each group label.
  const counts = lensCounts(lens, options.scope);
  const entityOf = (edge: MapEdge) => lens.writerEntityIds?.get(edge.from) ?? edge.from;
  const entry = (edge: MapEdge, from: Origin): WriterEntry | null => {
    const source = graph.nodes.get(edge.from);
    if (!source || !keep(edge)) return null;
    const group = groupOf(edge, from);
    // A writer shows once, in its strongest group; a weaker write by the same entity is evidence
    // for the card it already has, not another writer.
    if (from !== 'record' && counts.entityGroups.get(entityOf(edge)) !== group) return null;
    const owner = source.kind === 'action' ? (graph.nodes.get(source.ownerId) ?? source) : source;
    return {
      edge,
      source,
      selectId: owner.id,
      group,
      tier: evidenceTier(edge),
      paths: writerPaths(graph, source),
      cascade: cascadeFor(graph, edge, source),
      lines: [...new Set((edge.spans ?? []).map((s) => s.line))],
      reached: source.inActiveScope,
      foreign: foreignDestination(edge),
    };
  };
  const present = (edges: readonly MapEdge[]) =>
    edges.filter((e) => keep(e) && graph.nodes.has(e.from));
  const distinct = (edges: readonly MapEdge[]) => new Set(edges.map((e) => e.from)).size;
  const entriesOf = (edges: readonly MapEdge[], from: Origin) =>
    edges.map((e) => entry(e, from)).filter((e): e is WriterEntry => e !== null);
  const entries: WriterEntry[] = [
    ...entriesOf(lens.writers, 'writers'),
    ...entriesOf(lens.possibleWriters, 'possible'),
  ];
  const unresolvedEdges = present(lens.unresolvedWriters);
  const recordEdges = present(lens.otherRecordChanges);
  const expandedKeys = options.expanded ?? new Set<GroupKey>();
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const titles: Record<
    Exclude<GroupKey, 'unresolved' | 'recordChanges'>,
    Pick<WriterGroup, 'title' | 'sub' | 'tier'>
  > = {
    declared: { title: 'Declared in configuration', sub: null, tier: 'declared' },
    exact: { title: 'Functions · exact', sub: null, tier: 'inferred' },
    partial: { title: 'Functions · partial', sub: null, tier: 'inferred' },
    unknownFields: {
      title: `May write ${moduleName} · fields unknown`,
      sub: null,
      tier: 'unresolved',
    },
  };
  const order = ['declared', 'exact', 'partial', 'unknownFields'] as const;
  const groups: WriterGroup[] = order
    .map((key): WriterGroup => {
      const items = entries.filter((e) => e.group === key);
      return {
        key,
        ...titles[key],
        items,
        sources: counts.groups[key],
        collapsible: false,
        expanded: true,
        summary: null,
      };
    })
    .filter((g) => g.items.length > 0);

  // Dozens of functions that write "some module" are a caveat, not forty cards: one line, opened
  // on demand (their cards cost layout, and a long list buried the writers that are known).
  if (counts.groups.unresolved > 0) {
    const n = counts.groups.unresolved;
    const expanded = expandedKeys.has('unresolved');
    groups.push({
      key: 'unresolved',
      title: 'Unresolved module',
      sub: null,
      tier: 'unresolved',
      items: expanded ? entriesOf(unresolvedEdges, 'unresolved') : [],
      sources: n,
      collapsible: true,
      expanded,
      summary: `${n} ${plural(n, 'function writes', 'functions write')} records in a module we couldn't resolve. ${plural(n, 'It', 'They')} may affect this field.`,
    });
  }
  // Delete, relate, attach and tag effects change the record but set no field value, so they are
  // never writers of this field: listed after the writers, collapsed, and left out of every count.
  if (recordEdges.length) {
    const n = distinct(recordEdges);
    const expanded = expandedKeys.has('recordChanges');
    groups.push({
      key: 'recordChanges',
      title: 'Other record changes',
      sub: null,
      tier: 'record',
      items: expanded ? entriesOf(recordEdges, 'record') : [],
      sources: n,
      collapsible: true,
      expanded,
      summary: `${n} ${plural(n, 'function', 'functions')} delete, relate, attach or tag ${moduleName} records. ${plural(n, 'It does', 'They do')} not set ${fieldLabel}, so ${plural(n, 'it is', 'they are')} not counted as ${plural(n, 'a writer', 'writers')}.`,
    });
  }

  const fieldId = field?.id ?? `field:${moduleApiName}.${fieldApiName}`;
  const reactorOf = (edge: MapEdge): ReactorEntry | null => {
    const rule = graph.nodes.get(edge.to);
    if (rule?.kind !== 'rule' || (options.scope === 'active' && !rule.inActiveScope)) return null;
    const group =
      rule.triggerType === 'field_update' && rule.watchedFields.includes(fieldApiName)
        ? 'trigger'
        : 'criteria';
    const all = ruleEffects(graph, rule, fieldId);
    return {
      edge,
      rule,
      group,
      effects: all.slice(0, MAX_EFFECTS),
      extraEffects: Math.max(0, all.length - MAX_EFFECTS),
    };
  };
  const reactors = lens.reactors.map(reactorOf).filter((r): r is ReactorEntry => r !== null);
  const triggerReactors = reactors.filter((r) => r.group === 'trigger');
  const criteriaReactors = reactors.filter((r) => r.group === 'criteria');
  const cascadeKeys = new Set<string>();
  let hasLoop = false;
  for (const reactor of reactors)
    for (const effect of reactor.effects) {
      if (effect.loop) hasLoop = true;
      if (effect.cascade === 'possible' && hasReactors(graph, effect.targetId))
        cascadeKeys.add(`${reactor.rule.id}>${effect.targetId}`);
    }
  return {
    moduleApiName,
    fieldApiName,
    field,
    moduleName,
    fieldLabel,
    groups,
    // The query's own definition (distinct entities, unresolved included), so the start-screen
    // chips and this number cannot disagree.
    writerCount: counts.total,
    triggerReactors,
    criteriaReactors,
    reactorCount: reactors.length,
    cascades: cascadeKeys.size,
    hasLoop,
  };
}

const hasReactors = (graph: AutomationGraph, fieldId: MapNodeId): boolean =>
  (graph.outgoing.get(fieldId) ?? []).some((e) => e.kind === 'reacts');

/** Writes reachable from a rule through its actions and the functions they run. */
export function reachedWrites(graph: AutomationGraph, rootId: MapNodeId): MapEdge[] {
  const seen = new Set<MapNodeId>([rootId]);
  const queue: Array<{ id: MapNodeId; depth: number }> = [{ id: rootId, depth: 0 }];
  const writes: MapEdge[] = [];
  for (let i = 0; i < queue.length; i++) {
    const { id, depth } = queue[i];
    for (const edge of graph.outgoing.get(id) ?? []) {
      if (edge.kind === 'writes') writes.push(edge);
      else if (WALK_KINDS.has(edge.kind) && depth < 6 && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push({ id: edge.to, depth: depth + 1 });
      }
    }
  }
  return writes;
}

export function writeCascade(
  graph: AutomationGraph,
  edge: MapEdge,
): 'none' | 'possible' | 'unknown' {
  const source = graph.nodes.get(edge.from);
  if (!source) return 'none';
  if (source.kind === 'function') {
    const key = spanKey(edge);
    return (graph.outgoing.get(source.id) ?? []).some(
      (x) => x.kind === 'cascades' && spanKey(x) === key,
    )
      ? 'possible'
      : 'none';
  }
  return 'unknown';
}

const RANK = { none: 0, unknown: 1, possible: 2 } as const;

function ruleEffects(
  graph: AutomationGraph,
  rule: RuleNode,
  originFieldId: MapNodeId,
): EffectChip[] {
  const byTarget = new Map<MapNodeId, EffectChip>();
  for (const edge of reachedWrites(graph, rule.id)) {
    const target = graph.nodes.get(edge.to);
    if (target?.kind !== 'field') continue;
    const cascade = writeCascade(graph, edge);
    // A delete or relate changes the record, not a field: it must not read as "fields unknown".
    const recordOnly = isRecordChange(edge);
    const key = recordOnly ? `${target.id}|record` : target.id;
    const known = byTarget.get(key);
    if (known) {
      if (RANK[cascade] > RANK[known.cascade]) known.cascade = cascade;
      continue;
    }
    const bucket = target.bucket !== 'field';
    const source = graph.nodes.get(edge.from);
    byTarget.set(key, {
      targetId: target.id,
      label: recordOnly
        ? `${moduleLabel(graph, target.moduleApiName, false)} · record change`
        : target.bucket === 'unknownModule'
          ? 'Unresolved module'
          : target.bucket === 'unknownFields'
            ? `${moduleLabel(graph, target.moduleApiName, false)} · fields unknown`
            : target.label,
      pivot:
        bucket || !target.moduleApiName
          ? null
          : { moduleApiName: target.moduleApiName, fieldApiName: target.fieldApiName },
      cross: target.moduleApiName !== rule.moduleApiName,
      loop: false,
      cascade,
      via: source && source.kind !== 'function' ? declaredLabel(graph, edge, source) : null,
    });
  }
  const chips = [...byTarget.values()];
  for (const chip of chips)
    chip.loop =
      chip.cascade === 'possible' &&
      chip.pivot !== null &&
      (chip.targetId === originFieldId || closesLoop(graph, chip.targetId, originFieldId));
  return chips;
}

/** Bounded search: does a possible cascade from `fieldId` eventually write `originId`? */
function closesLoop(
  graph: AutomationGraph,
  fieldId: MapNodeId,
  originId: MapNodeId,
  depth = 3,
  seen = new Set<MapNodeId>(),
): boolean {
  if (depth <= 0 || seen.has(fieldId)) return false;
  seen.add(fieldId);
  for (const reacts of graph.outgoing.get(fieldId) ?? []) {
    if (reacts.kind !== 'reacts') continue;
    const rule = graph.nodes.get(reacts.to);
    if (rule?.kind !== 'rule') continue;
    for (const write of reachedWrites(graph, rule.id)) {
      if (writeCascade(graph, write) !== 'possible') continue;
      if (write.to === originId) return true;
      if (closesLoop(graph, write.to, originId, depth - 1, seen)) return true;
    }
  }
  return false;
}

/* ---------- field catalogue (start screen) ---------- */

export interface CatalogueField {
  id: MapNodeId;
  moduleApiName: string;
  fieldApiName: string;
  label: string;
  moduleName: string;
  writers: number;
  reactors: number;
}

export function fieldCatalogue(graph: AutomationGraph, teaser: boolean): CatalogueField[] {
  const out: CatalogueField[] = [];
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'field' || node.bucket !== 'field' || !node.moduleApiName) continue;
    const writers = new Set(
      (graph.incoming.get(node.id) ?? []).filter((e) => e.kind === 'writes').map((e) => e.from),
    );
    out.push({
      id: node.id,
      moduleApiName: node.moduleApiName,
      fieldApiName: node.fieldApiName,
      label: node.label,
      moduleName: moduleLabel(graph, node.moduleApiName, teaser),
      writers: writers.size,
      reactors: (graph.outgoing.get(node.id) ?? []).filter((e) => e.kind === 'reacts').length,
    });
  }
  return out.sort(
    (a, b) =>
      b.writers - a.writers ||
      a.moduleName.localeCompare(b.moduleName) ||
      a.label.localeCompare(b.label),
  );
}

/** Wording for the cascade annotation on a writer; shared by the lens cards and the inspector. */
export function cascadeText(note: CascadeNote): {
  text: string;
  tone: 'possible' | 'unknown' | 'muted';
} {
  switch (note.kind) {
    case 'possible':
      return {
        text: note.explicit
          ? 'May re-trigger workflow rules (trigger: workflow)'
          : 'May re-trigger workflow rules (Zoho default)',
        tone: 'possible',
      };
    case 'not-requested':
      return { text: 'Workflow not requested (Deluge default)', tone: 'muted' };
    case 'unknown':
      return { text: 'Workflow trigger unknown', tone: 'muted' };
    case 'declared':
      return {
        text: `${note.label} · re-trigger behaviour unverified`,
        tone: 'unknown',
      };
  }
}
