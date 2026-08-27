import {
  Archive,
  Download,
  Eye,
  Expand,
  Library,
  Map as MapIcon,
  MoreHorizontal,
  RotateCcw,
  Save,
  Sparkles,
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
import { HistoryWorkbench } from './components/HistoryWorkbench';
import {
  Inspector,
  type PersonAgencyQuarterChoiceView,
} from './components/Inspector';
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
import {
  QuarterPulse,
  type QuarterPulseEvent,
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
import { RosterPanel, type RosterItem } from './components/RosterPanel';
import { TopBar, type PlaybackSpeed } from './components/TopBar';
import {
  DEFAULT_MAP_CAMERA,
  WorldMap,
  type MapCamera,
} from './components/WorldMap';
import { WorldCollectionPanel } from './components/WorldCollectionPanel';
import { WorldStart } from './components/WorldStart';
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
  getRuntimePerformanceSnapshot,
  measureRuntimePhaseAsync,
  measureRuntimePhase,
  recordRuntimeMetric,
  resetRuntimePerformanceMetrics,
  runtimeNow,
} from './performance/runtime-profiler';
import {
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
  SIMULATION_SYSTEM_PHASES,
  validateWorld,
  type V03InterventionAction,
  type WorldState,
} from './sim';
import { APP_VERSION } from './version';
import {
  familyRoster,
  militaryRoster,
  peopleRoster,
  polityRoster,
  toCausalEvent,
  toChronicleEvent,
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
  type PersonAgencyDossierOptions,
} from './view/adapters';
import {
  type HistoricalTerritoryView,
} from './view/v1-history';
import {
  deriveObserverLeadProjection,
  type ObserverLead,
  type ObserverLeadProjection,
} from './view/observer-leads';
import { projectSituationWorkbench } from './view/situation-detail';
import { projectQuarterPulseSituations } from './view/quarter-pulse-situations';
import {
  projectSituationSnapshotItem,
  toSituationSnapshot,
} from './view/situation-snapshot';
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
  MAX_AGENCY_SHADOW_CHARACTERS,
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
  toAgencyShadowPlayerEntries,
  type AgencyShadowLedger,
  type AgencyShadowPlayerEntry,
} from './view/v1-agency-shadow';
import './styles/app.css';

type Selection =
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

type AdvanceSource = 'manual' | 'auto';
type OpenWorldSource = 'create' | 'continue' | 'import' | 'collection';

const DEFAULT_SEED = '沧衡-甲子';
const BASE_AUTOPLAY_INTERVAL = 1_800;
const MAP_PRIMER_STORAGE_KEY = 'canghai-map-primer-complete-v1';
const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const HISTORY_COLORS: Record<string, string> = {
  世界: '#777267',
  人口: '#6b765f',
  经济: '#8b743f',
  政治: '#8f3d33',
  军事: '#6e4741',
  外交: '#556f70',
  海洋: '#526e75',
  疾病: '#9b3c31',
  知识: '#697255',
  迁徙: '#796953',
};

function historyRoster(world: WorldState): RosterItem[] {
  return world.history
    .slice(-72)
    .reverse()
    .map((event) => ({
      id: event.id,
      title: event.title,
      subtitle: `第 ${event.year} 年·${event.season} · ${event.category}`,
      meta: `${event.causes.length} 条因由`,
      accent: HISTORY_COLORS[event.category],
      alert: event.importance >= 4,
    }));
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

function selectedEntityLabel(world: WorldState, selection: Selection): string | null {
  if (!selection) return null;
  if (selection.kind === 'region') return world.regions.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'country') return world.polities.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'family') return world.families?.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'person') return world.characters.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'seaZone') return world.seaZones.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'army') return world.armies.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'fleet') return world.fleets.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'practice') return world.practices.find((item) => item.id === selection.id)?.name ?? null;
  const system = toSystemInspector(world, selection.kind, selection.id);
  return system?.name ?? null;
}

function observerStorageKey(seed: string): string {
  return `${OBSERVER_DESK_STORAGE_KEY}:${encodeURIComponent(seed)}`;
}

function agencyShadowRestoreToken(slot: string): string {
  return slot === 'autosave' ? 'autosave' : `collection:${slot}`;
}

function agencyPeriodLabel(turn: number): string {
  const seasons = ['春', '夏', '秋', '冬'] as const;
  const safeTurn = Math.max(0, Math.floor(turn));
  return `第 ${Math.floor(safeTurn / 4) + 1} 年${seasons[safeTurn % 4]}`;
}

