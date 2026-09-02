import type {
  HistoryEvent,
  SimulationFact,
  StateDelta,
  WorldState,
} from '../sim/types';

export type CoreImpactSource = '粮食' | '疾病' | '地方压力';
export type CoreImpactTargetKind = 'army' | 'polity' | 'person' | 'war';
export type CoreImpactKind = '兵力' | '军令' | '合法性' | '官职' | '兵权' | '人物行动';

export interface CoreImpactTarget {
  kind: CoreImpactTargetKind;
  id: string;
}

export interface CoreImpactBeforeAfter {
  label: string;
  before: number | string | boolean | null;
  after: number | string | boolean | null;
}

export interface CoreImpactProjection {
  id: string;
  turn: number;
  source: CoreImpactSource;
  target: CoreImpactTarget;
  impact: CoreImpactKind;
  summary: string;
  beforeAfter?: CoreImpactBeforeAfter;
  sourceFactIds: readonly string[];
  sourceEventIds: readonly string[];
  relatedTargets: readonly CoreImpactTarget[];
  relatedWarId: string | null;
}

export interface CoreImpactScope {
  target?: Pick<CoreImpactTarget, 'kind' | 'id'>;
  warId?: string;
  sourceFactIds?: readonly string[];
  sources?: readonly CoreImpactSource[];
  limit?: number;
}

interface RankedImpact extends CoreImpactProjection {
  priority: number;
}

const ORDER_LABELS = {
  hold: '驻守',
  advance: '进军',
  intercept: '截击',
  reinforce: '驰援',
  retreat: '撤退',
} as const;

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort(stableCompare);
}

