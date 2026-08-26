import type {
  CausalEvent,
  CausalFactor,
  CausalReference,
} from '../components/CausalDrawer';
import type { ChronicleEvent, ChronicleTone } from '../components/Chronicle';
import type {
  CountryInspectorData,
  FamilyInspectorData,
  InspectorRecord,
  PersonInspectorData,
  RegionInspectorData,
  SystemInspectorData,
} from '../components/Inspector';
import type {
  ArchiveDossier,
  ArchiveLink,
  ArchiveRecord,
} from '../components/HistoricalArchive';
import type {
  MapArmyView,
  MapFleetView,
  MapFlowView,
  MapMarkerView,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
  MapOverlay,
} from '../components/WorldMap';
import type { RosterItem } from '../components/RosterPanel';
import type {
  ArmyState,
  BiographyFact,
  CharacterState,
  EventCategory,
  FamilyState,
  HistoryEvent,
  RelationshipState,
  PolityState,
  RegionState,
  SimulationFact,
  WorldState,
} from '../sim/types';
import {
  projectCharacterAgency,
  toCharacterAgencyPlayerProjection,
} from '../sim/agency';

const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;

function worldFamilies(world: WorldState) {
  return Array.isArray(world.families) ? world.families : [];
}

function worldRelationships(world: WorldState) {
  return Array.isArray(world.relationships) ? world.relationships : [];
}

function worldFactions(world: WorldState) {
  return Array.isArray(world.factions) ? world.factions : [];
}

function worldDiplomacy(world: WorldState) {
  return Array.isArray(world.diplomacy) ? world.diplomacy : [];
}

function worldOffices(world: WorldState) {
  return Array.isArray(world.offices) ? world.offices : [];
}

function turnLabel(turn: number) {
  const safeTurn = Math.max(0, Number.isFinite(turn) ? Math.floor(turn) : 0);
  return `第 ${Math.floor(safeTurn / 4) + 1} 年 · ${SEASON_NAMES[safeTurn % 4]}`;
}

interface PersonExperienceEntry {
  turn: number;
  record: ArchiveRecord;
}

function factNamesCharacter(fact: SimulationFact, characterId: string): boolean {
  if (!fact.actorIds.includes(characterId)) return false;
  switch (fact.kind) {
    case 'battle':
      return [fact.payload.attacker, ...fact.payload.defenders].some((force) => (
        force.commanderId === characterId || force.deputyCommanderId === characterId
      ));
    case 'appointment_started':
    case 'appointment_ended':
      return fact.payload.holderId === characterId;
    case 'character_death':
      return fact.payload.characterId === characterId;
    case 'marriage':
      return fact.payload.leftCharacterId === characterId || fact.payload.rightCharacterId === characterId;
    default:
      return true;
  }
}

function biographySource(
  item: CharacterState,
  biography: BiographyFact,
  eventById: ReadonlyMap<string, HistoryEvent>,
  factById: ReadonlyMap<string, SimulationFact>,
): { event: HistoryEvent | null; fact: SimulationFact | null } | null {
  if (biography.factId !== null) {
    if (biography.eventId !== null) return null;
    const sourceFact = factById.get(biography.factId);
    return sourceFact && sourceFact.turn === biography.turn && factNamesCharacter(sourceFact, item.id)
      ? { event: null, fact: sourceFact }
      : null;
  }
  if (biography.eventId !== null) {
    const sourceEvent = eventById.get(biography.eventId);
    return sourceEvent && sourceEvent.turn === biography.turn && sourceEvent.actorIds.includes(item.id)
      ? { event: sourceEvent, fact: null }
      : null;
  }
  return biography.kind === '旧档人物' && biography.turn === 0
    ? { event: null, fact: null }
    : null;
}

function coActorNames(world: WorldState, item: CharacterState, event: HistoryEvent): string | null {
  const names = event.actorIds
    .filter((actorId) => actorId !== item.id)
    .map((actorId) => character(world, actorId)?.name)
    .filter((name): name is string => Boolean(name));
  if (!names.length) return null;
  return `${names.slice(0, 3).join('、')}${names.length > 3 ? '等人' : ''}`;
}

function biographySummary(world: WorldState, item: CharacterState, fact: BiographyFact, event: HistoryEvent): string {
  const others = coActorNames(world, item, event);
  return `${item.name}卷中记为「${fact.kind}」，见于「${event.title}」${others ? `；同卷人物还有${others}` : ''}。`;
}

function relatedEventSummary(world: WorldState, item: CharacterState, event: HistoryEvent): string {
  const others = coActorNames(world, item, event);
  return `${item.name}直接卷入「${event.title}」${others ? `；同卷人物还有${others}` : ''}。`;
}

function appointmentSummary(world: WorldState, item: CharacterState, fact: Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>): string {
  const owner = polity(world, fact.payload.polityId)?.name ?? '所属政权';
  const scope = fact.payload.armyId
    ? world.armies.find((army) => army.id === fact.payload.armyId)?.name ?? '所部军团'
    : fact.payload.fleetId
      ? world.fleets.find((fleet) => fleet.id === fact.payload.fleetId)?.name ?? '所部水师'
      : fact.payload.regionId
        ? region(world, fact.payload.regionId)?.name ?? '地方官署'
        : '中枢官署';
  return fact.kind === 'appointment_started'
    ? `${item.name}受${owner}任为${fact.payload.officeKind}，职掌系于${scope}。`
    : `${item.name}卸下${owner}${fact.payload.officeKind}之职，原职掌系于${scope}。`;
}

/**
 * Projects a person's dated record from sources that explicitly name that
 * person. Biography prose is presentation data, so every linked entry is
 * checked against its authoritative Fact or Chronicle actor list before it is
 * shown. Appointment Facts are included even though they deliberately have no
 * Chronicle projection.
 */
export function toPersonExperienceRecords(world: WorldState, item: CharacterState): ArchiveRecord[] {
  const entries: PersonExperienceEntry[] = [];
  const knownEventIds = new Set<string>();
  const knownFactIds = new Set<string>();
  const biography = Array.isArray(item.biography) ? item.biography : [];
  const eventById = new Map(world.history.map((event) => [event.id, event]));
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));

  for (const fact of biography) {
    const source = biographySource(item, fact, eventById, factById);
    if (!source) continue;
    if (source.event) {
      knownEventIds.add(source.event.id);
      for (const sourceFactId of source.event.sourceFactIds) knownFactIds.add(sourceFactId);
    }
    if (source.fact) knownFactIds.add(source.fact.id);
    entries.push({
      turn: fact.turn,
      record: {
        id: fact.id,
        date: turnLabel(fact.turn),
        title: fact.kind,
        summary: source.event
          ? biographySummary(world, item, fact, source.event)
          : fact.summary,
        eventId: fact.eventId,
        importance: fact.importance,
      },
    });
  }

  for (const event of world.history) {
    if (!event.actorIds.includes(item.id) || knownEventIds.has(event.id)) continue;
    entries.push({
      turn: event.turn,
      record: {
        ...eventArchiveRecord(event),
        summary: relatedEventSummary(world, item, event),
      },
    });
    knownEventIds.add(event.id);
    for (const sourceFactId of event.sourceFactIds) knownFactIds.add(sourceFactId);
  }

  const appointmentFacts = world.facts.filter((fact): fact is Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }> => (
    (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
    && factNamesCharacter(fact, item.id)
  ));
  const startedAppointmentIds = new Set(appointmentFacts
    .filter((fact) => fact.kind === 'appointment_started')
    .map((fact) => fact.payload.appointmentId));
  for (const fact of appointmentFacts) {
    if (knownFactIds.has(fact.id)) continue;
    entries.push({
      turn: fact.turn,
      record: {
        id: `${item.id}:experience:${fact.id}`,
        date: turnLabel(fact.turn),
        title: fact.kind === 'appointment_started' ? `就任${fact.payload.officeKind}` : `卸任${fact.payload.officeKind}`,
        summary: appointmentSummary(world, item, fact),
        eventId: null,
        importance: fact.importance,
      },
    });
  }

  for (const office of world.offices) {
    if (office.holderId !== item.id || startedAppointmentIds.has(office.id)) continue;
    const owner = polity(world, office.polityId)?.name ?? '所属政权';
    entries.push({
      turn: office.appointedTurn,
      record: {
        id: `${item.id}:experience:${office.id}:initial`,
        date: turnLabel(office.appointedTurn),
        title: `任${office.kind}`,
        summary: `${item.name}在初始官档中登记为${owner}${office.kind}。`,
        eventId: null,
        importance: office.rank >= 80 ? 2 : 1,
      },
    });
  }

  return entries
    .sort((left, right) => left.turn - right.turn || left.record.id.localeCompare(right.record.id))
    .map((entry) => entry.record);
}

