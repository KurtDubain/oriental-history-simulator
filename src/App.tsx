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
  observerLeadWatchKey,
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
import { RosterPanel, type RosterSection } from './components/RosterPanel';
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
  isV03InterventionEvent,
  serializeWorld,
  measureRuntimeValidation,
  projectCharacterEmbodiedActions,
  SIMULATION_SYSTEM_PHASES,
  validateWorld,
  type V03InterventionAction,
  type WorldState,
} from './sim';
import {
  DEFAULT_MAP_PROFILE_ID,
  getMapProfileForContentVersion,
  type MapProfileId,
} from './maps';
import {
  familyRoster,
  militaryRoster,
  peopleRoster,
  polityRoster,
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
  OBSERVER_DESK_STORAGE_KEY,
  applyObserverEventAlerts,
  completeObserverGuideStep,
  createObserverDeskSettings,
  evaluateObserverPause,
  historyEventToPauseCandidate,
  observerGuideProgress,
  observerWatchKey,
  parseObserverDeskSettings,
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
  restoreEmbodimentObserverState,
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
import type {
  PowerRosterSection,
  Selection,
  SnapshotOptions,
} from './view/observer-shell-contract';
import { shouldShowObserverSoundInvitation } from './view/observer-interface-settings';
import { useObserverInterface } from './view/use-observer-interface';
import './styles/app.css';

type AdvanceSource = 'manual' | 'auto';
type OpenWorldSource = 'create' | 'continue' | 'import' | 'collection';

const DEFAULT_SEED = '沧衡-甲子';
const BASE_AUTOPLAY_INTERVAL = 1_800;
const MAP_PRIMER_STORAGE_KEY = 'canghai-map-primer-complete-v1';

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
const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

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

function observerStorageKey(seed: string, mapContentVersion?: string): string {
  const worldKey = mapContentVersion
    ? `${encodeURIComponent(mapContentVersion)}:${encodeURIComponent(seed)}`
    : encodeURIComponent(seed);
  return `${OBSERVER_DESK_STORAGE_KEY}:${worldKey}`;
}

function supportsLegacyObserverStorage(mapContentVersion: string): boolean {
  return getMapProfileForContentVersion(mapContentVersion)
    .compatibility.legacyPartialRegionVersions.length > 0;
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
  const [startOpen, setStartOpen] = useState(true);
  const [hasSave, setHasSave] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [activeView, setActiveView] = useState<ObserverView>('world');
  const [powerRosterSection, setPowerRosterSection] = useState<PowerRosterSection>('polities');
  const [overlay, setOverlay] = useState<MapOverlay>('political');
  const [mapCamera, setMapCamera] = useState<MapCamera>(() => ({ ...DEFAULT_MAP_CAMERA }));
  const [mapLod, setMapLod] = useState<MapLodLevel>('overview');
  const [mobileInspectorExpanded, setMobileInspectorExpanded] = useState(false);
  const [mapGestureActive, setMapGestureActive] = useState(false);
  const [mapCameraKey, setMapCameraKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [focusedArmyId, setFocusedArmyId] = useState<string | null>(null);
  const [primerOpen, setPrimerOpen] = useState(false);
  const [primerStep, setPrimerStep] = useState<MapPrimerStep>('terrain');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [resumeArchiveAfterEvent, setResumeArchiveAfterEvent] = useState(false);
  const [mandateOpen, setMandateOpen] = useState(false);
  const [mandateBusy, setMandateBusy] = useState(false);
  const [mandateMessage, setMandateMessage] = useState<MandateMessage | null>(null);
  const [observerDeskOpen, setObserverDeskOpen] = useState(false);
  const [situationWorkbenchOpen, setSituationWorkbenchOpen] = useState(false);
  const [selectedSituationId, setSelectedSituationId] = useState<string | null>(null);
  const [resumeSituationAfterEvent, setResumeSituationAfterEvent] = useState(false);
  const [observerSettings, setObserverSettings] = useState<ObserverDeskSettings>(() => createObserverDeskSettings());
  const followed = useMemo(
    () => new Set(observerSettings.watchlist.map((item) => observerWatchKey(item.kind, item.id))),
    [observerSettings.watchlist],
  );
  const [pauseMatch, setPauseMatch] = useState<ObserverPauseMatch | null>(null);
  const [historicalView, setHistoricalView] = useState<HistoricalTerritoryView | null>(null);
  const [resumeHistoryAfterEvent, setResumeHistoryAfterEvent] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [worldSaves, setWorldSaves] = useState<WorldSaveSummary[]>([]);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agencyShadowLedger, setAgencyShadowLedger] = useState<AgencyShadowLedger>(() => createAgencyShadowLedger());
  const [agencyShadowBranchId, setAgencyShadowBranchId] = useState<string | null>(null);
  const [embodimentObserver, setEmbodimentObserver] = useState<EmbodimentObserverState>(() => createEmbodimentObserverState());
  const embodiedCharacterId = embodimentObserver.activeActor?.id ?? null;
  const pendingEmbodiedAction = embodimentObserver.pendingAction;
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
    || overlay === 'conflict'
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
  });

  const worldRef = useRef<WorldState | null>(null);
  const worldShellRef = useRef<HTMLElement>(null);
  const runningRef = useRef(false);
  const speedRef = useRef<PlaybackSpeed>(1);
  const clockAccumulatorRef = useRef(0);
  const externalClockUntilRef = useRef(0);
  const advancingRef = useRef(false);
  const archiveReturnFocusRef = useRef<HTMLElement | null>(null);
  const archiveFocusRestoreAllowedRef = useRef(false);
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
  const observerSettingsRef = useRef(observerSettings);
  const advanceRef = useRef<(source: AdvanceSource) => boolean>(() => false);
  const primerAdvanceDoneRef = useRef(false);
  const primerNewestEventIdRef = useRef<string | null>(null);
  const reactCommitStartedAtRef = useRef<{ startedAt: number; turn: number } | null>(null);
  const autosaveCoordinatorRef = useRef<AutosaveCoordinator | null>(null);
  const agencyShadowLedgerRef = useRef(agencyShadowLedger);
  const agencyShadowBranchIdRef = useRef<string | null>(agencyShadowBranchId);
  const embodimentObserverRef = useRef<EmbodimentObserverState>(embodimentObserver);
  const shouldRestoreArchiveFocus = useCallback(() => archiveFocusRestoreAllowedRef.current, []);
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
    startOpen,
    selectedMapProfileId,
    running,
    speed,
    view: activeView,
    powerRosterSection,
    overlay,
    selection,
    selectedEventId,
    archiveOpen,
    mandateOpen,
    observerDeskOpen,
    settingsOpen,
    interfaceSettings,
    audioState: settingsAudioState,
    fullscreen,
    historyWorkbenchOpen: activeView === 'chronicle',
    situationWorkbenchOpen,
    selectedSituationId,
    observerLeadProjection,
    historicalTurn: historicalView?.turn ?? null,
    watchedCount: observerSettings.watchlist.length,
    watchlist: observerSettings.watchlist.map((item) => ({ ...item })),
    guideCompleted: observerGuideProgress(observerSettings).completed,
    pauseReason: pauseMatch?.reason ?? null,
    pauseRule: pauseMatch?.rule ?? null,
    pauseSituationId: pauseMatch?.situationId ?? null,
    pauseSituationTrigger: pauseMatch?.situationTrigger ?? null,
    collectionOpen,
    worldSaveCount: worldSaves.length,
    primerOpen,
    primerStep,
    mapCamera,
    mapLod,
    mobileInspectorExpanded,
    mapGestureActive,
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
    worldShellRef.current.inert = startOpen || archiveOpen || mandateOpen || observerDeskOpen || settingsOpen || situationWorkbenchOpen || collectionOpen || primerOpen || activeView === 'chronicle';
  }, [activeView, archiveOpen, collectionOpen, mandateOpen, observerDeskOpen, primerOpen, settingsOpen, situationWorkbenchOpen, startOpen, world]);

  const openWorld = useCallback((
    nextWorld: WorldState,
    source: OpenWorldSource,
    restoreToken: string | null = null,
  ) => {
    resetRuntimePerformanceMetrics();
    const validWorld = assertValidWorld(nextWorld);
    resetAutosaveCoordinator(source === 'continue' ? validWorld.turn : 0);
    const defaultRegionId = validWorld.regions.find((region) => (
      validWorld.polities.some((polity) => polity.alive && polity.capitalRegionId === region.id)
    ))?.id ?? validWorld.regions[0]?.id;
    let restoredObserver = createObserverDeskSettings();
    try {
      const currentObserver = localStorage.getItem(
        observerStorageKey(validWorld.seed, validWorld.mapContentVersion),
      );
      const legacyObserver = supportsLegacyObserverStorage(validWorld.mapContentVersion)
        ? localStorage.getItem(observerStorageKey(validWorld.seed))
        : null;
      restoredObserver = parseObserverDeskSettings(currentObserver ?? legacyObserver);
    } catch {
      // Continue with safe defaults when localStorage is unavailable.
    }
    restoredObserver = completeObserverGuideStep(restoredObserver, 'world-opened');
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
    let restoredEmbodiment = createEmbodimentObserverState(validWorld);
    if (source === 'continue' || source === 'collection') {
      try {
        restoredEmbodiment = restoreEmbodimentObserverState(
          validWorld,
          localStorage.getItem(
            embodimentObserverStorageKey(validWorld.seed, validWorld.mapContentVersion),
          ) ?? (
            supportsLegacyObserverStorage(validWorld.mapContentVersion)
              ? localStorage.getItem(embodimentObserverStorageKey(validWorld.seed))
              : null
          ),
        );
      } catch {
        restoredEmbodiment = createEmbodimentObserverState(validWorld);
      }
    }
    commitWorld(validWorld, source === 'continue' || source === 'collection' ? 'restore' : 'reset');
    commitEmbodiedObserver(restoredEmbodiment);
    setSeed(validWorld.seed);
    setSelectedMapProfileId(getMapProfileForContentVersion(validWorld.mapContentVersion).id);
    const compactViewport = window.matchMedia('(max-width: 760px)').matches;
    const restoredPersonId = restoredEmbodiment.activeActor?.id
      ?? (restoredEmbodiment.closure
        && validWorld.characters.some((item) => item.id === restoredEmbodiment.closure?.actorId)
        ? restoredEmbodiment.closure.actorId
        : null);
    setSelection(restoredPersonId
      ? { kind: 'person', id: restoredPersonId }
      : source !== 'create' && !compactViewport && defaultRegionId
        ? { kind: 'region', id: defaultRegionId }
        : null);
    setSelectedEventId(null);
    setArchiveOpen(false);
    setMandateOpen(false);
    setObserverDeskOpen(false);
    setSettingsOpen(false);
    setSituationWorkbenchOpen(false);
    setSelectedSituationId(null);
    setResumeSituationAfterEvent(false);
    setCollectionOpen(false);
    setMandateMessage(null);
    setResumeArchiveAfterEvent(false);
    archiveFocusRestoreAllowedRef.current = false;
    setFocusedArmyId(null);
    setPauseMatch(null);
    setHistoricalView(null);
    setResumeHistoryAfterEvent(false);
    setPowerRosterSection('polities');
    setActiveView(restoredPersonId ? 'people' : 'world');
    setOverlay('political');
    setMapCamera({ ...DEFAULT_MAP_CAMERA });
    setMapCameraKey((current) => current + 1);
    setStartOpen(false);
    setStartError(null);
    setFatalError(null);
    let primerPreviouslyCompleted = false;
    try {
      primerPreviouslyCompleted = localStorage.getItem(MAP_PRIMER_STORAGE_KEY) === '1';
    } catch {
      // If preferences cannot be read, showing the short primer is the safer first-run behavior.
    }
    primerAdvanceDoneRef.current = false;
    primerNewestEventIdRef.current = null;
    setPrimerStep('terrain');
    setPrimerOpen(source === 'create' && validWorld.turn === 0 && !primerPreviouslyCompleted);
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
  }, [commitAgencyShadow, commitEmbodiedObserver, commitWorld, resetAgencyShadowAtWorld, resetAutosaveCoordinator]);

  const handleCreate = useCallback(async () => {
    setStartBusy(true);
    setStartError(null);
    try {
      const nextWorld = createWorld(seed.trim(), selectedMapProfileId);
      const saves = await listWorldSaves();
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
        await refreshWorldSaves();
        setToast('已先把缺少地图的自动续写收藏留底，原世界没有丢失。');
      }
      openWorld(nextWorld, 'create');
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '无法创建世界。');
    } finally {
      setStartBusy(false);
    }
  }, [openWorld, refreshWorldSaves, seed, selectedMapProfileId]);

  const handleContinue = useCallback(async () => {
    setStartBusy(true);
    setStartError(null);
    try {
      const saved = await loadWorld();
      if (!saved) throw new Error('没有找到可续读的本地史册。');
      openWorld(deserializeWorld(saved.payload), 'continue', agencyShadowRestoreToken('autosave'));
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '无法读取本地史册。');
    } finally {
      setStartBusy(false);
    }
  }, [openWorld]);

  const handleImport = useCallback(async (file: File) => {
    setStartBusy(true);
    setStartError(null);
    try {
      const payload = await readWorldFile(file);
      openWorld(deserializeWorld(payload), 'import');
      setToast('已导入史册，因果记录与世界状态均已恢复。');
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '该文件无法作为史册读取。');
    } finally {
      setStartBusy(false);
    }
  }, [openWorld]);

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
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSelectedEventId(null);
    setMandateMessage(null);
    setMandateOpen(true);
    gameAudio.play('open', 0.58);
  }, []);

  const handleCloseMandate = useCallback(() => {
    setMandateOpen(false);
    gameAudio.play('close', 0.48);
    window.setTimeout(() => mandateTriggerRef.current?.focus(), 0);
  }, []);

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
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSelectedEventId(null);
    collectionReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setCollectionOpen(true);
    gameAudio.play('open', 0.58);
    setCollectionBusy(true);
    try {
      await refreshWorldSaves();
    } catch (error) {
      setToast(error instanceof Error ? error.message : '无法读取本机世界收藏。');
    } finally {
      setCollectionBusy(false);
    }
  }, [refreshWorldSaves]);

  const handleCloseCollection = useCallback(() => {
    setCollectionOpen(false);
    gameAudio.play('close', 0.48);
    requestAnimationFrame(() => {
      const trigger = collectionTriggerRef.current
        ?? document.querySelector<HTMLElement>('#open-world-collection');
      trigger?.focus({ preventScroll: true });
    });
  }, []);

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
    setCollectionBusy(true);
    try {
      const saved = await loadWorldFromSlot(slot);
      if (!saved) throw new Error('该世界槽位已经不存在。');
      // Authenticate the target before touching the current autosave. This is
      // essential for missing-map saves: a failed load must never overwrite the
      // only recoverable payload. Loading autosave itself also skips a same-slot
      // flush, otherwise the selected historical payload would be replaced.
      const restoredWorld = deserializeWorld(saved.payload);
      if (slot !== AUTOSAVE_SLOT) {
        const pendingSave = await autosaveCoordinatorRef.current?.flush('pause');
        if (pendingSave?.status === 'failed') throw pendingSave.error;
      }
      openWorld(restoredWorld, 'collection', agencyShadowRestoreToken(slot));
      setToast(`已读取“${saved.label ?? '世界存档'}”。`);
      await refreshWorldSaves();
    } finally {
      setCollectionBusy(false);
    }
  }, [openWorld, refreshWorldSaves]);

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

  const handleNewWorldMenu = useCallback(async () => {
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    const current = worldRef.current;
    if (current) {
      try {
        const result = await autosaveCoordinatorRef.current?.flush('pause');
        if (result?.status === 'failed') throw result.error;
        setHasSave(true);
      } catch {
        // The in-memory world remains intact and can still be exported.
      }
    }
    setSettingsOpen(false);
    setStartOpen(true);
    setStartError(null);
  }, []);

  const advanceOne = useCallback((source: AdvanceSource): boolean => {
    const current = worldRef.current;
    if (!current || advancingRef.current) return false;
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
          setActiveView('people');
          setSelection({ kind: 'person', id: nextEmbodiment.closure.actorId });
        }
      }
      const newEvents = next.history.slice(oldHistoryLength);
      const historyCue = quarterHistoryCue(newEvents);
      const turnCue: AudioCue | null = embodiedActionResolved
        ? 'action_resolve'
        : historyCue ?? (source === 'manual' ? 'quarter' : null);
      if (turnCue) gameAudio.play(turnCue, source === 'manual' ? 0.76 : 0.5);
      const pauseCandidates = [
        ...worldToSituationPauseCandidates(next),
        ...newEvents.map(historyEventToPauseCandidate),
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
        runningRef.current = false;
        setRunning(false);
        clockAccumulatorRef.current = 0;
        setToast(`${matchedPause.reason}：${matchedPause.eventTitle}。自动推演已暂停。`);
      }
      return true;
    } catch (error) {
      runningRef.current = false;
      setRunning(false);
      setFatalError(error instanceof Error ? error.message : '世界推演发生未知错误。');
      return false;
    } finally {
      advancingRef.current = false;
    }
  }, [commitAgencyShadow, commitWorld, resetAgencyShadowAtWorld, selection]);
  advanceRef.current = advanceOne;

  const driveClock = useCallback((milliseconds: number) => {
    if (!runningRef.current || milliseconds <= 0) return;
    clockAccumulatorRef.current += Math.min(milliseconds, 60_000);
    let steps = 0;
    while (runningRef.current && steps < 32) {
      const interval = BASE_AUTOPLAY_INTERVAL / speedRef.current;
      if (clockAccumulatorRef.current < interval) break;
      clockAccumulatorRef.current -= interval;
      if (!advanceRef.current('auto')) break;
      steps += 1;
    }
  }, [commitEmbodiedObserver]);

  useEffect(() => {
    let animationFrame = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(250, Math.max(0, now - lastTime));
      lastTime = now;
      if (now >= externalClockUntilRef.current) driveClock(elapsed);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [driveClock]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.target instanceof HTMLElement && (
        event.target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target.tagName)
      )) return;
      const options = snapshotOptionsRef.current;
      if (options.primerOpen) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        return;
      }
      if (
        options.startOpen
        || options.archiveOpen
        || options.mandateOpen
        || options.observerDeskOpen
        || options.settingsOpen
        || options.situationWorkbenchOpen
        || options.collectionOpen
        || options.historyWorkbenchOpen
        || options.historicalTurn !== null
        || options.selectedEventId
      ) return;
      if (key === 'n') {
        event.preventDefault();
        advanceRef.current('manual');
      } else if (key === ' ') {
        event.preventDefault();
        setRunning((current) => {
          const next = !current;
          runningRef.current = next;
          if (!next) clockAccumulatorRef.current = 0;
          return next;
        });
      } else if (key === 'h') {
        event.preventDefault();
        runningRef.current = false;
        setRunning(false);
        clockAccumulatorRef.current = 0;
        setActiveView('chronicle');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    window.render_game_to_text = () => makeTextSnapshot(worldRef.current, snapshotOptionsRef.current);
    window.advanceTime = (milliseconds: number) => {
      externalClockUntilRef.current = performance.now() + 1_000;
      driveClock(Math.max(0, milliseconds));
    };
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [driveClock]);

  const handleToggleRunning = useCallback(() => {
    if (historicalView) {
      setToast('正在回望旧季；请先“归还当下”再继续推演。');
      return;
    }
    setPauseMatch(null);
    gameAudio.play('select', 0.42);
    setRunning((current) => {
      const next = !current;
      runningRef.current = next;
      if (!next) clockAccumulatorRef.current = 0;
      return next;
    });
  }, [historicalView]);

  const handleSpeedChange = useCallback((nextSpeed: PlaybackSpeed) => {
    gameAudio.play('select', 0.38);
    speedRef.current = nextSpeed;
    setSpeed(nextSpeed);
  }, []);

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

  const handleOverlayChange = useCallback((nextOverlay: MapOverlay) => {
    gameAudio.play('select', 0.46);
    setOverlay(nextOverlay);
    if (selection && shouldCloseMapSelectionForOverlay(selection.kind, nextOverlay)) {
      setSelection(null);
      setMobileInspectorExpanded(false);
    }
    if (nextOverlay !== 'political') completeGuideStep('overlay-switched');
  }, [completeGuideStep, selection]);

  const handleOpenMapPrimer = useCallback(() => {
    if (!worldRef.current) return;
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSelectedEventId(null);
    setArchiveOpen(false);
    setMandateOpen(false);
    setObserverDeskOpen(false);
    setCollectionOpen(false);
    setResumeArchiveAfterEvent(false);
    setResumeHistoryAfterEvent(false);
    archiveFocusRestoreAllowedRef.current = false;
    setHistoricalView(null);
    setActiveView('world');
    primerAdvanceDoneRef.current = false;
    primerNewestEventIdRef.current = null;
    setPrimerStep('terrain');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setPrimerOpen(true);
    gameAudio.play('open', 0.6);
  }, []);

  const handleCloseMapPrimer = useCallback((_reason: MapPrimerCloseReason) => {
    try {
      localStorage.setItem(MAP_PRIMER_STORAGE_KEY, '1');
    } catch {
      // Primer completion is a preference only; storage failures must not block the world.
    }
    setPrimerOpen(false);
    gameAudio.play('close', 0.46);
  }, []);

  const handlePrimerAdvance = useCallback(() => {
    if (primerAdvanceDoneRef.current) return;
    const current = worldRef.current;
    if (!current) return;
    const oldHistoryLength = current.history.length;
    if (!advanceRef.current('manual')) return;
    primerAdvanceDoneRef.current = true;
    const next = worldRef.current;
    if (!next) return;
    const newEvents = next.history.slice(oldHistoryLength);
    const newestMeaningful = [...newEvents].reverse().find((event) => event.importance >= 3 && event.causes.length > 0)
      ?? [...newEvents].reverse().find((event) => event.causes.length > 0)
      ?? newEvents.at(-1)
      ?? null;
    primerNewestEventIdRef.current = newestMeaningful?.id ?? null;
  }, []);

  const handlePrimerOpenWhy = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    const eventId = primerNewestEventIdRef.current
      ?? [...current.history].reverse().find((event) => event.importance >= 3 && event.causes.length > 0)?.id
      ?? current.history.at(-1)?.id
      ?? null;
    if (!eventId) {
      setToast('这一季没有留下可追溯的重大史事，可继续推进后再查看。');
      return;
    }
    completeGuideStep('cause-traced');
    setResumeArchiveAfterEvent(false);
    setResumeHistoryAfterEvent(false);
    setSelectedEventId(eventId);
  }, [completeGuideStep]);

  const handleViewChange = useCallback((nextView: ObserverView) => {
    if (nextView === 'chronicle') {
      runningRef.current = false;
      setRunning(false);
      clockAccumulatorRef.current = 0;
      setSelectedEventId(null);
      gameAudio.play('open', 0.64);
    } else {
      gameAudio.play('select', 0.44);
    }
    setActiveView(nextView);
  }, []);

  const handleCloseHistoryWorkbench = useCallback(() => {
    setActiveView('world');
    window.setTimeout(() => historyTriggerRef.current?.focus(), 0);
  }, []);

  const handleOpenObserverDesk = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSelectedEventId(null);
    setObserverDeskOpen(true);
    gameAudio.play('open', 0.58);
  }, []);

  const handleCloseObserverDesk = useCallback(() => {
    setObserverDeskOpen(false);
    gameAudio.play('close', 0.48);
    window.setTimeout(() => observerDeskTriggerRef.current?.focus(), 0);
  }, []);

  const handleOpenSettings = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSelectedEventId(null);
    setMobileToolsOpen(false);
    setSettingsOpen(true);
    gameAudio.play('open', 0.58);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    gameAudio.play('close', 0.48);
    window.setTimeout(() => settingsTriggerRef.current?.focus(), 0);
  }, []);

  const handlePreviewSound = useCallback(() => {
    void previewSound().then((ready) => {
      if (!ready) setToast('浏览器尚未允许声音，请再轻触一次试听。');
    });
  }, [previewSound]);

  const handleApplyAppUpdate = useCallback(async () => {
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
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
  }, []);

  const handleHistoricalTurnChange = useCallback((turn: number, view: HistoricalTerritoryView) => {
    const current = worldRef.current;
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setOverlay('political');
    setHistoricalView(current && turn < current.turn ? view : null);
  }, []);

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
  const mapMarkers = useMemo(() => world && !historicalView ? toMapMarkers(world, overlay) : [], [historicalView, overlay, world]);
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
  const polityItems = useMemo(() => world ? polityRoster(world) : [], [world]);
  const familyItems = useMemo(() => world ? familyRoster(world) : [], [world]);
  const peopleItems = useMemo(() => world ? peopleRoster(world) : [], [world]);
  const militaryItems = useMemo(() => world ? militaryRoster(world) : [], [world]);
  const powerMilitaryAlertCount = useMemo(() => world
    ? world.wars.filter((item) => item.active).length
      + world.armies.filter((item) => item.supply < 45 || item.morale < 40).length
    : 0, [world]);
  const powerRosterSections = useMemo<readonly RosterSection[]>(() => [
    { id: 'polities', label: '列国', count: polityItems.length },
    { id: 'families', label: '世家', count: familyItems.length },
    {
      id: 'military',
      label: '军旅',
      count: militaryItems.length,
      alertCount: powerMilitaryAlertCount,
    },
  ], [familyItems.length, militaryItems.length, polityItems.length, powerMilitaryAlertCount]);
  const quarterPulseProjection = useMemo(() => (
    world ? projectQuarterPulse(world) : { stories: [], highlightedRegionIds: [] }
  ), [world]);
  const quarterHighlightedRegionIds = historicalView
    ? []
    : quarterPulseProjection.highlightedRegionIds;
  const selectedHistoryEvent = useMemo(() => (
    world && selectedEventId ? world.history.find((event) => event.id === selectedEventId) ?? null : null
  ), [selectedEventId, world]);
  const archiveDossier = useMemo<ArchiveDossier | null>(() => {
    if (!world || !selection) return null;
    if (selection.kind === 'country') {
      const item = world.polities.find((candidate) => candidate.id === selection.id);
      return item ? toCountryArchive(world, item) : null;
    }
    if (selection.kind === 'family') {
      const item = world.families?.find((candidate) => candidate.id === selection.id);
      return item ? toFamilyArchive(world, item) : null;
    }
    if (selection.kind === 'person') {
      const item = world.characters.find((candidate) => candidate.id === selection.id);
      return item ? toPersonArchive(
        world,
        item,
        agencyDossierOptions(agencyShadowLedger, agencyShadowBranchId, item.id),
      ) : null;
    }
    return null;
  }, [agencyShadowBranchId, agencyShadowLedger, selection, world]);

  const rosterConfig = useMemo(() => {
    if (activeView === 'powers' && powerRosterSection === 'polities') return {
      title: '天下列国', eyebrow: '势力诸卷 · 政权根基', items: polityItems, emptyMessage: '天下已无成形政权。', searchPlaceholder: '检索国号、君主或都城',
    };
    if (activeView === 'powers' && powerRosterSection === 'families') return {
      title: '天下世家', eyebrow: '势力诸卷 · 门第传承', items: familyItems, emptyMessage: '尚无被谱牒记名的家族。', searchPlaceholder: '检索家名、家主或门望',
    };
    if (activeView === 'people') return {
      title: '时人群像', eyebrow: '声望与所图', items: peopleItems, emptyMessage: '暂无可记名人物。', searchPlaceholder: '检索姓名、身份或所图',
    };
    if (activeView === 'powers' && powerRosterSection === 'military') return {
      title: '天下军旅', eyebrow: '势力诸卷 · 兵力军需', items: militaryItems, emptyMessage: '天下暂无宏观军团。', searchPlaceholder: '检索军号、主帅或驻地',
    };
    return null;
  }, [activeView, familyItems, militaryItems, peopleItems, polityItems, powerRosterSection]);

  const handlePowerRosterSectionChange = useCallback((id: string) => {
    if (id !== 'polities' && id !== 'families' && id !== 'military') return;
    gameAudio.play('select', 0.42);
    setPowerRosterSection(id);
  }, []);

  const handleCloseRoster = useCallback(() => {
    const returnTarget = activeView === 'powers'
      ? powersTriggerRef.current
      : activeView === 'people'
        ? peopleTriggerRef.current
        : null;
    setActiveView('world');
    gameAudio.play('close', 0.4);
    window.setTimeout(() => returnTarget?.focus(), 0);
  }, [activeView]);

  const handleRosterSelect = useCallback((id: string) => {
    const current = worldRef.current;
    if (!current) return;
    gameAudio.play('select', 0.48);
    const closeCompactRoster = () => {
      if (window.matchMedia('(max-width: 780px)').matches) setActiveView('world');
    };
    if (activeView === 'powers' && powerRosterSection === 'polities') {
      setSelection({ kind: 'country', id });
      closeCompactRoster();
      return;
    }
    if (activeView === 'powers' && powerRosterSection === 'families') {
      setSelection({ kind: 'family', id });
      closeCompactRoster();
      return;
    }
    if (activeView === 'people') {
      setSelection({ kind: 'person', id });
      closeCompactRoster();
      return;
    }
    if (activeView === 'powers' && powerRosterSection === 'military') {
      const army = current.armies.find((item) => item.id === id);
      const fleet = current.fleets.find((item) => item.id === id);
      setFocusedArmyId(id);
      if (army) setSelection({ kind: 'army', id: army.id });
      else if (fleet) setSelection({ kind: 'fleet', id: fleet.id });
      closeCompactRoster();
      return;
    }
    if (activeView === 'chronicle') setSelectedEventId(id);
  }, [activeView, powerRosterSection]);

  const handleSelectArchiveEntity = useCallback((kind: ArchiveEntityKind, id: string) => {
    gameAudio.play('select', 0.44);
    setSelectedEventId(null);
    setSelection({ kind, id });
    if (kind === 'country' || kind === 'family') {
      setPowerRosterSection(kind === 'country' ? 'polities' : 'families');
      setActiveView('powers');
    } else {
      setActiveView(kind === 'person' ? 'people' : 'world');
    }
  }, []);

  const handleSelectScopedEvent = useCallback((eventId: string) => {
    gameAudio.play('open', 0.58);
    archiveFocusRestoreAllowedRef.current = false;
    setResumeSituationAfterEvent(false);
    setResumeArchiveAfterEvent(archiveOpen);
    setArchiveOpen(false);
    setSelectedEventId(eventId);
    completeGuideStep('cause-traced');
  }, [archiveOpen, completeGuideStep]);

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
    const projection = projectSituationWorkbench(current, preferredSituationId ?? selectedSituationId);
    setSelectedSituationId(projection.selectedId);
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSituationWorkbenchOpen(true);
    setResumeSituationAfterEvent(false);
    gameAudio.play('open', 0.64);
  }, [selectedSituationId]);

  const handleCloseSituationWorkbench = useCallback(() => {
    situationFocusRestoreAllowedRef.current = true;
    setSituationWorkbenchOpen(false);
    setResumeSituationAfterEvent(false);
    gameAudio.play('close', 0.48);
  }, []);

  const handleSelectSituationEntity = useCallback((kind: ArchiveEntityKind, id: string) => {
    situationFocusRestoreAllowedRef.current = false;
    setSituationWorkbenchOpen(false);
    setResumeSituationAfterEvent(false);
    handleSelectArchiveEntity(kind, id);
  }, [handleSelectArchiveEntity]);

  const handleSelectSituationHistory = useCallback((eventId: string) => {
    situationFocusRestoreAllowedRef.current = false;
    setSituationWorkbenchOpen(false);
    setResumeSituationAfterEvent(true);
    setResumeArchiveAfterEvent(false);
    setResumeHistoryAfterEvent(false);
    setSelectedEventId(eventId);
    completeGuideStep('cause-traced');
  }, [completeGuideStep]);

  const handleEnterEmbodiment = useCallback((characterId: string) => {
    const current = worldRef.current;
    const character = current?.characters.find((item) => item.id === characterId && item.alive);
    if (!current || !character) {
      setToast('此人已经无法入世。');
      return;
    }
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    const nextState = enterEmbodimentObserverState(embodimentObserverRef.current, current, character.id);
    if (!nextState) {
      setToast('此人已经无法入世。');
      return;
    }
    commitEmbodiedObserver(nextState);
    gameAudio.play('open', 0.48);
  }, [commitEmbodiedObserver]);

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
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    const nextState = queueEmbodiedObserverAction(embodimentObserverRef.current, current, option.command);
    if (!nextState) {
      setToast('此事眼下已经不能进行。');
      return;
    }
    commitEmbodiedObserver(nextState);
    gameAudio.play('action_submit', 0.72);
  }, [commitEmbodiedObserver]);

  const handleCancelEmbodiedAction = useCallback(() => {
    const current = worldRef.current;
    if (!current) return;
    commitEmbodiedObserver(cancelEmbodiedObserverAction(embodimentObserverRef.current, current));
  }, [commitEmbodiedObserver]);

  const handleDismissEmbodimentClosure = useCallback(() => {
    commitEmbodiedObserver(dismissEmbodimentClosure(embodimentObserverRef.current));
  }, [commitEmbodiedObserver]);

  const closeInspectorToMap = useCallback(() => {
    gameAudio.play('close', 0.38);
    setSelection(null);
    setMobileInspectorExpanded(false);
    window.setTimeout(() => {
      document.querySelector<HTMLCanvasElement>('.world-map__canvas')?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const inspector = useMemo<ReactNode>(() => {
    if (!world || !selection) return null;
    const followKey = `${selection.kind}:${selection.id}`;
    const shared = {
      isFollowing: followed.has(followKey),
      onToggleFollow: () => {
        const item = watchItemForSelection(world, selection);
        if (!item) return;
        const nextSettings = followed.has(followKey)
          ? removeObserverWatch(observerSettingsRef.current, item.kind, item.id)
          : upsertObserverWatch(observerSettingsRef.current, item);
        commitObserverSettings(nextSettings);
        gameAudio.play('select', 0.5);
      },
      onClose: closeInspectorToMap,
      mobileExpanded: mobileInspectorExpanded,
      onMobileExpandedChange: setMobileInspectorExpanded,
      onOpenArchive: selection.kind === 'country' || selection.kind === 'family' || selection.kind === 'person' ? () => {
        archiveReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        archiveFocusRestoreAllowedRef.current = true;
        setArchiveOpen(true);
        gameAudio.play('open', 0.62);
      } : undefined,
      onSelectEntity: handleSelectArchiveEntity,
      onSelectEvent: handleSelectScopedEvent,
    };
    if (selection.kind === 'region') {
      const item = world.regions.find((candidate) => candidate.id === selection.id);
      return item ? <Inspector kind="region" data={toRegionInspector(world, item)} {...shared} /> : null;
    }
    if (selection.kind === 'country') {
      const item = world.polities.find((candidate) => candidate.id === selection.id);
      return item ? <Inspector kind="country" data={toCountryInspector(world, item)} {...shared} /> : null;
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
    agencyShadowBranchId,
    agencyShadowLedger,
    closeInspectorToMap,
    commitObserverSettings,
    embodiedCharacterId,
    embodimentObserver.closure,
    followed,
    handleCancelEmbodiedAction,
    handleChooseEmbodiedAction,
    handleEnterEmbodiment,
    handleDismissEmbodimentClosure,
    handleLeaveEmbodiment,
    handleSelectArchiveEntity,
    handleSelectScopedEvent,
    mobileInspectorExpanded,
    pendingEmbodiedAction,
    selection,
    world,
  ]);

  const selectQuarterEvent = useCallback((eventId: string) => {
    gameAudio.play('open', 0.58);
    setResumeArchiveAfterEvent(false);
    setResumeSituationAfterEvent(false);
    setSelectedEventId(eventId);
    completeGuideStep('cause-traced');
  }, [completeGuideStep]);

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
        setObserverDeskOpen(false);
        setPauseMatch(null);
        setToast('这条局势已折入冷档案，当前卷宗不再保留可展开正文。');
        return;
      }
      setObserverDeskOpen(false);
      setPauseMatch(null);
      handleOpenSituationWorkbench(item.id, observerDeskTriggerRef.current);
      return;
    }
    const current = worldRef.current;
    const nextSelection = { kind: item.kind, id: item.id } as Selection;
    if (!current || !selectedEntityLabel(current, nextSelection)) {
      setObserverDeskOpen(false);
      setPauseMatch(null);
      setToast(`“${item.label}”已退出当下舆图；关注记录仍保留在观察台。`);
      return;
    }
    if (item.kind === 'army' || item.kind === 'fleet') setFocusedArmyId(item.id);
    setSelection(nextSelection);
    if (item.kind === 'country' || item.kind === 'family') {
      setPowerRosterSection(item.kind === 'country' ? 'polities' : 'families');
      setActiveView('powers');
    } else {
      setActiveView(item.kind === 'person' ? 'people' : 'world');
    }
    setObserverDeskOpen(false);
    setPauseMatch(null);
  }, [handleOpenSituationWorkbench]);

  const handleInspectObserverLead = useCallback((lead: ObserverLead) => {
    if (!lead.situationId) gameAudio.play('select', 0.52);
    setPauseMatch(null);
    setOverlay(lead.overlay);
    setSelection(lead.target);
    setActiveView('world');
    if (lead.situationId) handleOpenSituationWorkbench(lead.situationId);
  }, [handleOpenSituationWorkbench]);

  const handleToggleObserverLead = useCallback((lead: ObserverLead) => {
    const current = worldRef.current;
    if (!current) return;
    const item = lead.situationId
      ? watchItemForSituation(current, lead.situationId)
      : watchItemForSelection(current, lead.target);
    if (!item) return;
    const watched = observerSettingsRef.current.watchlist.some((entry) => (
      observerWatchKey(entry.kind, entry.id) === observerLeadWatchKey(lead)
    ));
    const nextSettings = watched
      ? removeObserverWatch(observerSettingsRef.current, item.kind, item.id)
      : upsertObserverWatch(observerSettingsRef.current, item);
    commitObserverSettings(nextSettings);
    gameAudio.play('select', 0.5);
    setToast(watched
      ? `已取消关注：${item.label}`
      : item.kind === 'situation'
        ? `已关注局势：${item.label}。形成、阶段变化、核心人物死亡或结案时会提醒并自动暂停。`
        : `已关注：${item.label}。推进季度后，相关动向会提醒并自动暂停。`);
  }, [commitObserverSettings]);

  const handleSelectPauseMatch = useCallback((match: ObserverPauseMatch) => {
    if (!match.situationId) return;
    commitObserverSettings(setObserverWatchAlert(
      observerSettingsRef.current,
      'situation',
      match.situationId,
      false,
    ));
    setObserverDeskOpen(false);
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
      setObserverDeskOpen(false);
      requestAnimationFrame(() => advanceRef.current('manual'));
      return;
    }
    if (step === 'overlay-switched') {
      handleOverlayChange('trade');
      setObserverDeskOpen(false);
      return;
    }
    if (step === 'cause-traced') {
      const event = current.history.at(-1);
      if (event) {
        completeGuideStep(step);
        setResumeSituationAfterEvent(false);
        setSelectedEventId(event.id);
        setObserverDeskOpen(false);
      }
      return;
    }
    const target = selection ?? (current.regions[0] ? { kind: 'region' as const, id: current.regions[0].id } : null);
    if (!target) return;
    const item = watchItemForSelection(current, target);
    if (!item) return;
    commitObserverSettings(upsertObserverWatch(observerSettingsRef.current, item));
    setSelection(target);
    setActiveView('world');
  }, [commitObserverSettings, completeGuideStep, handleOverlayChange, selection]);

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

  const totalPopulation = world
    ? world.regions.reduce((sum, item) => sum + item.population, 0)
      + world.armies.reduce((sum, item) => sum + item.soldiers, 0)
    : 0;
  const activeWarCount = world?.wars.filter((item) => item.active).length ?? 0;
  const livingPolityCount = world?.polities.filter((item) => item.alive).length ?? 0;
  const lowSupplyCount = world?.armies.filter((item) => item.supply < 45 || item.morale < 40).length ?? 0;
  const guideProgress = observerGuideProgress(observerSettings);
  const currentCollectionSlot = world
    ? worldSaves.find((save) => save.status === 'ready' && save.hash === world.hash)?.slot
    : undefined;
  const namedWorldSaveCount = worldSaves.filter((save) => !save.isAutosave).length;
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
          aria-hidden={startOpen || archiveOpen || mandateOpen || observerDeskOpen || settingsOpen || situationWorkbenchOpen || collectionOpen || primerOpen || activeView === 'chronicle' || undefined}
        >
          <TopBar
            title="沧衡纪"
            eraName="初元"
            year={world.year}
            season={world.season}
            turn={world.turn}
            isRunning={running}
            speed={speed}
            canAdvance={!fatalError && !historicalView}
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
              selectedObject={selection && selection.kind !== 'region' && selection.kind !== 'country' && selection.kind !== 'family' && selection.kind !== 'person' ? selection : null}
              overlay={historicalView ? 'political' : overlay}
              cameraKey={mapCameraKey}
              onCameraChange={setMapCamera}
              onLodChange={setMapLod}
              onGestureActivityChange={setMapGestureActive}
              mobileQuickLookOpen={Boolean(inspector) && !mobileInspectorExpanded}
              season={historicalView?.season ?? world.season}
              atmosphereEnabled={interfaceSettings.mapAtmosphere}
              motionReduced={interfaceSettings.motion === 'reduced'}
              onSelectBlank={closeInspectorToMap}
              onSelectRegion={(id) => {
                gameAudio.play('select', 0.46);
                setMobileToolsOpen(false);
                setMobileInspectorExpanded(false);
                setSelection({ kind: 'region', id });
                setActiveView('world');
              }}
              onSelectObject={(kind, id) => {
                gameAudio.play('select', 0.52);
                setMobileToolsOpen(false);
                setMobileInspectorExpanded(false);
                if (kind === 'army' || kind === 'fleet') setFocusedArmyId(id);
                setSelection({ kind, id });
                setActiveView('world');
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
                <button type="button" onClick={() => { setMobileToolsOpen(false); handleNewWorldMenu(); }} aria-label="返回世界书页" title="新纪、续读或导入">
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
                <button type="button" onClick={handleResetHistoricalView}>归还当下</button>
              </aside>
            ) : null}

            {rosterConfig ? (
              <RosterPanel
                key={activeView}
                title={rosterConfig.title}
                eyebrow={rosterConfig.eyebrow}
                items={rosterConfig.items}
                selectedId={rosterSelectedId}
                emptyMessage={rosterConfig.emptyMessage}
                searchPlaceholder={rosterConfig.searchPlaceholder}
                onSelect={handleRosterSelect}
                onClose={handleCloseRoster}
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
            stories={quarterPulseProjection.stories}
            onSelectEvent={selectQuarterEvent}
            onSelectSituation={handleOpenSituationWorkbench}
            onSelectLedger={selectQuarterLedger}
          />

          <CausalDrawer
            open={Boolean(selectedHistoryEvent)}
            event={selectedHistoryEvent ? toCausalEvent(world, selectedHistoryEvent) : null}
            onClose={() => {
              setSelectedEventId(null);
              if (resumeArchiveAfterEvent) {
                archiveFocusRestoreAllowedRef.current = true;
                setArchiveOpen(true);
                setResumeArchiveAfterEvent(false);
              } else if (resumeHistoryAfterEvent) {
                setActiveView('chronicle');
                setResumeHistoryAfterEvent(false);
              } else if (resumeSituationAfterEvent) {
                situationFocusRestoreAllowedRef.current = true;
                setSituationWorkbenchOpen(true);
                setResumeSituationAfterEvent(false);
              }
            }}
            onInspectEvidence={inspectEvidence}
            onSelectReference={(reference: CausalReference) => {
              archiveFocusRestoreAllowedRef.current = false;
              setResumeArchiveAfterEvent(false);
              setResumeHistoryAfterEvent(false);
              setResumeSituationAfterEvent(false);
              setSelectedEventId(null);
              handleSelectArchiveEntity(reference.kind, reference.id);
            }}
            onSelectSubject={(kind, id) => {
              archiveFocusRestoreAllowedRef.current = false;
              setResumeArchiveAfterEvent(false);
              setResumeHistoryAfterEvent(false);
              setResumeSituationAfterEvent(false);
              setSelectedEventId(null);
              handleSelectArchiveEntity(kind, id);
            }}
          />
        </main>
      ) : (
        <main className="observer-boot-underlay" aria-hidden="true" />
      )}

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
          setArchiveOpen(false);
          setResumeArchiveAfterEvent(false);
        }}
        onSelectEntity={handleSelectArchiveEntity}
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
          open={activeView === 'chronicle'}
          world={world}
          turn={historicalView?.turn ?? world.turn}
          onSelectEvent={(eventId) => {
            completeGuideStep('cause-traced');
            setResumeSituationAfterEvent(false);
            setResumeHistoryAfterEvent(true);
            setActiveView('world');
            setSelectedEventId(eventId);
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
        onSelectSituation={setSelectedSituationId}
        onSelectEntity={handleSelectSituationEntity}
        onSelectHistoryEvent={handleSelectSituationHistory}
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
        busy={collectionBusy}
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
        onCancel={world ? () => setStartOpen(false) : undefined}
      />

      {toast ? <div className="observer-toast" role="status">{toast}</div> : null}

    </>
  );
}
