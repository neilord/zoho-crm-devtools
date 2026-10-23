import type { WorkflowCriteria } from '../../workflows/types';
import type { AutomationGraph, MapFilters, SearchHit } from '../types';
import { filterNodes } from './queries';

type Location = SearchHit['matches'][number]['location'];
interface SearchText {
  location: Location;
  text: string;
  lower: string;
  lines?: readonly number[];
  offsets?: readonly number[];
  ends?: readonly number[];
}
export interface MapSearchIndex {
  readonly graph: AutomationGraph;
  readonly documents: ReadonlyMap<string, readonly SearchText[]>;
}
const stringify = (v: unknown) => (typeof v === 'string' ? v : (JSON.stringify(v) ?? ''));
function criteriaText(c: WorkflowCriteria | null): string {
  if (!c) return '';
  if (c.kind === 'group') return c.children.map(criteriaText).join(` ${c.operator} `);
  return c.kind === 'unknown'
    ? c.jsonText
    : `${c.field.label} ${c.field.apiName} ${c.comparator} ${stringify(c.value)}`;
}

/** Pre-normalize searchable configuration once. Sources use the catalogue Deluge id namespace. */
export function buildSearchIndex(
  graph: AutomationGraph,
  sources: ReadonlyMap<string, string>,
): MapSearchIndex {
  const documents = new Map<string, SearchText[]>();
  const templateBodies = new Map<string, string>();
  for (const n of graph.nodes.values())
    if (n.kind === 'action' && n.action.kind === 'emailNotification' && n.action.template)
      if (n.action.template.bodyText && !templateBodies.has(`template:${n.action.template.id}`))
        templateBodies.set(`template:${n.action.template.id}`, n.action.template.bodyText);
  for (const n of graph.nodes.values()) {
    const texts: SearchText[] = [];
    const add = (location: Location, text: string | null | undefined) => {
      if (!text) return;
      const entry: SearchText = { location, text, lower: text.toLowerCase() };
      // Unicode lowercasing can expand a code point (e.g. İ). Keep highlights
      // in the original UTF-16 coordinates rather than the folded string's.
      if (entry.lower.length !== text.length) {
        const offsets: number[] = [],
          ends: number[] = [];
        let original = 0;
        for (const point of text) {
          const folded = point.toLowerCase();
          for (let i = 0; i < folded.length; i++) {
            offsets.push(original + Math.min(i, point.length - 1));
            ends.push(original + Math.min(i + 1, point.length));
          }
          original += point.length;
        }
        offsets.push(text.length);
        entry.offsets = offsets;
        entry.ends = ends;
      }
      if (location === 'source') {
        const lines = [0];
        for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines.push(i + 1);
        entry.lines = lines;
      }
      texts.push(entry);
    };
    add('name', n.label);
    if (n.kind === 'function' || n.kind === 'module') add('apiName', n.apiName);
    if (n.kind === 'field') add('apiName', n.fieldApiName);
    if (n.kind === 'function') add('source', sources.get(n.delugeId));
    if (n.kind === 'rule') {
      if (n.rule.trigger?.type === 'field_update')
        add('criteria', criteriaText(n.rule.trigger.criteria));
      for (const c of n.rule.conditions) {
        add('criteria', criteriaText(c.criteria));
        add('criteria', criteriaText(c.relatedCriteria?.criteria ?? null));
      }
    }
    if (n.kind === 'action') {
      const a = n.action;
      if (a.kind === 'fieldUpdate') add('value', stringify(a.value));
      if (a.kind === 'task' || a.kind === 'convert')
        for (const m of a.fieldMappings) add('value', stringify(m.value));
      if (a.kind === 'webhook') add('url', a.url);
      if (a.kind === 'function') add('apiName', a.apiName);
    }
    if (n.kind === 'template') {
      add('template', n.subject);
      add('template', templateBodies.get(n.id));
    }
    documents.set(n.id, texts);
  }
  return { graph, documents };
}

/** Literal UTF-16 search, at most eight snippets per node. Rank location first, then active scope.
 * Source snippets stay on one line unless the query itself spans lines. Highlight offsets are
 * relative to the displayed snippet. No regular expression or markup is constructed from input. */
export function searchMap(
  index: MapSearchIndex,
  query: string,
  filters: MapFilters,
): readonly SearchHit[] {
  if (!query.trim()) return [];
  const needle = query.toLowerCase();
  const allowed = filterNodes(index.graph, filters);
  const hits: SearchHit[] = [];
  const weights: Record<Location, number> = {
    name: 100,
    apiName: 80,
    criteria: 40,
    value: 40,
    template: 30,
    url: 30,
    source: 20,
  };
  for (const [nodeId, texts] of index.documents) {
    if (!allowed.has(nodeId)) continue;
    const matches: SearchHit['matches'][number][] = [];
    let best = 0;
    for (const entry of texts) {
      if (matches.length >= 8) break;
      let cursor = 0;
      while (matches.length < 8) {
        const found = entry.lower.indexOf(needle, cursor);
        if (found < 0) break;
        const originalOffset = (offset: number) => entry.offsets?.[offset] ?? offset;
        const at = originalOffset(found);
        const originalEnd = (offset: number) => entry.ends?.[offset - 1] ?? offset;
        const matchEnd = originalEnd(found + needle.length);
        let start = Math.max(0, at - 60),
          end = Math.min(entry.text.length, matchEnd + 100);
        let line: number | undefined;
        if (entry.lines) {
          let lo = 0,
            hi = entry.lines.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (entry.lines[mid] <= at) lo = mid + 1;
            else hi = mid;
          }
          line = lo;
          start = Math.max(start, entry.lines[lo - 1]);
          const newline = entry.text.indexOf('\n', matchEnd);
          if (newline >= 0) end = Math.min(end, newline);
        }
        const snippet = entry.text.slice(start, end);
        const highlights = [];
        let occurrence = found;
        while (occurrence >= 0 && originalEnd(occurrence + needle.length) <= end) {
          highlights.push({
            start: originalOffset(occurrence) - start,
            end: originalEnd(occurrence + needle.length) - start,
          });
          occurrence = entry.lower.indexOf(needle, occurrence + needle.length);
        }
        matches.push({ location: entry.location, snippet, highlights, ...(line ? { line } : {}) });
        best = Math.max(best, weights[entry.location]);
        cursor = occurrence >= 0 ? occurrence : entry.lower.length;
      }
    }
    if (matches.length)
      hits.push({
        nodeId,
        score: best + (index.graph.nodes.get(nodeId)?.inActiveScope ? 1 : 0),
        matches,
      });
  }
  return hits.sort(
    (a, b) => b.score - a.score || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0),
  );
}
