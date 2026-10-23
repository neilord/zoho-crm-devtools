/**
 * URL hash codec for Automation Map deep links (UX spec §11).
 *
 * Example: `#zcdt-map=v1;view=board;sel=rule:4823;z=0.92;c=1180,640;scope=all;q=Stage`.
 * Only ids, API names, enumerations and numbers are written, plus the search text the user typed.
 * Node ids in the `external:` namespace embed hosts and connection names (CRM text), so they are
 * never encodable. Decoding is strict: a malformed or out-of-range known key rejects the whole
 * hash (a half-applied link would show a misleading view); unknown keys are ignored so older
 * builds survive newer links.
 */
import type { WorkflowTriggerType } from '../../workflows/types';
import { AUTOMATION_MAP_HASH_PREFIX } from '../entry/request';
import type { MapFilters, MapNodeKind } from '../types';
import type { MapView, MapViewState } from './context';
import { MAX_TRACE_DEPTH } from './view-store';

export const HASH_PREFIX = AUTOMATION_MAP_HASH_PREFIX;
const VERSION = 'v1';
const MIN_ZOOM = 0.06;
const MAX_ZOOM = 2;
const MAX_COORD = 1_000_000;
const MAX_QUERY = 200;
const MAX_LIST = 64;

const VIEWS: readonly MapView[] = ['fields', 'board', 'list', 'trace'];
const NODE_KINDS: readonly MapNodeKind[] = [
  'module',
  'field',
  'rule',
  'action',
  'template',
  'function',
  'button',
  'schedule',
  'transition',
  'approval',
  'external',
];
const TRIGGER_TYPES: readonly WorkflowTriggerType[] = [
  'field_update',
  'create',
  'create_or_edit',
  'edit',
  'date_or_datetime',
  'mail_sent',
  'mail_sent_opened',
  'mail_sent_bounced',
  'email_received',
  'section_update',
  'incoming_call_createedit',
  'outgoing_call_createedit',
  'unknown',
];
const FLAGS: ReadonlyArray<MapFilters['flags'] extends ReadonlySet<infer F> ? F : never> = [
  'writesFields',
  'callsExternal',
  'cascades',
  'restApi',
  'gaps',
];

/** Namespaces whose ids hold only Zoho ids / API names; `external:` is deliberately absent. */
const SHAREABLE_NAMESPACES = [
  'module',
  'field',
  'rule',
  'action',
  'template',
  'function',
  'button',
  'schedule',
  'transition',
  'approval',
] as const;
const NODE_ID = new RegExp(`^(?:${SHAREABLE_NAMESPACES.join('|')}):[A-Za-z0-9_.$*/-]{1,160}$`);
const API_NAME = /^[$A-Za-z0-9_]{1,100}$/;
const FIELD_PATH = /^([$A-Za-z0-9_]{1,100})\.([$A-Za-z0-9_]{1,100})$/;

export const isShareableNodeId = (id: string): boolean => NODE_ID.test(id);

export interface HashViewport {
  width: number;
  height: number;
}

export interface EncodeOptions {
  /** Size of the board area; converts the camera's top-left into the spec's centre point. */
  viewport?: HashViewport;
  /** Teaser: only the view and the revealed node are written (UX spec §11). */
  teaser?: boolean;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

export function encodeMapHash(state: MapViewState, options: EncodeOptions = {}): string {
  const parts: string[] = [VERSION];
  const sel =
    state.selectedId !== null && isShareableNodeId(state.selectedId) ? state.selectedId : null;
  const trace =
    state.traceRootId !== null && isShareableNodeId(state.traceRootId) ? state.traceRootId : null;
  const view: MapView = state.view === 'trace' && !trace ? 'board' : state.view;
  parts.push(`view=${view}`);
  if (options.teaser) {
    if (sel) parts.push(`sel=${sel}`);
    return `${HASH_PREFIX}${parts.join(';')}`;
  }
  if (sel) parts.push(`sel=${sel}`);
  if (state.field) parts.push(`field=${state.field.moduleApiName}.${state.field.fieldApiName}`);
  const f = state.filters;
  if (f.scope !== 'active') parts.push('scope=all');
  const query = state.query.trim().slice(0, MAX_QUERY);
  if (query) parts.push(`q=${encodeURIComponent(query)}`);
  const apiList = (key: string, values: Iterable<string>, ok: (v: string) => boolean) => {
    const list = [...values].filter(ok).sort().slice(0, MAX_LIST);
    if (list.length) parts.push(`${key}=${list.join(',')}`);
  };
  apiList('mods', f.modules, (v) => API_NAME.test(v));
  apiList('kinds', f.kinds, (v) => NODE_KINDS.includes(v as MapNodeKind));
  apiList('tt', f.triggerTypes, (v) => TRIGGER_TYPES.includes(v as WorkflowTriggerType));
  apiList('flags', f.flags, (v) => (FLAGS as readonly string[]).includes(v));
  if (state.focusModuleApiName && API_NAME.test(state.focusModuleApiName))
    parts.push(`focus=${state.focusModuleApiName}`);
  if (view === 'board' || view === 'trace') {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.camera.zoom));
    const vw = options.viewport?.width ?? 0;
    const vh = options.viewport?.height ?? 0;
    parts.push(
      `z=${num(zoom)}`,
      `c=${Math.round(state.camera.x + vw / (2 * zoom))},${Math.round(state.camera.y + vh / (2 * zoom))}`,
    );
  }
  if (view === 'trace' && trace)
    parts.push(`trace=${trace},${state.traceDepth.upstream},${state.traceDepth.downstream}`);
  return `${HASH_PREFIX}${parts.join(';')}`;
}