function agencyTrackedCharacterIds(
  world: WorldState,
  selection: Selection,
  watchlist: readonly ObserverWatchItem[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id) || !world.characters.some((character) => character.id === id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (selection?.kind === 'person') add(selection.id);
  watchlist.filter((item) => item.kind === 'person').forEach((item) => add(item.id));
  [...world.armies].sort((left, right) => left.id.localeCompare(right.id)).forEach((army) => add(army.deputyCommanderId));
  [...world.fleets].sort((left, right) => left.id.localeCompare(right.id)).forEach((fleet) => add(fleet.deputyCommanderId));
  [...world.situationSystem.situations]
    .filter((situation) => situation.status === 'open')
    .sort((left, right) => right.tension - left.tension || left.id.localeCompare(right.id))
    .forEach((situation) => {
      situation.executableActorIds.forEach(add);
      situation.participants.coreCharacterIds.forEach(add);
    });
  [...world.polities]
    .filter((polity) => polity.alive)
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((polity) => add(polity.rulerId));
  [...world.armies].sort((left, right) => left.id.localeCompare(right.id)).forEach((army) => add(army.commanderId));
  [...world.characters]
    .filter((character) => character.alive)
    .sort((left, right) => right.influence - left.influence || right.renown - left.renown || left.id.localeCompare(right.id))
    .forEach((character) => add(character.id));
  return ids.slice(0, MAX_AGENCY_SHADOW_CHARACTERS);
}

function quarterChoiceFromAgencyEntry(entry: AgencyShadowPlayerEntry): PersonAgencyQuarterChoiceView {
  const outcome = entry.conclusion === '相合'
    ? 'aligned'
    : entry.conclusion === '仅见盘算'
      ? 'unobserved'
      : entry.conclusion === '仅见旧制'
        ? 'not_applicable'
        : 'diverged';
  return {
    periodLabel: agencyPeriodLabel(entry.turn),
    intended: entry.intended ?? '季初没有留下可与此事核对的明确打算',
    actual: entry.actual ?? '本季没有出现与这项盘算相应的主帅任命',
    outcome,
    reason: entry.reason,
    sourceEventId: entry.sourceEventId,
  };
}

function agencyDossierOptions(
  ledger: AgencyShadowLedger,
  branchId: string | null,
  characterId: string,
): PersonAgencyDossierOptions {
  if (!branchId) return {};
  const projection = getAgencyShadowProjection(ledger, branchId, characterId);
  const branch = ledger.branches.find((item) => item.id === branchId);
  const comparison = branch
    ? toAgencyShadowPlayerEntries(
        branch.comparisons.filter((item) => item.actorId === characterId),
        1,
      )[0]
    : undefined;
  return {
    projection,
    quarterChoice: comparison ? quarterChoiceFromAgencyEntry(comparison) : null,
  };
}

function availableCollectionSlot(prefix: string, saves: WorldSaveSummary[]): string {
  const occupied = new Set(saves.filter((save) => !save.isAutosave).map((save) => save.slot));
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? prefix : `${prefix}_${index}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error('无法分配新的世界收藏槽位。');
}

function watchItemForSelection(world: WorldState, selection: Exclude<Selection, null>): ObserverWatchItem | null {
  const label = selectedEntityLabel(world, selection);
  if (!label) return null;
  let detail = '等待下一条相关史事';
  if (selection.kind === 'country') {
    const item = world.polities.find((candidate) => candidate.id === selection.id);
    if (item) detail = `${item.alive ? item.governmentForm : '已亡政权'} · ${item.controlledRegionIds.length}州域`;
  } else if (selection.kind === 'family') {
    const item = world.families.find((candidate) => candidate.id === selection.id);
    if (item) detail = `${item.memberIds.length}名成员 · 声望${Math.round(item.prestige)}`;
  } else if (selection.kind === 'person') {
    const item = world.characters.find((candidate) => candidate.id === selection.id);
    if (item) detail = `${item.alive ? item.role : '已故'} · ${item.age}岁 · 影响${Math.round(item.influence)}`;
  } else if (selection.kind === 'region') {
    const item = world.regions.find((candidate) => candidate.id === selection.id);
    const owner = item ? world.polities.find((candidate) => candidate.id === item.controllerId) : null;
    if (item) detail = `${owner?.name ?? '无主'} · 人口${compact.format(item.population)} · 动荡${Math.round(item.unrest)}`;
  } else {
    const system = toSystemInspector(world, selection.kind, selection.id);
    if (system) detail = system.subtitle;
  }
  return { kind: selection.kind, id: selection.id, label, detail, alert: false };
}

function watchItemForSituation(world: WorldState, situationId: string): ObserverWatchItem | null {
  const situation = world.situationSystem.situations.find((item) => item.id === situationId);
  if (!situation) return null;
  const snapshot = projectSituationSnapshotItem(situation, world);
  return {
    kind: 'situation',
    id: situation.id,
    label: snapshot.title,
    detail: `${snapshot.statusLabel} · ${snapshot.phaseLabel} · 张力${Math.round(snapshot.tension)}`,
    alert: false,
  };
}

interface SnapshotOptions {
  startOpen: boolean;
  running: boolean;
  speed: PlaybackSpeed;
  view: ObserverView;
  overlay: MapOverlay;
  selection: Selection;
  selectedEventId: string | null;
  archiveOpen: boolean;
  mandateOpen: boolean;
  observerDeskOpen: boolean;
  historyWorkbenchOpen: boolean;
  situationWorkbenchOpen: boolean;
  selectedSituationId: string | null;
  observerLeadProjection: ObserverLeadProjection | null;
  historicalTurn: number | null;
  watchedCount: number;
  watchlist: ObserverWatchItem[];
  guideCompleted: number;
  pauseReason: string | null;
  pauseRule: string | null;
  pauseSituationId: string | null;
  pauseSituationTrigger: string | null;
  collectionOpen: boolean;
  worldSaveCount: number;
  primerOpen: boolean;
  primerStep: MapPrimerStep;
  mapCamera: MapCamera;
  agencyShadowLedger: AgencyShadowLedger;
  agencyShadowBranchId: string | null;
}

function makeTextSnapshot(world: WorldState | null, options: SnapshotOptions): string {
  if (!world) {
    return JSON.stringify({
      mode: 'start',
      productVersion: APP_VERSION,
      appUpdate: getAppUpdateState(),
      title: '沧衡纪',
      seedInputVisible: options.startOpen,
      collectionOpen: options.collectionOpen,
      worldSaveCount: options.worldSaveCount,
      primerOpen: options.primerOpen,
      primerStep: options.primerStep,
      actions: ['开启新纪', '续读旧史', '世界收藏', '导入史册'],
    });
  }

  const selected = options.selection ? { ...options.selection, label: selectedEntityLabel(world, options.selection) } : null;
  const polityName = (id: string) => world.polities.find((item) => item.id === id)?.name ?? id;
  const regionName = (id: string | null) => world.regions.find((item) => item.id === id)?.name ?? id;
  const characterName = (id: string) => world.characters.find((item) => item.id === id)?.name ?? id;
  const families = Array.isArray(world.families) ? world.families : [];
  const relationships = Array.isArray(world.relationships) ? world.relationships : [];
  const factions = Array.isArray(world.factions) ? world.factions : [];
  const diplomacy = Array.isArray(world.diplomacy) ? world.diplomacy : [];
  const familyName = (id: string | null | undefined) => families.find((item) => item.id === id)?.name ?? id ?? null;
  let selectedDetail: object | null = null;
  if (options.selection?.kind === 'region') {
    const item = world.regions.find((region) => region.id === options.selection?.id);
    if (item) selectedDetail = {
      kind: 'region',
      id: item.id,
      name: item.name,
      terrain: item.terrain,
      climate: item.climate,
      controller: polityName(item.controllerId),
      population: item.population,
      food: item.food,
      foodSeasons: Number((item.food / Math.max(1, item.population)).toFixed(2)),
      wealth: item.wealth,
      cityLevel: item.cityLevel,
      defense: item.defense,
      unrest: item.unrest,
      devastation: item.devastation,
    };
  } else if (options.selection?.kind === 'country') {
    const item = world.polities.find((polity) => polity.id === options.selection?.id);
    if (item) selectedDetail = {
      kind: 'country',
      id: item.id,
      name: item.name,
      alive: item.alive,
      dynasty: item.dynastyName,
      ruler: characterName(item.rulerId),
      capital: regionName(item.capitalRegionId),
      regions: item.controlledRegionIds.map((id) => regionName(id)),
      treasury: item.treasury,
      legitimacy: item.legitimacy,
      authority: item.authority,
      administration: item.administration,
      warWeariness: item.warWeariness,
      governmentForm: item.governmentForm,
      rulingFamily: familyName(item.rulingFamilyId),
      courtInfluence: item.courtInfluence,
      tradeRevenue: item.tradeRevenue,
      navalBudget: item.navalBudget,
      maritimeOrientation: item.maritimeOrientation,
      maritimeAssets: {
        fleets: world.fleets.filter((fleet) => fleet.polityId === item.id).map((fleet) => fleet.id),
        ports: world.ports
          .filter((port) => world.regions.find((region) => region.id === port.regionId)?.controllerId === item.id)
          .map((port) => port.id),
      },
      factions: factions.filter((entry) => entry.polityId === item.id && entry.active !== false).map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        leader: characterName(entry.leaderId),
        power: entry.power,
        cohesion: entry.cohesion,
        agenda: entry.agenda,
      })),
      diplomacy: diplomacy.filter((entry) => entry.polityAId === item.id || entry.polityBId === item.id).map((entry) => ({
        with: polityName(entry.polityAId === item.id ? entry.polityBId : entry.polityAId),
        status: entry.status,
        trust: entry.trust,
        grievance: entry.grievance,
        tradeDependency: entry.tradeDependency,
      })),
    };
  } else if (options.selection?.kind === 'family') {
    const item = families.find((candidate) => candidate.id === options.selection?.id);
    if (item) selectedDetail = {
      kind: 'family',
      id: item.id,
      name: item.name,
      polity: polityName(item.polityId),
      founder: characterName(item.founderId),
      head: characterName(item.headId),
      branch: item.branchName,
      members: item.memberIds.map(characterName),
      prestige: item.prestige,
      wealth: item.wealth,
      politicalInfluence: item.politicalInfluence,
      traditions: item.traditions,
      marriageAlliances: item.marriageAllianceFamilyIds.map(familyName),
      historyEventIds: world.history
        .filter((event) => event.actorIds.some((id) => item.memberIds.includes(id))
          || event.stateDeltas.some((delta) => delta.entityType === 'family' && delta.entityId === item.id))
        .map((event) => event.id),
    };
  } else if (options.selection?.kind === 'person') {
    const item = world.characters.find((character) => character.id === options.selection?.id);
    if (item) {
      const personDossier = toPersonInspector(
        world,
        item,
        agencyDossierOptions(options.agencyShadowLedger, options.agencyShadowBranchId, item.id),
      );
      selectedDetail = {
        kind: 'person',
        id: item.id,
        name: item.name,
        alive: item.alive,
        age: item.age,
        sex: item.sex,
        polity: polityName(item.polityId),
        role: item.role,
        location: regionName(item.locationRegionId),
        governedRegion: regionName(item.governedRegionId),
        commandingArmyId: item.commandingArmyId,
        abilities: { leadership: item.leadership, governance: item.governance, cunning: item.cunning },
        personality: { ambition: item.ambition, loyalty: item.loyalty, caution: item.caution },
        renown: item.renown,
        lifeStage: item.lifeStage,
        politicalClass: item.politicalClass,
        tier: item.tier,
        family: familyName(item.familyId),
        parents: (item.parentIds ?? []).map(characterName),
        spouses: (item.spouseIds ?? []).map(characterName),
        influence: item.influence,
        personalWealth: item.personalWealth,
        merit: item.merit,
        deputyExperience: item.deputyExperience,
        insubordination: item.insubordination,
        agency: personDossier.agency,
        biography: Array.isArray(item.biography) ? item.biography.slice(-20) : [],
        relationships: relationships
          .filter((entry) => entry.sourceId === item.id || entry.targetId === item.id)
          .slice(0, 10)
          .map((entry) => ({
            with: characterName(entry.sourceId === item.id ? entry.targetId : entry.sourceId),
            kinship: entry.kinship,
            affinity: entry.affinity,
            trust: entry.trust,
            fear: entry.fear,
            grievance: entry.grievance,
            gratitude: entry.gratitude,
            memories: entry.memories,
          })),
      };
    }
  } else if (options.selection) {
    const system = toSystemInspector(world, options.selection.kind, options.selection.id);
    if (system) selectedDetail = system;
  }
  const selectedEvent = options.selectedEventId
    ? world.history.find((event) => event.id === options.selectedEventId)
    : undefined;
  const selectedEventDetail = selectedEvent ? {
    id: selectedEvent.id,
    date: `${selectedEvent.year}年${selectedEvent.season}`,
    category: selectedEvent.category,
    kind: selectedEvent.kind,
    title: selectedEvent.title,
    summary: selectedEvent.summary,
    importance: selectedEvent.importance,
    actors: selectedEvent.actorIds.map(characterName),
    polities: selectedEvent.polityIds.map(polityName),
    regions: selectedEvent.regionIds.map((id) => regionName(id)),
    causes: selectedEvent.causes.map((cause) => ({ label: cause.label, role: cause.role, evidence: cause.evidence, refs: cause.refs ?? [] })),
    stateDeltas: selectedEvent.stateDeltas.slice(0, 12),
  } : null;
  const visibleRoster = options.view === 'polities'
    ? polityRoster(world)
    : options.view === 'families'
      ? familyRoster(world)
      : options.view === 'people'
        ? peopleRoster(world)
        : options.view === 'military'
          ? militaryRoster(world)
          : options.view === 'chronicle'
            ? historyRoster(world)
            : [];
  const topFlows = (options.historicalTurn === null ? toMapFlows(world, options.overlay) : []).map((flow) => ({
    id: flow.id,
    kind: flow.kind,
    from: [flow.from.x, flow.from.y],
    to: [flow.to.x, flow.to.y],
    magnitude: flow.magnitude,
    label: flow.label,
    target: { kind: flow.selectedKind, id: flow.selectedId },
  }));
  const importantRegions = world.regions
    .slice()
    .sort((left, right) => Number(left.id === options.selection?.id) - Number(right.id === options.selection?.id)
      || right.strategicValue - left.strategicValue)
    .slice(0, 40);
  const report = world.lastTurn;
  const interventionHistory = world.history.filter(isV03InterventionEvent);
  const latestIntervention = interventionHistory.at(-1);
  const focusLeadProjection = options.observerLeadProjection
    ?? deriveObserverLeadProjection(world);
  const focusLeads = focusLeadProjection.leads;
  const situationWorkbench = options.situationWorkbenchOpen
    ? projectSituationWorkbench(world, options.selectedSituationId)
    : null;
  return JSON.stringify({
    mode: options.startOpen ? 'world-menu' : 'observing',
    productVersion: APP_VERSION,
    appUpdate: getAppUpdateState(),
    worldSchemaVersion: world.schemaVersion,
    mapContentVersion: world.mapContentVersion,
    coordinates: 'map world coordinates use origin top-left, x rightward, y downward, range 1000x700',
    time: { turn: world.turn, year: world.year, season: world.season },
    deterministicWorldHash: world.hash,
    runtimePerformance: getRuntimePerformanceSnapshot(),
    seed: world.seed,
    playback: { running: options.running, speed: options.speed },
    observer: {
      deskOpen: options.observerDeskOpen,
      historyWorkbenchOpen: options.historyWorkbenchOpen,
      situationWorkbenchOpen: options.situationWorkbenchOpen,
      selectedSituationId: situationWorkbench?.selectedId ?? options.selectedSituationId,
      selectedSituation: situationWorkbench?.selected ? {
        id: situationWorkbench.selected.id,
        type: situationWorkbench.selected.type,
        title: situationWorkbench.selected.title,
        status: situationWorkbench.selected.status,
        phase: situationWorkbench.selected.phase,
        playerSummary: situationWorkbench.selected.playerSummary,
        currentChange: situationWorkbench.selected.currentChange,
        nextWatch: situationWorkbench.selected.nextWatch,
        outcome: situationWorkbench.selected.outcome,
        timeline: situationWorkbench.selected.timeline.map((item) => ({
          turn: item.turn,
          kind: item.kind,
          label: item.label,
          milestoneFactId: item.milestoneFactId,
          historyEventIds: item.historyEventIds,
        })),
        evidenceFactIds: situationWorkbench.selected.evidence.map((fact) => fact.id),
        consequenceCount: situationWorkbench.selected.consequences.length,
      } : null,
      historicalTurn: options.historicalTurn,
      watchedCount: options.watchedCount,
      watchlist: options.watchlist.map((item) => ({
        kind: item.kind,
        id: item.id,
        label: item.label,
        detail: item.detail,
        alert: item.alert,
      })),
      watchedSituationIds: options.watchlist
        .filter((item) => item.kind === 'situation')
        .map((item) => item.id),
      guideCompleted: options.guideCompleted,
      lastPauseReason: options.pauseReason,
      lastPauseRule: options.pauseRule,
      lastPauseSituationId: options.pauseSituationId,
      lastPauseSituationTrigger: options.pauseSituationTrigger,
      collectionOpen: options.collectionOpen,
      worldSaveCount: options.worldSaveCount,
      primerOpen: options.primerOpen,
      primerStep: options.primerStep,
      focusLeads: focusLeads.map((lead) => ({
        id: lead.id,
        slot: lead.slot,
        source: lead.source ?? 'fallback',
        situationId: lead.situationId ?? null,
        situationType: lead.situationType ?? null,
        displayMode: lead.displayMode ?? 'fallback',
        selectedSinceTurn: lead.selectedSinceTurn ?? world.turn,
        retainThroughTurn: lead.retainThroughTurn ?? world.turn,
        trackingTurns: lead.trackingTurns ?? 1,
        recentChange: lead.recentChange ?? null,
        arbitrationReason: lead.arbitrationReason ?? 'legacy_fallback',
        question: lead.question,
        stage: lead.stage,
        tension: lead.tension,
        evidence: lead.evidence,
        nextSignal: lead.nextSignal,
        target: lead.target,
        overlay: lead.overlay,
      })),
      leadArbitration: {
        version: focusLeadProjection.continuity.version,
        lastArbitratedTurn: focusLeadProjection.continuity.lastTurn,
        slots: focusLeadProjection.continuity.slots.map((entry) => ({ ...entry })),
      },
      situations: toSituationSnapshot(world),
      agencyContinuity: (() => {
        const branch = options.agencyShadowBranchId
          ? options.agencyShadowLedger.branches.find((item) => item.id === options.agencyShadowBranchId)
          : null;
        return branch ? {
          trackedCharacters: branch.projections.length,
          recordedComparisons: branch.comparisons.length,
          throughTurn: branch.head.turn,
          matchesWorld: branch.head.seed === world.seed
            && branch.head.turn === world.turn
            && branch.head.hash === world.hash,
        } : null;
      })(),
      commandCandidates: world.agencyDecisionSystem.actors.map((actor) => ({
        characterId: actor.characterId,
        name: characterName(actor.characterId),
        status: actor.goal.status,
      })),
    },
    interface: {
      view: options.view,
      overlay: options.overlay,
      mapViewport: {
        zoom: Number(options.mapCamera.zoom.toFixed(3)),
        panX: Number(options.mapCamera.panX.toFixed(1)),
        panY: Number(options.mapCamera.panY.toFixed(1)),
      },
      selected,
      selectedEventId: options.selectedEventId,
      archiveOpen: options.archiveOpen,
      mandateOpen: options.mandateOpen,
      primerOpen: options.primerOpen,
      primerStep: options.primerStep,
      selectedDetail,
      selectedEvent: selectedEventDetail,
      visibleRoster: visibleRoster.slice(0, 60),
      rosterTotal: visibleRoster.length,
      topFlows,
    },
    mandate: {
      available: availableMandate(world),
      cadence: 'once_per_quarter',
      usedThisTurn: latestIntervention?.turn === world.turn,
      recentIntervention: latestIntervention ? {
        id: latestIntervention.id,
        kind: latestIntervention.kind,
        turn: latestIntervention.turn,
        date: `${latestIntervention.year}年${latestIntervention.season}`,
        title: latestIntervention.title,
        summary: latestIntervention.summary,
        costEvidence: latestIntervention.causes.find((cause) => cause.label === '天命消耗')?.evidence ?? null,
        stateDeltas: latestIntervention.stateDeltas.slice(0, 8),
      } : null,
    },
    totals: {
      regions: world.regions.length,
      livingPolities: world.polities.filter((item) => item.alive).length,
      livingCharacters: world.characters.filter((item) => item.alive).length,
      families: families.length,
      armies: world.armies.length,
      fleets: world.fleets.length,
      seaZones: world.seaZones.length,
      ports: world.ports.length,
      activeTradeCorridors: world.tradeCorridors.filter((item) => item.active).length,
      activeOutbreaks: world.infections.filter((item) => item.infectious > 0).length,
      infectious: world.infections.reduce((sum, item) => sum + item.infectious, 0),
      knownPractices: new Set(world.practiceStates.filter((item) => item.mastery > 0 && item.lostTurn === null).map((item) => item.practiceId)).size,
      migrationsThisTurn: report?.trade.shipments.filter((item) => item.kind === '迁徙').length ?? 0,
      activeWars: world.wars.filter((item) => item.active).length,
      population: world.regions.reduce((sum, item) => sum + item.population, 0)
        + world.armies.reduce((sum, item) => sum + item.soldiers, 0),
    },
    recentHistory: world.history.slice(-8).map((event) => ({
      id: event.id,
      date: `${event.year}年${event.season}`,
      title: event.title,
      importance: event.importance,
      causes: event.causes.map((cause) => cause.evidence),
    })),
    visibleFamilies: options.view === 'families' ? families.slice(0, 60).map((item) => ({
      id: item.id,
      name: item.name,
      polity: polityName(item.polityId),
      head: characterName(item.headId),
      members: item.memberIds.length,
      prestige: item.prestige,
      influence: item.politicalInfluence,
    })) : [],
    lastTurnLedger: report ? {
      turn: report.turn,
      year: report.year,
      season: report.season,
      eventIds: report.eventIds,
      population: report.population,
      food: report.food,
      wealth: report.wealth,
      trade: {
        shipments: report.trade.shipments.length,
        deliveredValue: report.trade.valueTransferred,
        tariffs: report.trade.tariffsTransferred,
        produced: report.trade.produced,
        consumed: report.trade.consumed,
        lost: report.trade.lost,
      },
      migration: report.migration,
      health: report.health,
      knowledge: report.knowledge,
      maritime: report.maritime,
      logistics: { routeUsage: report.logistics.routeUsage.length, seaUsage: report.logistics.seaUsage.length },
    } : null,
    polities: world.polities.filter((item) => item.alive).slice(0, 16).map((item) => ({
      id: item.id,
      name: item.name,
      ruler: characterName(item.rulerId),
      capital: regionName(item.capitalRegionId),
      regions: item.controlledRegionIds.length,
      treasury: item.treasury,
      legitimacy: item.legitimacy,
      authority: item.authority,
      administration: item.administration,
      atWar: world.wars.some((war) => war.active && (war.attackerId === item.id || war.defenderId === item.id)),
    })),
    mapObjects: {
      regions: importantRegions.map((region) => ({
      id: region.id,
      name: region.name,
      center: [region.x, region.y],
      controllerId: region.controllerId,
      population: region.population,
      foodSeasons: Number((region.food / Math.max(1, region.population)).toFixed(2)),
      unrest: region.unrest,
      })),
      seaZones: world.seaZones.map((zone) => ({ id: zone.id, name: zone.name, center: [zone.x, zone.y], controllerId: zone.controllerId, contested: zone.contested, traffic: zone.traffic })),
      fleets: world.fleets.slice(0, 24).map((fleet) => ({ id: fleet.id, name: fleet.name, polityId: fleet.polityId, seaZoneId: fleet.seaZoneId, portRegionId: fleet.portRegionId, mission: fleet.mission, readiness: fleet.readiness })),
      armies: world.armies.slice(0, 24).map((army) => ({
      id: army.id,
      name: army.name,
      polityId: army.polityId,
      regionId: army.regionId,
      soldiers: army.soldiers,
      morale: army.morale,
      supply: army.supply,
      })),
    },
  });
}

export function App() {
  const [world, setWorld] = useState<WorldState | null>(null);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [startOpen, setStartOpen] = useState(true);
  const [hasSave, setHasSave] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [activeView, setActiveView] = useState<ObserverView>('world');
  const [overlay, setOverlay] = useState<MapOverlay>('political');
  const [mapCamera, setMapCamera] = useState<MapCamera>(() => ({ ...DEFAULT_MAP_CAMERA }));
  const [mapCameraKey, setMapCameraKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [followed, setFollowed] = useState<Set<string>>(() => new Set());
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
  const [pauseMatch, setPauseMatch] = useState<ObserverPauseMatch | null>(null);
  const [historicalView, setHistoricalView] = useState<HistoricalTerritoryView | null>(null);
  const [resumeHistoryAfterEvent, setResumeHistoryAfterEvent] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [worldSaves, setWorldSaves] = useState<WorldSaveSummary[]>([]);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [agencyShadowLedger, setAgencyShadowLedger] = useState<AgencyShadowLedger>(() => createAgencyShadowLedger());
  const [agencyShadowBranchId, setAgencyShadowBranchId] = useState<string | null>(null);
  const appUpdate = useSyncExternalStore(
    subscribeAppUpdate,
    getAppUpdateState,
    getAppUpdateState,
  );

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
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const collectionTriggerRef = useRef<HTMLButtonElement>(null);
  const primerTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const mobileToolsTriggerRef = useRef<HTMLButtonElement>(null);
  const collectionReturnFocusRef = useRef<HTMLElement | null>(null);
  const observerSettingsRef = useRef(observerSettings);
  const advanceRef = useRef<(source: AdvanceSource) => boolean>(() => false);
  const primerAdvanceDoneRef = useRef(false);
  const primerNewestEventIdRef = useRef<string | null>(null);
  const reactCommitStartedAtRef = useRef<{ startedAt: number; turn: number } | null>(null);
  const autosaveCoordinatorRef = useRef<AutosaveCoordinator | null>(null);
  const agencyShadowLedgerRef = useRef(agencyShadowLedger);
  const agencyShadowBranchIdRef = useRef<string | null>(agencyShadowBranchId);
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
  const snapshotOptionsRef = useRef<SnapshotOptions>({
    startOpen,
    running,
    speed,
    view: activeView,
    overlay,
    selection,
    selectedEventId,
    archiveOpen,
    mandateOpen,
    observerDeskOpen,
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
    agencyShadowLedger,
    agencyShadowBranchId,
  });

  const commitAgencyShadow = useCallback((nextLedger: AgencyShadowLedger, nextBranchId: string | null) => {
    agencyShadowLedgerRef.current = nextLedger;
    agencyShadowBranchIdRef.current = nextBranchId;
    setAgencyShadowLedger(nextLedger);
    setAgencyShadowBranchId(nextBranchId);
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
    setHasSave(saves.some((save) => save.isAutosave && save.status === 'ready'));
    return saves;
  }, []);

  useEffect(() => {
    refreshWorldSaves().catch(() => setHasSave(false));
  }, [refreshWorldSaves]);

  useEffect(() => {
    observerSettingsRef.current = observerSettings;
    setFollowed(new Set(observerSettings.watchlist.map((item) => observerWatchKey(item.kind, item.id))));
    if (!world) return;
    try {
      localStorage.setItem(observerStorageKey(world.seed), serializeObserverDeskSettings(observerSettings));
    } catch {
      // Observer preferences are non-authoritative; a blocked localStorage must not stop play.
    }
  }, [observerSettings, world]);

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
    worldShellRef.current.inert = startOpen || archiveOpen || mandateOpen || observerDeskOpen || situationWorkbenchOpen || collectionOpen || primerOpen || activeView === 'chronicle';
  }, [activeView, archiveOpen, collectionOpen, mandateOpen, observerDeskOpen, primerOpen, situationWorkbenchOpen, startOpen, world]);

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
      restoredObserver = parseObserverDeskSettings(localStorage.getItem(observerStorageKey(validWorld.seed)));
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
    commitWorld(validWorld, source === 'continue' || source === 'collection' ? 'restore' : 'reset');
    setSeed(validWorld.seed);
    const compactViewport = window.matchMedia('(max-width: 760px)').matches;
    setSelection(source !== 'create' && !compactViewport && defaultRegionId ? { kind: 'region', id: defaultRegionId } : null);
    setSelectedEventId(null);
    setArchiveOpen(false);
    setMandateOpen(false);
    setObserverDeskOpen(false);
    setSituationWorkbenchOpen(false);
    setSelectedSituationId(null);
    setResumeSituationAfterEvent(false);
    setCollectionOpen(false);
    setMandateMessage(null);
    setResumeArchiveAfterEvent(false);
    archiveFocusRestoreAllowedRef.current = false;
    setFocusedArmyId(null);
    setFollowed(new Set(restoredObserver.watchlist.map((item) => observerWatchKey(item.kind, item.id))));
    setPauseMatch(null);
    setHistoricalView(null);
    setResumeHistoryAfterEvent(false);
    setActiveView('world');
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
  }, [commitAgencyShadow, commitWorld, resetAgencyShadowAtWorld, resetAutosaveCoordinator]);

  const handleCreate = useCallback(() => {
    setStartBusy(true);
    setStartError(null);
    try {
      openWorld(createWorld(seed.trim()), 'create');
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '无法创建世界。');
    } finally {
      setStartBusy(false);
    }
  }, [openWorld, seed]);

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
  }, []);

  const handleCloseMandate = useCallback(() => {
    setMandateOpen(false);
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
  }, [commitAgencyShadow, commitWorld, mandateBusy, resetAgencyShadowAtWorld, selection]);

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
    requestAnimationFrame(() => {
      const trigger = collectionTriggerRef.current
        ?? document.querySelector<HTMLElement>('#open-world-collection');
      trigger?.focus();
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
      const pendingSave = await autosaveCoordinatorRef.current?.flush('pause');
      if (pendingSave?.status === 'failed') throw pendingSave.error;
      const saved = await loadWorldFromSlot(slot);
      if (!saved) throw new Error('该世界槽位已经不存在。');
      openWorld(deserializeWorld(saved.payload), 'collection', agencyShadowRestoreToken(slot));
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
      const source = saves.find((save) => save.slot === sourceSlot && save.status === 'ready');
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
    setStartOpen(true);
    setStartError(null);
  }, []);

  const advanceOne = useCallback((source: AdvanceSource): boolean => {
    const current = worldRef.current;
    if (!current || advancingRef.current) return false;
    advancingRef.current = true;
    try {
      const oldHistoryLength = current.history.length;
      const detailed = advanceWorldDetailed(current);
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
      const newEvents = next.history.slice(oldHistoryLength);
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
  }, []);

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

  snapshotOptionsRef.current = {
    startOpen,
    running,
    speed,
    view: activeView,
    overlay,
    selection,
    selectedEventId,
    archiveOpen,
    mandateOpen,
    observerDeskOpen,
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
    agencyShadowLedger,
    agencyShadowBranchId,
  };
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
    setRunning((current) => {
      const next = !current;
      runningRef.current = next;
      if (!next) clockAccumulatorRef.current = 0;
      return next;
    });
  }, [historicalView]);

  const handleSpeedChange = useCallback((nextSpeed: PlaybackSpeed) => {
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
    setOverlay(nextOverlay);
    if (nextOverlay !== 'political') completeGuideStep('overlay-switched');
  }, [completeGuideStep]);

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
  }, []);

  const handleCloseMapPrimer = useCallback((_reason: MapPrimerCloseReason) => {
    try {
      localStorage.setItem(MAP_PRIMER_STORAGE_KEY, '1');
    } catch {
      // Primer completion is a preference only; storage failures must not block the world.
    }
    setPrimerOpen(false);
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
    }
    setActiveView(nextView);
  }, []);

  const handleOpenObserverDesk = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    clockAccumulatorRef.current = 0;
    setSelectedEventId(null);
    setObserverDeskOpen(true);
  }, []);

  const handleCloseObserverDesk = useCallback(() => {
    setObserverDeskOpen(false);
    window.setTimeout(() => observerDeskTriggerRef.current?.focus(), 0);
  }, []);

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

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
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
  const quarterSituationChanges = useMemo(() => (
    world ? projectQuarterPulseSituations(world) : []
  ), [world]);
  const quarterEvents = useMemo<QuarterPulseEvent[]>(() => {
    if (!world?.lastTurn) return [];
    const eventIds = new Set(world.lastTurn.eventIds);
    return world.history
      .filter((event) => (
        eventIds.has(event.id)
        && event.kind !== 'quarter_summary'
        && !event.kind.startsWith('situation_')
      ))
      .map((event) => {
        const chronicle = toChronicleEvent(world, event);
        return {
          id: event.id,
          title: chronicle.title,
          category: chronicle.category,
          importance: event.importance,
          location: chronicle.location,
        };
      });
  }, [world]);
  const quarterHighlightedRegionIds = useMemo(() => {
    if (!world?.lastTurn || historicalView) return [];
    const eventIds = new Set(world.lastTurn.eventIds);
    const importantEvents = world.history
      .filter((event) => eventIds.has(event.id) && event.kind !== 'quarter_summary')
      .sort((left, right) => right.importance - left.importance)
      .slice(0, 3);
    const regionIds = new Set(world.lastTurn.health.outbreakRegionIds);
    for (const event of importantEvents) {
      event.regionIds.forEach((id) => regionIds.add(id));
      event.stateDeltas
        .filter((delta) => delta.entityType === 'region')
        .forEach((delta) => regionIds.add(delta.entityId));
    }
    return [...regionIds].filter((id) => world.regions.some((region) => region.id === id)).slice(0, 16);
  }, [historicalView, world]);
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
    if (activeView === 'polities') return {
      title: '天下列国', eyebrow: '政权根基', items: polityItems, emptyMessage: '天下已无成形政权。',
    };
    if (activeView === 'families') return {
      title: '天下世家', eyebrow: '门第与传承', items: familyItems, emptyMessage: '尚无被谱牒记名的家族。',
    };
    if (activeView === 'people') return {
      title: '时人群像', eyebrow: '声望与所图', items: peopleItems, emptyMessage: '暂无可记名人物。',
    };
    if (activeView === 'military') return {
      title: '天下军旅', eyebrow: '兵力与补给', items: militaryItems, emptyMessage: '天下暂无宏观军团。',
    };
    return null;
  }, [activeView, familyItems, militaryItems, peopleItems, polityItems]);

  const handleRosterSelect = useCallback((id: string) => {
    const current = worldRef.current;
    if (!current) return;
    if (activeView === 'polities') {
      setSelection({ kind: 'country', id });
      return;
    }
    if (activeView === 'families') {
      setSelection({ kind: 'family', id });
      return;
    }
    if (activeView === 'people') {
      setSelection({ kind: 'person', id });
      return;
    }
    if (activeView === 'military') {
      const army = current.armies.find((item) => item.id === id);
      const fleet = current.fleets.find((item) => item.id === id);
      setFocusedArmyId(id);
      if (army) setSelection({ kind: 'army', id: army.id });
      else if (fleet) setSelection({ kind: 'fleet', id: fleet.id });
      return;
    }
    if (activeView === 'chronicle') setSelectedEventId(id);
  }, [activeView]);

  const handleSelectArchiveEntity = useCallback((kind: ArchiveEntityKind, id: string) => {
    setSelectedEventId(null);
    setSelection({ kind, id });
    setActiveView(kind === 'country' ? 'polities' : kind === 'family' ? 'families' : kind === 'person' ? 'people' : 'world');
  }, []);

  const handleSelectScopedEvent = useCallback((eventId: string) => {
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
  }, [selectedSituationId]);

  const handleCloseSituationWorkbench = useCallback(() => {
    situationFocusRestoreAllowedRef.current = true;
    setSituationWorkbenchOpen(false);
    setResumeSituationAfterEvent(false);
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
      },
      onClose: () => setSelection(null),
      onOpenArchive: selection.kind === 'country' || selection.kind === 'family' || selection.kind === 'person' ? () => {
        archiveReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        archiveFocusRestoreAllowedRef.current = true;
        setArchiveOpen(true);
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
        {...shared}
      /> : null;
    }
    const system = toSystemInspector(world, selection.kind, selection.id);
    return system ? <Inspector kind="system" data={system} {...shared} /> : null;
  }, [
    agencyShadowBranchId,
    agencyShadowLedger,
    commitObserverSettings,
    followed,
    handleSelectArchiveEntity,
    handleSelectScopedEvent,
    selection,
    world,
  ]);

  const selectQuarterEvent = useCallback((eventId: string) => {
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
    setActiveView(item.kind === 'country' ? 'polities' : item.kind === 'family' ? 'families' : item.kind === 'person' ? 'people' : 'world');
    setObserverDeskOpen(false);
    setPauseMatch(null);
  }, [handleOpenSituationWorkbench]);

  const handleInspectObserverLead = useCallback((lead: ObserverLead) => {
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
  const currentCollectionSlot = world
    ? worldSaves.find((save) => save.status === 'ready' && save.hash === world.hash)?.slot
    : undefined;
  const namedWorldSaveCount = worldSaves.filter((save) => !save.isAutosave).length;
  const rosterSelectedId = activeView === 'polities' && selection?.kind === 'country'
    ? selection.id
    : activeView === 'families' && selection?.kind === 'family'
      ? selection.id
    : activeView === 'people' && selection?.kind === 'person'
      ? selection.id
      : activeView === 'military'
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
          data-focus-open={activeView === 'world' && !historicalView && !inspector || undefined}
          aria-hidden={startOpen || archiveOpen || mandateOpen || observerDeskOpen || situationWorkbenchOpen || collectionOpen || primerOpen || activeView === 'chronicle' || undefined}
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
            onViewChange={handleViewChange}
            onOverlayChange={handleOverlayChange}
          />

          <section
            className="observer-stage"
            aria-label="世界观察舆图"
            data-historical-turn={historicalView?.turn ?? undefined}
          >
            <WorldMap
              regions={mapRegions}
              routes={mapRoutes}
              armies={mapArmies}
              seaZones={mapSeaZones}
              fleets={mapFleets}
              flows={mapFlows}
              markers={mapMarkers}
              highlightedRegionIds={quarterHighlightedRegionIds}
              selectedRegionId={selection?.kind === 'region' ? selection.id : null}
              selectedObject={selection && selection.kind !== 'region' && selection.kind !== 'country' && selection.kind !== 'family' && selection.kind !== 'person' ? selection : null}
              overlay={historicalView ? 'political' : overlay}
              cameraKey={mapCameraKey}
              onCameraChange={setMapCamera}
              onSelectRegion={(id) => {
                setMobileToolsOpen(false);
                setSelection({ kind: 'region', id });
                setActiveView('world');
              }}
              onSelectObject={(kind, id) => {
                setMobileToolsOpen(false);
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
              <button
                ref={historyTriggerRef}
                type="button"
                data-history-workbench-trigger="true"
                onClick={() => {
                  setMobileToolsOpen(false);
                  handleViewChange('chronicle');
                }}
                aria-label="打开历史工作台，快捷键 H"
                title="历史工作台（H）"
              >
                <Archive size={16} aria-hidden="true" />
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
                <button type="button" onClick={() => { setMobileToolsOpen(false); handleFullscreen(); }} aria-label="切换全屏，快捷键 F" title="全屏（F）">
                  <Expand size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => { setMobileToolsOpen(false); handleNewWorldMenu(); }} aria-label="返回世界书页" title="新纪、续读或导入">
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

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
                onSelect={handleRosterSelect}
                onClose={() => setActiveView('world')}
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
            report={world.lastTurn}
            events={quarterEvents}
            situationChanges={quarterSituationChanges}
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
          onClose={() => setActiveView('world')}
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
