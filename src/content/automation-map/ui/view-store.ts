/** Single source of truth for Automation Map view state, shared by the shell and the canvas. */
import type { MapFilters } from '../types';
import type { MapViewState, ViewStore } from './context';

export const MAX_TRACE_DEPTH = 6;
export const DEFAULT_TRACE_DEPTH = { upstream: 2, downstream: 3 } as const;
/** A field is usually traced from its writers (up) more than from its reactors (down). */
export const FIELD_TRACE_DEPTH = { upstream: 3, downstream: 2 } as const;

export function defaultFilters(): MapFilters {
  return {
    scope: 'active',
    modules: new Set(),
    kinds: new Set(),
    triggerTypes: new Set(),
    flags: new Set(),
  };
}

export function defaultViewState(): MapViewState {
  return {
    view: 'fields',
    field: null,
    selectedId: null,
    hoverId: null,
    traceRootId: null,
    traceDepth: { ...DEFAULT_TRACE_DEPTH },
    focusModuleApiName: null,
    camera: { x: 0, y: 0, zoom: 1 },
    query: '',
    filters: defaultFilters(),
    inspectorOpen: false,
  };
}

const sameSet = (a: ReadonlySet<unknown>, b: ReadonlySet<unknown>): boolean =>
  a === b || (a.size === b.size && [...a].every((v) => b.has(v)));

/** True when two filter objects select the same nodes (set identity is irrelevant). */
export function sameFilters(a: MapFilters, b: MapFilters): boolean {
  return (
    a === b ||
    (a.scope === b.scope &&
      sameSet(a.modules, b.modules) &&
      sameSet(a.kinds, b.kinds) &&
      sameSet(a.triggerTypes, b.triggerTypes) &&
      sameSet(a.flags, b.flags))
  );
}

const clampDepth = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_TRACE_DEPTH, Math.max(0, Math.round(n))) : 0;

function equal<K extends keyof MapViewState>(key: K, a: MapViewState[K], b: MapViewState[K]) {
  if (a === b) return true;
  switch (key) {
    case 'filters':
      return sameFilters(a as MapFilters, b as MapFilters);
    case 'camera': {
      const x = a as MapViewState['camera'];
      const y = b as MapViewState['camera'];
      return x.x === y.x && x.y === y.y && x.zoom === y.zoom;
    }
    case 'traceDepth': {
      const x = a as MapViewState['traceDepth'];
      const y = b as MapViewState['traceDepth'];
      return x.upstream === y.upstream && x.downstream === y.downstream;
    }
    case 'field': {
      const x = a as MapViewState['field'];
      const y = b as MapViewState['field'];
      return (
        x !== null &&
        y !== null &&
        x.moduleApiName === y.moduleApiName &&
        x.fieldApiName === y.fieldApiName
      );
    }
    default:
      return false;
  }
}

export function createViewStore(initial: Partial<MapViewState> = {}): ViewStore {
  let state: MapViewState = { ...defaultViewState(), ...initial };
  state = { ...state, traceDepth: normalizeDepth(state.traceDepth) };
  const listeners = new Set<(next: Readonly<MapViewState>, prev: Readonly<MapViewState>) => void>();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      const next: MapViewState = { ...prev };
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof MapViewState>) {
        let value = patch[key] as MapViewState[typeof key];
        if (value === undefined) continue;
        if (key === 'traceDepth') value = normalizeDepth(value as MapViewState['traceDepth']);
        if (equal(key, prev[key], value)) continue;
        (next as unknown as Record<string, unknown>)[key] = value;
        changed = true;
      }
      if (!changed) return;
      state = next;
      for (const listener of [...listeners]) {
        try {
          listener(next, prev);
        } catch (error) {
          console.error('Zoho CRM DevTools: Automation Map view listener failed', error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function normalizeDepth(depth: MapViewState['traceDepth']): MapViewState['traceDepth'] {
  return { upstream: clampDepth(depth.upstream), downstream: clampDepth(depth.downstream) };
}
