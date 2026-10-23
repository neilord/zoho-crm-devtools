/** Pure text helpers shared by the shell panels. No DOM. */
import { triggerSummary } from '../../workflows/view-model';
import type {
  AutomationGraph,
  EdgeEvidence,
  FieldNode,
  FunctionAnalysisState,
  MapEdge,
  MapNode,
  MapNodeId,
  RuleNode,
} from '../types';
import { ACTION_LABEL, KIND_LABEL } from './kinds';

/** Neutral stand-in for a module the teaser has not revealed: its name must never reach the DOM. */
export const FOGGED_MODULE = 'Another module';
export const ORG_WIDE = 'Org-wide';
export const SHARED = 'Shared';

export function moduleLabel(
  graph: AutomationGraph,
  apiName: string | null,
  teaser: boolean,
): string {
  if (!apiName || apiName === '*') return 'Unknown module';
  const node = graph.nodes.get(`module:${apiName}`);
  if (node) return node.label;
  return teaser ? FOGGED_MODULE : apiName;
}

/** "Deals · Stage", or the honest bucket wording for unknown fields / modules. */
export function fieldName(graph: AutomationGraph, node: FieldNode, teaser: boolean): string {
  if (node.bucket === 'unknownModule') return 'Unresolved module';
  const module = moduleLabel(graph, node.moduleApiName, teaser);
  return node.bucket === 'unknownFields'
    ? `${module} · fields unknown`
    : `${module} · ${node.label}`;
}

/** Short title for lists, chips and tooltips. */
export function nodeName(graph: AutomationGraph, node: MapNode, teaser: boolean): string {
  switch (node.kind) {
    case 'field':
      return fieldName(graph, node, teaser);
    case 'action':
      return `${ACTION_LABEL[node.action.kind]}: ${node.label}`;
    case 'transition':
      return node.label;
    default:
      return node.label;
  }
}

/** Plain name without module qualifier (for headings where the module is a separate badge). */
export function nodeBareName(graph: AutomationGraph, node: MapNode, teaser: boolean): string {
  if (node.kind === 'field')
    return node.bucket === 'field' ? node.label : fieldName(graph, node, teaser);
  return nodeName(graph, node, teaser);
}

const humanize = (value: string): string => {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
};

export function placementLabel(placements: readonly string[]): string {
  return placements.length ? placements.map(humanize).join(', ') : 'Custom button';
}

export function restApiLabel(restApi: { apiKey: boolean; oauth: boolean }): string {
  return restApi.apiKey && restApi.oauth ? 'API key / OAuth' : restApi.apiKey ? 'API key' : 'OAuth';
}

export function incomingCount(graph: AutomationGraph, id: MapNodeId, kinds?: string[]): number {
  const edges = graph.incoming.get(id) ?? [];
  return kinds ? edges.filter((e) => kinds.includes(e.kind)).length : edges.length;
}

/** The "Entry / trigger" column of the list and the second line of cards. */
export function entryLabel(graph: AutomationGraph, node: MapNode): string {
  switch (node.kind) {
    case 'rule':
      return triggerSummary(node.rule);
    case 'button':
      return `Button · ${placementLabel(node.placements)}`;
    case 'schedule':
      return node.recurrenceLabel ?? 'Schedule';
    case 'function':
      return node.restApi
        ? `REST API · ${restApiLabel(node.restApi)}`
        : `Called by ${node.inDegree}`;
    case 'transition':
      return `Blueprint · ${node.blueprintName}`;
    case 'approval':
      return 'Approval process';
    case 'action':
      return graph.nodes.get(node.ownerId)?.label ?? '';
    case 'template':
    case 'external':
      return `Used by ${incomingCount(graph, node.id)}`;
    case 'field':
      return `Written by ${incomingCount(graph, node.id, ['writes'])}`;
    case 'module':
      return '';
  }
}

export interface StatusView {
  label: string;
  tone: 'on' | 'off' | 'ok' | 'warn' | 'bad' | 'pending' | 'none';
}

