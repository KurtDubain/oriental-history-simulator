import type { PlaybackSpeed } from '../components/TopBar';
import type {
  MapCamera,
  MapLodLevel,
} from '../components/WorldMap';
import type { MapOverlay, ObserverView } from '../components/NavigationRail';
import type { MapPrimerStep } from '../components/MapPrimer';
import type { MapProfileId } from '../maps';
import type { EmbodimentClosure } from './embodiment-observer';
import type { RosterDiscoveryStateMap, RosterVisibleCountMap } from './roster-discovery';
import type {
  ObserverAudioState,
  ObserverInterfaceSettings,
} from './observer-interface-settings';
import type { ObserverLeadProjection } from './observer-leads';
import type { AgencyShadowLedger } from './v1-agency-shadow';
import type {
  ObserverPauseMatch,
  ObserverWatchItem,
} from './v1-observer';
import type { EmbodiedActionCommand } from '../sim';

export type PowerRosterSection = 'polities' | 'families' | 'military';

/** A selection is observer-only navigation state and never enters WorldState. */
export type Selection =
  | { kind: 'region'; id: string }
  | { kind: 'country'; id: string }
  | { kind: 'family'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'seaZone'; id: string }
  | { kind: 'army'; id: string }
  | { kind: 'fleet'; id: string }
  | { kind: 'tradeCorridor'; id: string }
  | { kind: 'practice'; id: string }
  | { kind: 'outbreak'; id: string }
  | { kind: 'migration'; id: string }
  | null;

/**
 * Presentation inputs consumed by render_game_to_text.
 *
 * The contract intentionally contains observer state only. The authoritative
 * world is always supplied separately so this snapshot can never become a
 * second simulation-state owner.
 */
export interface SnapshotOptions {
  startOpen: boolean;
  selectedMapProfileId: MapProfileId;
  running: boolean;
  speed: PlaybackSpeed;
  view: ObserverView;
  powerRosterSection: PowerRosterSection;
  rosterDiscovery: RosterDiscoveryStateMap;
  rosterVisibleCounts: RosterVisibleCountMap;
  overlay: MapOverlay;
  selection: Selection;
  selectedEventId: string | null;
  archiveOpen: boolean;
  mandateOpen: boolean;
  observerDeskOpen: boolean;
  settingsOpen: boolean;
  interfaceSettings: ObserverInterfaceSettings;
  audioState: ObserverAudioState;
  fullscreen: boolean;
  historyWorkbenchOpen: boolean;
  situationWorkbenchOpen: boolean;
  selectedSituationId: string | null;
  observerLeadProjection: ObserverLeadProjection | null;
  historicalTurn: number | null;
  watchedCount: number;
  watchlist: ObserverWatchItem[];
  guideCompleted: number;
  pauseReason: string | null;
  pauseRule: ObserverPauseMatch['rule'] | null;
  pauseSituationId: string | null;
  pauseSituationTrigger: ObserverPauseMatch['situationTrigger'] | null;
  collectionOpen: boolean;
  worldSaveCount: number;
  primerOpen: boolean;
  primerStep: MapPrimerStep;
  mapCamera: MapCamera;
  mapLod: MapLodLevel;
  mobileInspectorExpanded: boolean;
  mapGestureActive: boolean;
  agencyShadowLedger: AgencyShadowLedger;
  agencyShadowBranchId: string | null;
  embodiedCharacterId: string | null;
  pendingEmbodiedAction: EmbodiedActionCommand | null;
  embodimentClosure: EmbodimentClosure | null;
}