function family(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return worldFamilies(world).find((candidate) => candidate.id === id);
}

function livingCharacter(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.characters.find((character) => character.id === id && character.alive);
}

function character(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.characters.find((candidate) => candidate.id === id);
}

function polity(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.polities.find((candidate) => candidate.id === id);
}

function region(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.regions.find((candidate) => candidate.id === id);
}

function historyRecord(item: HistoryEvent): InspectorRecord {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    eventId: item.id,
    importance: item.importance,
  };
}

function scopedHistory(world: WorldState, predicate: (event: HistoryEvent) => boolean, limit = 8) {
  return world.history.filter(predicate).slice(-limit).reverse().map(historyRecord);
}

function foodSafetyRatio(item: RegionState) {
  const quarterlyNeed = Math.max(1, item.population);
  return item.food / quarterlyNeed;
}

export function toMapRegions(world: WorldState): MapRegionView[] {
  const polities = new Map(world.polities.map((item) => [item.id, item]));
  return world.regions.map((item) => {
    const owner = polities.get(item.controllerId);
    const infection = world.infections.find((entry) => entry.hostKind === 'region' && entry.hostId === item.id);
    const practiceStates = world.practiceStates.filter((entry) => entry.regionId === item.id && entry.lostTurn === null);
    const tradeVolume = world.tradeCorridors.filter((entry) => entry.active && (entry.originRegionId === item.id || entry.destinationRegionId === item.id)).reduce((sum, entry) => sum + entry.lastVolume, 0);
    return {
      id: item.id,
      name: item.name,
      polygon: item.polygon,
      center: { x: item.x, y: item.y },
      terrain: item.terrain,
      polityId: owner?.id,
      polityName: owner?.name ?? '无主之地',
      polityColor: owner?.color ?? '#777267',
      population: item.population,
      foodRatio: foodSafetyRatio(item),
      unrest: item.unrest,
      warDamage: item.devastation,
      port: item.port,
      portLevel: item.portLevel,
      capital: owner?.capitalRegionId === item.id,
      cityLevel: item.cityLevel,
      defense: item.defense,
      strategicValue: item.strategicValue,
      diseasePressure: infection ? (infection.infectious + infection.exposed) / Math.max(1, item.population) * 100 : 0,
      knowledgeAdoption: practiceStates.length ? practiceStates.reduce((sum, entry) => sum + entry.adoption, 0) / practiceStates.length : 0,
      refugeePopulation: item.refugeePopulation,
      tradeVolume: Math.min(100, Math.log1p(tradeVolume) * 8),
    };
  });
}

export function toMapRoutes(world: WorldState): MapRouteView[] {
  return world.routes.map((item) => ({
    id: item.id,
    from: item.fromRegionId,
    to: item.toRegionId,
    type: item.kind === '河道' ? 'river' : item.kind === '海峡' ? 'sea' : 'land',
  }));
}

export function toMapArmies(world: WorldState): MapArmyView[] {
  const polities = new Map(world.polities.map((item) => [item.id, item]));
  return world.armies
    .filter((army) => army.soldiers > 0)
    .map((army) => ({
      id: army.id,
      name: army.name,
      regionId: army.regionId,
      polityId: army.polityId,
      polityColor: polities.get(army.polityId)?.color,
      strength: army.soldiers,
      morale: army.morale,
      status: army.supply < 45 ? '补给吃紧' : '在营',
    }));
}

export function toMapSeaZones(world: WorldState): MapSeaZoneView[] {
  return world.seaZones.map((item) => {
    const controller = polity(world, item.controllerId);
    const totalPower = Object.values(item.powerByPolity).reduce((sum, value) => sum + Math.max(0, value), 0);
    const controllerPower = item.controllerId ? Math.max(0, item.powerByPolity[item.controllerId] ?? 0) : 0;
    return {
      id: item.id,
      name: item.name,
      center: { x: item.x, y: item.y },
      climate: item.climate,
      controllerName: controller?.name,
      controllerColor: controller?.color,
      contested: item.contested,
      traffic: item.traffic,
      stormRisk: item.stormRisk,
      piracy: item.piracy,
      powerShare: totalPower > 0 ? controllerPower / totalPower : 0,
    };
  });
}

function fleetPoint(world: WorldState, fleetId: string) {
  const fleet = world.fleets.find((item) => item.id === fleetId);
  if (!fleet) return undefined;
  const zone = world.seaZones.find((item) => item.id === fleet.seaZoneId);
  const portRegion = region(world, fleet.portRegionId ?? fleet.homePortRegionId);
  return zone ? { x: zone.x, y: zone.y } : portRegion ? { x: portRegion.x, y: portRegion.y } : undefined;
}

export function toMapFleets(world: WorldState): MapFleetView[] {
  return world.fleets.flatMap((item) => {
    const position = fleetPoint(world, item.id);
    if (!position) return [];
    return [{
      id: item.id,
      name: item.name,
      seaZoneId: item.seaZoneId,
      regionId: item.portRegionId,
      position,
      polityColor: polity(world, item.polityId)?.color,
      strength: item.warships * 3 + item.patrolShips + item.transports * 0.4,
      readiness: item.readiness,
      mission: item.mission,
    }];
  });
}

function hostPoint(world: WorldState, hostId: string) {
  const hostRegion = region(world, hostId);
  if (hostRegion) return { x: hostRegion.x, y: hostRegion.y };
  const army = world.armies.find((item) => item.id === hostId);
  const armyRegion = region(world, army?.regionId);
  if (armyRegion) return { x: armyRegion.x, y: armyRegion.y };
  return fleetPoint(world, hostId);
}

export function toMapFlows(world: WorldState, overlay: MapOverlay): MapFlowView[] {
  const flows: MapFlowView[] = [];
  if (overlay === 'trade') {
    for (const corridor of world.tradeCorridors.filter((item) => item.active)) {
      const from = region(world, corridor.originRegionId);
      const to = region(world, corridor.destinationRegionId);
      if (!from || !to) continue;
      flows.push({ id: corridor.id, kind: 'trade', from, to, magnitude: corridor.lastVolume, label: `${corridor.commodity} · ${compact.format(corridor.lastVolume)}`, selectedKind: 'tradeCorridor', selectedId: corridor.id, alert: corridor.risk >= 65 });
    }
  }
  if (overlay === 'migration') {
    for (const shipment of world.lastTurn?.trade.shipments.filter((item) => item.kind === '迁徙') ?? []) {
      const from = region(world, shipment.originRegionId);
      const to = region(world, shipment.destinationRegionId);
      if (!from || !to) continue;
      flows.push({ id: shipment.id, kind: 'migration', from, to, magnitude: shipment.peopleDeparted, label: `${compact.format(shipment.peopleArrived)}人落籍`, selectedKind: 'migration', selectedId: shipment.id, alert: shipment.peopleLost > 0 });
    }
  }
  if (overlay === 'disease') {
    for (const infection of world.infections) {
      const destination = hostPoint(world, infection.hostId);
      if (!destination) continue;
      for (const source of infection.recentSources) {
        const origin = hostPoint(world, source.sourceHostId);
        if (!origin || source.importedExposures <= 0) continue;
        flows.push({ id: `${infection.id}-${source.turn}-${source.shipmentId ?? source.sourceHostId}`, kind: 'disease', from: origin, to: destination, magnitude: source.importedExposures, label: `输入暴露 ${source.importedExposures}`, selectedKind: 'outbreak', selectedId: infection.id, alert: true });
      }
    }
  }
  if (overlay === 'knowledge') {
    for (const state of world.practiceStates.filter((item) => item.sourceRegionId && item.mastery > 0)) {
      const from = region(world, state.sourceRegionId);
      const to = region(world, state.regionId);
      const practice = world.practices.find((item) => item.id === state.practiceId);
      if (!from || !to || !practice) continue;
      flows.push({ id: state.id, kind: 'knowledge', from, to, magnitude: Math.max(state.adoption, state.mastery), label: `${practice.name} · 采用${Math.round(state.adoption)}`, selectedKind: 'practice', selectedId: practice.id });
    }
  }
  if (overlay === 'naval') {
    for (const lane of world.seaLanes) {
      const from = world.seaZones.find((item) => item.id === lane.fromSeaZoneId);
      const to = world.seaZones.find((item) => item.id === lane.toSeaZoneId);
      if (!from || !to) continue;
      flows.push({ id: lane.id, kind: 'naval', from, to, magnitude: lane.capacity, label: lane.strait ? '海峡航道' : '海上航道', selectedKind: 'seaZone', selectedId: to.id, alert: lane.baseRisk >= 65 });
    }
  }
  return flows.sort((left, right) => right.magnitude - left.magnitude || left.id.localeCompare(right.id)).slice(0, 16);
}