const ANALYSIS: Record<FunctionAnalysisState, StatusView> = {
  pending: { label: 'Analysing…', tone: 'pending' },
  analyzed: { label: 'Analysed', tone: 'ok' },
  limited: { label: 'Partly analysed', tone: 'warn' },
  unsupported: { label: 'Not supported', tone: 'warn' },
  'source-unavailable': { label: 'No source', tone: 'warn' },
  failed: { label: 'Not analysed', tone: 'bad' },
};

export function statusOf(node: MapNode): StatusView {
  switch (node.kind) {
    case 'function':
      return ANALYSIS[node.analysis];
    case 'rule':
    case 'button':
    case 'schedule':
    case 'transition':
    case 'approval':
      return node.active === true
        ? { label: 'Active', tone: 'on' }
        : node.active === false
          ? { label: 'Inactive', tone: 'off' }
          : { label: 'Unknown', tone: 'none' };
    default:
      return { label: '—', tone: 'none' };
  }
}

export const isGapFunction = (node: MapNode): boolean =>
  node.kind === 'function' && node.analysis !== 'analyzed' && node.analysis !== 'pending';

export type EvidenceTier = 'declared' | 'exact' | 'partial' | 'unresolved';

export function evidenceTier(edge: MapEdge): EvidenceTier {
  const evidence: EdgeEvidence = edge.evidence;
  if (evidence === 'declared') return 'declared';
  if (evidence === 'unresolved') return 'unresolved';
  return edge.confidence === 'exact' ? 'exact' : 'partial';
}

export const TIER_LABEL: Readonly<Record<EvidenceTier, string>> = {
  declared: 'Declared',
  exact: 'Inferred · exact',
  partial: 'Inferred · partial',
  unresolved: 'Unresolved',
};

/** True when the edge's destination is known not to be this org (never an exact local writer). */
export const foreignDestination = (edge: MapEdge): boolean =>
  edge.destinationScope !== undefined && edge.destinationScope !== 'current-org';

/** Owner rule for action nodes: used so action writers open the rule that owns them. */
export function ownerOf(graph: AutomationGraph, node: MapNode): MapNode {
  return node.kind === 'action' ? (graph.nodes.get(node.ownerId) ?? node) : node;
}

export const ruleOf = (node: MapNode | undefined): RuleNode | null =>
  node?.kind === 'rule' ? node : null;

export const kindWord = (node: MapNode): string => KIND_LABEL[node.kind];

export function describeAnalysis(
  node: MapNode,
): { tone: 'ok' | 'warn' | 'bad'; text: string } | null {
  if (node.kind !== 'function') return null;
  switch (node.analysis) {
    case 'analyzed':
      return {
        tone: 'ok',
        text: 'Analysed. Writes listed above were extracted from this source. Values and branches are not evaluated, so each write is possible, not guaranteed.',
      };
    case 'limited':
      return {
        tone: 'warn',
        text: 'Partly analysed. Some writes use keys, modules or options built at run time, so they could not all be named.',
      };
    case 'unsupported':
      return {
        tone: 'warn',
        text: 'Not supported. This function uses code the analyser does not understand yet, so its writes are unknown.',
      };
    case 'source-unavailable':
      return {
        tone: 'bad',
        text: 'Not analysed: source unavailable. Zoho returned this function without code (common for extension functions), so it could not be analysed or searched.',
      };
    case 'failed':
      return {
        tone: 'bad',
        text: 'Not analysed. The source could not be read or parsed. It may write any field.',
      };
    case 'pending':
      return null;
  }
}

/** Rules the teaser has read in full. Every preview string quotes this one number. */
export function flowsShown(graph: AutomationGraph): number {
  let n = 0;
  for (const node of graph.nodes.values()) if (node.kind === 'rule') n++;
  return n;
}

/** "1 flow", "3 flows"; before the first flow has loaded, just "a preview". */
export function flowsText(n: number): string {
  return n === 0 ? 'a preview' : n === 1 ? '1 flow' : `${n} flows`;
}

/** "one real flow", "3 real flows", "a real flow still loading". */
export function realFlowsText(n: number): string {
  return n === 0 ? 'a real flow, still loading' : n === 1 ? 'one real flow' : `${n} real flows`;
}

/** "Updated 3 min ago" for the last successful revalidation; null when none is on record. */
export function updatedAgo(at: number | null | undefined, now = Date.now()): string | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  return `Updated ${Math.floor(hours / 24)} d ago`;
}
