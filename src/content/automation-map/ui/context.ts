/**
 * Frozen contract shared by the Automation Map UI pieces (shell/panels and canvas).
 * The UI reads data only through `MapDataPort`; integration wires it to the store, and tests and
 * the dev harness wire it to synthetic fixtures. Native handoffs and billing stay behind the port.
 */
import type {
  AutomationMapSnapshot,
  FieldLens,
  FieldNode,
  MapFilters,
  MapNodeId,
  SearchHit,
  TraceOptions,
  TraceResult,
} from '../types';

export interface MapDataPort {
  snapshot(): AutomationMapSnapshot;
  /** Called on every published snapshot (progressive loading, refresh, access change). */
  subscribe(listener: (snapshot: AutomationMapSnapshot) => void): () => void;
  /** Deluge source for a catalogue function, when available; null in teaser for fogged data. */
  sourceText(delugeId: string): string | null;
  search(query: string, filters: MapFilters): readonly SearchHit[];
  /** Pass the current filters so the lens answers within the user's scope (and kinds, flags). */
  fieldLens(moduleApiName: string, fieldApiName: string, filters?: MapFilters): FieldLens;
  /**
   * Fields ranked by distinct writer count, using exactly the lens's writer union and scope, so a
   * start-screen chip never disagrees with the lens it opens.
   */
  mostWrittenFields(filters: MapFilters, limit?: number): readonly MostWrittenField[];
  trace(nodeId: MapNodeId, options: TraceOptions): TraceResult;
  /** Retry one failure, or every retryable failure when omitted. */
  retry(failureId?: string): Promise<void>;
  /** Revalidate every dependency now, ignoring the freshness window (explicit user action). */
  refresh(): Promise<void>;
  /** Opens the existing upgrade modal configured for Automation Map (Pro). */
  requestUpgrade(): void;
  /** Native handoffs (ADR 0024); they open Zoho screens and never change CRM data. */
  openRuleInZoho(ruleId: string): void;
  openFunctionInZoho(delugeId: string): void;
}

export interface MostWrittenField {
  field: FieldNode;
  count: number;
}

export type MapView = 'fields' | 'board' | 'list' | 'trace';

export interface Camera {
  /** World coordinates of the viewport's top-left corner, and scale (1 = 100%). */
  x: number;
  y: number;
  zoom: number;
}

export interface MapViewState {
  view: MapView;
  /** Field lens target; null shows the Fields start screen. */
  field: { moduleApiName: string; fieldApiName: string } | null;
  selectedId: MapNodeId | null;
  hoverId: MapNodeId | null;
  traceRootId: MapNodeId | null;
  traceDepth: { upstream: number; downstream: number };
  /** Board island to frame (toolbar / "Show on map" entry), or null for the overview. */
  focusModuleApiName: string | null;
  camera: Camera;
  query: string;
  filters: MapFilters;
  inspectorOpen: boolean;
}

export interface ViewStore {
  get(): Readonly<MapViewState>;
  /** Shallow patch; listeners run synchronously once per call with the new and previous state. */
  set(patch: Partial<MapViewState>): void;
  subscribe(
    listener: (next: Readonly<MapViewState>, prev: Readonly<MapViewState>) => void,
  ): () => void;
}

export interface MapUiContext {
  port: MapDataPort;
  view: ViewStore;
  /** The overlay's shadow root, for focus management and style scoping. */
  root: ShadowRoot;
}

/** Board and trace canvases mount into a container the shell owns; they return a disposer. */
export type MountView = (container: HTMLElement, context: MapUiContext) => () => void;