export function toMapMarkers(world: WorldState, overlay: MapOverlay): MapMarkerView[] {
  if (overlay === 'disease') {
    return world.infections
      .filter((item) => item.infectious > 0 || item.exposed > 0)
      .flatMap((item) => {
        const position = hostPoint(world, item.hostId);
        const pathogen = world.pathogens.find((candidate) => candidate.id === item.pathogenId);
        const total = item.susceptible + item.exposed + item.infectious + item.recovered;
        return position ? [{ id: item.id, kind: 'outbreak' as const, position, magnitude: Math.min(100, (item.exposed + item.infectious) / Math.max(1, total) * 1_000), label: pathogen?.name ?? '疫病', alert: item.infectious > 0 }] : [];
      })
      .sort((left, right) => right.magnitude - left.magnitude)
      .slice(0, 20);
  }
  if (overlay === 'knowledge') {
    return world.practiceStates
      .filter((item) => item.innovationProgress > 0 || item.mastery > 0)
      .sort((left, right) => Math.max(right.adoption, right.mastery, right.innovationProgress) - Math.max(left.adoption, left.mastery, left.innovationProgress))
      .flatMap((item) => {
        const practice = world.practices.find((candidate) => candidate.id === item.practiceId);
        const practiceRegion = region(world, item.regionId);
        return practice && practiceRegion ? [{ id: practice.id, kind: 'practice' as const, position: { x: practiceRegion.x, y: practiceRegion.y }, magnitude: Math.max(item.adoption, item.mastery, item.innovationProgress), label: practice.name }] : [];
      })
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 20);
  }
  return [];
}

function systemHistory(world: WorldState, entityType: string, id: string): InspectorRecord[] {
  return scopedHistory(world, (event) => event.stateDeltas.some((delta) => delta.entityType === entityType && delta.entityId === id)
    || event.causes.some((cause) => cause.refs?.some((ref) => ref.entityType === entityType && ref.entityId === id)));
}

export function toSystemInspector(world: WorldState, kind: SystemInspectorData['kind'], id: string): SystemInspectorData | null {
  if (kind === 'seaZone') {
    const item = world.seaZones.find((candidate) => candidate.id === id);
    if (!item) return null;
    const controller = polity(world, item.controllerId);
    return { id, kind, name: item.name, subtitle: `${item.climate} · ${item.contested ? '列舰相争' : controller?.name ?? '无主海域'}`, summary: item.contested ? '多方投射在此交叠，护航、封锁与补给均承受额外风险。' : '海域控制尚有主次，商船流量与风浪共同塑造其价值。', facts: [{ label: '主导', value: controller?.name ?? '无' }, { label: '港口', value: `${item.portRegionIds.length}处` }, { label: '船流', value: compact.format(item.traffic) }, { label: '相邻海域', value: item.adjacentSeaZoneIds.length }], meters: [{ label: '风暴风险', value: item.stormRisk }, { label: '海盗压力', value: item.piracy }], links: item.portRegionIds.slice(0, 6).flatMap((regionId) => { const portRegion = region(world, regionId); return portRegion ? [{ id: portRegion.id, kind: 'region' as const, label: portRegion.name, detail: '通海港口', value: portRegion.portLevel }] : []; }), history: systemHistory(world, 'seaZone', id) };
  }
  if (kind === 'army') {
    const item = world.armies.find((candidate) => candidate.id === id);
    if (!item) return null;
    const owner = polity(world, item.polityId);
    const commander = character(world, item.commanderId);
    const deputy = character(world, item.deputyCommanderId);
    const stationed = region(world, item.regionId);
    const summary = item.supply < 35
      ? '粮道已很吃紧；继续行军或交战，减员会先于正面溃败到来。'
      : item.morale < 40
        ? '军心不稳；主帅威望、近期胜负和补给将决定这支军团能否维持建制。'
        : item.training >= 70 && item.experience >= 60
          ? '这是一支训练与战阵经验俱佳的常备军，真正的限制来自粮道、主帅和战场位置。'
          : '军团的战力由兵力、训练、军心与补给共同决定，人数并不等同于胜算。';
    return {
      id,
      kind,
      name: item.name,
      subtitle: `${owner?.name ?? '无属'} · ${stationed?.name ?? '驻地不详'}`,
      summary,
      facts: [
        { label: '主帅', value: commander?.name ?? '无帅' },
        { label: '副将', value: deputy?.name ?? '暂缺' },
        { label: '兵力', value: compact.format(item.soldiers) },
        { label: '军粮', value: compact.format(item.food) },
        { label: '本营', value: region(world, item.originRegionId)?.name ?? '不详' },
        { label: '最近移动', value: item.lastMovedTurn < 0 ? '尚未移营' : item.lastMovedTurn === world.turn ? '本季' : turnLabel(item.lastMovedTurn) },
      ],
      meters: [
        { label: '士气', value: item.morale },
        { label: '训练', value: item.training },
        { label: '战阵经验', value: item.experience },
        { label: '补给', value: item.supply },
      ],
      links: [
        commander ? { id: commander.id, kind: 'person' as const, label: commander.name, detail: '军团主帅' } : null,
        deputy ? { id: deputy.id, kind: 'person' as const, label: deputy.name, detail: '军团副将' } : null,
        stationed ? { id: stationed.id, kind: 'region' as const, label: stationed.name, detail: '当前驻地' } : null,
        owner ? { id: owner.id, kind: 'country' as const, label: owner.name, detail: '所属政权' } : null,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      history: systemHistory(world, 'army', id),
    };
  }
  if (kind === 'fleet') {
    const item = world.fleets.find((candidate) => candidate.id === id);
    if (!item) return null;
    const commander = character(world, item.commanderId);
    const zone = world.seaZones.find((candidate) => candidate.id === item.seaZoneId);
    return { id, kind, name: item.name, subtitle: `${polity(world, item.polityId)?.name ?? '无属'} · ${item.mission}`, summary: item.repairNeed > 55 ? '船体与索具急需入港修整，继续远航会迅速失去在场能力。' : '舰队以港口、粮饷和航海实践维持海上任务。', facts: [{ label: '主将', value: commander?.name ?? '无帅' }, { label: '所在', value: zone?.name ?? region(world, item.portRegionId)?.name ?? '航行中' }, { label: '战船', value: item.warships }, { label: '运输船', value: item.transports }, { label: '水手', value: compact.format(item.sailors) }, { label: '军粮', value: compact.format(item.food) }], meters: [{ label: '战备', value: item.readiness }, { label: '士气', value: item.morale }, { label: '修理需求', value: item.repairNeed }], links: [{ id: item.homePortRegionId, kind: 'region' as const, label: region(world, item.homePortRegionId)?.name ?? '母港', detail: '舰队母港' }, ...(zone ? [{ id: zone.id, kind: 'seaZone' as const, label: zone.name, detail: '当前海域' }] : [])], history: systemHistory(world, 'fleet', id) };
  }
  if (kind === 'tradeCorridor') {
    const item = world.tradeCorridors.find((candidate) => candidate.id === id);
    if (!item) return null;
    const from = region(world, item.originRegionId);
    const to = region(world, item.destinationRegionId);
    return { id, kind, name: `${from?.name ?? '起地'}—${to?.name ?? '讫地'}`, subtitle: `${item.commodity}商路 · ${item.active ? '通行中' : '已中断'}`, summary: item.risk >= 60 ? '损耗、劫掠或封锁正在侵蚀这条商路的利润。' : '货物与货款沿实际容量往来，利润进入港口、家族与政权账户。', facts: [{ label: '当季流量', value: compact.format(item.lastVolume) }, { label: '累计流量', value: compact.format(item.rollingVolume) }, { label: '累计利润', value: compact.format(item.rollingProfit) }, { label: '路径段', value: item.pathEdgeIds.length }], meters: [{ label: '通行风险', value: item.risk }], links: [from ? { id: from.id, kind: 'region' as const, label: from.name, detail: '货源地' } : null, to ? { id: to.id, kind: 'region' as const, label: to.name, detail: '到岸市场' } : null].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)), history: systemHistory(world, 'tradeCorridor', id) };
  }
  if (kind === 'practice') {
    const item = world.practices.find((candidate) => candidate.id === id);
    if (!item) return null;
    const states = world.practiceStates.filter((state) => state.practiceId === id && state.lostTurn === null).sort((a, b) => b.adoption - a.adoption);
    const stateIds = new Set(states.map((state) => state.id));
    const history = scopedHistory(world, (event) => event.stateDeltas.some((delta) => delta.entityType === 'practice' && (delta.entityId === id || stateIds.has(delta.entityId)))
      || event.causes.some((cause) => cause.refs?.some((ref) => ref.entityType === 'practice' && (ref.entityId === id || stateIds.has(ref.entityId)))));
    return { id, kind, name: item.name, subtitle: `${item.category}实践 · 自然发现与传播`, summary: item.description, facts: [{ label: '掌握地区', value: states.length }, { label: '最高采用', value: Math.round(states[0]?.adoption ?? 0) }, { label: '作用强度', value: Math.round(item.effectStrength) }, { label: '遗产基线', value: states.some((state) => state.legacyBaseline) ? '含旧档' : '否' }], meters: [{ label: '最高掌握', value: states[0]?.mastery ?? 0 }, { label: '最高采用', value: states[0]?.adoption ?? 0 }], links: states.slice(0, 6).flatMap((state) => { const knownRegion = region(world, state.regionId); return knownRegion ? [{ id: knownRegion.id, kind: 'region' as const, label: knownRegion.name, detail: `掌握 ${Math.round(state.mastery)} · 采用 ${Math.round(state.adoption)}`, value: Math.round(state.adoption) }] : []; }), history };
  }
  if (kind === 'outbreak') {
    const item = world.infections.find((candidate) => candidate.id === id);
    if (!item) return null;
    const pathogen = world.pathogens.find((candidate) => candidate.id === item.pathogenId);
    const hostLabel = item.hostKind === 'region' ? region(world, item.hostId)?.name : item.hostKind === 'fleet' ? world.fleets.find((candidate) => candidate.id === item.hostId)?.name : world.armies.find((candidate) => candidate.id === item.hostId)?.name;
    return { id, kind, name: pathogen?.name ?? '未识之疫', subtitle: `${hostLabel ?? '未知宿主'} · ${item.infectious > 0 ? '传播中' : '病势已息'}`, summary: item.infectious > 0 ? '当前感染来自本地接触与已记录的人员流动，不会跨越无接触的地域。' : '活跃病例已归零，但康复、免疫与传播记忆仍保留在档案中。', facts: [{ label: '易感', value: compact.format(item.susceptible) }, { label: '潜伏', value: compact.format(item.exposed) }, { label: '染病', value: compact.format(item.infectious) }, { label: '康复', value: compact.format(item.recovered) }, { label: '输入来源', value: item.recentSources.length }], meters: [{ label: '历史峰值', value: Math.min(100, item.peakInfectious / Math.max(1, item.susceptible + item.exposed + item.infectious + item.recovered) * 100) }], links: item.hostKind === 'region' ? [{ id: item.hostId, kind: 'region' as const, label: hostLabel ?? '疫区', detail: '当前宿主地区' }] : [], history: systemHistory(world, 'infection', id) };
  }
  const shipment = world.lastTurn?.trade.shipments.find((item) => item.id === id && item.kind === '迁徙');
  if (!shipment) return null;
  const from = region(world, shipment.originRegionId);
  const to = region(world, shipment.destinationRegionId);
  return { id, kind: 'migration', name: `${from?.name ?? '故土'}迁往${to?.name ?? '新地'}`, subtitle: `${shipment.status} · 当季人口流`, summary: shipment.peopleLost > 0 ? '途中风险造成了可核验的人员损失，幸存者已按到达与落籍分别入账。' : '迁徙沿已接受的路线容量发生，只改变人口所在，不凭空增减世界人口。', facts: [{ label: '启程', value: compact.format(shipment.peopleDeparted) }, { label: '抵达', value: compact.format(shipment.peopleArrived) }, { label: '途中死亡', value: compact.format(shipment.peopleLost) }, { label: '接触量', value: compact.format(shipment.contactVolume) }], links: [from ? { id: from.id, kind: 'region' as const, label: from.name, detail: '迁出地' } : null, to ? { id: to.id, kind: 'region' as const, label: to.name, detail: '目的地' } : null].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)), history: systemHistory(world, 'migration', id) };
}

