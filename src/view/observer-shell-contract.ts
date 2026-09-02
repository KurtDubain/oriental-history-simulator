import type { PlaybackSpeed } from '../components/TopBar';
import type {
  MapCamera,
  MapLodLevel,
} from '../components/WorldMap';
import type { MapOverlay } from '../components/NavigationRail';
import type { MapPrimerStep } from '../components/MapPrimer';
import type { MapProfileId } from '../maps';
import type { EmbodimentClosure } from './embodiment-observer';
import type { RosterDiscoveryStateMap, RosterVisibleCountMap } from './roster-discovery';
import type {
  ObserverAudioState,
  ObserverInterfaceSettings,
} from './observer-interface-settings';
import type { ObserverLeadProjection } from './observer-leads';
import type {
  ObserverPauseMatch,
  ObserverWatchItem,
} from './v1-observer';
import type { EmbodiedActionCommand } from '../sim';
import type { ObserverNavigationState, Selection } from './observer-navigation';

export type { PowerRosterSection, Selection } from './observer-navigation';

/**
 * Presentation inputs consumed by render_game_to_text.
 *
 * The contract intentionally contains observer state only. The authoritative
 * world is always supplied separately so this snapshot can never become a
 * second simulation-state owner.
 */
export interface SnapshotOptions {
  navigation: ObserverNavigationState;
  selectedMapProfileId: MapProfileId;
  running: boolean;
  speed: PlaybackSpeed;
  rosterDiscovery: RosterDiscoveryStateMap;
  rosterVisibleCounts: RosterVisibleCountMap;
  overlay: MapOverlay;
  selection: Selection;
  interfaceSettings: ObserverInterfaceSettings;
  audioState: ObserverAudioState;
  fullscreen: boolean;
  observerLeadProjection: ObserverLeadProjection | null;
  historicalTurn: number | null;
  watchedCount: number;
  watchlist: ObserverWatchItem[];
  guideCompleted: number;
  pauseReason: string | null;
  pauseRule: ObserverPauseMatch['rule'] | null;
  pauseSituationId: string | null;
  pauseSituationTrigger: ObserverPauseMatch['situationTrigger'] | null;
  worldSaveCount: number;
  primerStep: MapPrimerStep;
  mapCamera: MapCamera;
  mapLod: MapLodLevel;
  mobileInspectorExpanded: boolean;
  mapGestureActive: boolean;
  focusedPoliticalFactionId: string | null;
  embodiedCharacterId: string | null;
  pendingEmbodiedAction: EmbodiedActionCommand | null;
  embodimentClosure: EmbodimentClosure | null;
}
