import {
  Download,
  Eye,
  Library,
  Map as MapIcon,
  MoreHorizontal,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { CausalDrawer, type CausalFactor, type CausalReference } from './components/CausalDrawer';
import { AudioInvitation } from './components/AudioInvitation';
import { HistoryWorkbench } from './components/HistoryWorkbench';
import { Inspector } from './components/Inspector';
import { MandatePanel, type MandateMessage, type MandateTarget } from './components/MandatePanel';
import {
  MapPrimer,
  type MapPrimerCloseReason,
  type MapPrimerStep,
} from './components/MapPrimer';
import { ObserverDesk } from './components/ObserverDesk';
import {
  ObserverLeads,
} from './components/ObserverLeads';
import { SituationWorkbench } from './components/SituationWorkbench';
import { SettingsPanel } from './components/SettingsPanel';
import {
  QuarterPulse,
  type QuarterPulseLedger,
} from './components/QuarterPulse';
import {
  HistoricalArchive,
  type ArchiveDossier,
  type ArchiveEntityKind,
} from './components/HistoricalArchive';
import {
  NavigationRail,
  type MapOverlay,
  type ObserverView,
} from './components/NavigationRail';
import { RosterPanel } from './components/RosterPanel';
import { TopBar, type PlaybackSpeed } from './components/TopBar';
import {
  DEFAULT_MAP_CAMERA,
  WorldMap,
  type MapCamera,
  type MapLodLevel,
} from './components/WorldMap';
import { WorldCollectionPanel } from './components/WorldCollectionPanel';
import { WorldStart } from './components/WorldStart';
import {
  gameAudio,
  type AudioCue,
} from './audio';
import {
  checkForAppUpdate,
  getAppUpdateState,
  startAppUpdateMonitor,
  subscribeAppUpdate,
} from './infra/app-update';
import {
  createAutosaveCoordinator,
  type AutosaveCoordinator,
} from './persistence/autosave-coordinator';
import {
  measureRuntimePhaseAsync,
  measureRuntimePhase,
  recordRuntimeMetric,
  resetRuntimePerformanceMetrics,
  runtimeNow,
} from './performance/runtime-profiler';
import {
  AUTOSAVE_SLOT,
  MAX_WORLD_SLOTS,
  deleteWorldSlot,
  downloadWorld,
  duplicateWorldSlot,
  listWorldSaves,
  loadWorld,
  loadWorldFromSlot,
  readWorldFile,
  renameWorldSlot,
  saveWorld,
  saveWorldToSlot,
  type WorldSaveSummary,
} from './persistence/storage';
import {
  advanceWorldDetailed,
  applyV03Intervention,
  availableMandate,
  createWorld,
  deserializeWorld,
  findWorldHistoryEvent,
  isV03InterventionEvent,
  serializeWorld,
  measureRuntimeValidation,
  projectCharacterEmbodiedActions,
  SIMULATION_SYSTEM_PHASES,
  validateWorld,
  type V03InterventionAction,
  type WorldState,
} from './sim';
import { DEFAULT_MAP_PROFILE_ID, type MapProfileId } from './maps';
import {
  projectRosterDirectory,
  rosterScopeFor,
  toCausalEvent,
  toCountryInspector,
  toCountryArchive,
  toFamilyArchive,
  toFamilyInspector,
  toMapArmies,
  toMapFleets,
  toMapFlows,
  toMapMarkers,
  toMapRegions,
  toMapRoutes,
  toMapSeaZones,
  toPersonInspector,
  toPersonArchive,
  toRegionInspector,
  toSystemInspector,
  worldPopulation,
  type RosterReason,
} from './view/adapters';
import {
  type HistoricalTerritoryView,
} from './view/v1-history';
import {
  deriveObserverLeadProjection,
  type ObserverLead,
} from './view/observer-leads';
import { projectSituationWorkbench } from './view/situation-detail';
import { projectQuarterPulse } from './view/quarter-pulse-stories';
import {
  applyObserverEventAlerts,
  completeObserverGuideStep,
  createObserverDeskSettings,
  evaluateObserverPause,
  historyEventsToPauseCandidates,
  observerGuideProgress,
  observerWatchKey,
  removeObserverWatch,
  serializeObserverDeskSettings,
  setObserverWatchAlert,
  upsertObserverWatch,
  worldToSituationPauseCandidates,
  type ObserverDeskSettings,
  type ObserverGuideStepId,
  type ObserverPauseMatch,
  type ObserverWatchItem,
} from './view/v1-observer';
import { isDefaultVisibleHistoryEvent } from './view/history-visibility';
import {
  AGENCY_SHADOW_STORAGE_KEY,
  advanceAgencyShadowBranch,
  attachAgencyShadowBranch,
  bindAgencyShadowRestorePoint,
  copyAgencyShadowRestorePoint,
  createAgencyShadowLedger,
  ensureAgencyShadowCharacters,
  forkAgencyShadowIntervention,
  getAgencyShadowProjection,
  parseAgencyShadowLedger,
  removeAgencyShadowRestorePoint,
  serializeAgencyShadowLedger,
  type AgencyShadowLedger,
} from './view/v1-agency-shadow';
import {
  advanceEmbodimentObserverState,
  cancelEmbodiedObserverAction,
  createEmbodimentObserverState,
  dismissEmbodimentClosure,
  embodimentObserverStorageKey,
  enterEmbodimentObserverState,
  leaveEmbodimentObserverState,
  queueEmbodiedObserverAction,
  reanchorEmbodimentObserverState,
  serializeEmbodimentObserverState,
  type EmbodimentObserverState,
} from './view/embodiment-observer';
import { projectPersonEmbodimentView } from './view/embodiment-view';
import { makeTextSnapshot } from './view/game-text-snapshot';
import {
  agencyDossierOptions,
  agencyShadowRestoreToken,
  agencyTrackedCharacterIds,
} from './view/observer-agency-projection';
import { shouldCloseMapSelectionForOverlay } from './view/map-selection-policy';
import {
  selectedEntityLabel,
  watchItemForSelection,
  watchItemForSituation,
} from './view/observer-selection';
import type { Selection, SnapshotOptions } from './view/observer-shell-contract';
import { shouldShowObserverSoundInvitation } from './view/observer-interface-settings';
import { useObserverInterface } from './view/use-observer-interface';
import { useObserverNavigation } from './view/use-observer-navigation';
import {
  observerLayerIsOpen,
  observerNavigationIsBlocking,
  type CourtFactionTarget,
} from './view/observer-navigation';
import {
  useObserverPlayback,
  type ObserverAdvanceSource,
} from './view/use-observer-playback';
import { useRosterDiscovery } from './view/use-roster-discovery';
import { useRosterDossierFlow } from './view/use-roster-dossier-flow';
import { useWorldSessionController } from './view/use-world-session-controller';
import {
  MAP_PRIMER_STORAGE_KEY,
  observerStorageKey,
  restoreWorldSession,
  type OpenWorldSource,
} from './view/world-session-restore';
import { compact } from './view/compact-number';
import './styles/app.css';

const DEFAULT_SEED = '沧衡-甲子';
const BASE_AUTOPLAY_INTERVAL = 1_800;

function quarterHistoryCue(events: ReadonlyArray<WorldState['history'][number]>): AudioCue | null {
  if (events.some((event) => (
    event.kind === 'succession'
    || event.kind === 'war_declared'
    || event.kind === 'war_started'
    || event.kind === 'war_ended'
  ))) return 'turning_point';
  if (events.some((event) => event.kind === 'battle_victory' || event.kind === 'battle')) return 'battle';
  if (events.some((event) => event.kind === 'territory_control_changed')) return 'territory';
  if (events.some((event) => event.kind === 'character_death' && event.importance >= 4)) return 'death';
  if (events.some((event) => event.importance >= 5)) return 'turning_point';
  return null;
}
function assertValidWorld(candidate: WorldState): WorldState {
  const violations = measureRuntimePhase(
    'validation.full',
    () => validateWorld(candidate),
    candidate.turn,
  );
  if (violations.length) {
    throw new Error(`世界校验失败：${violations.slice(0, 3).map((item) => item.message).join('；')}`);
  }
  return candidate;
}

function assertValidRuntimeTurn(previous: WorldState, candidate: WorldState): WorldState {
  const measurement = measureRuntimeValidation(previous, candidate);
  recordRuntimeMetric('validation.runtime', measurement.durationMs, candidate.turn);
  if (measurement.violations.length) {
    throw new Error(`季度校验失败：${measurement.violations.slice(0, 3).map((item) => item.message).join('；')}`);
  }
  return candidate;
}

function availableCollectionSlot(prefix: string, saves: WorldSaveSummary[]): string {
  const occupied = new Set(saves.filter((save) => !save.isAutosave).map((save) => save.slot));
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? prefix : `${prefix}_${index}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error('无法分配新的世界收藏槽位。');
}

export function App() {
  const [world, setWorld] = useState<WorldState | null>(null);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [selectedMapProfileId, setSelectedMapProfileId] = useState<MapProfileId>(DEFAULT_MAP_PROFILE_ID);
  const [hasSave, setHasSave] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const advanceRef = useRef<(source: ObserverAdvanceSource) => boolean>(() => false);
  const playback = useObserverPlayback(advanceRef, BASE_AUTOPLAY_INTERVAL);
  const navigation = useObserverNavigation();
  const session = useWorldSessionController();
  const startBusy = session.isBusy('start');
  const collectionSessionBusy = session.isBusy('collection');
  const { running, speed } = playback;
  const { activeView, powerRosterSection, selectedEventId } = navigation;
  const startOpen = navigation.isLayerInJourney('start');
  const primerOpen = navigation.isLayerOpen('primer');
  const archiveOpen = navigation.isLayerOpen('archive');
  const mandateOpen = navigation.isLayerOpen('mandate');
  const observerDeskOpen = navigation.isLayerOpen('observer-desk');
  const situationWorkbenchOpen = navigation.isLayerOpen('situations');
  const collectionOpen = navigation.isLayerOpen('collection');
  const settingsOpen = navigation.isLayerOpen('settings');
  const historyWorkbenchOpen = navigation.isPageVisible('chronicle');
  const selectedSituationId = navigation.topLayer?.kind === 'situations'
    ? navigation.topLayer.situationId
    : null;
  const [overlay, setOverlay] = useState<MapOverlay>('political');
  const [mapCamera, setMapCamera] = useState<MapCamera>(() => ({ ...DEFAULT_MAP_CAMERA }));
  const [mapLod, setMapLod] = useState<MapLodLevel>('overview');
  const [mobileInspectorExpanded, setMobileInspectorExpanded] = useState(false);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  const [mapCameraKey, setMapCameraKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusedPoliticalFactionId, setFocusedPoliticalFactionId] = useState<string | null>(null);
  const { returnTarget: rosterDossierReturn, enteredFromRoster: rosterDossierEntry, compactPresentation: compactRosterDossier, begin: beginRosterDossier, clear: clearRosterDossier, returnToRoster } = useRosterDossierFlow(activeView, powerRosterSection);
  useEffect(() => { setMobileInspectorExpanded(Boolean(rosterDossierReturn)); }, [rosterDossierReturn]);
  const [focusedArmyId, setFocusedArmyId] = useState<string | null>(null);
  const [primerStep, setPrimerStep] = useState<MapPrimerStep>('terrain');
  const [mandateBusy, setMandateBusy] = useState(false);
  const [mandateMessage, setMandateMessage] = useState<MandateMessage | null>(null);
  const [observerSettings, setObserverSettings] = useState<ObserverDeskSettings>(() => createObserverDeskSettings());
  const followed = useMemo(
    () => new Set(observerSettings.watchlist.map((item) => observerWatchKey(item.kind, item.id))),
    [observerSettings.watchlist],
  );
  const [pauseMatch, setPauseMatch] = useState<ObserverPauseMatch | null>(null);
  const [historicalView, setHistoricalView] = useState<HistoricalTerritoryView | null>(null);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [worldStartInitialFocus, setWorldStartInitialFocus] = useState<'primary' | 'collection'>('primary');
  const [worldSaves, setWorldSaves] = useState<WorldSaveSummary[]>([]);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [agencyShadowLedger, setAgencyShadowLedger] = useState<AgencyShadowLedger>(() => createAgencyShadowLedger());
  const [agencyShadowBranchId, setAgencyShadowBranchId] = useState<string | null>(null);
  const [embodimentObserver, setEmbodimentObserver] = useState<EmbodimentObserverState>(() => createEmbodimentObserverState());
  const embodiedCharacterId = embodimentObserver.activeActor?.id ?? null;
  const pendingEmbodiedAction = embodimentObserver.pendingAction;
  const rosterDiscovery = useRosterDiscovery(
    world ? `${world.mapContentVersion}:${world.seed}` : null,
  );
  const appUpdate = useSyncExternalStore(
    subscribeAppUpdate,
    getAppUpdateState,
    getAppUpdateState,
  );
  const seaAudioFocused = overlay === 'naval'
    || overlay === 'trade'
    || selection?.kind === 'fleet'
    || selection?.kind === 'seaZone'
    || selection?.kind === 'tradeCorridor';
  const dangerAudioFocused = overlay === 'war'
    || overlay === 'disease'
    || selection?.kind === 'army'
    || selection?.kind === 'outbreak';
  const worldWarAmbience = world?.wars.some((war) => war.active) ?? false;
  const {
    settings: interfaceSettings,
    audioState: settingsAudioState,
    fullscreen,
    commitSettings: commitInterfaceSettings,
    enableSound,
    dismissSoundInvitation,
    previewSound,
    toggleFullscreen: handleFullscreen,
  } = useObserverInterface({
    seaFocused: seaAudioFocused,
    dangerFocused: dangerAudioFocused,
    worldWarAmbience,
  });
  const audioInvitationVisible = shouldShowObserverSoundInvitation(interfaceSettings, {
    turn: world?.turn,
    worldViewActive: activeView === 'world' && historicalView === null,
    selectionOpen: selection !== null,
  }) && !mobileToolsOpen;

  const worldRef = useRef<WorldState | null>(null);
  const worldShellRef = useRef<HTMLElement>(null);
  const advancingRef = useRef(false);
  const archiveReturnFocusRef = useRef<HTMLElement | null>(null);
  const causalReturnFocusRef = useRef<HTMLElement | null>(null);
  const archiveFocusRestoreAllowedRef = useRef(false);
  const causalFocusRestoreAllowedRef = useRef(false);
  const mandateTriggerRef = useRef<HTMLButtonElement>(null);
  const observerDeskTriggerRef = useRef<HTMLButtonElement>(null);
  const situationReturnFocusRef = useRef<HTMLElement | null>(null);
  const situationFocusRestoreAllowedRef = useRef(false);
  const powersTriggerRef = useRef<HTMLButtonElement>(null);
  const peopleTriggerRef = useRef<HTMLButtonElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const collectionTriggerRef = useRef<HTMLButtonElement>(null);
  const primerTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const collectionReturnFocusRef = useRef<HTMLElement | null>(null);
  const worldStartReturnFocusRef = useRef<HTMLElement | null>(null);
  const observerSettingsRef = useRef(observerSettings);
  const primerAdvanceDoneRef = useRef(false);
  const primerNewestEventIdRef = useRef<string | null>(null);
  const reactCommitStartedAtRef = useRef<{ startedAt: number; turn: number } | null>(null);
  const autosaveCoordinatorRef = useRef<AutosaveCoordinator | null>(null);
  const agencyShadowLedgerRef = useRef(agencyShadowLedger);
  const agencyShadowBranchIdRef = useRef<string | null>(agencyShadowBranchId);
  const embodimentObserverRef = useRef<EmbodimentObserverState>(embodimentObserver);
  const courtFocusRequestRef = useRef(0);
  const shouldRestoreArchiveFocus = useCallback(() => archiveFocusRestoreAllowedRef.current, []);
  const shouldRestoreCausalFocus = useCallback(() => causalFocusRestoreAllowedRef.current, []);
  useEffect(() => startAppUpdateMonitor(), []);

  useEffect(() => {
    if (!mobileToolsOpen) return undefined;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !mobileToolsRef.current?.contains(target)) setMobileToolsOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMobileToolsOpen(false);
      window.setTimeout(() => mobileToolsTriggerRef.current?.focus(), 0);
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [mobileToolsOpen]);
  const observerLeadProjection = useMemo(() => (
    world ? deriveObserverLeadProjection(world, observerSettings.leadContinuity) : null
  ), [observerSettings.leadContinuity, world]);
  const currentSnapshotOptions: SnapshotOptions = {
    navigation: navigation.state,
    selectedMapProfileId,
    running,
    speed,
    rosterDiscovery: rosterDiscovery.states,
    rosterVisibleCounts: rosterDiscovery.visibleCounts,
    overlay,
    selection,
    interfaceSettings,
    audioState: settingsAudioState,
    fullscreen,
    observerLeadProjection,
    historicalTurn: historicalView?.turn ?? null,
    watchedCount: observerSettings.watchlist.length,
    watchlist: observerSettings.watchlist.map((item) => ({ ...item })),
    guideCompleted: observerGuideProgress(observerSettings).completed,
    pauseReason: pauseMatch?.reason ?? null,
    pauseRule: pauseMatch?.rule ?? null,
    pauseSituationId: pauseMatch?.situationId ?? null,
    pauseSituationTrigger: pauseMatch?.situationTrigger ?? null,
    worldSaveCount: worldSaves.length,
    primerStep,
    mapCamera,
    mapLod,
    mobileInspectorExpanded,
    mapGestureActive,
    focusedPoliticalFactionId,
    agencyShadowLedger,
    agencyShadowBranchId,
    embodiedCharacterId,
    pendingEmbodiedAction,
    embodimentClosure: embodimentObserver.closure,
  };
  const snapshotOptionsRef = useRef<SnapshotOptions>(currentSnapshotOptions);
  // Keep render_game_to_text current on every render. commitWorld and
  // commitObserverSettings still patch this ref synchronously before React's
  // next commit, preserving the existing immediate snapshot semantics.
  snapshotOptionsRef.current = currentSnapshotOptions;

  const commitAgencyShadow = useCallback((nextLedger: AgencyShadowLedger, nextBranchId: string | null) => {
    agencyShadowLedgerRef.current = nextLedger;
    agencyShadowBranchIdRef.current = nextBranchId;
    setAgencyShadowLedger(nextLedger);
    setAgencyShadowBranchId(nextBranchId);
  }, []);

  const commitEmbodiedObserver = useCallback((nextState: EmbodimentObserverState) => {
    embodimentObserverRef.current = nextState;
    setEmbodimentObserver(nextState);
  }, []);

  const resetAgencyShadowAtWorld = useCallback((nextWorld: WorldState) => {
    try {
      const fresh = attachAgencyShadowBranch(createAgencyShadowLedger(), nextWorld, 'create');
      let nextLedger = ensureAgencyShadowCharacters(
        fresh.ledger,
        fresh.branchId,
        nextWorld,
        agencyTrackedCharacterIds(nextWorld, selection, observerSettingsRef.current.watchlist),
      );
      nextLedger = bindAgencyShadowRestorePoint(
        nextLedger,
        fresh.branchId,
        nextWorld,
        agencyShadowRestoreToken('autosave'),
      );
      commitAgencyShadow(nextLedger, fresh.branchId);
    } catch {
      // Observer notes are expendable: even an unexpected projection error must not stop the world.
      commitAgencyShadow(createAgencyShadowLedger(), null);
    }
  }, [commitAgencyShadow, selection]);

  const commitWorld = useCallback((
    nextWorld: WorldState,
    leadLineage: 'advance' | 'restore' | 'reset' = 'advance',
  ) => {
    const previousHash = leadLineage === 'advance' ? worldRef.current?.hash ?? null : null;
    const refreshedWatchlist = observerSettingsRef.current.watchlist.map((item) => {
      if (item.kind !== 'situation') return item;
      const currentItem = watchItemForSituation(nextWorld, item.id);
      return currentItem ? { ...currentItem, alert: item.alert } : item;
    });
    const leadProjection = deriveObserverLeadProjection(
      nextWorld,
      leadLineage === 'reset' ? null : observerSettingsRef.current.leadContinuity,
      previousHash,
    );
    const nextObserverSettings = {
      ...observerSettingsRef.current,
      watchlist: refreshedWatchlist,
      leadContinuity: leadProjection.continuity,
    };
    observerSettingsRef.current = nextObserverSettings;
    setObserverSettings(nextObserverSettings);
    snapshotOptionsRef.current = {
      ...snapshotOptionsRef.current,
      observerLeadProjection: leadProjection,
      watchedCount: refreshedWatchlist.length,
      watchlist: refreshedWatchlist.map((item) => ({ ...item })),
    };
    reactCommitStartedAtRef.current = { startedAt: runtimeNow(), turn: nextWorld.turn };
    worldRef.current = nextWorld;
    setWorld(nextWorld);
    autosaveCoordinatorRef.current?.markDirty({
      turn: nextWorld.turn,
      serialize: () => measureRuntimePhase(
        'persistence.serialize',
        () => serializeWorld(nextWorld),
        nextWorld.turn,
      ),
    });
  }, []);

  useLayoutEffect(() => {
    const pending = reactCommitStartedAtRef.current;
    if (!pending || pending.turn !== world?.turn) return;
    recordRuntimeMetric('react.commit', runtimeNow() - pending.startedAt, pending.turn);
    reactCommitStartedAtRef.current = null;
  }, [world]);

  useLayoutEffect(() => {
    if (!world || selection?.kind !== 'person' || !agencyShadowBranchId) return;
    const projection = getAgencyShadowProjection(
      agencyShadowLedger,
      agencyShadowBranchId,
      selection.id,
    );
    if (
      projection?.seed === world.seed
      && projection.reviewedTurn === world.turn
      && projection.sourceWorldHash === world.hash
    ) return;
    try {
      const trackedIds = agencyTrackedCharacterIds(world, selection, observerSettings.watchlist);
      let nextLedger = ensureAgencyShadowCharacters(
        agencyShadowLedger,
        agencyShadowBranchId,
        world,
        trackedIds,
      );
      nextLedger = bindAgencyShadowRestorePoint(
        nextLedger,
        agencyShadowBranchId,
        world,
        agencyShadowRestoreToken('autosave'),
        trackedIds,
      );
      commitAgencyShadow(nextLedger, agencyShadowBranchId);
    } catch {
      resetAgencyShadowAtWorld(world);
    }
  }, [
    agencyShadowBranchId,
    agencyShadowLedger,
    commitAgencyShadow,
    observerSettings.watchlist,
    resetAgencyShadowAtWorld,
    selection,
    world,
  ]);

  const resetAutosaveCoordinator = useCallback((initialSavedTurn: number) => {
    autosaveCoordinatorRef.current?.dispose();
    const coordinator = createAutosaveCoordinator({
      initialSavedTurn,
      save: (payload, context) => measureRuntimePhaseAsync(
        'persistence.indexeddb',
        () => saveWorld(payload),
        context.turn,
      ),
      onSaved: () => setHasSave(true),
      onError: (error) => {
        setToast(error instanceof Error ? error.message : '本地史册保存失败。');
      },
    });
    autosaveCoordinatorRef.current = coordinator;
    return coordinator;
  }, []);

  const refreshWorldSaves = useCallback(async () => {
    const saves = await listWorldSaves();
    setWorldSaves(saves);
    // An unavailable-map autosave must stay discoverable: Continue can then
    // explain which map package is missing instead of reporting no local save.
    setHasSave(saves.some((save) => save.isAutosave && save.status !== 'corrupt'));
    return saves;
  }, []);

  useEffect(() => {
    refreshWorldSaves().catch(() => setHasSave(false));
  }, [refreshWorldSaves]);

  useEffect(() => {
    observerSettingsRef.current = observerSettings;
    if (!world) return;
    try {
      localStorage.setItem(
        observerStorageKey(world.seed, world.mapContentVersion),
        serializeObserverDeskSettings(observerSettings),
      );
    } catch {
      // Observer preferences are non-authoritative; a blocked localStorage must not stop play.
    }
  }, [observerSettings, world]);

  useEffect(() => {
    embodimentObserverRef.current = embodimentObserver;
    if (!world
      || embodimentObserver.anchor?.seed !== world.seed
      || embodimentObserver.anchor.turn !== world.turn
      || embodimentObserver.anchor.hash !== world.hash) return;
    try {
      localStorage.setItem(
        embodimentObserverStorageKey(world.seed, world.mapContentVersion),
        serializeEmbodimentObserverState(embodimentObserver),
      );
    } catch {
      // The embodied viewpoint is expendable observer metadata; the world remains authoritative.
    }
  }, [embodimentObserver, world]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(AGENCY_SHADOW_STORAGE_KEY, serializeAgencyShadowLedger(agencyShadowLedger));
      } catch {
        // The continuity ledger is an observer aid; storage pressure must never stop the world.
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [agencyShadowLedger]);

  useEffect(() => {
    if (running) return;
    void autosaveCoordinatorRef.current?.flush('pause');
  }, [running]);

  useEffect(() => {
    const flushBackground = () => {
      if (document.visibilityState === 'hidden') {
        void autosaveCoordinatorRef.current?.flush('background');
      }
    };
    const flushPage = () => {
      void autosaveCoordinatorRef.current?.flush('background');
      try {
        localStorage.setItem(
          AGENCY_SHADOW_STORAGE_KEY,
          serializeAgencyShadowLedger(agencyShadowLedgerRef.current),
        );
        const currentWorld = worldRef.current;
        const currentEmbodiment = embodimentObserverRef.current;
        if (currentWorld
          && currentEmbodiment.anchor?.seed === currentWorld.seed
          && currentEmbodiment.anchor.turn === currentWorld.turn
          && currentEmbodiment.anchor.hash === currentWorld.hash) {
          localStorage.setItem(
            embodimentObserverStorageKey(currentWorld.seed, currentWorld.mapContentVersion),
            serializeEmbodimentObserverState(currentEmbodiment),
          );
        }
      } catch {
        // Keep page shutdown best-effort when localStorage is unavailable.
      }
    };
    document.addEventListener('visibilitychange', flushBackground);
    window.addEventListener('pagehide', flushPage);
    return () => {
      document.removeEventListener('visibilitychange', flushBackground);
      window.removeEventListener('pagehide', flushPage);
      autosaveCoordinatorRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3_600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!worldShellRef.current) return;
    worldShellRef.current.inert = navigation.blocking;
  }, [navigation.blocking, world]);

  const openWorld = useCallback((
    nextWorld: WorldState,
    source: OpenWorldSource,
    restoreToken: string | null = null,
  ) => {
    clearRosterDossier(); rosterDiscovery.reset(); resetRuntimePerformanceMetrics();
    const validWorld = assertValidWorld(nextWorld);
    resetAutosaveCoordinator(source === 'continue' ? validWorld.turn : 0);
    const restoredSession = restoreWorldSession(
      validWorld,
      source,
      localStorage,
      window.matchMedia('(max-width: 760px)').matches,
    );
    const restoredObserver = restoredSession.observerSettings;
    observerSettingsRef.current = restoredObserver;
    setObserverSettings(restoredObserver);
    try {
      let restoredLedger = agencyShadowLedgerRef.current;
      if (restoredLedger.branches.length === 0 && restoredLedger.restorePoints.length === 0) {
        restoredLedger = parseAgencyShadowLedger(localStorage.getItem(AGENCY_SHADOW_STORAGE_KEY));
      }
      const mode = source === 'create' ? 'create' : source === 'import' ? 'import' : 'restore';
      const attached = attachAgencyShadowBranch(restoredLedger, validWorld, mode, restoreToken);
      let nextLedger = ensureAgencyShadowCharacters(
        attached.ledger,
        attached.branchId,
        validWorld,
        agencyTrackedCharacterIds(validWorld, null, restoredObserver.watchlist),
      );
      nextLedger = bindAgencyShadowRestorePoint(
        nextLedger,
        attached.branchId,
        validWorld,
        agencyShadowRestoreToken('autosave'),
      );
      if (restoreToken && restoreToken !== agencyShadowRestoreToken('autosave')) {
        nextLedger = bindAgencyShadowRestorePoint(
          nextLedger,
          attached.branchId,
          validWorld,
          restoreToken,
        );
      }
      commitAgencyShadow(nextLedger, attached.branchId);
    } catch {
      resetAgencyShadowAtWorld(validWorld);
    }
    commitWorld(validWorld, source === 'continue' || source === 'collection' ? 'restore' : 'reset');
    commitEmbodiedObserver(restoredSession.embodiment);
    setSeed(restoredSession.seed);
    setSelectedMapProfileId(restoredSession.mapProfileId);
    setSelection(restoredSession.selection);
    setFocusedPoliticalFactionId(restoredSession.focusedPoliticalFactionId);
    navigation.reset(restoredSession.navigation);
    setMandateMessage(null);
    archiveFocusRestoreAllowedRef.current = false;
    causalFocusRestoreAllowedRef.current = false;
    setFocusedArmyId(null);
    setPauseMatch(null);
    setHistoricalView(null);
    setOverlay('political');
    setMapCamera({ ...DEFAULT_MAP_CAMERA });
    setMapCameraKey((current) => current + 1);
    setStartError(null);
    setFatalError(null);
    primerAdvanceDoneRef.current = false;
    primerNewestEventIdRef.current = null;
    setPrimerStep('terrain');
    playback.pause();
  }, [clearRosterDossier, commitAgencyShadow, commitEmbodiedObserver, commitWorld, navigation, playback, resetAgencyShadowAtWorld, resetAutosaveCoordinator, rosterDiscovery]);

  const handleCreate = useCallback(async () => {
    const ticket = session.begin('start');
    setStartError(null);
    try {
      const nextWorld = createWorld(seed.trim(), selectedMapProfileId);
      const saves = await listWorldSaves();
      if (!session.isCurrent(ticket)) return;
      const unavailableAutosave = saves.find((save) => save.isAutosave && save.status === 'incompatible');
      if (unavailableAutosave) {
        const namedCount = saves.filter((save) => !save.isAutosave).length;
        if (namedCount >= MAX_WORLD_SLOTS) {
          throw new Error('自动续写使用了尚未安装的地图，且世界收藏已满。请先在世界收藏中整理一个槽位。');
        }
        const recoverySlot = availableCollectionSlot(
          `recovery_${unavailableAutosave.hash?.slice(0, 8) ?? 'map'}`,
          saves,
        );
        await duplicateWorldSlot(
          AUTOSAVE_SLOT,
          recoverySlot,
          `${unavailableAutosave.label.slice(0, 64)} · 待补地图`,
        );
        if (!session.isCurrent(ticket)) return;
        await refreshWorldSaves();
        if (session.isCurrent(ticket)) setToast('已先把缺少地图的自动续写收藏留底，原世界没有丢失。');
      }
      session.commit(ticket, () => openWorld(nextWorld, 'create'));
    } catch (error) {
      if (session.isCurrent(ticket)) setStartError(error instanceof Error ? error.message : '无法创建世界。');
    } finally {
      session.finish(ticket);
    }
  }, [openWorld, refreshWorldSaves, seed, selectedMapProfileId, session]);

  const handleContinue = useCallback(async () => {
    const ticket = session.begin('start');
    setStartError(null);
    try {
      const saved = await loadWorld();
      if (!saved) throw new Error('没有找到可续读的本地史册。');
      const restored = deserializeWorld(saved.payload);
      session.commit(ticket, () => openWorld(restored, 'continue', agencyShadowRestoreToken('autosave')));
    } catch (error) {
      if (session.isCurrent(ticket)) setStartError(error instanceof Error ? error.message : '无法读取本地史册。');
    } finally {
      session.finish(ticket);
    }
  }, [openWorld, session]);

  const handleImport = useCallback(async (file: File) => {
    const ticket = session.begin('start');
    setStartError(null);
    try {
      const payload = await readWorldFile(file);
      const restored = deserializeWorld(payload);
      session.commit(ticket, () => {
        openWorld(restored, 'import');
        setToast('已导入史册，因果记录与世界状态均已恢复。');
      });
    } catch (error) {
      if (session.isCurrent(ticket)) setStartError(error instanceof Error ? error.message : '该文件无法作为史册读取。');
    } finally {
      session.finish(ticket);
    }
  }, [openWorld, session]);

  const handleManualSave = useCallback(async () => {
    const current = worldRef.current;
    if (!current) return;
    try {
      const validCurrent = assertValidWorld(current);
      const coordinator = autosaveCoordinatorRef.current ?? resetAutosaveCoordinator(0);
      coordinator.markDirty({
        turn: validCurrent.turn,
        serialize: () => measureRuntimePhase(
          'persistence.serialize',
          () => serializeWorld(validCurrent),
          validCurrent.turn,
        ),
      });
      const result = await coordinator.flush('manual');
      if (result.status === 'failed') throw result.error;
      setHasSave(true);
      await refreshWorldSaves();
      setToast(`已将第 ${current.year} 年${current.season}的世界写入本地史册。`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '本地史册保存失败。');
    }
  }, [refreshWorldSaves, resetAutosaveCoordinator]);

  const handleOpenMandate = useCallback(() => {
    playback.pause();
    setMandateMessage(null);
    navigation.openLayer({ kind: 'mandate' });
    gameAudio.play('open', 0.58);
  }, [navigation, playback]);

  const handleCloseMandate = useCallback(() => {
    navigation.closeTopLayer();
    gameAudio.play('close', 0.48);
  }, [navigation]);

  const handleApplyMandate = useCallback(async (action: V03InterventionAction): Promise<boolean> => {
    const current = worldRef.current;
    if (!current || mandateBusy) return false;
    setMandateBusy(true);
    setMandateMessage(null);
    try {
      const historyLength = current.history.length;
      const next = assertValidWorld(applyV03Intervention(current, action));
      const intervention = next.history.slice(historyLength).find(isV03InterventionEvent);
      try {
        const currentBranchId = agencyShadowBranchIdRef.current;
        if (!currentBranchId) throw new Error('人物取舍分支尚未建立');
        const forked = forkAgencyShadowIntervention(
          agencyShadowLedgerRef.current,
          currentBranchId,
          current,
          next,
        );
        let nextLedger = ensureAgencyShadowCharacters(
          forked.ledger,
          forked.branchId,
          next,
          agencyTrackedCharacterIds(next, selection, observerSettingsRef.current.watchlist),
        );
        nextLedger = bindAgencyShadowRestorePoint(
          nextLedger,
          forked.branchId,
          next,
          agencyShadowRestoreToken('autosave'),
        );
        commitAgencyShadow(nextLedger, forked.branchId);
      } catch {
        resetAgencyShadowAtWorld(next);
      }
      commitWorld(next);
      commitEmbodiedObserver(reanchorEmbodimentObserverState(embodimentObserverRef.current, next));
      try {
        const flushResult = await autosaveCoordinatorRef.current?.flush('intervention');
        if (flushResult?.status === 'failed') throw flushResult.error;
        setHasSave(true);
        const interventionResult = intervention?.title ?? '有限天意已经写入世界';
        setMandateMessage({ tone: 'success', text: `${interventionResult}。分支凭证与状态差量已存入史册。` });
        setToast(`天意已落笔：${interventionResult}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : '本地史册保存失败';
        setMandateMessage({ tone: 'error', text: `天意已经生效，但自动保存失败：${reason}。请手动导出史册。` });
        setToast('天意已经生效，但本地保存失败。');
      }
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : '本次天意无法生效。';
      setMandateMessage({ tone: 'error', text: reason });
      setToast(reason);
      return false;
    } finally {
      setMandateBusy(false);
    }
  }, [commitAgencyShadow, commitEmbodiedObserver, commitWorld, mandateBusy, resetAgencyShadowAtWorld, selection]);

  const handleExport = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    try {
      const validCurrent = assertValidWorld(current);
      downloadWorld(serializeWorld(validCurrent), `沧衡纪_${validCurrent.seed}_第${validCurrent.year}年${validCurrent.season}.json`);
      setToast('已将完整世界、随机种子与因果史册导出。');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '世界未通过完整校验，无法导出。');
    }
  }, []);

  const handleOpenCollection = useCallback(async () => {
    playback.pause();
    if (startOpen) setWorldStartInitialFocus('collection');
    collectionReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    navigation.openLayer({ kind: 'collection' }, startOpen);
    gameAudio.play('open', 0.58);
    setCollectionBusy(true);
    try {
      await refreshWorldSaves();
    } catch (error) {
      setToast(error instanceof Error ? error.message : '无法读取本机世界收藏。');
    } finally {
      setCollectionBusy(false);
    }
  }, [navigation, playback, refreshWorldSaves, startOpen]);

  const handleCloseCollection = useCallback(() => {
    session.cancel('collection');
    navigation.closeTopLayer();
    gameAudio.play('close', 0.48);
  }, [navigation, session]);

  const handleSaveCurrentToCollection = useCallback(async (label: string) => {
    const current = worldRef.current;
    if (!current) throw new Error('请先开启或读取一个世界，再收藏当前分支。');
    setCollectionBusy(true);
    try {
      const validCurrent = assertValidWorld(current);
      const saves = await listWorldSaves();
      const slot = availableCollectionSlot(`world_${validCurrent.hash.slice(0, 8)}_t${validCurrent.turn}`, saves);
      await saveWorldToSlot(serializeWorld(validCurrent), slot, label);
      try {
        const currentBranchId = agencyShadowBranchIdRef.current;
        if (currentBranchId) {
          const nextLedger = bindAgencyShadowRestorePoint(
            agencyShadowLedgerRef.current,
            currentBranchId,
            validCurrent,
            agencyShadowRestoreToken(slot),
            agencyTrackedCharacterIds(validCurrent, selection, observerSettingsRef.current.watchlist),
          );
          commitAgencyShadow(nextLedger, currentBranchId);
        }
      } catch {
        // The world save is authoritative; optional observer notes must not make it fail.
      }
      await refreshWorldSaves();
      setToast(`“${label}”已存入世界收藏。`);
    } finally {
      setCollectionBusy(false);
    }
  }, [commitAgencyShadow, refreshWorldSaves, selection]);

  const handleLoadCollectionSlot = useCallback(async (slot: string) => {
    const ticket = session.begin('collection');
    try {
      const saved = await loadWorldFromSlot(slot);
      if (!session.isCurrent(ticket)) return;
      if (!saved) throw new Error('该世界槽位已经不存在。');
      // Authenticate the target before touching the current autosave. This is
      // essential for missing-map saves: a failed load must never overwrite the
      // only recoverable payload. Loading autosave itself also skips a same-slot
      // flush, otherwise the selected historical payload would be replaced.
      const restoredWorld = deserializeWorld(saved.payload);
      if (slot !== AUTOSAVE_SLOT) {
        const pendingSave = await autosaveCoordinatorRef.current?.flush('pause');
        if (!session.isCurrent(ticket)) return;
        if (pendingSave?.status === 'failed') throw pendingSave.error;
      }
      session.commit(ticket, () => {
        openWorld(restoredWorld, 'collection', agencyShadowRestoreToken(slot));
        setToast(`已读取“${saved.label ?? '世界存档'}”。`);
      });
      if (session.isCurrent(ticket)) await refreshWorldSaves();
    } finally {
      session.finish(ticket);
    }
  }, [openWorld, refreshWorldSaves, session]);

  const handleRenameCollectionSlot = useCallback(async (slot: string, label: string) => {
    setCollectionBusy(true);
    try {
      await renameWorldSlot(slot, label);
      await refreshWorldSaves();
      setToast(`世界已改名为“${label}”。`);
    } finally {
      setCollectionBusy(false);
    }
  }, [refreshWorldSaves]);

  const handleDuplicateCollectionSlot = useCallback(async (sourceSlot: string) => {
    setCollectionBusy(true);
    try {
      const saves = await listWorldSaves();
      const source = saves.find((save) => save.slot === sourceSlot && save.status !== 'corrupt');
      if (!source) throw new Error('找不到要复制的世界。');
      const baseHash = source.hash?.slice(0, 8) ?? 'branch';
      const targetSlot = availableCollectionSlot(`branch_${baseHash}_t${source.turn ?? 0}`, saves);
      const label = `${source.label.slice(0, 72)} · 分支`;
      await duplicateWorldSlot(sourceSlot, targetSlot, label);
      try {
        commitAgencyShadow(
          copyAgencyShadowRestorePoint(
            agencyShadowLedgerRef.current,
            agencyShadowRestoreToken(sourceSlot),
            agencyShadowRestoreToken(targetSlot),
          ),
          agencyShadowBranchIdRef.current,
        );
      } catch {
        // A copied world remains valid even if its optional observer note cannot be copied.
      }
      await refreshWorldSaves();
      setToast(`已从“${source.label}”复制一个独立分支。`);
    } finally {
      setCollectionBusy(false);
    }
  }, [commitAgencyShadow, refreshWorldSaves]);

  const handleDeleteCollectionSlot = useCallback(async (slot: string) => {
    setCollectionBusy(true);
    try {
      await deleteWorldSlot(slot);
      try {
        commitAgencyShadow(
          removeAgencyShadowRestorePoint(
            agencyShadowLedgerRef.current,
            agencyShadowRestoreToken(slot),
          ),
          agencyShadowBranchIdRef.current,
        );
      } catch {
        // Save deletion is complete even when optional observer notes are unavailable.
      }
      await refreshWorldSaves();
      setToast('世界槽位已从本机移除；当前正在观察的世界未改变。');
    } finally {
      setCollectionBusy(false);
    }
  }, [commitAgencyShadow, refreshWorldSaves]);

  const handleNewWorldMenu = useCallback(async (returnFocusTo?: HTMLElement | null) => {
    playback.pause();
    setWorldStartInitialFocus('primary');
    worldStartReturnFocusRef.current = returnFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const ticket = session.begin('start');
    navigation.openLayer({ kind: 'start' });
    setStartError(null);
    const current = worldRef.current;
    if (current) {
      try {
        const result = await autosaveCoordinatorRef.current?.flush('pause');
        if (!session.isCurrent(ticket)) return;
        if (result?.status === 'failed') throw result.error;
        setHasSave(true);
      } catch {
        // The in-memory world remains intact and can still be exported.
      }
    }
    session.finish(ticket);
  }, [navigation, playback, session]);

  const advanceOne = useCallback((source: ObserverAdvanceSource): boolean => {
    const current = worldRef.current;
    const primerAdvance = source === 'primer' && navigation.topLayer?.kind === 'primer';
    if (
      !current
      || advancingRef.current
      || fatalError
      || historicalView
      || (navigation.blocking && !primerAdvance)
      || (source === 'primer' && !primerAdvance)
    ) return false;
    advancingRef.current = true;
    try {
      const oldHistoryLength = current.history.length;
      const embodimentBeforeAdvance = embodimentObserverRef.current;
      const queuedEmbodiedAction = embodimentBeforeAdvance.pendingAction?.issuedTurn === current.turn
        ? embodimentBeforeAdvance.pendingAction
        : null;
      const detailed = advanceWorldDetailed(current, { embodiedAction: queuedEmbodiedAction });
      const advanced = detailed.world;
      recordRuntimeMetric('simulation.clone', detailed.timings.cloneMs, current.turn);
      recordRuntimeMetric('simulation.systems', detailed.timings.systemsMs, current.turn);
      recordRuntimeMetric('simulation.hash', detailed.timings.hashMs, current.turn);
      recordRuntimeMetric('simulation.total', detailed.timings.totalMs, current.turn);
      for (const system of SIMULATION_SYSTEM_PHASES) {
        recordRuntimeMetric(`simulation.system.${system}`, detailed.timings.systems[system], current.turn);
      }
      const next = assertValidRuntimeTurn(current, advanced);
      try {
        const currentBranchId = agencyShadowBranchIdRef.current;
        if (!currentBranchId) throw new Error('人物取舍分支尚未建立');
        const advancedShadow = advanceAgencyShadowBranch(
          agencyShadowLedgerRef.current,
          currentBranchId,
          current,
          next,
          agencyTrackedCharacterIds(current, selection, observerSettingsRef.current.watchlist),
        );
        let nextLedger = ensureAgencyShadowCharacters(
          advancedShadow.ledger,
          advancedShadow.branchId,
          next,
          agencyTrackedCharacterIds(next, selection, observerSettingsRef.current.watchlist),
        );
        nextLedger = bindAgencyShadowRestorePoint(
          nextLedger,
          advancedShadow.branchId,
          next,
          agencyShadowRestoreToken('autosave'),
          agencyTrackedCharacterIds(next, selection, observerSettingsRef.current.watchlist),
        );
        commitAgencyShadow(nextLedger, advancedShadow.branchId);
      } catch {
        resetAgencyShadowAtWorld(next);
      }
      commitWorld(next);
      const nextEmbodiment = advanceEmbodimentObserverState(
        embodimentBeforeAdvance,
        current,
        next,
      );
      commitEmbodiedObserver(nextEmbodiment);
      let embodiedActionResolved = false;
      if (queuedEmbodiedAction) {
        const resolution = [...next.facts].reverse().find((fact) => (
          fact.kind === 'embodied_action_resolved'
          && fact.payload.actionId === queuedEmbodiedAction.actionId
        ));
        if (resolution?.kind === 'embodied_action_resolved') {
          setToast(resolution.payload.resultSummary);
          embodiedActionResolved = true;
        }
      }
      if (nextEmbodiment.closure && nextEmbodiment.closure !== embodimentBeforeAdvance.closure) {
        const closureActorExists = next.characters.some((item) => item.id === nextEmbodiment.closure?.actorId);
        if (closureActorExists) {
          clearRosterDossier(); navigation.goToView('people');
          setSelection({ kind: 'person', id: nextEmbodiment.closure.actorId });
        }
      }
      const newEvents = next.history.slice(oldHistoryLength);
      const visibleNewEvents = newEvents.filter(isDefaultVisibleHistoryEvent);
      const historyCue = quarterHistoryCue(visibleNewEvents);
      const turnCue: AudioCue | null = embodiedActionResolved
        ? 'action_resolve'
        : historyCue ?? (source === 'manual' ? 'quarter' : null);
      if (turnCue) gameAudio.play(turnCue, source === 'manual' ? 0.76 : 0.5);
      const pauseCandidates = [
        ...worldToSituationPauseCandidates(next),
        ...historyEventsToPauseCandidates(newEvents),
      ];
      let nextObserverSettings = completeObserverGuideStep(observerSettingsRef.current, 'quarter-advanced');
      nextObserverSettings = applyObserverEventAlerts(nextObserverSettings, pauseCandidates);
      observerSettingsRef.current = nextObserverSettings;
      setObserverSettings(nextObserverSettings);
      const matchedPause = source === 'auto'
        ? evaluateObserverPause(nextObserverSettings, pauseCandidates)
        : null;
      setPauseMatch(matchedPause);
      if (matchedPause) {
        playback.pause();
        setToast(`${matchedPause.reason}：${matchedPause.eventTitle}。自动推演已暂停。`);
      }
      return true;
    } catch (error) {
      playback.pause();
      setFatalError(error instanceof Error ? error.message : '世界推演发生未知错误。');
      return false;
    } finally {
      advancingRef.current = false;
    }
  }, [clearRosterDossier, commitAgencyShadow, commitWorld, fatalError, historicalView, navigation, playback, resetAgencyShadowAtWorld, selection]);
  advanceRef.current = advanceOne;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.target instanceof HTMLElement && (
        event.target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target.tagName)
      )) return;
      const options = snapshotOptionsRef.current;
      if (observerLayerIsOpen(options.navigation, 'primer')) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        return;
      }
      if (observerNavigationIsBlocking(options.navigation) || options.historicalTurn !== null) return;
      if (key === 'n') {
        event.preventDefault();
        advanceRef.current('manual');
      } else if (key === ' ') {
        event.preventDefault();
        if (!fatalError) playback.toggle();
      } else if (key === 'h') {
        event.preventDefault();
        playback.pause();
        clearRosterDossier(); navigation.goToView('chronicle');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearRosterDossier, fatalError, navigation, playback]);

  useEffect(() => {
    window.render_game_to_text = () => makeTextSnapshot(worldRef.current, snapshotOptionsRef.current);
    window.advanceTime = (milliseconds: number) => {
      playback.advanceExternalClock(milliseconds);
    };
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [playback]);

  const handleToggleRunning = useCallback(() => {
    if (fatalError) {
      setToast('推演已停止；当前世界仍可保存或导出。');
      return;
    }
    if (historicalView) {
      setToast('正在回望旧季；请先“回到当下”再继续推演。');
      return;
    }
    if (navigation.blocking) {
      setToast('请先收起当前书页，再继续推演。');
      return;
    }
    setPauseMatch(null);
    gameAudio.play('select', 0.42);
    playback.toggle();
  }, [fatalError, historicalView, navigation.blocking, playback]);

  const handleSpeedChange = useCallback((nextSpeed: PlaybackSpeed) => {
    gameAudio.play('select', 0.38);
    playback.changeSpeed(nextSpeed);
  }, [playback]);

  const commitObserverSettings = useCallback((nextSettings: ObserverDeskSettings) => {
    observerSettingsRef.current = nextSettings;
    snapshotOptionsRef.current = {
      ...snapshotOptionsRef.current,
      watchedCount: nextSettings.watchlist.length,
      watchlist: nextSettings.watchlist.map((item) => ({ ...item })),
      guideCompleted: observerGuideProgress(nextSettings).completed,
    };
    setObserverSettings(nextSettings);
  }, []);

  const completeGuideStep = useCallback((step: ObserverGuideStepId) => {
    commitObserverSettings(completeObserverGuideStep(observerSettingsRef.current, step));
  }, [commitObserverSettings]);

  const openCausalEvent = useCallback((
    eventId: string,
    preserveCurrent = false,
    returnFocusTo: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  ): boolean => {
    const current = worldRef.current;
    if (!current || !findWorldHistoryEvent(current, eventId)) {
      setToast('这条史事已经不在当前可读卷页中。');
      return false;
    }
    playback.pause();
    causalReturnFocusRef.current = returnFocusTo;
    causalFocusRestoreAllowedRef.current = true;
    navigation.openEvent(eventId, preserveCurrent);
    completeGuideStep('cause-traced');
    gameAudio.play('open', 0.58);
    return true;
  }, [completeGuideStep, navigation, playback]);

  const handleOverlayChange = useCallback((nextOverlay: MapOverlay) => {
    gameAudio.play('select', 0.46);
    setOverlay(nextOverlay);
    if (selection && shouldCloseMapSelectionForOverlay(selection.kind, nextOverlay)) {
      clearRosterDossier(); setSelection(null);
      setMobileInspectorExpanded(false);
    }
    if (nextOverlay !== 'political') completeGuideStep('overlay-switched');
  }, [clearRosterDossier, completeGuideStep, selection]);

  const handleOpenMapPrimer = useCallback(() => {
    if (!worldRef.current) return;
    playback.pause();
    archiveFocusRestoreAllowedRef.current = false;
    setHistoricalView(null);
    clearRosterDossier();
    primerAdvanceDoneRef.current = false;
    primerNewestEventIdRef.current = null;
    setPrimerStep('terrain');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    navigation.reset({
      view: 'world',
      powerRosterSection,
      layers: [{ kind: 'primer' }],
    });
    gameAudio.play('open', 0.6);
  }, [clearRosterDossier, navigation, playback, powerRosterSection]);

  const handleCloseMapPrimer = useCallback((_reason: MapPrimerCloseReason) => {
    try {
      localStorage.setItem(MAP_PRIMER_STORAGE_KEY, '1');
    } catch {
      // Primer completion is a preference only; storage failures must not block the world.
    }
    navigation.closeTopLayer();
    gameAudio.play('close', 0.46);
  }, [navigation]);

  const handlePrimerAdvance = useCallback((): boolean => {
    if (primerAdvanceDoneRef.current) return false;
    const current = worldRef.current;
    if (!current) return false;
    const oldHistoryLength = current.history.length;
    if (!advanceRef.current('primer')) return false;
    primerAdvanceDoneRef.current = true;
    const next = worldRef.current;
    if (!next) return false;
    const newEvents = next.history.slice(oldHistoryLength).filter(isDefaultVisibleHistoryEvent);
    const newestMeaningful = [...newEvents].reverse().find((event) => event.importance >= 3 && event.causes.length > 0)
      ?? [...newEvents].reverse().find((event) => event.causes.length > 0)
      ?? newEvents.at(-1)
      ?? null;
    primerNewestEventIdRef.current = newestMeaningful?.id ?? null;
    return true;
  }, []);

  const handlePrimerOpenWhy = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    const eventId = primerNewestEventIdRef.current
      ?? [...current.history].reverse().find((event) => isDefaultVisibleHistoryEvent(event) && event.importance >= 3 && event.causes.length > 0)?.id
      ?? [...current.history].reverse().find(isDefaultVisibleHistoryEvent)?.id
      ?? null;
    if (!eventId) {
      setToast('这一季没有留下可追溯的重大史事，可继续推进后再查看。');
      return;
    }
    openCausalEvent(
      eventId,
      false,
      document.querySelector<HTMLCanvasElement>('.world-map__canvas'),
    );
  }, [openCausalEvent]);

  const handleViewChange = useCallback((nextView: ObserverView) => {
    if (nextView === 'chronicle') {
      playback.pause();
      gameAudio.play('open', 0.64);
    } else {
      gameAudio.play('select', 0.44);
    }
    clearRosterDossier(); navigation.goToView(nextView);
  }, [clearRosterDossier, navigation, playback]);

  const handleCloseHistoryWorkbench = useCallback(() => {
    navigation.goToView('world');
  }, [navigation]);

  const handleOpenObserverDesk = useCallback(() => {
    playback.pause();
    navigation.openLayer({ kind: 'observer-desk' });
    gameAudio.play('open', 0.58);
  }, [navigation, playback]);

  const handleCloseObserverDesk = useCallback(() => {
    navigation.closeTopLayer();
    gameAudio.play('close', 0.48);
  }, [navigation]);

  const handleOpenSettings = useCallback(() => {
    playback.pause();
    setMobileToolsOpen(false);
    navigation.openLayer({ kind: 'settings' });
    gameAudio.play('open', 0.58);
  }, [navigation, playback]);

  const handleCloseSettings = useCallback(() => {
    navigation.closeTopLayer();
    gameAudio.play('close', 0.48);
  }, [navigation]);

  const handlePreviewSound = useCallback(() => {
    void previewSound().then((ready) => {
      if (!ready) setToast('浏览器尚未允许声音，请再轻触一次试听。');
    });
  }, [previewSound]);

  const handleApplyAppUpdate = useCallback(async () => {
    playback.pause();
    const coordinator = autosaveCoordinatorRef.current;
    if (worldRef.current && coordinator) {
      const result = await coordinator.flush('pause');
      if (result.status === 'failed' || result.status === 'disposed') {
        setToast('当前世界尚未保存，暂不重载。请先手动保存后再更新。');
        return false;
      }
    }
    window.location.reload();
    return true;
  }, [playback]);

  const handleHistoricalTurnChange = useCallback((turn: number, view: HistoricalTerritoryView) => {
    const current = worldRef.current;
    playback.pause();
    setOverlay('political');
    setHistoricalView(current && turn < current.turn ? view : null);
  }, [playback]);

  const handleResetHistoricalView = useCallback(() => {
    setHistoricalView(null);
  }, []);

  const mapRegions = useMemo(() => {
    if (!world) return [];
    const current = toMapRegions(world);
    if (!historicalView) return current;
    const polities = new Map(world.polities.map((item) => [item.id, item]));
    return current.map((region) => {
      const controllerId = historicalView.controllerByRegionId[region.id];
      const owner = controllerId ? polities.get(controllerId) : undefined;
      return {
        ...region,
        polityId: owner?.id,
        polityName: owner?.name,
        polityColor: owner?.color,
      };
    });
  }, [historicalView, world]);
  const mapRoutes = useMemo(() => world ? toMapRoutes(world) : [], [world]);
  const mapArmies = useMemo(() => world && !historicalView ? toMapArmies(world) : [], [historicalView, world]);
  const mapSeaZones = useMemo(() => {
    if (!world) return [];
    const zones = toMapSeaZones(world);
    return historicalView ? zones.map((zone) => ({
      ...zone,
      controllerName: undefined,
      controllerColor: undefined,
      contested: false,
      traffic: 0,
      powerShare: 0,
    })) : zones;
  }, [historicalView, world]);
  const mapFleets = useMemo(() => world && !historicalView ? toMapFleets(world) : [], [historicalView, world]);
  const mapFlows = useMemo(() => world && !historicalView ? toMapFlows(world, overlay) : [], [historicalView, overlay, world]);
  const mapMarkers = useMemo(() => world && !historicalView
    ? toMapMarkers(world, overlay, focusedPoliticalFactionId)
    : [], [focusedPoliticalFactionId, historicalView, overlay, world]);
  const observerLeads = observerLeadProjection?.leads ?? [];
  const readableSituationCount = world ? (
    world.situationSystem.situations.filter((item) => item.status === 'open').length
    + Math.min(8, world.situationSystem.situations.filter((item) => item.status === 'resolved').length)
  ) : 0;
  const situationWorkbenchProjection = useMemo(() => (
    world && situationWorkbenchOpen
      ? projectSituationWorkbench(world, selectedSituationId)
      : null
  ), [selectedSituationId, situationWorkbenchOpen, world]);
  const rosterDirectory = useMemo(() => (
    world && (activeView === 'people' || activeView === 'powers')
      ? projectRosterDirectory(world, observerSettings.watchlist)
      : null
  ), [activeView, observerSettings.watchlist, world]);
  const activeRosterScope = rosterScopeFor(activeView, powerRosterSection);
  const rosterConfig = activeRosterScope ? rosterDirectory?.[activeRosterScope] ?? null : null;
  const powerRosterSections = rosterDirectory?.sections ?? [];
  const quarterPulseProjection = useMemo(() => (
    world ? projectQuarterPulse(world) : { stories: [], highlightedRegionIds: [] }
  ), [world]);
  const quarterHighlightedRegionIds = historicalView
    ? []
    : quarterPulseProjection.highlightedRegionIds;
  const selectedHistoryEvent = useMemo(() => (
    world && selectedEventId ? findWorldHistoryEvent(world, selectedEventId) ?? null : null
  ), [selectedEventId, world]);
  const archiveDossier = useMemo<ArchiveDossier | null>(() => {
    const subject = navigation.topLayer?.kind === 'archive' ? navigation.topLayer.subject : null;
    if (!archiveOpen || !world || !subject) return null;
    if (subject.kind === 'country') {
      const item = world.polities.find((candidate) => candidate.id === subject.id);
      return item ? toCountryArchive(world, item) : null;
    }
    if (subject.kind === 'family') {
      const item = world.families?.find((candidate) => candidate.id === subject.id);
      return item ? toFamilyArchive(world, item) : null;
    }
    if (subject.kind === 'person') {
      const item = world.characters.find((candidate) => candidate.id === subject.id);
      return item ? toPersonArchive(
        world,
        item,
        agencyDossierOptions(agencyShadowLedger, agencyShadowBranchId, item.id),
      ) : null;
    }
    return null;
  }, [agencyShadowBranchId, agencyShadowLedger, archiveOpen, navigation.topLayer, world]);

  const handlePowerRosterSectionChange = useCallback((id: string) => {
    if (id !== 'polities' && id !== 'families' && id !== 'military') return;
    gameAudio.play('select', 0.42);
    navigation.setPowerRosterSection(id);
  }, [navigation]);

  const handleCloseRoster = useCallback(() => {
    const returnTarget = activeView === 'powers'
      ? powersTriggerRef.current
      : activeView === 'people'
        ? peopleTriggerRef.current
        : null;
    clearRosterDossier(); navigation.goToView('world');
    gameAudio.play('close', 0.4);
    window.setTimeout(() => returnTarget?.focus(), 0);
  }, [activeView, clearRosterDossier, navigation]);

  const handleRosterSelect = useCallback((id: string) => {
    const current = worldRef.current;
    if (!current) return;
    gameAudio.play('select', 0.48);
    setMobileInspectorExpanded(Boolean(beginRosterDossier(id)));
    if (activeView === 'powers' && powerRosterSection === 'polities') {
      setSelection({ kind: 'country', id });
      return;
    }
    if (activeView === 'powers' && powerRosterSection === 'families') {
      setSelection({ kind: 'family', id });
      return;
    }
    if (activeView === 'people') {
      setSelection({ kind: 'person', id });
      return;
    }
    if (activeView === 'powers' && powerRosterSection === 'military') {
      const army = current.armies.find((item) => item.id === id);
      const fleet = current.fleets.find((item) => item.id === id);
      setFocusedArmyId(id);
      if (army) setSelection({ kind: 'army', id: army.id });
      else if (fleet) setSelection({ kind: 'fleet', id: fleet.id });
      return;
    }
  }, [activeView, beginRosterDossier, powerRosterSection]);

  const handleSelectArchiveEntity = useCallback((kind: ArchiveEntityKind, id: string) => {
    gameAudio.play('select', 0.44);
    setSelection({ kind, id });
    navigation.closeAllLayers();
    if (rosterDossierReturn) return; clearRosterDossier();
    if (kind === 'country' || kind === 'family') {
      navigation.goToView('powers', kind === 'country' ? 'polities' : 'families');
    } else {
      navigation.goToView(kind === 'person' ? 'people' : 'world');
    }
  }, [clearRosterDossier, navigation, rosterDossierReturn]);

  const handleSelectArchiveLink = useCallback((kind: ArchiveEntityKind, id: string) => {
    archiveFocusRestoreAllowedRef.current = false;
    handleSelectArchiveEntity(kind, id);
    window.setTimeout(() => {
      const inspector = document.querySelector<HTMLElement>('.observer-inspector');
      const rosterReturn = inspector?.querySelector<HTMLButtonElement>('[data-inspector-return="roster"]');
      (rosterReturn ?? inspector)?.focus({ preventScroll: true });
    }, 0);
  }, [handleSelectArchiveEntity]);

  const handleSelectNarrativeEntity = useCallback((kind: ArchiveEntityKind, id: string) => {
    archiveFocusRestoreAllowedRef.current = false;
    causalFocusRestoreAllowedRef.current = false;
    situationFocusRestoreAllowedRef.current = false;
    clearRosterDossier();
    setSelection({ kind, id });
    setMobileInspectorExpanded(true);
    navigation.reset({ view: 'world', powerRosterSection, layers: [] });
    gameAudio.play('select', 0.44);
    window.setTimeout(() => document.querySelector<HTMLElement>('.observer-inspector')?.focus({ preventScroll: true }), 0);
  }, [clearRosterDossier, navigation, powerRosterSection]);

  const handleSelectScopedEvent = useCallback((eventId: string) => {
    gameAudio.play('open', 0.58);
    archiveFocusRestoreAllowedRef.current = false;
    openCausalEvent(eventId, archiveOpen || situationWorkbenchOpen);
  }, [archiveOpen, openCausalEvent, situationWorkbenchOpen]);

  const shouldRestoreSituationFocus = useCallback(() => situationFocusRestoreAllowedRef.current, []);

  const handleOpenSituationWorkbench = useCallback((
    preferredSituationId: string | null = null,
    returnFocusTo: HTMLElement | null = null,
  ) => {
    const current = worldRef.current;
    if (!current || current.situationSystem.situations.length === 0) return;
    situationReturnFocusRef.current = returnFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    situationFocusRestoreAllowedRef.current = true;
    const projection = projectSituationWorkbench(current, preferredSituationId);
    if (!projection.selectedId || !projection.selected) return;
    playback.pause();
    navigation.openLayer({ kind: 'situations', situationId: projection.selectedId });
    gameAudio.play('open', 0.64);
  }, [navigation, playback]);

  const handleRosterReasonSelect = useCallback((reason: RosterReason) => {
    if (reason.target.kind === 'event') {
      handleSelectScopedEvent(reason.target.id);
      return;
    }
    if (reason.target.kind === 'situation') {
      handleOpenSituationWorkbench(reason.target.id);
      return;
    }
    handleRosterSelect(reason.target.id);
  }, [handleOpenSituationWorkbench, handleRosterSelect, handleSelectScopedEvent]);

  const handleCloseSituationWorkbench = useCallback(() => {
    situationFocusRestoreAllowedRef.current = true;
    navigation.closeTopLayer();
    gameAudio.play('close', 0.48);
  }, [navigation]);

  const handleSelectSituationEntity = useCallback((kind: ArchiveEntityKind, id: string) => {
    situationFocusRestoreAllowedRef.current = false;
    handleSelectNarrativeEntity(kind, id);
  }, [handleSelectNarrativeEntity]);

  const handleSelectSituationHistory = useCallback((eventId: string) => {
    situationFocusRestoreAllowedRef.current = false;
    openCausalEvent(eventId, true);
  }, [openCausalEvent]);

  const handleEnterEmbodiment = useCallback((characterId: string) => {
    const current = worldRef.current;
    const character = current?.characters.find((item) => item.id === characterId && item.alive);
    if (!current || !character) {
      setToast('此人已经无法入世。');
      return;
    }
    playback.pause();
    const nextState = enterEmbodimentObserverState(embodimentObserverRef.current, current, character.id);
    if (!nextState) {
      setToast('此人已经无法入世。');
      return;
    }
    commitEmbodiedObserver(nextState);
    gameAudio.play('open', 0.48);
  }, [commitEmbodiedObserver, playback]);

  const handleLeaveEmbodiment = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    const pending = embodimentObserverRef.current.pendingAction;
    commitEmbodiedObserver(leaveEmbodimentObserverState(embodimentObserverRef.current, current));
    if (pending) setToast('已回到观察者视角；此前定下的本季行动仍会照常结算。');
  }, [commitEmbodiedObserver]);

  const handleChooseEmbodiedAction = useCallback((actionId: string) => {
    const current = worldRef.current;
    const actorId = embodimentObserverRef.current.activeActor?.id ?? null;
    if (!current || !actorId) return;
    const option = projectCharacterEmbodiedActions(current, actorId).find((item) => item.command.actionId === actionId);
    if (!option?.available) {
      setToast(option?.unavailableReason ?? '此事眼下已经不能进行。');
      return;
    }
    playback.pause();
    const nextState = queueEmbodiedObserverAction(embodimentObserverRef.current, current, option.command);
    if (!nextState) {
      setToast('此事眼下已经不能进行。');
      return;
    }
    commitEmbodiedObserver(nextState);
    gameAudio.play('action_submit', 0.72);
  }, [commitEmbodiedObserver, playback]);

  const handleCancelEmbodiedAction = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    commitEmbodiedObserver(cancelEmbodiedObserverAction(embodimentObserverRef.current, current));
  }, [commitEmbodiedObserver]);

  const handleDismissEmbodimentClosure = useCallback(() => {
    commitEmbodiedObserver(dismissEmbodimentClosure(embodimentObserverRef.current));
  }, [commitEmbodiedObserver]);

  const toggleObserverWatchItem = useCallback((item: ObserverWatchItem) => {
    const key = observerWatchKey(item.kind, item.id);
    const watched = observerSettingsRef.current.watchlist.some((entry) => (
      observerWatchKey(entry.kind, entry.id) === key
    ));
    commitObserverSettings(watched
      ? removeObserverWatch(observerSettingsRef.current, item.kind, item.id)
      : upsertObserverWatch(observerSettingsRef.current, item));
    gameAudio.play('select', 0.5);
    setToast(watched
      ? `已取消关注：${item.label}`
      : item.kind === 'situation'
        ? `已关注局势：${item.label}。有重要转折或结案时，推演会停下。`
        : `已关注：${item.label}。有新动向时，推演会停下。`);
  }, [commitObserverSettings]);

  const closeInspectorToMap = useCallback(() => {
    const rosterTarget = returnToRoster();
    gameAudio.play('close', 0.38);
    setSelection(null);
    setMobileInspectorExpanded(false);
    if (rosterTarget) {
      navigation.goToView(rosterTarget.view, rosterTarget.section ?? undefined);
      return;
    }
    window.setTimeout(() => {
      document.querySelector<HTMLCanvasElement>('.world-map__canvas')?.focus({ preventScroll: true });
    }, 0);
  }, [navigation, returnToRoster]);

  const handleShowFactionRoots = useCallback((factionId: string) => {
    const current = worldRef.current;
    const faction = current?.factions.find((item) => item.id === factionId && item.active);
    if (!current || !faction) {
      setToast('这支派系已退出当下朝局，舆图上没有可追踪的根基。');
      return;
    }
    const rootCount = toMapMarkers(current, 'political', factionId)
      .filter((marker) => marker.kind === 'powerRoot').length;
    setFocusedPoliticalFactionId(factionId);
    setOverlay('political');
    clearRosterDossier(); setSelection(null);
    setMobileInspectorExpanded(false);
    navigation.goToView('world');
    setToast(rootCount
      ? `舆图已标出${faction.name}的 ${rootCount} 处实权根基。`
      : `${faction.name}本季只有中枢影响，没有可落在舆图上的州治或军令。`);
    gameAudio.play('open', 0.48);
    window.setTimeout(() => document.querySelector<HTMLCanvasElement>('.world-map__canvas')?.focus({ preventScroll: true }), 0);
  }, [clearRosterDossier, navigation]);

  const handleOpenCourtFaction = useCallback((target: CourtFactionTarget, expand = true) => {
    const current = worldRef.current;
    const faction = current?.factions.find((item) => item.id === target.factionId && item.active && item.polityId === target.polityId);
    if (!current?.polities.some((item) => item.id === target.polityId && item.alive) || !faction) {
      setToast('这支派系已退出当下朝局，未替你改选别派。');
      return;
    }
    courtFocusRequestRef.current += 1;
    const courtFocus = { ...target, requestKey: courtFocusRequestRef.current };
    archiveFocusRestoreAllowedRef.current = false; causalFocusRestoreAllowedRef.current = false; situationFocusRestoreAllowedRef.current = false;
    clearRosterDossier(); setMobileInspectorExpanded(expand);
    setSelection({ kind: 'country', id: target.polityId, initialTab: 'court', tabRequestKey: courtFocus.requestKey, courtFocus });
    navigation.reset({ view: 'world', powerRosterSection, layers: [] });
    gameAudio.play('open', 0.48);
  }, [clearRosterDossier, navigation, powerRosterSection]);

  const inspector = useMemo<ReactNode>(() => {
    if (!world || !selection) return null;
    const followKey = `${selection.kind}:${selection.id}`;
    const shared = {
      isFollowing: followed.has(followKey),
      onToggleFollow: () => {
        const item = watchItemForSelection(world, selection);
        if (!item) return;
        toggleObserverWatchItem(item);
      },
      onClose: closeInspectorToMap,
      entrySource: rosterDossierReturn ? 'roster' as const : undefined, returnToOrigin: rosterDossierEntry, returnLabel: activeView === 'people' ? '返回人物名录' : '返回势力名录',
      mobileExpanded: mobileInspectorExpanded,
      onMobileExpandedChange: setMobileInspectorExpanded,
      onOpenArchive: selection.kind === 'country' || selection.kind === 'family' || selection.kind === 'person' ? () => {
        archiveReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        archiveFocusRestoreAllowedRef.current = true;
        playback.pause();
        navigation.openLayer({ kind: 'archive', subject: selection });
        gameAudio.play('open', 0.62);
      } : undefined,
      onSelectEntity: handleSelectArchiveEntity,
      onSelectEvent: handleSelectScopedEvent,
      onSelectCourtFaction: handleOpenCourtFaction,
    };
    if (selection.kind === 'region') {
      const item = world.regions.find((candidate) => candidate.id === selection.id);
      return item ? <Inspector kind="region" data={toRegionInspector(world, item)} {...shared} /> : null;
    }
    if (selection.kind === 'country') {
      const item = world.polities.find((candidate) => candidate.id === selection.id);
      return item ? <Inspector
        kind="country"
        data={toCountryInspector(world, item)}
        initialTab={selection.initialTab}
        tabRequestKey={selection.tabRequestKey}
        courtFocus={selection.courtFocus}
        onShowFactionRoots={handleShowFactionRoots}
        {...shared}
      /> : null;
    }
    if (selection.kind === 'family') {
      const item = world.families?.find((candidate) => candidate.id === selection.id);
      return item ? <Inspector kind="family" data={toFamilyInspector(world, item)} {...shared} /> : null;
    }
    if (selection.kind === 'person') {
      const item = world.characters.find((candidate) => candidate.id === selection.id);
      return item ? <Inspector
        kind="person"
        data={toPersonInspector(
          world,
          item,
          agencyDossierOptions(agencyShadowLedger, agencyShadowBranchId, item.id),
        )}
        embodiment={projectPersonEmbodimentView(
          world,
          item.id,
          embodiedCharacterId,
          pendingEmbodiedAction,
          embodimentObserver.closure,
        )}
        onEnterEmbodiment={() => handleEnterEmbodiment(item.id)}
        onLeaveEmbodiment={handleLeaveEmbodiment}
        onChooseEmbodiedAction={handleChooseEmbodiedAction}
        onCancelEmbodiedAction={handleCancelEmbodiedAction}
        onDismissEmbodimentClosure={handleDismissEmbodimentClosure}
        {...shared}
      /> : null;
    }
    const system = toSystemInspector(world, selection.kind, selection.id);
    return system ? <Inspector kind="system" data={system} {...shared} /> : null;
  }, [
    activeView,
    agencyShadowBranchId,
    agencyShadowLedger,
    closeInspectorToMap,
    embodiedCharacterId,
    embodimentObserver.closure,
    followed,
    handleCancelEmbodiedAction,
    handleChooseEmbodiedAction,
    handleEnterEmbodiment,
    handleDismissEmbodimentClosure,
    handleLeaveEmbodiment,
    handleOpenCourtFaction,
    handleShowFactionRoots,
    handleSelectArchiveEntity,
    handleSelectScopedEvent,
    mobileInspectorExpanded,
    navigation,
    pendingEmbodiedAction,
    playback,
    rosterDossierEntry,
    rosterDossierReturn,
    selection,
    toggleObserverWatchItem,
    world,
  ]);

  const selectQuarterEvent = useCallback((eventId: string) => {
    openCausalEvent(eventId);
  }, [openCausalEvent]);

  const selectQuarterLedger = useCallback((ledger: QuarterPulseLedger) => {
    handleOverlayChange(ledger === 'population' ? 'population' : ledger === 'food' ? 'food' : 'trade');
    const current = worldRef.current;
    if (!current?.lastTurn) return;
    const reportIds = new Set(current.lastTurn.eventIds);
    const summary = [...current.history].reverse().find((event) => (
      reportIds.has(event.id) && event.kind === 'quarter_summary'
    ));
    if (summary) selectQuarterEvent(summary.id);
    else setToast('本季总账已经显示，史册尚未生成独立总账条目。');
  }, [handleOverlayChange, selectQuarterEvent]);

  const inspectEvidence = useCallback((factor: CausalFactor) => {
    if (factor.evidence) setToast(`凭证：${factor.evidence}`);
  }, []);

  const handleSelectWatchItem = useCallback((item: ObserverWatchItem) => {
    if (item.kind === 'situation') {
      const current = worldRef.current;
      if (!current?.situationSystem.situations.some((situation) => situation.id === item.id)) {
        navigation.closeTopLayer();
        setPauseMatch(null);
        setToast('这条局势已折入冷档案，当前卷宗不再保留可展开正文。');
        return;
      }
      setPauseMatch(null);
      handleOpenSituationWorkbench(item.id, observerDeskTriggerRef.current);
      return;
    }
    const current = worldRef.current;
    const nextSelection = { kind: item.kind, id: item.id } as Selection;
    if (!current || !selectedEntityLabel(current, nextSelection)) {
      navigation.closeTopLayer();
      setPauseMatch(null);
      setToast(`“${item.label}”已退出当下舆图；关注记录仍保留在观察台。`);
      return;
    }
    if (item.kind === 'army' || item.kind === 'fleet') setFocusedArmyId(item.id);
    clearRosterDossier(); setSelection(nextSelection);
    if (item.kind === 'country' || item.kind === 'family') {
      navigation.goToView('powers', item.kind === 'country' ? 'polities' : 'families');
    } else {
      navigation.goToView(item.kind === 'person' ? 'people' : 'world');
    }
    setPauseMatch(null);
  }, [clearRosterDossier, handleOpenSituationWorkbench, navigation]);

  const handleInspectObserverLead = useCallback((lead: ObserverLead) => {
    setPauseMatch(null);
    setOverlay(lead.overlay);
    clearRosterDossier();
    if (lead.situationId) {
      setSelection(null);
      handleOpenSituationWorkbench(lead.situationId);
      return;
    }
    setSelection(lead.target);
    navigation.goToView('world');
    gameAudio.play('select', 0.52);
  }, [clearRosterDossier, handleOpenSituationWorkbench, navigation]);

  const handleToggleObserverLead = useCallback((lead: ObserverLead) => {
    const current = worldRef.current;
    if (!current) return;
    const item = lead.situationId
      ? watchItemForSituation(current, lead.situationId)
      : watchItemForSelection(current, lead.target);
    if (!item) return;
    toggleObserverWatchItem(item);
  }, [toggleObserverWatchItem]);

  const handleToggleSelectedSituation = useCallback(() => {
    const current = worldRef.current;
    if (!current || !selectedSituationId) return;
    const item = watchItemForSituation(current, selectedSituationId);
    if (item) toggleObserverWatchItem(item);
  }, [selectedSituationId, toggleObserverWatchItem]);

  const handleSelectPauseMatch = useCallback((match: ObserverPauseMatch) => {
    if (!match.situationId) return;
    commitObserverSettings(setObserverWatchAlert(
      observerSettingsRef.current,
      'situation',
      match.situationId,
      false,
    ));
    handleOpenSituationWorkbench(match.situationId, observerDeskTriggerRef.current);
  }, [commitObserverSettings, handleOpenSituationWorkbench]);

  const handleGuideAction = useCallback((step: ObserverGuideStepId) => {
    const current = worldRef.current;
    if (!current) return;
    if (step === 'world-opened') {
      completeGuideStep(step);
      return;
    }
    if (step === 'quarter-advanced') {
      navigation.closeTopLayer();
      requestAnimationFrame(() => advanceRef.current('manual'));
      return;
    }
    if (step === 'overlay-switched') {
      handleOverlayChange('trade');
      navigation.closeTopLayer();
      return;
    }
    if (step === 'cause-traced') {
      const event = [...current.history].reverse().find(isDefaultVisibleHistoryEvent);
      if (event) {
        openCausalEvent(event.id);
      }
      return;
    }
    const target = selection ?? (current.regions[0] ? { kind: 'region' as const, id: current.regions[0].id } : null);
    if (!target) return;
    const item = watchItemForSelection(current, target);
    if (!item) return;
    commitObserverSettings(upsertObserverWatch(observerSettingsRef.current, item));
    clearRosterDossier(); setSelection(target);
    navigation.goToView('world');
  }, [clearRosterDossier, commitObserverSettings, completeGuideStep, handleOverlayChange, navigation, openCausalEvent, selection]);

  const mandateTarget = useMemo<MandateTarget | null>(() => {
    if (!world || !selection) return null;
    if (selection.kind === 'country') {
      const polity = world.polities.find((item) => item.id === selection.id && item.alive);
      return polity ? { id: polity.id, kind: 'country', name: polity.name, detail: `合法性 ${Math.round(polity.legitimacy)} · 仅可微调三点` } : null;
    }
    if (selection.kind === 'person') {
      const character = world.characters.find((item) => item.id === selection.id && item.alive);
      return character ? { id: character.id, kind: 'person', name: character.name, detail: `${character.role} · 影响 ${Math.round(character.influence)} · 声望 ${Math.round(character.renown)}` } : null;
    }
    if (selection.kind === 'region') {
      const region = world.regions.find((item) => item.id === selection.id);
      return region ? { id: region.id, kind: 'region', name: region.name, detail: `人口 ${compact.format(region.population)} · 破坏 ${Math.round(region.devastation)}` } : null;
    }
    return null;
  }, [selection, world]);
  const mandateAvailable = world ? availableMandate(world) : 0;
  const latestIntervention = world ? [...world.history].reverse().find(isV03InterventionEvent) ?? null : null;
  const mandateUsedThisTurn = Boolean(world && latestIntervention?.turn === world.turn);

  const totalPopulation = world ? worldPopulation(world) : 0;
  const activeWarCount = world?.wars.filter((item) => item.active).length ?? 0;
  const livingPolityCount = world?.polities.filter((item) => item.alive).length ?? 0;
  const lowSupplyCount = world?.armies.filter((item) => item.supply < 45 || item.morale < 40).length ?? 0;
  const guideProgress = observerGuideProgress(observerSettings);
  const currentCollectionSlot = world
    ? worldSaves.find((save) => save.status === 'ready' && save.hash === world.hash)?.slot
    : undefined;
  const namedWorldSaveCount = worldSaves.filter((save) => !save.isAutosave).length;
  const handleCloseCausalEvent = useCallback(() => {
    const parent = navigation.state.layers.at(-2);
    if (parent?.kind === 'archive') archiveFocusRestoreAllowedRef.current = true;
    if (parent?.kind === 'situations') situationFocusRestoreAllowedRef.current = true;
    navigation.closeTopLayer();
  }, [navigation]);
  const handleSelectSituation = useCallback((situationId: string) => {
    const current = worldRef.current;
    if (!current?.situationSystem.situations.some((item) => item.id === situationId)) return;
    navigation.replaceTopLayer({ kind: 'situations', situationId });
  }, [navigation]);
  const handleCancelWorldStart = useCallback(() => {
    session.cancel('start');
    navigation.closeTopLayer();
  }, [navigation, session]);
  const rosterSelectedId = activeView === 'powers' && powerRosterSection === 'polities' && selection?.kind === 'country'
    ? selection.id
    : activeView === 'powers' && powerRosterSection === 'families' && selection?.kind === 'family'
      ? selection.id
    : activeView === 'people' && selection?.kind === 'person'
      ? selection.id
      : activeView === 'powers' && powerRosterSection === 'military'
        ? focusedArmyId
        : activeView === 'chronicle'
          ? selectedEventId
          : null;

  return (
    <>
      {world ? (
        <main
          ref={worldShellRef}
          className="observer-app"
          data-inspector-open={Boolean(inspector)}
          data-mobile-inspector-mode={inspector ? mobileInspectorExpanded ? 'full' : 'quick' : 'closed'}
          data-audio-invitation-open={audioInvitationVisible || undefined}
          data-map-gesture-active={mapGestureActive || undefined}
          data-focus-open={activeView === 'world' && !historicalView && !inspector || undefined}
          data-motion={interfaceSettings.motion}
          data-interface-density={interfaceSettings.interfaceDensity}
          data-map-atmosphere={interfaceSettings.mapAtmosphere || undefined}
          aria-hidden={navigation.blocking || undefined}
        >
          <TopBar
            title="沧衡纪"
            eraName="初元"
            year={world.year}
            season={world.season}
            turn={world.turn}
            isRunning={running}
            speed={speed}
            canAdvance={!fatalError && !historicalView && !navigation.blocking}
            onToggleRunning={handleToggleRunning}
            onAdvance={() => advanceOne('manual')}
            onSpeedChange={handleSpeedChange}
          />

          <NavigationRail
            activeView={activeView}
            activeOverlay={overlay}
            militaryAlertCount={activeWarCount + lowSupplyCount}
            powersTriggerRef={powersTriggerRef}
            peopleTriggerRef={peopleTriggerRef}
            historyTriggerRef={historyTriggerRef}
            onViewChange={handleViewChange}
            onOverlayChange={handleOverlayChange}
          />

          <section
            className="observer-stage"
            aria-label="世界观察舆图"
            data-historical-turn={historicalView?.turn ?? undefined}
          >
            <WorldMap
              mapContentVersion={world.mapContentVersion}
              regions={mapRegions}
              routes={mapRoutes}
              armies={mapArmies}
              seaZones={mapSeaZones}
              fleets={mapFleets}
              flows={mapFlows}
              markers={mapMarkers}
              highlightedRegionIds={quarterHighlightedRegionIds}
              highlightEpoch={world.lastTurn?.turn ?? -1}
              selectedRegionId={selection?.kind === 'region' ? selection.id : null}
              selectedObject={selection && selection.kind !== 'region' && selection.kind !== 'family' && selection.kind !== 'person' ? selection : null}
              overlay={historicalView ? 'political' : overlay}
              cameraKey={mapCameraKey}
              onCameraChange={setMapCamera}
              onLodChange={setMapLod}
              onGestureActivityChange={setMapGestureActive}
              mobileQuickLookOpen={Boolean(inspector) && !mobileInspectorExpanded}
              season={historicalView?.season ?? world.season}
              atmosphereEnabled={interfaceSettings.mapAtmosphere}
              motionReduced={interfaceSettings.motion === 'reduced'}
              politicalFocusPolityId={world.factions.find((item) => item.id === focusedPoliticalFactionId)?.polityId ?? null}
              politicalFocusFactionId={focusedPoliticalFactionId}
              onSelectBlank={closeInspectorToMap}
              onSelectRegion={(id) => {
                gameAudio.play('select', 0.46);
                setMobileToolsOpen(false);
                setMobileInspectorExpanded(false);
                clearRosterDossier(); setSelection({ kind: 'region', id });
                navigation.goToView('world');
              }}
              onSelectObject={(kind, id, marker) => {
                gameAudio.play('select', 0.52);
                setMobileToolsOpen(false);
                setMobileInspectorExpanded(false);
                if (kind === 'army' || kind === 'fleet') setFocusedArmyId(id);
                if (kind === 'country' && marker?.factionId) { handleOpenCourtFaction({ polityId: id, factionId: marker.factionId }, false); return; }
                if (kind === 'country') courtFocusRequestRef.current += 1;
                clearRosterDossier(); setSelection(kind === 'country'
                  ? { kind, id, initialTab: 'court', tabRequestKey: courtFocusRequestRef.current }
                  : { kind, id });
                navigation.goToView('world');
              }}
            />

            <div className="observer-world-summary" aria-label="世界总览">
              <span><small>天下人口</small><strong>{compact.format(totalPopulation)}</strong></span>
              <span><small>当代政权</small><strong>{livingPolityCount}</strong></span>
              <span data-alert={activeWarCount > 0 || undefined}><small>进行中战事</small><strong>{activeWarCount}</strong></span>
            </div>

            {guideProgress.completed < guideProgress.total ? (
              <button
                ref={primerTriggerRef}
                type="button"
                className="observer-map-primer-trigger"
                data-map-primer-trigger="true"
                onClick={handleOpenMapPrimer}
                aria-label="打开三步读图导览"
                title="三步读图"
              >
                <MapIcon size={14} strokeWidth={1.6} aria-hidden="true" />
                <span>读图</span>
              </button>
            ) : null}

            <div ref={mobileToolsRef} className="observer-world-tools" data-mobile-more-open={mobileToolsOpen || undefined} aria-label="世界与存档工具">
              <button
                ref={observerDeskTriggerRef}
                type="button"
                data-observer-desk-trigger="true"
                data-alert={observerSettings.watchlist.some((item) => item.alert) || appUpdate.phase === 'available' || undefined}
                onClick={() => {
                  setMobileToolsOpen(false);
                  handleOpenObserverDesk();
                }}
                aria-label={appUpdate.phase === 'available'
                  ? `打开观察台，发现新版本${appUpdate.remoteVersion ? ` v${appUpdate.remoteVersion}` : ''}`
                  : `打开观察台，关注${observerSettings.watchlist.length}项`}
                title={appUpdate.phase === 'available'
                  ? `观察台 · 发现${appUpdate.remoteVersion ? ` v${appUpdate.remoteVersion}` : '新版本'}`
                  : `观察台 · ${observerSettings.watchlist.length}项关注`}
              >
                <Eye size={16} aria-hidden="true" />
              </button>
              <span className="observer-world-tools__rule" aria-hidden="true" />
              <button
                ref={mandateTriggerRef}
                type="button"
                data-mandate-trigger="true"
                data-mandate-available={mandateAvailable}
                onClick={() => {
                  setMobileToolsOpen(false);
                  handleOpenMandate();
                }}
                aria-label={mandateUsedThisTurn ? '打开天意，本季已经干预' : `打开天意，本季可用${mandateAvailable}点`}
                title={mandateUsedThisTurn ? '本季天意已用' : `天意 · ${mandateAvailable}点`}
              >
                <Sparkles size={16} aria-hidden="true" />
              </button>
              <button
                ref={settingsTriggerRef}
                type="button"
                data-settings-trigger="true"
                data-audio-state={settingsAudioState}
                data-audio-unset={!interfaceSettings.sound.promptDismissed || undefined}
                onClick={handleOpenSettings}
                aria-label={`打开设置，${interfaceSettings.sound.enabled
                  ? settingsAudioState === 'ready' ? '声音已开启' : '声音等待轻触'
                  : '声音尚未开启'}`}
                title={interfaceSettings.sound.enabled ? '设置 · 声音已开启' : '设置 · 声音尚未开启'}
              >
                <Settings2 size={16} aria-hidden="true" />
                <span className="observer-world-tools__audio-state" aria-hidden="true">
                  {interfaceSettings.sound.enabled
                    ? <Volume2 size={9} />
                    : <VolumeX size={9} />}
                </span>
              </button>
              <button
                ref={mobileToolsTriggerRef}
                type="button"
                className="observer-world-tools__more"
                aria-label={mobileToolsOpen ? '收起更多工具' : '打开更多工具'}
                aria-expanded={mobileToolsOpen}
                onClick={() => setMobileToolsOpen((current) => !current)}
              >
                <MoreHorizontal size={17} aria-hidden="true" />
              </button>
              <div className="observer-world-tools__secondary">
                <span className="observer-world-tools__rule" aria-hidden="true" />
                <button
                  ref={collectionTriggerRef}
                  type="button"
                  data-world-collection-trigger="true"
                  onClick={() => {
                    setMobileToolsOpen(false);
                    handleOpenCollection();
                  }}
                  aria-label={`打开世界收藏，现有${namedWorldSaveCount}个命名世界`}
                  title={`世界收藏 · ${namedWorldSaveCount}`}
                >
                  <Library size={16} aria-hidden="true" />
                </button>
                <span className="observer-world-tools__rule" aria-hidden="true" />
                <button type="button" onClick={() => { setMobileToolsOpen(false); handleManualSave(); }} aria-label="保存当前世界" title="保存当前世界">
                  <Save size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => { setMobileToolsOpen(false); handleExport(); }} aria-label="导出完整史册" title="导出完整史册">
                  <Download size={16} aria-hidden="true" />
                </button>
                <span className="observer-world-tools__rule" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => {
                    const returnFocusTo = mobileToolsOpen
                      ? mobileToolsTriggerRef.current
                      : document.activeElement instanceof HTMLElement
                        ? document.activeElement
                        : null;
                    setMobileToolsOpen(false);
                    handleNewWorldMenu(returnFocusTo);
                  }}
                  aria-label="返回世界书页"
                  title="新纪、续读或导入"
                >
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <AudioInvitation
              open={audioInvitationVisible}
              onEnable={enableSound}
              onDismiss={dismissSoundInvitation}
            />

            <div className="observer-world-signature" aria-label="确定性世界签名">
              <span>SEED {world.seed}</span>
              <strong>{world.hash}</strong>
            </div>

            {historicalView ? (
              <aside className="observer-history-lens" role="status" aria-label="历史舆图正在显示">
                <div>
                  <span>历史舆图 · 只读</span>
                  <strong>第 {historicalView.year} 年 · {historicalView.season}季</strong>
                  <small>
                    距今 {world.turn - historicalView.turn} 季 · {historicalView.extantPolities.length} 个政权 ·
                    {historicalView.confidence === 'complete' ? ' 差量链完整' : ' 差量链有缺页'} · 档案仍为当下
                  </small>
                </div>
                <button type="button" onClick={() => handleViewChange('chronicle')}>查阅史册</button>
                <button type="button" onClick={handleResetHistoricalView}>回到当下</button>
              </aside>
            ) : null}

            {rosterConfig ? (
              <RosterPanel
                title={rosterConfig.title}
                eyebrow={rosterConfig.eyebrow}
                items={rosterConfig.items}
                definition={rosterConfig.definition}
                state={rosterDiscovery.states[rosterConfig.scope]}
                onStateChange={(nextState) => rosterDiscovery.update(rosterConfig.scope, nextState)}
                visibleCount={rosterDiscovery.visibleCounts[rosterConfig.scope]} onShowMore={() => rosterDiscovery.showMore(rosterConfig.scope)}
                selectedId={rosterSelectedId}
                emptyMessage={rosterConfig.emptyMessage}
                searchPlaceholder={rosterConfig.searchPlaceholder}
                onSelect={handleRosterSelect}
                onReasonSelect={handleRosterReasonSelect}
                onClose={handleCloseRoster} suspended={Boolean(rosterDossierReturn && inspector)}
                escapeBlocked={Boolean(rosterDossierEntry && inspector)}
                sections={activeView === 'powers' ? powerRosterSections : undefined}
                activeSection={activeView === 'powers' ? powerRosterSection : undefined}
                onSectionChange={activeView === 'powers' ? handlePowerRosterSectionChange : undefined}
              />
            ) : null}

            {fatalError ? (
              <div className="observer-fatal" role="alert">
                <strong>推演已停止</strong>
                <p>{fatalError}当前世界仍可保存或导出，不会继续写入错误状态。</p>
              </div>
            ) : null}
          </section>

          {activeView === 'world' && !historicalView && !inspector ? (
            <ObserverLeads
              leads={observerLeads}
              watchedKeys={followed}
              selectedKey={selection ? `${selection.kind}:${selection.id}` : null}
              situationCount={readableSituationCount}
              onInspect={handleInspectObserverLead}
              onToggleWatch={handleToggleObserverLead}
              onOpenSituations={handleOpenSituationWorkbench}
            />
          ) : null}

          {inspector}

          <QuarterPulse
            key={world.lastTurn?.turn ?? 'unwritten'}
            report={world.lastTurn}
            stories={quarterPulseProjection.stories} compact={Boolean(inspector) && mobileInspectorExpanded && compactRosterDossier}
            onSelectEvent={selectQuarterEvent}
            onSelectSituation={handleOpenSituationWorkbench}
            onSelectLedger={selectQuarterLedger}
          />

        </main>
      ) : (
        <main className="observer-boot-underlay" aria-hidden="true" />
      )}

      <CausalDrawer
        open={Boolean(selectedHistoryEvent)}
        event={world && selectedHistoryEvent ? toCausalEvent(world, selectedHistoryEvent) : null}
        onClose={handleCloseCausalEvent}
        returnFocusTo={causalReturnFocusRef.current}
        shouldRestoreFocus={shouldRestoreCausalFocus}
        onInspectEvidence={inspectEvidence}
        onSelectReference={(reference: CausalReference) => {
          archiveFocusRestoreAllowedRef.current = false;
          causalFocusRestoreAllowedRef.current = false;
          situationFocusRestoreAllowedRef.current = false;
          handleSelectNarrativeEntity(reference.kind, reference.id);
        }}
        onSelectSubject={(kind, id) => {
          archiveFocusRestoreAllowedRef.current = false;
          causalFocusRestoreAllowedRef.current = false;
          situationFocusRestoreAllowedRef.current = false;
          handleSelectNarrativeEntity(kind, id);
        }}
        onSelectCourtFaction={handleOpenCourtFaction}
      />

      <MapPrimer
        open={primerOpen && Boolean(world)}
        currentStep={primerStep}
        onStep={setPrimerStep}
        onClose={handleCloseMapPrimer}
        onSelectOverlay={handleOverlayChange}
        onAdvance={handlePrimerAdvance}
        onOpenWhy={handlePrimerOpenWhy}
        returnFocusTo={primerTriggerRef.current}
      />

      <HistoricalArchive
        open={archiveOpen && Boolean(archiveDossier)}
        dossier={archiveDossier}
        onClose={() => {
          archiveFocusRestoreAllowedRef.current = true;
          navigation.closeTopLayer();
        }}
        onSelectEntity={handleSelectArchiveLink}
        onSelectEvent={handleSelectScopedEvent}
        returnFocusTo={archiveReturnFocusRef.current}
        shouldRestoreFocus={shouldRestoreArchiveFocus}
      />

      <MandatePanel
        open={mandateOpen && Boolean(world)}
        available={mandateAvailable}
        usedThisTurn={mandateUsedThisTurn}
        target={mandateTarget}
        busy={mandateBusy}
        message={mandateMessage}
        recentIntervention={latestIntervention ? {
          title: latestIntervention.title,
          date: `第 ${latestIntervention.year} 年 · ${latestIntervention.season}`,
        } : null}
        onApply={handleApplyMandate}
        onClose={handleCloseMandate}
        returnFocusTo={mandateTriggerRef.current}
      />

      {world ? (
        <HistoryWorkbench
          open={historyWorkbenchOpen}
          world={world}
          turn={historicalView?.turn ?? world.turn}
          onSelectEvent={(eventId) => {
            openCausalEvent(eventId, true);
          }}
          onTurnChange={handleHistoricalTurnChange}
          onClose={handleCloseHistoryWorkbench}
          onReset={handleResetHistoricalView}
          returnFocusTo={historyTriggerRef.current}
        />
      ) : null}

      <SituationWorkbench
        open={situationWorkbenchOpen}
        projection={situationWorkbenchProjection}
        onClose={handleCloseSituationWorkbench}
        onSelectSituation={handleSelectSituation}
        onSelectEntity={handleSelectSituationEntity}
        onSelectHistoryEvent={handleSelectSituationHistory}
        onSelectCourtFaction={handleOpenCourtFaction}
        isWatched={Boolean(selectedSituationId && followed.has(`situation:${selectedSituationId}`))}
        onToggleWatch={handleToggleSelectedSituation}
        returnFocusTo={situationReturnFocusRef.current}
        shouldRestoreFocus={shouldRestoreSituationFocus}
      />

      <ObserverDesk
        open={observerDeskOpen && Boolean(world)}
        settings={observerSettings}
        onSettingsChange={commitObserverSettings}
        onClose={handleCloseObserverDesk}
        onSelectWatchItem={handleSelectWatchItem}
        onGuideAction={handleGuideAction}
        pauseMatch={pauseMatch}
        onSelectPauseMatch={handleSelectPauseMatch}
        returnFocusTo={observerDeskTriggerRef.current}
        appUpdate={appUpdate}
        onCheckUpdate={() => checkForAppUpdate(true)}
        onApplyUpdate={handleApplyAppUpdate}
      />

      <SettingsPanel
        open={settingsOpen && Boolean(world)}
        settings={interfaceSettings}
        audioState={settingsAudioState}
        fullscreen={fullscreen}
        onSettingsChange={commitInterfaceSettings}
        onPreviewSound={handlePreviewSound}
        onToggleFullscreen={handleFullscreen}
        onClose={handleCloseSettings}
        returnFocusTo={settingsTriggerRef.current}
      />

      <WorldCollectionPanel
        open={collectionOpen}
        saves={worldSaves}
        currentSlot={currentCollectionSlot}
        busy={collectionBusy || collectionSessionBusy}
        canSaveCurrent={Boolean(world)}
        onLoad={handleLoadCollectionSlot}
        onDelete={handleDeleteCollectionSlot}
        onRename={handleRenameCollectionSlot}
        onDuplicate={handleDuplicateCollectionSlot}
        onSaveCurrent={handleSaveCurrentToCollection}
        onClose={handleCloseCollection}
        returnFocusTo={collectionReturnFocusRef.current}
      />

      <WorldStart
        open={startOpen && !collectionOpen}
        seed={seed}
        selectedMapProfileId={selectedMapProfileId}
        onSelectMapProfile={setSelectedMapProfileId}
        hasSave={hasSave}
        busy={startBusy}
        error={startError}
        onSeedChange={setSeed}
        onCreate={handleCreate}
        onContinue={handleContinue}
        onOpenCollection={handleOpenCollection}
        collectionCount={namedWorldSaveCount}
        onImport={handleImport}
        onCancel={world ? handleCancelWorldStart : undefined}
        initialFocus={worldStartInitialFocus}
        returnFocusTo={worldStartReturnFocusRef.current}
        shouldRestoreFocus={() => navigation.state.layers.length === 0}
      />
      {toast ? <div className="observer-toast" role="status">{toast}</div> : null}
    </>
  );
}