export function toRegionInspector(world: WorldState, item: RegionState): RegionInspectorData {
  const owner = polity(world, item.controllerId);
  const governor = world.characters.find(
    (character) => character.alive && character.governedRegionId === item.id,
  );
  const resources = [item.river ? '河运' : null, item.port ? '港口' : null]
    .filter((value): value is string => Boolean(value));
  const related: NonNullable<RegionInspectorData['related']> = [];
  const seaLink = world.portLinks.find((link) => link.regionId === item.id);
  const seaZone = world.seaZones.find((zone) => zone.id === seaLink?.seaZoneId);
  if (seaZone) related.push({ id: seaZone.id, kind: 'seaZone', label: seaZone.name, detail: '相连海域' });
  for (const corridor of world.tradeCorridors.filter((entry) => entry.active && (entry.originRegionId === item.id || entry.destinationRegionId === item.id)).slice(0, 2)) {
    related.push({ id: corridor.id, kind: 'tradeCorridor', label: `${region(world, corridor.originRegionId)?.name ?? '起地'}—${region(world, corridor.destinationRegionId)?.name ?? '讫地'}`, detail: `${corridor.commodity}商路 · 流量${compact.format(corridor.lastVolume)}` });
  }
  for (const infection of world.infections.filter((entry) => entry.hostKind === 'region' && entry.hostId === item.id && entry.infectious > 0).slice(0, 1)) {
    related.push({ id: infection.id, kind: 'outbreak', label: world.pathogens.find((pathogen) => pathogen.id === infection.pathogenId)?.name ?? '地方疫病', detail: `染病 ${compact.format(infection.infectious)}` });
  }
  for (const state of world.practiceStates.filter((entry) => entry.regionId === item.id && entry.mastery > 0 && entry.lostTurn === null).sort((a, b) => b.adoption - a.adoption).slice(0, 2)) {
    const practice = world.practices.find((entry) => entry.id === state.practiceId);
    if (practice) related.push({ id: practice.id, kind: 'practice', label: practice.name, detail: `${practice.category} · 采用${Math.round(state.adoption)}` });
  }
  return {
    id: item.id,
    name: item.name,
    terrain: item.terrain,
    climate: item.climate,
    polityName: owner?.name ?? '无主',
    population: item.population,
    food: `${compact.format(Math.max(0, item.food))} · ${foodSafetyRatio(item).toFixed(1)} 季`,
    cityLevel: `${item.cityLevel} 级`,
    defense: item.defense,
    unrest: item.unrest,
    governor: governor?.name ?? '暂缺',
    resources,
    related,
    summary: item.devastation > 35
      ? '战火留下的破坏仍在压低产出与秩序。'
      : item.unrest > 55
        ? '粮赋与地方秩序正在形成显著压力。'
        : item.port
          ? '港路使这里成为税粮、消息与兵船交汇之地。'
          : '地方生产与统治秩序目前维持在可控范围。',
  };
}

