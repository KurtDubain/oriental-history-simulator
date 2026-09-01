import type { RosterItem } from './roster-discovery';
import {
  getAppUpdateState,
} from '../infra/app-update';
import { getRuntimePerformanceSnapshot } from '../performance/runtime-profiler';
import {
  getMapProfile,
  getMapProfileForContentVersion,
  listMapProfiles,
} from '../maps';
import {
  availableMandate,
  isV03InterventionEvent,
  type WorldState,
} from '../sim';
import { findWorldHistoryEvent } from '../sim/archive';
import { APP_VERSION } from '../version';
import {
  projectRosterCollection,
  rosterScopeFor,
  toCountryInspector,
  toMapFlows,
  toMapMarkers,
  toPersonInspector,
  toSystemInspector,
  worldPopulation,
} from './adapters';
import { projectEmbodimentTextSnapshot } from './embodiment-view';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import { shouldShowObserverSoundInvitation } from './observer-interface-settings';
import { agencyDossierOptions } from './observer-agency-projection';
import { deriveObserverLeadProjection } from './observer-leads';
import {
  observerLayerIsOpen,
  observerPageIsVisible,
  selectedObserverEventId,
  topObserverLayer,
  type ObserverNavigationState,
} from './observer-navigation';
import { selectedEntityLabel } from './observer-selection';
import { projectQuarterPulse } from './quarter-pulse-stories';
import type { SnapshotOptions } from './observer-shell-contract';
import { projectSituationWorkbench } from './situation-detail';
import { toSituationSnapshot } from './situation-snapshot';
import { mapMarkerTarget } from './map-marker-layout';
import { projectMilitaryAuthority } from './military-authority-reading';

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

export type HistoryReadingLayer = 'evidence' | 'entity' | 'situation' | 'chronicle' | 'quarter';

export function deriveHistoryReadingLayer(navigation: ObserverNavigationState): HistoryReadingLayer {
  if (observerLayerIsOpen(navigation, 'event')) return 'evidence';
  if (observerLayerIsOpen(navigation, 'archive')) return 'entity';
  if (observerLayerIsOpen(navigation, 'situations')) return 'situation';
  if (observerPageIsVisible(navigation, 'chronicle')) return 'chronicle';
  return 'quarter';
}

function projectNavigationJourney(navigation: ObserverNavigationState): object[] {
  return navigation.layers.map((layer) => {
    if (layer.kind === 'event') return { kind: layer.kind, eventId: layer.eventId };
    if (layer.kind === 'situations') return { kind: layer.kind, situationId: layer.situationId };
    if (layer.kind === 'archive') return { kind: layer.kind, subject: { ...layer.subject } };
    return { kind: layer.kind };
  });
}