function currentFacts(world: WorldState): SimulationFact[] {
  const report = world.lastTurn;
  if (!report) return [];
  const ids = new Set(report.factIds);
  return world.facts
    .filter((fact) => fact.turn === report.turn && ids.has(fact.id))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function currentEvents(world: WorldState): HistoryEvent[] {
  const report = world.lastTurn;
  if (!report) return [];
  const ids = new Set(report.eventIds);
  return world.history
    .filter((event) => event.turn === report.turn && ids.has(event.id))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function target(kind: CoreImpactTargetKind, id: string): CoreImpactTarget {
  return { kind, id };
}

function deltaFor(
  deltas: readonly StateDelta[],
  entityType: StateDelta['entityType'],
  entityId: string,
  field: string,
): StateDelta | undefined {
  return deltas.find((delta) => (
    delta.entityType === entityType && delta.entityId === entityId && delta.field === field
  ));
}

function eventIdsForFact(events: readonly HistoryEvent[], factId: string): string[] {
  return events.filter((event) => event.sourceFactIds.includes(factId)).map((event) => event.id);
}

function lowReadinessImpacts(world: WorldState, facts: readonly SimulationFact[], events: readonly HistoryEvent[]): RankedImpact[] {
  return facts.flatMap((fact) => {
    if (fact.kind !== 'army_order_changed' || fact.payload.next.reasonCode !== 'low_readiness') return [];
    const army = world.armies.find((item) => item.id === fact.payload.armyId);
    if (!army || army.supply >= 30) return [];
    const commander = world.characters.find((person) => person.id === army.commanderId);
    const previous = ORDER_LABELS[fact.payload.previous.kind];
    const next = ORDER_LABELS[fact.payload.next.kind];
    return [{
      id: `core-impact:order:${fact.id}`,
      turn: fact.turn,
      source: '粮食' as const,
      target: target('army', army.id),
      impact: '军令' as const,
      summary: `${army.name}补给仅${Math.round(army.supply)}；${commander?.name ?? '主帅'}已将军令由${previous}改为${next}，军令事实明记缘由为军粮或军心不足。`,
      beforeAfter: { label: '军令', before: previous, after: next },
      sourceFactIds: unique([fact.id, ...fact.sourceFactIds]),
      sourceEventIds: eventIdsForFact(events, fact.id),
      relatedTargets: [
        target('polity', army.polityId),
        ...(commander ? [target('person', commander.id)] : []),
      ],
      relatedWarId: fact.payload.next.warId,
      priority: 92,
    }];
  });
}

function battleSupplyImpacts(world: WorldState, facts: readonly SimulationFact[], events: readonly HistoryEvent[]): RankedImpact[] {
  return facts.flatMap((fact) => {
    if (fact.kind !== 'battle') return [];
    const forces = [fact.payload.attacker, ...fact.payload.defenders]
      .filter((force) => force.supplyBefore < 60)
      .sort((left, right) => left.supplyBefore - right.supplyBefore || stableCompare(left.armyId, right.armyId));
    const force = forces[0];
    if (!force) return [];
    const army = world.armies.find((item) => item.id === force.armyId);
    const commander = world.characters.find((person) => person.id === force.commanderId);
    const armyLabel = army?.name ?? (commander ? `${commander.name}所部` : force.armyId);
    const battlefield = world.regions.find((region) => region.id === fact.payload.targetRegionId)?.name ?? '战场';
    return [{
      id: `core-impact:battle:${fact.id}`,
      turn: fact.turn,
      source: '粮食' as const,
      target: target('army', force.armyId),
      impact: '兵力' as const,
      summary: `${armyLabel}以补给${Math.round(force.supplyBefore)}投入${battlefield}之战；该补给与士气已进入实际战力结算，兵力由${Math.round(force.soldiersBefore)}变为${Math.round(force.soldiersAfter)}。`,
      beforeAfter: { label: '兵力', before: force.soldiersBefore, after: force.soldiersAfter },
      sourceFactIds: unique([fact.id, ...fact.sourceFactIds]),
      sourceEventIds: eventIdsForFact(events, fact.id),
      relatedTargets: [
        target('war', fact.payload.warId),
        target('polity', force.polityId),
        ...(commander ? [target('person', commander.id)] : []),
      ],
      relatedWarId: fact.payload.warId,
      priority: 100,
    }];
  });
}

function localGovernanceImpacts(world: WorldState, facts: readonly SimulationFact[], events: readonly HistoryEvent[]): RankedImpact[] {
  return facts.flatMap((fact) => {
    if (fact.kind !== 'local_governance_resolved' || fact.payload.outcome !== 'enacted') return [];
    const legitimacy = deltaFor(fact.stateDeltas, 'polity', fact.payload.polityId, 'legitimacy');
    if (!legitimacy && fact.payload.pressure < 60) return [];
    const region = world.regions.find((item) => item.id === fact.payload.regionId);
    const actor = world.characters.find((person) => person.id === fact.payload.actorId);
    const action = fact.payload.action === 'open_granary' ? '开仓赈济' : '减免当季赋';
    const legitimacyText = legitimacy ? `，合法性${String(legitimacy.before)}→${String(legitimacy.after)}` : '';
    return [{
      id: `core-impact:governance:${fact.id}`,
      turn: fact.turn,
      source: '地方压力' as const,
      target: target('polity', fact.payload.polityId),
      impact: legitimacy ? '合法性' as const : '人物行动' as const,
      summary: `${region?.name ?? '当地'}在粮可支${fact.payload.foodSeasonsBefore.toFixed(1)}季、动荡${Math.round(fact.payload.unrestBefore)}的压力下，${actor?.name ?? '地方长官'}实行${action}；动荡${Math.round(fact.payload.unrestBefore)}→${Math.round(fact.payload.unrestAfter)}${legitimacyText}。`,
      beforeAfter: legitimacy
        ? { label: '合法性', before: legitimacy.before, after: legitimacy.after }
        : { label: '地方动荡', before: fact.payload.unrestBefore, after: fact.payload.unrestAfter },
      sourceFactIds: unique([fact.id, ...fact.sourceFactIds]),
      sourceEventIds: eventIdsForFact(events, fact.id),
      relatedTargets: [
        ...(actor ? [target('person', actor.id)] : []),
      ],
      relatedWarId: null,
      priority: legitimacy ? 84 : 70,
    }];
  });
}

function legitimacyCrisisImpacts(world: WorldState, events: readonly HistoryEvent[]): RankedImpact[] {
  return events.flatMap((event) => {
    if (event.kind !== 'legitimacy_crisis') return [];
    const legitimacy = event.stateDeltas.find((delta) => delta.entityType === 'polity' && delta.field === 'legitimacy');
    if (!legitimacy) return [];
    const polityId = legitimacy.entityId;
    const polity = world.polities.find((item) => item.id === polityId);
    const food = event.causes.find((cause) => cause.label === '粮食安全')?.evidence;
    const unrest = event.causes.find((cause) => cause.label === '民间不安')?.evidence;
    const authority = event.stateDeltas.find((delta) => delta.entityType === 'polity' && delta.entityId === polityId && delta.field === 'authority');
    return [{
      id: `core-impact:legitimacy:${event.id}`,
      turn: event.turn,
      source: '地方压力' as const,
      target: target('polity', polityId),
      impact: '合法性' as const,
      summary: `${[food, unrest].filter(Boolean).join('、')}等压力已进入朝局结算；${polity?.name ?? '该政权'}合法性${String(legitimacy.before)}→${String(legitimacy.after)}${authority ? `，中央权威${String(authority.before)}→${String(authority.after)}` : ''}。`,
      beforeAfter: { label: '合法性', before: legitimacy.before, after: legitimacy.after },
      sourceFactIds: unique(event.sourceFactIds),
      sourceEventIds: [event.id],
      relatedTargets: [],
      relatedWarId: null,
      priority: 88,
    }];
  });
}

function rebellionImpacts(facts: readonly SimulationFact[], events: readonly HistoryEvent[]): RankedImpact[] {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  return events.flatMap((event) => {
    if (event.kind !== 'rebellion') return [];
    const warFact = event.sourceFactIds
      .map((id) => factById.get(id))
      .find((fact): fact is Extract<SimulationFact, { kind: 'war_started' }> => fact?.kind === 'war_started');
    if (!warFact) return [];
    const crisis = event.causes.find((cause) => cause.label === '结构危机')?.evidence;
    const military = event.causes.find((cause) => cause.label === '军事与财政前置')?.evidence;
    return [{
      id: `core-impact:rebellion:${event.id}`,
      turn: event.turn,
      source: '地方压力' as const,
      target: target('war', warFact.payload.warId),
      impact: '兵权' as const,
      summary: `${crisis ? `地方结构危机为“${crisis}”` : '地方结构危机已成形'}；${military ?? '起事者已完成军资准备'}，并实际触发${warFact.payload.reason}。`,
      sourceFactIds: unique([warFact.id, ...event.sourceFactIds]),
      sourceEventIds: [event.id],
      relatedTargets: warFact.polityIds.map((id) => target('polity', id)),
      relatedWarId: warFact.payload.warId,
      priority: 98,
    }];
  });
}

function sameOfficeSeat(
  left: Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>['payload'],
  right: Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>['payload'],
): boolean {
  return left.officeKind === right.officeKind
    && left.polityId === right.polityId
    && left.regionId === right.regionId
    && left.armyId === right.armyId
    && left.fleetId === right.fleetId;
}

function diseaseOfficeImpacts(world: WorldState, facts: readonly SimulationFact[], events: readonly HistoryEvent[]): RankedImpact[] {
  const endedFacts = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'appointment_ended' }> => fact.kind === 'appointment_ended');
  const startedFacts = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'appointment_started' }> => fact.kind === 'appointment_started');
  return facts.flatMap((fact) => {
    if (fact.kind !== 'character_death' || !fact.payload.diseaseId) return [];
    const ended = endedFacts
      .filter((item) => item.payload.holderId === fact.payload.characterId)
      .sort((left, right) => right.payload.rank - left.payload.rank || stableCompare(left.id, right.id))[0];
    if (!ended) return [];
    const person = world.characters.find((item) => item.id === fact.payload.characterId);
    const pathogen = world.pathogens.find((item) => item.id === fact.payload.diseaseId);
    const successor = startedFacts.find((item) => (
      item.payload.holderId !== fact.payload.characterId && sameOfficeSeat(ended.payload, item.payload)
    ));
    const successorName = successor
      ? world.characters.find((item) => item.id === successor.payload.holderId)?.name ?? successor.payload.holderId
      : null;
    const seatLabel = ended.payload.armyId
      ? `${world.armies.find((army) => army.id === ended.payload.armyId)?.name ?? ended.payload.armyId}主帅`
      : ended.payload.fleetId
        ? `${world.fleets.find((fleet) => fleet.id === ended.payload.fleetId)?.name ?? ended.payload.fleetId}提督`
        : ended.payload.officeKind;
    const polityId = fact.polityIds[0] ?? person?.polityId ?? '';
    const relatedTargets: CoreImpactTarget[] = [];
    if (polityId) relatedTargets.push(target('polity', polityId));
    if (ended.payload.armyId) relatedTargets.push(target('army', ended.payload.armyId));
    if (successorName && successor) relatedTargets.push(target('person', successor.payload.holderId));
    const linkedFactIds = [fact.id, ...fact.sourceFactIds, ended.id, successor?.id ?? ''];
    return [{
      id: `core-impact:disease:${fact.id}`,
      turn: fact.turn,
      source: '疾病' as const,
      target: target('person', fact.payload.characterId),
      impact: ended.payload.armyId || ended.payload.fleetId ? '兵权' as const : '官职' as const,
      summary: `${person?.name ?? '该人'}在染患${pathogen?.name ?? fact.payload.diseaseId}期间病故（健康${Math.round(fact.payload.health)}），其${seatLabel}职权随生命状态一并结算${successorName ? `；同季由${successorName}接掌` : ''}。`,
      beforeAfter: { label: '生命状态', before: true, after: false },
      sourceFactIds: unique(linkedFactIds),
      sourceEventIds: eventIdsForFact(events, fact.id),
      relatedTargets,
      relatedWarId: null,
      priority: successor ? 94 : 82,
    }];
  });
}