export function toCountryInspector(world: WorldState, item: PolityState): CountryInspectorData {
  const owned = world.regions.filter((candidate) => candidate.controllerId === item.id);
  const fieldedSoldiers = world.armies
    .filter((army) => army.polityId === item.id)
    .reduce((sum, army) => sum + army.soldiers, 0);
  const ruler = livingCharacter(world, item.rulerId);
  const capital = region(world, item.capitalRegionId);
  const enemies = world.wars
    .filter((war) => war.active && (war.attackerId === item.id || war.defenderId === item.id))
    .map((war) => polity(world, war.attackerId === item.id ? war.defenderId : war.attackerId)?.name)
    .filter((name): name is string => Boolean(name));
  const rulingFamily = family(world, item.rulingFamilyId);
  const factions = worldFactions(world)
    .filter((faction) => faction.polityId === item.id && faction.active !== false)
    .sort((a, b) => b.power - a.power || a.id.localeCompare(b.id));
  const appointments = worldOffices(world).filter((office) => office.polityId === item.id && office.active);
  const powerholders = world.characters
    .filter((candidate) => candidate.alive && candidate.polityId === item.id)
    .sort((a, b) => (b.influence ?? b.renown) - (a.influence ?? a.renown) || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((candidate) => {
      const office = appointments
        .filter((appointment) => appointment.holderId === candidate.id)
        .sort((a, b) => b.rank - a.rank)[0];
      const faction = factions.find((entry) => entry.memberIds.includes(candidate.id));
      return {
        id: candidate.id,
        name: candidate.name,
        office: office?.kind ?? candidate.role,
        influence: candidate.influence ?? candidate.renown,
        faction: faction?.name,
      };
    });
  const diplomacy = worldDiplomacy(world)
    .filter((relation) => relation.polityAId === item.id || relation.polityBId === item.id)
    .map((relation) => {
      const isA = relation.polityAId === item.id;
      const otherId = isA ? relation.polityBId : relation.polityAId;
      return {
        polityId: otherId,
        polity: polity(world, otherId)?.name ?? '无名政权',
        status: relation.status,
        trust: relation.trust,
        threat: isA ? relation.threatAtoB : relation.threatBtoA,
        grievance: relation.grievance,
        tradeDependency: relation.tradeDependency,
      };
    })
    .sort((a, b) => (a.status === '战争' ? -1 : 0) - (b.status === '战争' ? -1 : 0) || b.threat - a.threat);
  const maritimeAssets: SystemInspectorData['links'] = [
    ...world.fleets.filter((fleet) => fleet.polityId === item.id).map((fleet) => ({ id: fleet.id, kind: 'fleet' as const, label: fleet.name, detail: `${fleet.mission} · 战备${Math.round(fleet.readiness)}`, value: fleet.warships + fleet.transports + fleet.patrolShips })),
    ...world.ports.filter((port) => world.regions.find((candidate) => candidate.id === port.regionId)?.controllerId === item.id).slice(0, 4).flatMap((port) => { const portRegion = region(world, port.regionId); return portRegion ? [{ id: portRegion.id, kind: 'region' as const, label: portRegion.name, detail: `港口${port.level}级 · 吞吐${compact.format(port.throughput)}`, value: port.level }] : []; }),
  ];
  return {
    id: item.id,
    name: item.name,
    ruler: ruler?.name ?? '君位空悬',
    rulerId: ruler?.id,
    capital: capital?.name ?? '流亡政权',
    government: [item.governmentForm, item.dynastyName].filter(Boolean).join(' · '),
    rulingFamily: rulingFamily?.name,
    rulingFamilyId: rulingFamily?.id ?? null,
    population: owned.reduce((sum, candidate) => sum + candidate.population, 0) + fieldedSoldiers,
    treasury: Math.max(0, item.treasury),
    food: owned.reduce((sum, candidate) => sum + candidate.food, 0),
    regionCount: owned.length,
    legitimacy: item.legitimacy,
    centralAuthority: item.authority,
    administration: item.administration,
    courtInfluence: item.courtInfluence,
    atWarWith: enemies,
    factions: factions.map((faction) => ({
      id: faction.id,
      name: faction.name,
      kind: faction.kind,
      leaderId: faction.leaderId,
      leader: character(world, faction.leaderId)?.name ?? '领袖不详',
      power: faction.power,
      cohesion: faction.cohesion,
      agenda: faction.agenda,
    })),
    powerholders,
    diplomacy,
    tradeRevenue: item.tradeRevenue,
    navalBudget: item.navalBudget,
    maritimeOrientation: item.maritimeOrientation,
    maritimeAssets,
    history: scopedHistory(world, (event) => event.polityIds.includes(item.id)),
    status: !item.alive
      ? '该政权已退出当代政治。'
      : enemies.length
        ? `正与${enemies.join('、')}交战。`
        : item.warWeariness > 50
          ? '长期动员正在侵蚀财政与服从。'
          : '政令与财政尚能维持日常统治。',
  };
}

function characterTraits(item: CharacterState) {
  const traits: string[] = [];
  if (item.ambition >= 72) traits.push('雄心炽盛');
  if (item.loyalty >= 75) traits.push('重诺');
  if (item.loyalty <= 35) traits.push('离心');
  if (item.caution >= 72) traits.push('审慎');
  if (item.caution <= 30) traits.push('敢决');
  if (item.renown >= 65) traits.push('声名远播');
  return traits.length ? traits : ['尚未显露鲜明声名'];
}

function relationSalience(item: RelationshipState) {
  return Math.max(Math.abs(item.affinity), item.trust, item.fear, item.grievance, item.gratitude);
}

function relationSentiment(item: RelationshipState) {
  if (item.grievance >= 65) return '积怨深重';
  if (item.fear >= 65) return '敬惧';
  if (item.trust >= 70 && item.affinity >= 30) return '亲信';
  if (item.gratitude >= 60) return '感恩';
  if (item.affinity <= -35) return '不睦';
  if (item.affinity >= 35) return '亲近';
  return '往来平淡';
}

export function toPersonInspector(world: WorldState, item: CharacterState): PersonInspectorData {
  const owner = polity(world, item.polityId);
  const home = region(world, item.locationRegionId);
  const personFamily = family(world, item.familyId);
  const agency = toCharacterAgencyPlayerProjection(projectCharacterAgency(world, item.id));
  const currentStep = agency.currentPlanSteps.find((step) => step.status === 'available');
  const coreDesires = agency.desires.map((desire) => desire.label);
  const relationships = worldRelationships(world)
    .filter((relation) => relation.sourceId === item.id || relation.targetId === item.id)
    .sort((a, b) => relationSalience(b) - relationSalience(a) || a.id.localeCompare(b.id))
    .slice(0, 10)
    .map((relation) => {
      const targetId = relation.sourceId === item.id ? relation.targetId : relation.sourceId;
      return {
        id: relation.id,
        targetId,
        name: character(world, targetId)?.name ?? '无名之人',
        relation: relation.kinship === '无' ? relation.memories.at(-1)?.kind ?? '相识' : relation.kinship,
        sentiment: relationSentiment(relation),
        detail: `信任 ${Math.round(relation.trust)} · 怨 ${Math.round(relation.grievance)}`,
        memories: [...relation.memories]
          .sort((a, b) => b.turn - a.turn)
          .slice(0, 2)
          .map((memory) => memory.summary),
      };
    });
  const experiences = toPersonExperienceRecords(world, item).slice(-12).reverse();
  return {
    id: item.id,
    name: item.name,
    age: item.age,
    gender: item.sex,
    role: item.alive ? item.role : '已故',
    lifeStage: item.lifeStage,
    politicalClass: item.politicalClass,
    tier: item.tier,
    origin: home?.name,
    family: personFamily?.name ?? `${item.familyName}氏`,
    familyId: personFamily?.id ?? null,
    polity: owner?.name,
    health: item.alive ? 100 : 0,
    influence: item.influence,
    personalWealth: item.personalWealth,
    merit: item.merit,
    deputyExperience: item.deputyExperience,
    insubordination: item.insubordination,
    ambition: item.ambition,
    loyalty: item.loyalty,
    caution: item.caution,
    abilities: {
      command: item.leadership,
      martial: Math.round(item.leadership * 0.72 + item.caution * 0.12),
      governance: item.governance,
      strategy: item.cunning,
      charisma: Math.round((item.renown + item.loyalty) / 2),
      scholarship: Math.round((item.governance + item.cunning) / 2),
    },
    agency,
    traits: characterTraits(item),
    relationships,
    experiences,
    summary: agency.primaryGoal
      ? `所图：${agency.primaryGoal.label}。${currentStep ? `眼下先${currentStep.label}` : agency.primaryGoal.reason}${agency.primaryGoal.barrier ? `；难处在于${agency.primaryGoal.barrier}` : ''}。`
      : agency.availability === 'dormant'
        ? `最看重${coreDesires.join('与') || agency.longTermDirectionLabel}，尚未成年，眼下还没有明确打算。`
        : agency.availability === 'closed'
          ? `此人生平已定；其长远所重以${agency.longTermDirectionLabel}为先。`
          : `最看重${coreDesires.join('与') || agency.longTermDirectionLabel}，眼下仍在权衡。`,
  };
}

function familyEvent(item: FamilyState, event: HistoryEvent) {
  const memberIds = new Set(item.memberIds);
  return event.actorIds.some((id) => memberIds.has(id))
    || event.stateDeltas.some((delta) => delta.entityType === 'family' && delta.entityId === item.id);
}

export function toFamilyInspector(world: WorldState, item: FamilyState): FamilyInspectorData {
  const owner = polity(world, item.polityId);
  const founder = character(world, item.founderId);
  const head = character(world, item.headId);
  const members = item.memberIds
    .map((id) => character(world, id))
    .filter((candidate): candidate is CharacterState => Boolean(candidate))
    .sort((a, b) => Number(b.id === item.headId) - Number(a.id === item.headId)
      || Number(b.alive) - Number(a.alive)
      || (b.influence ?? b.renown) - (a.influence ?? a.renown));
  const alliances = item.marriageAllianceFamilyIds
    .map((id) => family(world, id))
    .filter((candidate): candidate is FamilyState => Boolean(candidate))
    .map((candidate) => ({ id: candidate.id, name: candidate.name, detail: '以婚姻维系的盟族' }));
  const leadingTradition = Object.entries(item.traditions)
    .sort(([, a], [, b]) => b - a)[0]?.[0];
  const traditionLabel = ({ political: '从政', military: '军旅', commercial: '商贸', scholarly: '学术' } as Record<string, string>)[leadingTradition] ?? '立身';
  return {
    id: item.id,
    name: item.name,
    branch: item.branchName ?? undefined,
    polity: owner?.name,
    polityId: owner?.id ?? null,
    founder: founder?.name ?? '始祖失考',
    founderId: founder?.id,
    head: head?.name ?? '家主未定',
    headId: head?.id,
    founded: turnLabel(item.foundedTurn),
    memberCount: members.length,
    prestige: item.prestige,
    wealth: item.wealth,
    politicalInfluence: item.politicalInfluence,
    traditions: item.traditions,
    alliances,
    members: members.slice(0, 20).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      age: member.age,
      influence: member.influence ?? member.renown,
      alive: member.alive,
    })),
    history: scopedHistory(world, (event) => familyEvent(item, event)),
    summary: item.politicalInfluence >= 65
      ? `${item.name}已成为${owner?.name ?? '当世'}朝局中不可忽视的门第，以${traditionLabel}传统维系声名。`
      : item.prestige >= 60
        ? `${item.name}声望渐著，族中人物正在把${traditionLabel}传统转化为实际地位。`
        : `${item.name}仍在积累家产、婚盟与可传之后世的功名。`,
  };
}