export interface DecodedMapHash {
  /** Everything except the camera; apply with `store.set`. */
  state: Partial<MapViewState>;
  /** Zoom plus the viewport centre; resolve with `cameraFromHash` once the area is measured. */
  camera: { zoom: number; center: { x: number; y: number } } | null;
}

export function cameraFromHash(
  camera: NonNullable<DecodedMapHash['camera']>,
  viewport: HashViewport,
): MapViewState['camera'] {
  const { zoom, center } = camera;
  return {
    x: center.x - viewport.width / (2 * zoom),
    y: center.y - viewport.height / (2 * zoom),
    zoom,
  };
}

function list<T extends string>(raw: string, allowed: (v: string) => v is T): T[] | null {
  const items = raw.split(',');
  if (items.length > MAX_LIST || items.some((v) => !allowed(v))) return null;
  return items as T[];
}
const isApi = (v: string): v is string => API_NAME.test(v);
const finite = (raw: string): number | null => {
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Returns null for anything that is not a well-formed v1 map hash. */
export function decodeMapHash(hash: string): DecodedMapHash | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const tokens = hash.slice(HASH_PREFIX.length).split(';');
  if (tokens[0] !== VERSION) return null;
  const values = new Map<string, string>();
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=');
    if (eq <= 0) return null;
    const key = token.slice(0, eq);
    if (values.has(key)) return null;
    values.set(key, token.slice(eq + 1));
  }

  const state: Partial<MapViewState> = {};
  const filters: { -readonly [K in keyof MapFilters]: MapFilters[K] } = {
    scope: 'active',
    modules: new Set(),
    kinds: new Set(),
    triggerTypes: new Set(),
    flags: new Set(),
  };
  let hasFilters = false;
  let zoom: number | null = null;
  let centre: { x: number; y: number } | null = null;
  let traceId: string | null = null;

  for (const [key, value] of values) {
    switch (key) {
      case 'view':
        if (!(VIEWS as readonly string[]).includes(value)) return null;
        state.view = value as MapView;
        break;
      case 'sel':
        if (!NODE_ID.test(value)) return null;
        state.selectedId = value;
        state.inspectorOpen = true;
        break;
      case 'field': {
        const m = FIELD_PATH.exec(value);
        if (!m) return null;
        state.field = { moduleApiName: m[1], fieldApiName: m[2] };
        break;
      }
      case 'scope':
        if (value !== 'active' && value !== 'all') return null;
        filters.scope = value === 'all' ? 'everything' : 'active';
        hasFilters = true;
        break;
      case 'q': {
        let decoded: string;
        try {
          decoded = decodeURIComponent(value);
        } catch {
          return null;
        }
        if (decoded.length > MAX_QUERY) return null;
        state.query = decoded;
        break;
      }
      case 'mods': {
        const mods = list(value, isApi);
        if (!mods) return null;
        filters.modules = new Set(mods);
        hasFilters = true;
        break;
      }
      case 'kinds': {
        const kinds = list(value, (v): v is MapNodeKind => NODE_KINDS.includes(v as MapNodeKind));
        if (!kinds) return null;
        filters.kinds = new Set(kinds);
        hasFilters = true;
        break;
      }
      case 'tt': {
        const types = list(value, (v): v is WorkflowTriggerType =>
          TRIGGER_TYPES.includes(v as WorkflowTriggerType),
        );
        if (!types) return null;
        filters.triggerTypes = new Set(types);
        hasFilters = true;
        break;
      }
      case 'flags': {
        const flags = list(value, (v): v is (typeof FLAGS)[number] =>
          (FLAGS as readonly string[]).includes(v),
        );
        if (!flags) return null;
        filters.flags = new Set(flags);
        hasFilters = true;
        break;
      }
      case 'focus':
        if (!API_NAME.test(value)) return null;
        state.focusModuleApiName = value;
        break;
      case 'z': {
        const n = finite(value);
        if (n === null || n < MIN_ZOOM || n > MAX_ZOOM) return null;
        zoom = n;
        break;
      }
      case 'c': {
        const m = /^(-?\d+),(-?\d+)$/.exec(value);
        if (!m) return null;
        const x = Number(m[1]);
        const y = Number(m[2]);
        if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return null;
        centre = { x, y };
        break;
      }
      case 'trace': {
        const parts = value.split(',');
        if (parts.length !== 3 || !NODE_ID.test(parts[0])) return null;
        const up = finite(parts[1]);
        const down = finite(parts[2]);
        if (
          up === null ||
          down === null ||
          !Number.isInteger(up) ||
          !Number.isInteger(down) ||
          up < 0 ||
          down < 0 ||
          up > MAX_TRACE_DEPTH ||
          down > MAX_TRACE_DEPTH
        )
          return null;
        traceId = parts[0];
        state.traceRootId = traceId;
        state.traceDepth = { upstream: up, downstream: down };
        break;
      }
      default:
        // Forward compatibility: keys from a newer build are ignored.
        break;
    }
  }
  if ((zoom === null) !== (centre === null)) return null;
  if (state.view === 'trace' && traceId === null) return null;
  if (hasFilters) state.filters = filters;
  return {
    state,
    camera: zoom !== null && centre !== null ? { zoom, center: centre } : null,
  };
}