function historyRoster(world: WorldState): RosterItem[] {
  return world.history
    .filter(isDefaultVisibleHistoryEvent)
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

function projectPlayerSituationDirectory(world: WorldState) {
  const snapshot = toSituationSnapshot(world);
  const projectItem = (item: (typeof snapshot.open)[number]) => ({
    id: item.id,
    type: item.type,
    typeLabel: item.typeLabel,
    title: item.title,
    status: item.status,
    statusLabel: item.statusLabel,
    startedTurn: item.startedTurn,
    lastUpdatedTurn: item.lastUpdatedTurn,
    resolvedTurn: item.resolvedTurn,
  });
  return {
    version: snapshot.version,
    lastReducedTurn: snapshot.lastReducedTurn,
    openCount: snapshot.openCount,
    resolvedCount: snapshot.resolvedCount,
    archivedResolvedCount: snapshot.archivedResolvedCount,
    open: snapshot.open.map(projectItem),
    recentResolved: snapshot.recentResolved.map(projectItem),
  };
}

function playerSituationChange(
  trigger: SnapshotOptions['pauseSituationTrigger'],
): 'new-situation' | 'new-action' | 'core-character-death' | 'resolved' | null {
  if (trigger === 'formation') return 'new-situation';
  if (trigger === 'phase-change') return 'new-action';
  if (trigger === 'core-character-death') return 'core-character-death';
  if (trigger === 'resolution') return 'resolved';
  return null;
}

export function makeTextSnapshot(world: WorldState | null, options: SnapshotOptions): string {
  const navigation = options.navigation;
  const topLayer = topObserverLayer(navigation);
  const startOpen = observerLayerIsOpen(navigation, 'start');
  const collectionOpen = observerLayerIsOpen(navigation, 'collection');
  const settingsOpen = observerLayerIsOpen(navigation, 'settings');
  const primerOpen = observerLayerIsOpen(navigation, 'primer');
  const archiveOpen = observerLayerIsOpen(navigation, 'archive');
  const mandateOpen = observerLayerIsOpen(navigation, 'mandate');
  const observerDeskOpen = observerLayerIsOpen(navigation, 'observer-desk');
  const situationWorkbenchOpen = observerLayerIsOpen(navigation, 'situations');
  const historyWorkbenchOpen = observerPageIsVisible(navigation, 'chronicle');
  const selectedEventId = selectedObserverEventId(navigation);
  const selectedSituationId = topLayer?.kind === 'situations' ? topLayer.situationId : null;
  const view = navigation.view;
  const powerRosterSection = navigation.powerRosterSection;
  if (!world) {
    const mapProfile = getMapProfile(options.selectedMapProfileId);
    return JSON.stringify({
      mode: 'start',
      productVersion: APP_VERSION,
      appUpdate: getAppUpdateState(),
      title: '沧衡纪',
      mapProfile: { id: mapProfile.id, revision: mapProfile.revision, name: mapProfile.name },
      availableMapProfiles: listMapProfiles().map((profile) => ({
        id: profile.id,
        revision: profile.revision,
        name: profile.name,
        regions: profile.simulation.regions.length,
        seaZones: profile.simulation.seaZones.length,
        polities: profile.simulation.polities.length,
      })),
      seedInputVisible: startOpen,
      collectionOpen,
      navigationJourney: projectNavigationJourney(navigation),
      settings: {
        open: settingsOpen,
        soundEnabled: options.interfaceSettings.sound.enabled,
        soundPromptVisible: false,
        motion: options.interfaceSettings.motion,
        mapAtmosphere: options.interfaceSettings.mapAtmosphere,
        density: options.interfaceSettings.interfaceDensity,
        audioState: options.audioState,
      },
      worldSaveCount: options.worldSaveCount,
      primerOpen,
      primerStep: options.primerStep,
      actions: ['开启新纪', '续读旧史', '世界收藏', '导入史册'],
    });
  }
  const mapProfile = getMapProfileForContentVersion(world.mapContentVersion);

  const selected = options.selection ? { ...options.selection, label: selectedEntityLabel(world, options.selection) } : null;
  const polityName = (id: string) => world.polities.find((item) => item.id === id)?.name ?? id;
  const regionName = (id: string | null) => world.regions.find((item) => item.id === id)?.name ?? id;
  const characterName = (id: string) => world.characters.find((item) => item.id === id)?.name ?? id;
  const families = Array.isArray(world.families) ? world.families : [];
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
    if (item) {
      const countryDossier = toCountryInspector(world, item);
      selectedDetail = {
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
      factions: countryDossier.factions?.map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        leader: entry.leader,
        power: entry.power,
        cohesion: entry.cohesion,
        agenda: entry.agenda,
        categories: entry.categories,
        resources: entry.resources,
        recentMovement: entry.recentMovement,
      })) ?? [],
      court: countryDossier.court ?? null,
      powerholders: countryDossier.powerholders ?? [],
      courtScenes: countryDossier.courtScenes ?? [],
      diplomacy: diplomacy.filter((entry) => entry.polityAId === item.id || entry.polityBId === item.id).map((entry) => ({
        with: polityName(entry.polityAId === item.id ? entry.polityBId : entry.polityAId),
        status: entry.status,
        trust: entry.trust,
        grievance: entry.grievance,
        tradeDependency: entry.tradeDependency,
      })),
      };
    }
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
        .filter(isDefaultVisibleHistoryEvent)
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
        relationships: (personDossier.relationships ?? []).map((entry) => ({
          targetId: entry.targetId,
          with: entry.name,
          relation: entry.relation,
          sentiment: entry.sentiment,
          detail: entry.detail,
          memories: entry.memories,
        })),
      };
    }
  } else if (options.selection) {
    const system = toSystemInspector(world, options.selection.kind, options.selection.id);
    if (system) selectedDetail = system;
  }
  const selectedEvent = selectedEventId
    ? findWorldHistoryEvent(world, selectedEventId)
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
  const rosterScope = rosterScopeFor(view, powerRosterSection);
  const rosterProjection = rosterScope
    ? projectRosterCollection(world, rosterScope, options.rosterDiscovery[rosterScope], options.watchlist)
    : null;
  const visibleRoster = rosterProjection?.items
    ?? (view === 'chronicle' ? historyRoster(world) : []);
  const visibleRosterLimit = rosterScope ? options.rosterVisibleCounts[rosterScope] : 60;
  const topFlows = (options.historicalTurn === null ? toMapFlows(world, options.overlay) : []).map((flow) => ({
    id: flow.id,
    kind: flow.kind,
    from: [flow.from.x, flow.from.y],
    to: [flow.to.x, flow.to.y],
    magnitude: flow.magnitude,
    label: flow.label,
    target: { kind: flow.selectedKind, id: flow.selectedId },
  }));
  const politicalMarkers = options.historicalTurn === null && options.overlay === 'political'
    ? toMapMarkers(world, 'political', options.focusedPoliticalFactionId)
    : [];
  const focusedPoliticalFaction = world.factions.find((item) => item.id === options.focusedPoliticalFactionId);
  const importantRegions = world.regions
    .slice()
    .sort((left, right) => Number(left.id === options.selection?.id) - Number(right.id === options.selection?.id)
      || right.strategicValue - left.strategicValue)
    .slice(0, 40);
  const report = world.lastTurn;
  const quarterPulse = projectQuarterPulse(world);
  const interventionHistory = world.history.filter(isV03InterventionEvent);
  const latestIntervention = interventionHistory.at(-1);
  const focusLeadProjection = options.observerLeadProjection
    ?? deriveObserverLeadProjection(world);
  const focusLeads = focusLeadProjection.leads;
  const situationWorkbench = situationWorkbenchOpen
    ? projectSituationWorkbench(world, selectedSituationId)
    : null;
  const selectedCreationProfile = getMapProfile(options.selectedMapProfileId);
  return JSON.stringify({
    mode: startOpen ? 'world-menu' : 'observing',
    productVersion: APP_VERSION,
    appUpdate: getAppUpdateState(),
    worldSchemaVersion: world.schemaVersion,
    mapContentVersion: world.mapContentVersion,
    mapProfile: { id: mapProfile.id, revision: mapProfile.revision, name: mapProfile.name },
    worldCreation: startOpen ? {
      selectedMapProfile: {
        id: selectedCreationProfile.id,
        revision: selectedCreationProfile.revision,
        name: selectedCreationProfile.name,
      },
      availableMapProfiles: listMapProfiles().map((profile) => ({
        id: profile.id,
        revision: profile.revision,
        name: profile.name,
      })),
    } : null,
    coordinates: `地图世界坐标以左上角为原点，横轴向右、纵轴向下，范围 ${mapProfile.presentation.width}×${mapProfile.presentation.height}`,
    time: { turn: world.turn, year: world.year, season: world.season },
    deterministicWorldHash: world.hash,
    archive: {
      coldThroughTurn: world.archiveSystem?.blocks.length
        ? world.archiveSystem.archivedThroughTurn
        : null,
      blockCount: world.archiveSystem?.blocks.length ?? 0,
      activeFactCount: world.facts.length,
      activeEventCount: world.history.length,
    },
    runtimePerformance: getRuntimePerformanceSnapshot(),
    seed: world.seed,
    playback: { running: options.running, speed: options.speed },
    observer: {
      deskOpen: observerDeskOpen,
      historyWorkbenchOpen,
      situationWorkbenchOpen,
      selectedSituationId: situationWorkbench?.selectedId ?? selectedSituationId,
      selectedSituation: situationWorkbench?.selected ? {
        id: situationWorkbench.selected.id,
        type: situationWorkbench.selected.type,
        title: situationWorkbench.selected.title,
        status: situationWorkbench.selected.status,
        playerSummary: situationWorkbench.selected.playerSummary,
        currentChange: situationWorkbench.selected.currentChange,
        recentDeltas: situationWorkbench.selected.recentDeltas,
        outcome: situationWorkbench.selected.outcome,
        scenes: situationWorkbench.selected.scenes.map((scene) => ({
          id: scene.id,
          turn: scene.turn,
          dateLabel: scene.dateLabel,
          title: scene.title,
          summary: scene.summary,
          result: scene.result,
          historyEventIds: scene.historyEventIds,
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
      lastPauseSituationChange: playerSituationChange(options.pauseSituationTrigger),
      collectionOpen,
      worldSaveCount: options.worldSaveCount,
      primerOpen,
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
        label: lead.label,
        startedLabel: lead.startedLabel ?? null,
        question: lead.question,
        evidence: lead.evidence,
        target: lead.target,
        overlay: lead.overlay,
      })),
      leadArbitration: {
        version: focusLeadProjection.continuity.version,
        lastArbitratedTurn: focusLeadProjection.continuity.lastTurn,
        slots: focusLeadProjection.continuity.slots.map((entry) => ({ ...entry })),
      },
      situations: projectPlayerSituationDirectory(world),
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
      embodiment: projectEmbodimentTextSnapshot(
        world,
        options.embodiedCharacterId,
        options.pendingEmbodiedAction,
        options.embodimentClosure,
      ),
      commandCandidates: world.agencyDecisionSystem.actors.map((actor) => ({
        characterId: actor.characterId,
        name: characterName(actor.characterId),
        status: actor.goal.status,
      })),
    },
    interface: {
      historyReadingLayer: deriveHistoryReadingLayer(navigation),
      navigationJourney: projectNavigationJourney(navigation),
      view,
      powerRosterSection,
      overlay: options.overlay,
      settings: {
        open: settingsOpen,
        soundEnabled: options.interfaceSettings.sound.enabled,
        soundPromptVisible: shouldShowObserverSoundInvitation(options.interfaceSettings, {
          turn: world.turn,
          worldViewActive: view === 'world' && options.historicalTurn === null,
          selectionOpen: options.selection !== null,
        }),
        motion: options.interfaceSettings.motion,
        mapAtmosphere: options.interfaceSettings.mapAtmosphere,
        density: options.interfaceSettings.interfaceDensity,
        audioState: options.audioState,
        fullscreen: options.fullscreen,
      },
      mapViewport: {
        zoom: Number(options.mapCamera.zoom.toFixed(3)),
        panX: Number(options.mapCamera.panX.toFixed(1)),
        panY: Number(options.mapCamera.panY.toFixed(1)),
        lod: options.mapLod,
      },
      politicalMap: {
        active: options.historicalTurn === null && options.overlay === 'political',
        focusedPolityId: focusedPoliticalFaction?.polityId ?? null,
        focusedFactionId: focusedPoliticalFaction?.id ?? null,
        courtEntryActive: options.selection?.kind === 'country'
          && (options.selection.initialTab === 'court' || Boolean(options.selection.courtFocus)),
        courtFocusedPolityId: options.selection?.kind === 'country' ? options.selection.courtFocus?.polityId ?? null : null,
        courtFocusedFactionId: options.selection?.kind === 'country' ? options.selection.courtFocus?.factionId ?? null : null,
        visiblePulses: politicalMarkers.filter((marker) => marker.kind === 'capitalPulse').map((marker) => ({
          id: marker.id, polityId: marker.polityId, factionId: marker.factionId ?? null,
          label: marker.label, status: marker.categoryLabel, summary: marker.detail,
          power: marker.magnitude, tone: marker.tone, position: [marker.position.x, marker.position.y],
          target: mapMarkerTarget(marker),
        })),
        visibleRoots: politicalMarkers.filter((marker) => marker.kind === 'powerRoot').map((marker) => ({
          id: marker.id, polityId: marker.polityId, factionId: marker.factionId,
          faction: marker.factionName, category: marker.rootKind, label: marker.label,
          detail: marker.detail, value: marker.magnitude, position: [marker.position.x, marker.position.y],
          target: mapMarkerTarget(marker),
        })),
      },
      quarterPulse: {
        turn: report?.turn ?? null,
        storyCount: quarterPulse.stories.length,
        stories: quarterPulse.stories.map((story) => ({
          id: story.id,
          kind: story.kind,
          title: story.title,
          summary: story.summary,
          importance: story.importance,
          destination: story.kind === 'situation'
            ? { kind: 'situation', id: story.situationId }
            : story.eventId
              ? { kind: 'event', id: story.eventId }
              : { kind: 'record', id: story.id },
          sourceFactIds: story.sourceFactIds,
          historyEventIds: story.historyEventIds,
          regionIds: story.regionIds,
        })),
        highlightedRegionIds: quarterPulse.highlightedRegionIds,
      },
      mobileInspectorMode: options.selection
        ? options.mobileInspectorExpanded ? 'full' : 'quick'
        : 'closed',
      mapGestureActive: options.mapGestureActive,
      selected,
      selectedEventId,
      archiveOpen,
      mandateOpen,
      primerOpen,
      primerStep: options.primerStep,
      selectedDetail,
      selectedEvent: selectedEventDetail,
      visibleRoster: visibleRoster.slice(0, visibleRosterLimit),
      rosterVisibleLimit: visibleRosterLimit,
      rosterTotal: rosterProjection?.totalCount ?? visibleRoster.length,
      rosterMatched: rosterProjection?.matchedCount ?? visibleRoster.length,
      rosterDiscovery: rosterProjection ? {
        scope: rosterProjection.scope,
        query: rosterProjection.state.query,
        quickView: rosterProjection.state.quickView,
        filters: rosterProjection.state.filters,
        sort: rosterProjection.state.sort,
        activeFilterCount: rosterProjection.activeFilterCount,
        conditionSummary: rosterProjection.conditionSummary,
      } : null,
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
      population: worldPopulation(world),
    },
    recentHistory: world.history.filter(isDefaultVisibleHistoryEvent).slice(-8).map((event) => ({
      id: event.id,
      date: `${event.year}年${event.season}`,
      title: event.title,
      importance: event.importance,
      causes: event.causes.map((cause) => cause.evidence),
    })),
    visibleFamilies: view === 'powers' && powerRosterSection === 'families' ? families.slice(0, 60).map((item) => ({
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
      armies: world.armies.slice(0, 24).map((army) => {
        const authority = projectMilitaryAuthority(world, army);
        return {
          id: army.id,
          name: army.name,
          polityId: army.polityId,
          regionId: army.regionId,
          soldiers: army.soldiers,
          morale: army.morale,
          supply: army.supply,
          lawfulCommander: authority.lawfulCommanderName,
          actualAllegiance: authority.actualAllegianceName,
          allegianceBasis: authority.allegianceBasis,
          commandDiverged: authority.commandDiverged,
          retinueSoldiers: authority.retinueSoldiers,
          order: authority.orderLabel,
          orderIssuer: authority.orderIssuerName,
          orderTargetRegionId: authority.orderTargetRegionId,
        };
      }),
    },
  });
}