function uniqueArchiveLinks(links: Array<ArchiveLink | null | undefined>) {
  const seen = new Set<string>();
  return links.filter((link): link is ArchiveLink => {
    if (!link) return false;
    const key = `${link.kind}:${link.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventArchiveRecord(item: HistoryEvent): ArchiveRecord {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    importance: item.importance,
    eventId: item.id,
  };
}

export function toCountryArchive(world: WorldState, item: PolityState): ArchiveDossier {
  const inspector = toCountryInspector(world, item);
  const ruler = character(world, item.rulerId);
  const rulingFamily = family(world, item.rulingFamilyId);
  const records = world.history.filter((event) => event.polityIds.includes(item.id)).map(eventArchiveRecord);
  const factionSentence = inspector.factions?.length
    ? `${inspector.factions.map((faction) => `${faction.name}主张${faction.agenda}`).join('；')}。其中${inspector.factions[0].name}权势最盛。`
    : '朝中尚未形成足以被史家命名的稳定派系，权力更多系于具体官职与个人。';
  const diplomacySentence = inspector.diplomacy?.length
    ? inspector.diplomacy.map((relation) => `与${relation.polity}${relation.status}`).join('，') + '。'
    : '现存记录中未见稳定联盟、朝贡或公开敌对关系。';
  return {
    id: item.id,
    kind: 'country',
    eyebrow: '国家史 · 政权本纪',
    title: `${item.name}本纪`,
    subtitle: `${inspector.government ?? '政体未详'} · ${item.alive ? '当代政权' : '已亡政权'}`,
    lead: `${item.name}的兴衰并非由一场战役或一位君主独自决定。领地、财政、合法性与朝中人物的选择，共同写成了这一政权的历史。`,
    facts: [
      { label: '国主', value: inspector.ruler }, { label: '都城', value: inspector.capital },
      { label: '领地', value: `${inspector.regionCount} 郡` }, { label: '府库', value: compact.format(Number(item.treasury) || 0) },
      { label: '合法性', value: String(Math.round(item.legitimacy)) }, { label: '中央权威', value: String(Math.round(item.authority)) },
    ],
    chapters: [
      { id: 'foundation', title: '立国之本', paragraphs: [`${item.name}以${inspector.capital}为中枢，现掌${inspector.regionCount}地。${inspector.status ?? ''}`, `宗主门第为${rulingFamily?.name ?? '未定'}；行政能力为${Math.round(item.administration)}，朝廷控制为${Math.round(item.courtInfluence ?? 0)}。`] },
      { id: 'court', title: '朝局与权臣', paragraphs: [factionSentence, inspector.powerholders?.length ? `当下最具影响的人物包括${inspector.powerholders.map((person) => `${person.name}（${person.office}）`).join('、')}。` : '朝廷尚无可确考的权力中枢人物。'] },
      { id: 'diplomacy', title: '邦交与威胁', paragraphs: [diplomacySentence, item.warWeariness > 50 ? `战争疲惫已达${Math.round(item.warWeariness)}，继续动员将侵蚀财政与服从。` : '长期动员尚未成为压倒性的国内负担。'] },
    ],
    records,
    links: uniqueArchiveLinks([
      ruler ? { id: ruler.id, kind: 'person', label: ruler.name, detail: '当代君主' } : null,
      rulingFamily ? { id: rulingFamily.id, kind: 'family', label: rulingFamily.name, detail: '宗主家族' } : null,
      ...(inspector.powerholders ?? []).map((person) => ({ id: person.id, kind: 'person' as const, label: person.name, detail: person.office })),
      ...(inspector.diplomacy ?? []).slice(0, 4).map((relation) => ({ id: relation.polityId, kind: 'country' as const, label: relation.polity, detail: relation.status })),
    ]).slice(0, 10),
  };
}

export function toFamilyArchive(world: WorldState, item: FamilyState): ArchiveDossier {
  const inspector = toFamilyInspector(world, item);
  const founder = character(world, item.founderId);
  const head = character(world, item.headId);
  const owner = polity(world, item.polityId);
  const relatedEvents = world.history.filter((event) => familyEvent(item, event));
  const records = [
    { turn: item.foundedTurn, record: { id: `${item.id}-founded`, date: turnLabel(item.foundedTurn), title: `${item.name}立族`, summary: `${founder?.name ?? '先祖'}被后世奉为家族始祖。`, importance: 3 } },
    ...relatedEvents.map((event) => ({ turn: event.turn, record: eventArchiveRecord(event) })),
  ].sort((a, b) => a.turn - b.turn || a.record.id.localeCompare(b.record.id)).map((entry) => entry.record);
  const tradition = item.traditions;
  return {
    id: item.id,
    kind: 'family',
    eyebrow: '家族史 · 谱牒世录',
    title: `${item.name}世录`,
    subtitle: `${owner?.name ?? '无属'} · ${item.branchName ?? '本宗'} · ${item.memberIds.length} 名入谱人物`,
    lead: `${item.name}的兴衰由婚姻、家产、官职与每一代人的选择累积而成。声望能够继承，风险也会沿着血缘与盟约传给后人。`,
    facts: [
      { label: '始祖', value: inspector.founder }, { label: '家主', value: inspector.head },
      { label: '家望', value: String(Math.round(item.prestige)) }, { label: '家产', value: compact.format(item.wealth) },
      { label: '政治影响', value: String(Math.round(item.politicalInfluence)) }, { label: '婚盟', value: `${item.marriageAllianceFamilyIds.length} 家` },
    ],
    chapters: [
      { id: 'lineage', title: '源流与门第', paragraphs: [`${inspector.founder}于${turnLabel(item.foundedTurn)}开此一族，今由${inspector.head}主家。${inspector.summary ?? ''}`, item.parentFamilyId ? `此支由${family(world, item.parentFamilyId)?.name ?? '旧族'}分出，另号${item.branchName ?? '支族'}。` : '此族被视作独立本宗，未见更早分支记录。'] },
      { id: 'tradition', title: '家风所长', paragraphs: [`从政传统${Math.round(tradition.political)}，军旅传统${Math.round(tradition.military)}，商业传统${Math.round(tradition.commercial)}，学术传统${Math.round(tradition.scholarly)}。`, `这些传统不是永久加成，而是族人经历、任职与社会记忆的沉积；后代仍需以行动维持。`] },
      { id: 'marriage', title: '婚盟与人脉', paragraphs: [inspector.alliances?.length ? `${item.name}已与${inspector.alliances.map((alliance) => alliance.name).join('、')}结为婚盟。` : '此族尚无稳定婚盟，政治风险更多由本族独自承担。', `族中现有${inspector.members?.filter((member) => member.alive).length ?? 0}名在世人物可查，其中${inspector.members?.[0]?.name ?? '尚无人'}影响最著。`] },
    ],
    records,
    links: uniqueArchiveLinks([
      head ? { id: head.id, kind: 'person', label: head.name, detail: '当代家主' } : null,
      founder ? { id: founder.id, kind: 'person', label: founder.name, detail: '家族始祖' } : null,
      owner ? { id: owner.id, kind: 'country', label: owner.name, detail: '所属政权' } : null,
      ...(inspector.members ?? []).slice(0, 5).map((member) => ({ id: member.id, kind: 'person' as const, label: member.name, detail: member.alive ? member.role : '已故族人' })),
      ...(inspector.alliances ?? []).map((alliance) => ({ id: alliance.id, kind: 'family' as const, label: alliance.name, detail: alliance.detail })),
    ]).slice(0, 10),
  };
}

export function toPersonArchive(world: WorldState, item: CharacterState): ArchiveDossier {
  const inspector = toPersonInspector(world, item);
  const owner = polity(world, item.polityId);
  const personFamily = family(world, item.familyId);
  const records: ArchiveRecord[] = toPersonExperienceRecords(world, item);
  const relationships = inspector.relationships ?? [];
  const agency = inspector.agency;
  const desireSentence = agency?.desires.length
    ? `${item.name}眼下最看重${agency.desires.map((desire) => desire.label).join('与')}`
    : `${item.name}的心中轻重尚未显明`;
  const goalSentence = agency?.primaryGoal
    ? `目前正在盘算「${agency.primaryGoal.label}」；${agency.primaryGoal.reason}${agency.primaryGoal.barrier ? `，眼下难处在于${agency.primaryGoal.barrier}` : ''}。`
    : agency?.availability === 'dormant'
      ? '年岁尚轻，尚未形成可以付诸世事的打算。'
      : agency?.availability === 'closed'
        ? '生平已定，不再形成新的打算。'
        : '眼下尚未形成明确打算。';
  return {
    id: item.id,
    kind: 'person',
    eyebrow: '人物传 · 生平行状',
    title: `${item.name}传`,
    subtitle: `${owner?.name ?? '无属'} · ${item.role} · ${item.lifeStage ?? `${item.age}岁`}`,
    lead: `${item.name}并非一组能力数字。出身决定最初的道路，性情与欲望塑造每次选择，而战争、任职、恩怨和挫折将这些选择写成人生。`,
    facts: [
      { label: '生年', value: turnLabel(item.birthTurn ?? Math.max(0, world.turn - item.age * 4)) },
      { label: '家族', value: inspector.family ?? '家世不详' }, { label: '阶层', value: item.politicalClass ?? '出身未详' },
      { label: '功绩', value: String(Math.round(item.merit ?? 0)) }, { label: '影响', value: String(Math.round(item.influence ?? item.renown)) },
      { label: '现职', value: item.alive ? item.role : '已故' },
    ],
    chapters: [
      { id: 'origin', title: '身世与起点', paragraphs: [`${item.name}出自${personFamily?.name ?? `${item.familyName}氏`}，被归入${item.politicalClass ?? '未详'}阶层，早年活动于${region(world, item.locationRegionId)?.name ?? '乡里失考'}。`, item.adultTurn === null ? '尚未成年，未来身份仍将受家族与时代局势塑造。' : `于${turnLabel(item.adultTurn)}步入成年，此后才真正进入任职、婚姻与政治选择的网络。`] },
      { id: 'career', title: '仕途与功业', paragraphs: [`现任${item.role}，功绩${Math.round(item.merit ?? 0)}、个人影响${Math.round(item.influence ?? item.renown)}。${inspector.summary ?? ''}`, item.commandingArmyId ? `手握军令，且有${Math.round(item.deputyExperience ?? 0)}点副将历练；其抗命倾向为${Math.round(item.insubordination ?? 0)}。` : '此时未直接统率军团，政治与家族网络更能决定其下一步。'] },
      { id: 'mind', title: '心志与关系', paragraphs: [`${desireSentence}。${goalSentence}这些只是当下盘算，不代表行动已经发生。`, relationships.length ? `与其关系最深者包括${relationships.slice(0, 4).map((relation) => `${relation.name}（${relation.sentiment}）`).join('、')}。` : '现存史料未留下足以构成长期记忆的人际关系。'] },
    ],
    records,
    links: uniqueArchiveLinks([
      personFamily ? { id: personFamily.id, kind: 'family', label: personFamily.name, detail: '所属家族' } : null,
      owner ? { id: owner.id, kind: 'country', label: owner.name, detail: '所仕政权' } : null,
      ...relationships.slice(0, 7).map((relation) => ({ id: relation.targetId, kind: 'person' as const, label: relation.name, detail: `${relation.relation} · ${relation.sentiment}` })),
    ]).slice(0, 10),
  };
}

function tone(category: EventCategory, kind: string): ChronicleTone {
  if (kind.includes('继承') || kind.includes('即位') || kind.includes('建国')) return 'succession';
  if (category === '军事' || category === '外交') return 'conflict';
  if (kind.includes('饥') || kind.includes('叛') || kind.includes('灭亡')) return 'crisis';
  if (category === '经济' || category === '人口') return 'prosperity';
  return 'neutral';
}

export function toChronicleEvent(world: WorldState, item: HistoryEvent): ChronicleEvent {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    category: item.category,
    title: item.title,
    summary: item.summary,
    location: item.regionIds.map((id) => region(world, id)?.name).filter(Boolean).join('、'),
    actors: item.actorIds.map((id) => character(world, id)?.name).filter((name): name is string => Boolean(name)),
    tone: tone(item.category, item.kind),
    isMajor: item.importance >= 4,
    causeCount: item.causes.length,
  };
}

function factorRole(index: number, total: number, explicitRole?: HistoryEvent['causes'][number]['role']): CausalFactor['role'] {
  if (explicitRole === '结构') return 'structure';
  if (explicitRole === '条件') return 'condition';
  if (explicitRole === '触发') return 'trigger';
  if (explicitRole === '选择') return 'choice';
  if (explicitRole === '结果') return 'outcome';
  if (index === total - 1) return 'trigger';
  if (index === 0) return 'structure';
  return 'condition';
}

function causalActorSummary(world: WorldState, item: HistoryEvent) {
  if (!item.actorIds.length) return undefined;
  if (item.kind === 'world_created') return `${item.actorIds.length}名初始人物`;
  const names = item.actorIds
    .map((id) => character(world, id)?.name)
    .filter((name): name is string => Boolean(name));
  const shown = names.slice(0, 6).join('、');
  return names.length > 6 ? `${shown}等${names.length}人` : shown || `${item.actorIds.length}名相关人物`;
}

function causalReference(world: WorldState, ref: NonNullable<HistoryEvent['causes'][number]['refs']>[number]): CausalReference | null {
  const detail = ref.field ? `${ref.label} · ${ref.field}` : ref.label;
  if (ref.entityType === 'region') {
    const item = region(world, ref.entityId);
    return item ? { id: item.id, kind: 'region', label: item.name, detail } : null;
  }
  if (ref.entityType === 'seaZone') {
    const item = world.seaZones.find((candidate) => candidate.id === ref.entityId);
    return item ? { id: item.id, kind: 'seaZone', label: item.name, detail } : null;
  }
  if (ref.entityType === 'fleet') {
    const item = world.fleets.find((candidate) => candidate.id === ref.entityId);
    return item ? { id: item.id, kind: 'fleet', label: item.name, detail } : null;
  }
  if (ref.entityType === 'tradeCorridor') {
    const item = world.tradeCorridors.find((candidate) => candidate.id === ref.entityId);
    const from = item ? region(world, item.originRegionId) : undefined;
    const to = item ? region(world, item.destinationRegionId) : undefined;
    return item ? { id: item.id, kind: 'tradeCorridor', label: `${from?.name ?? '起地'}—${to?.name ?? '讫地'}`, detail } : null;
  }
  if (ref.entityType === 'practice') {
    const state = world.practiceStates.find((candidate) => candidate.id === ref.entityId);
    const item = world.practices.find((candidate) => candidate.id === (state?.practiceId ?? ref.entityId));
    const practiceRegion = state ? region(world, state.regionId) : undefined;
    return item ? { id: item.id, kind: 'practice', label: item.name, detail: practiceRegion ? `${practiceRegion.name} · ${detail}` : detail } : null;
  }
  if (ref.entityType === 'infection') {
    const infection = world.infections.find((candidate) => candidate.id === ref.entityId);
    const pathogen = world.pathogens.find((candidate) => candidate.id === infection?.pathogenId);
    return infection ? { id: infection.id, kind: 'outbreak', label: pathogen?.name ?? '疫病记录', detail } : null;
  }
  if (ref.entityType === 'pathogen') {
    const infection = world.infections.find((candidate) => candidate.pathogenId === ref.entityId);
    const pathogen = world.pathogens.find((candidate) => candidate.id === ref.entityId);
    return infection ? { id: infection.id, kind: 'outbreak', label: pathogen?.name ?? '疫病记录', detail } : null;
  }
  if (ref.entityType === 'shipment' || ref.entityType === 'migration') {
    const shipment = world.lastTurn?.trade.shipments.find((candidate) => candidate.id === ref.entityId);
    return shipment?.kind === '迁徙' ? { id: shipment.id, kind: 'migration', label: '当季迁徙', detail } : null;
  }
  if (ref.entityType === 'port') {
    const port = world.ports.find((candidate) => candidate.id === ref.entityId);
    const portRegion = region(world, port?.regionId);
    return portRegion ? { id: portRegion.id, kind: 'region', label: portRegion.name, detail: `港口 · ${detail}` } : null;
  }
  if (ref.entityType === 'character') {
    const item = character(world, ref.entityId);
    return item ? { id: item.id, kind: 'person', label: item.name, detail } : null;
  }
  if (ref.entityType === 'polity') {
    const item = polity(world, ref.entityId);
    return item ? { id: item.id, kind: 'country', label: item.name, detail } : null;
  }
  if (ref.entityType === 'army') {
    const army = world.armies.find((candidate) => candidate.id === ref.entityId);
    const commander = character(world, army?.commanderId);
    return commander ? { id: commander.id, kind: 'person', label: army?.name ?? commander.name, detail: `军团 · ${detail}` } : null;
  }
  return null;
}

export function toCausalEvent(world: WorldState, item: HistoryEvent): CausalEvent {
  const actorSummary = causalActorSummary(world, item);
  const factors: CausalFactor[] = item.causes.map((cause, index) => ({
    id: `${item.id}-cause-${index}`,
    role: factorRole(index, item.causes.length, cause.role),
    label: cause.label,
    detail: cause.weight >= 0.7 ? '这是促成该结果的主导压力。' : '这一条件放大了行动发生或成功的可能。',
    actor: (item.kind === 'world_created' && index === 0)
      || cause.role === '选择'
      || (!cause.role && index === item.causes.length - 1)
      ? actorSummary
      : undefined,
    evidence: cause.evidence,
    refs: (cause.refs ?? []).map((ref) => causalReference(world, ref)).filter((ref): ref is CausalReference => Boolean(ref)),
  }));
  factors.push({
    id: `${item.id}-outcome`,
    role: 'outcome',
    label: item.title,
    detail: item.summary,
    evidence: item.stateDeltas.length
      ? `${item.stateDeltas.length} 项世界状态发生改变`
      : item.evidence[0],
  });
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    factors,
    subjects: uniqueArchiveLinks([
      ...item.actorIds.map((id) => {
        const actor = character(world, id);
        return actor ? { id: actor.id, kind: 'person' as const, label: actor.name, detail: actor.role } : null;
      }),
      ...item.actorIds.map((id) => {
        const actorFamily = family(world, character(world, id)?.familyId);
        return actorFamily ? { id: actorFamily.id, kind: 'family' as const, label: actorFamily.name, detail: '相关人物家族' } : null;
      }),
      ...item.polityIds.map((id) => {
        const eventPolity = polity(world, id);
        return eventPolity ? { id: eventPolity.id, kind: 'country' as const, label: eventPolity.name, detail: '相关政权' } : null;
      }),
      ...item.causes.flatMap((cause) => (cause.refs ?? []).map((ref) => {
        const resolved = causalReference(world, ref);
        return resolved ? { id: resolved.id, kind: resolved.kind, label: resolved.label, detail: resolved.detail } : null;
      })),
    ]).slice(0, 8),
    consequence: item.stateDeltas.slice(0, 2).map((delta) => `${delta.field}：${String(delta.before)} → ${String(delta.after)}`).join('；'),
  };
}

export function polityRoster(world: WorldState): RosterItem[] {
  return world.polities
    .filter((item) => item.alive)
    .sort((a, b) => b.controlledRegionIds.length - a.controlledRegionIds.length || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(world, item.rulerId)?.name ?? '君位空悬'} · ${region(world, item.capitalRegionId)?.name ?? '无都'}`,
      meta: `${item.controlledRegionIds.length} 地 · 威权 ${Math.round(item.authority)}`,
      accent: item.color,
      alert: item.warWeariness > 55,
    }));
}