function matchesScope(impact: CoreImpactProjection, scope: CoreImpactScope): boolean {
  if (scope.target) {
    const candidates = [impact.target, ...impact.relatedTargets];
    if (!candidates.some((item) => item.kind === scope.target?.kind && item.id === scope.target.id)) return false;
  }
  if (scope.warId && impact.relatedWarId !== scope.warId) return false;
  if (scope.sourceFactIds?.length) {
    const wanted = new Set(scope.sourceFactIds);
    if (!impact.sourceFactIds.some((id) => wanted.has(id))) return false;
  }
  if (scope.sources?.length && !scope.sources.includes(impact.source)) return false;
  return true;
}

function selectDistinct(candidates: readonly RankedImpact[], limit: number): CoreImpactProjection[] {
  const selected: RankedImpact[] = [];
  const usedFacts = new Set<string>();
  const usedTargetSources = new Set<string>();
  for (const candidate of [...candidates].sort((left, right) => (
    right.priority - left.priority || stableCompare(left.id, right.id)
  ))) {
    if (candidate.sourceFactIds.some((id) => usedFacts.has(id))) continue;
    const targetSource = `${candidate.source}:${candidate.target.kind}:${candidate.target.id}`;
    if (usedTargetSources.has(targetSource)) continue;
    selected.push(candidate);
    candidate.sourceFactIds.forEach((id) => usedFacts.add(id));
    usedTargetSources.add(targetSource);
    if (selected.length >= limit) break;
  }
  return selected.map(({ priority: _priority, ...impact }) => impact);
}

/**
 * Read-only projection of already-proven surrounding pressures into military or court outcomes.
 * It only reads the latest settled quarter and never fills gaps by correlating current values.
 */
export function projectCoreImpacts(world: WorldState, scope: CoreImpactScope = {}): CoreImpactProjection[] {
  if (!world.lastTurn) return [];
  const facts = currentFacts(world);
  const events = currentEvents(world);
  const candidates = [
    ...battleSupplyImpacts(world, facts, events),
    ...rebellionImpacts(facts, events),
    ...diseaseOfficeImpacts(world, facts, events),
    ...lowReadinessImpacts(world, facts, events),
    ...legitimacyCrisisImpacts(world, events),
    ...localGovernanceImpacts(world, facts, events),
  ].filter((impact) => matchesScope(impact, scope));
  const requestedLimit = scope.limit ?? 3;
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(3, Math.floor(requestedLimit))) : 0;
  return selectDistinct(candidates, limit);
}
