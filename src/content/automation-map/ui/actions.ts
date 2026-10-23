/** Contract between the overlay controller and the panels it composes. */
import type { MapFilters, MapNodeId } from '../types';
import type { MapDataPort, MapView } from './context';
import type { GroupKey } from './lens-model';
import type { SortState } from './list-model';

export interface FieldRef {
  moduleApiName: string;
  fieldApiName: string;
}

export interface EvidenceFocus {
  nodeId: MapNodeId;
  edgeId: string | null;
}

/** Shell-local state that is not part of the shared `MapViewState`. */
export interface UiState {
  railOpen: boolean;
  coverageOpen: boolean;
  keysOpen: boolean;
  fogCardOpen: boolean;
  bannerDismissed: boolean;
  lensTrail: FieldRef[];
  expandedPaths: Set<string>;
  /** Lens groups the user opened (unresolved module, other record changes). */
  expandedGroups: Set<GroupKey>;
  expandedCode: Set<string>;
  evidence: EvidenceFocus | null;
  matchIndex: number;
  list: { sort: SortState; expanded: Set<MapNodeId>; collapsed: Set<string> };
}

export interface ShellActions {
  setView(view: MapView): void;
  select(id: MapNodeId | null, options?: { evidence?: EvidenceFocus | null; view?: MapView }): void;
  /** `pivot` keeps the current field on the breadcrumb trail. */
  /** Opens a search result in the best view for it (fields open the lens). */
  openResult(id: MapNodeId): void;
  openField(ref: FieldRef, options?: { pivot?: boolean }): void;
  closeField(): void;
  trace(id: MapNodeId): void;
  showOnBoard(id: MapNodeId): void;
  showInList(id: MapNodeId): void;
  flyToModule(apiName: string): void;
  setFilters(patch: Partial<MapFilters>): void;
  clearFilters(): void;
  setQuery(query: string): void;
  copyLink(): void;
  toast(message: string): void;
  upgrade(): void;
  retry(failureId?: string): void;
  openRule(ruleId: string): void;
  openFunction(delugeId: string): void;
  setCoverageOpen(open: boolean): void;
  /** Revalidate the map's dependencies now (the popover's "Refresh now"). */
  refreshMap(): void;
  toggleKeys(open?: boolean): void;
  focusSearch(): void;
  /** Re-render regions that depend on `UiState` after the caller mutated it. */
  refresh(): void;
  /** Applies a starter question from the Fields start screen. */
  starter(id: 'deals-edit' | 'external' | 'loops' | 'map'): void;
}

/** Everything a panel needs from the controller; panels never reach the store directly. */
export interface RegionEnv {
  root: ShadowRoot;
  port: MapDataPort;
  actions: ShellActions;
  ui: UiState;
  /** Element that receives focus when a rebuilt control was the focused one and is gone. */
  fallback(): HTMLElement;
}