export function peopleRoster(world: WorldState): RosterItem[] {
  return world.characters
    .filter((item) => item.alive)
    .sort((a, b) => b.renown - a.renown || b.ambition - a.ambition || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${polity(world, item.polityId)?.name ?? '无属'} · ${item.role} · ${item.politicalClass ?? '出身未详'}`,
      meta: `${item.age} 岁 · 影响 ${Math.round(item.influence ?? item.renown)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.ambition > 78 && item.loyalty < 40,
    }));
}

export function familyRoster(world: WorldState): RosterItem[] {
  return worldFamilies(world)
    .slice()
    .sort((a, b) => b.prestige - a.prestige || b.politicalInfluence - a.politicalInfluence || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${polity(world, item.polityId)?.name ?? '无属'} · ${item.active === false ? '谱系已绝' : `家主 ${character(world, item.headId)?.name ?? '未定'}`}`,
      meta: `${item.memberIds.length} 人 · 家望 ${Math.round(item.prestige)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.active === false || !character(world, item.headId)?.alive,
    }));
}

export function militaryRoster(world: WorldState): RosterItem[] {
  const armies = world.armies
    .filter((item) => item.soldiers > 0)
    .sort((a, b) => b.soldiers - a.soldiers || a.id.localeCompare(b.id))
    .map((item: ArmyState) => ({
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(world, item.commanderId)?.name ?? '无帅'} · 驻${region(world, item.regionId)?.name ?? '途中'}`,
      meta: `${compact.format(item.soldiers)} 人 · 士气 ${Math.round(item.morale)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.supply < 45 || item.morale < 40,
    }));
  const fleets = world.fleets
    .slice()
    .sort((a, b) => (b.warships + b.patrolShips) - (a.warships + a.patrolShips) || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(world, item.commanderId)?.name ?? '无帅'} · ${item.mission}`,
      meta: `${item.warships + item.transports + item.patrolShips} 船 · 战备 ${Math.round(item.readiness)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.repairNeed > 55 || item.morale < 40,
    }));
  return [...fleets, ...armies];
}
