import {
  emitSimulationFact,
  type FactTurnBuffer,
  type LocalGovernanceActionKind,
} from '../facts';
import { stableCompare, stableHash } from '../random';
import type {
  CharacterState,
  EventCause,
  FoodLedger,
  HistoryEvent,
  StateDelta,
  WorldState,
} from '../types';
import {
  createEmbodiedActionCommand,
  EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS,
  type EmbodiedActionCommand,
  type EmbodiedActionProjection,
} from './embodiment';

export const LOCAL_GOVERNANCE_ACTION_COOLDOWN_TURNS = 4;
export const MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN = 4;
export const LOCAL_GOVERNANCE_POLITY_COOLDOWN_TURNS = 2;
const LOCAL_GOVERNANCE_FACT_LOOKBACK = 512;

export interface LocalGovernanceTurnContext extends FactTurnBuffer {
  food: FoodLedger;
}

export interface LocalGovernanceActionCandidate {
  actorId: string;
  polityId: string;
  regionId: string;
  action: LocalGovernanceActionKind;
  pressure: number;
  priority: number;
  embodiedCommand?: EmbodiedActionCommand;
}

export interface LocalGovernanceResolution {
  fact: Extract<WorldState['facts'][number], { kind: 'local_governance_resolved' }>;
  event: HistoryEvent;
}

export interface LocalGovernanceEventInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  stateDeltas?: StateDelta[];
  sourceFactIds?: string[];
}

export type EmitLocalGovernanceEvent = (input: LocalGovernanceEventInput) => HistoryEvent;

interface GovernanceFrame {
  actor: CharacterState;
  polity: WorldState['polities'][number] | null;
  region: WorldState['regions'][number] | null;
  permission: boolean;
  foodSeasons: number;
  reliefPressure: number;
  levyPressure: number;
  grainCost: number;
  treasuryCost: number;
  recentTurn: number | null;
  recentPolityTurn: number | null;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function compact(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const [integer, decimal] = String(rounded).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimal ? `${grouped}.${decimal}` : grouped;
}

function infectionPressure(world: WorldState, regionId: string, population: number): number {
  const infectious = world.infections
    .filter((item) => item.hostKind === 'region' && item.hostId === regionId)
    .reduce((sum, item) => sum + item.infectious, 0);
  return clamp((infectious / Math.max(1, population)) * 1_200);
}

function lastLocalGovernanceTurn(world: WorldState, actorId: string): number | null {
  const recent = world.facts.slice(-LOCAL_GOVERNANCE_FACT_LOOKBACK);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const fact = recent[index];
    if (fact?.kind === 'local_governance_resolved'
      && fact.payload.actorId === actorId
      && fact.payload.outcome !== 'invalidated') return fact.turn;
  }
  return null;
}

function lastPolityLocalGovernanceTurn(world: WorldState, polityId: string): number | null {
  const recent = world.facts.slice(-LOCAL_GOVERNANCE_FACT_LOOKBACK);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const fact = recent[index];
    if (fact?.kind === 'local_governance_resolved'
      && fact.payload.polityId === polityId
      && fact.payload.outcome !== 'invalidated') return fact.turn;
  }
  return null;
}

function governanceFrame(world: WorldState, actorId: string): GovernanceFrame | null {
  const actor = world.characters.find((item) => item.id === actorId);
  if (!actor || actor.role !== '地方长官' || !actor.governedRegionId) return null;
  const polity = world.polities.find((item) => item.id === actor.polityId && item.alive) ?? null;
  const region = world.regions.find((item) => item.id === actor.governedRegionId) ?? null;
  const office = world.offices.find((item) => (
    item.active
    && item.kind === '地方长官'
    && item.holderId === actor.id
    && item.polityId === actor.polityId
    && item.regionId === actor.governedRegionId
  ));
  const permission = Boolean(
    actor.alive
    && actor.age >= 16
    && polity
    && region
    && region.controllerId === polity.id
    && office,
  );
  const population = region?.population ?? 0;
  const foodSeasons = region ? region.food / Math.max(1, population) : 0;
  const foodStress = clamp((0.92 - foodSeasons) * 82);
  const unrestStress = clamp((region?.unrest ?? 0) * 0.84);
  const devastationStress = clamp((region?.devastation ?? 0) * 0.72);
  const epidemicStress = region ? infectionPressure(world, region.id, population) : 0;
  const refugeeStress = region
    ? clamp((region.refugeePopulation / Math.max(1, population)) * 420)
    : 0;
  const reliefPressure = clamp(Math.max(foodStress, unrestStress, devastationStress, epidemicStress, refugeeStress));
  const levyPressure = clamp(
    (polity?.taxRate ?? 0) * 300
    + (region?.unrest ?? 0) * 0.48
    + (region?.devastation ?? 0) * 0.18
    + refugeeStress * 0.18,
  );
  return {
    actor,
    polity,
    region,
    permission,
    foodSeasons,
    reliefPressure,
    levyPressure,
    grainCost: Math.max(20, Math.round(population * 0.018)),
    treasuryCost: Math.max(16, Math.round(population * 0.004 + (region?.wealth ?? 0) * 0.02)),
    recentTurn: lastLocalGovernanceTurn(world, actor.id),
    recentPolityTurn: polity ? lastPolityLocalGovernanceTurn(world, polity.id) : null,
  };
}

function unavailableReason(
  world: WorldState,
  frame: GovernanceFrame,
  action: LocalGovernanceActionKind,
): string | null {
  if (!frame.actor.alive) return '此人已经不在人世';
  if (!frame.permission || !frame.region || !frame.polity) return '任所或地方长官职权已经发生变化';
  if (frame.recentTurn !== null && world.turn - frame.recentTurn < LOCAL_GOVERNANCE_ACTION_COOLDOWN_TURNS) {
    return `上一项地方措施刚刚落定，至少要到第${frame.recentTurn + LOCAL_GOVERNANCE_ACTION_COOLDOWN_TURNS}回合再议`;
  }
  if (frame.recentPolityTurn !== null && world.turn - frame.recentPolityTurn < LOCAL_GOVERNANCE_POLITY_COOLDOWN_TURNS) {
    return `${frame.polity.shortName}上一季刚处置过一项地方措施，本季需先看成效`;
  }
  if (action === 'open_granary') {
    if (frame.region.unrest < 10 || frame.reliefPressure < 42) return `${frame.region.name}眼下尚无需要开仓的明确民生压力`;
    if (frame.region.food < frame.grainCost) return `${frame.region.name}仓粮不足，至少需要${compact(frame.grainCost)}石`;
    return null;
  }
  if (frame.region.unrest < 22 || frame.levyPressure < 50) return `${frame.region.name}眼下赋役与民怨尚未形成减免压力`;
  if (frame.polity.treasury < frame.treasuryCost) return `${frame.polity.shortName}国库不足，至少需要${compact(frame.treasuryCost)}财力`;
  return null;
}

function pressureCopy(frame: GovernanceFrame, action: LocalGovernanceActionKind): string {
  if (!frame.region || !frame.polity) return '任所情况不明';
  if (action === 'open_granary') {
    return `现有粮可支${frame.foodSeasons.toFixed(1)}季，动荡${Math.round(frame.region.unrest)}、破坏${Math.round(frame.region.devastation)}`;
  }
  return `现行税率${Math.round(frame.polity.taxRate * 100)}%，地方动荡${Math.round(frame.region.unrest)}、财货${compact(frame.region.wealth)}`;
}

/** Pure role projection. A governor receives two concrete choices in place of the generic opportunity action. */
export function projectEmbodiedLocalGovernanceActions(
  world: WorldState,
  actorId: string,
): readonly EmbodiedActionProjection[] {
  const frame = governanceFrame(world, actorId);
  if (!frame?.region) return [];
  const reliefUnavailable = unavailableReason(world, frame, 'open_granary');
  const levyUnavailable = unavailableReason(world, frame, 'reduce_levy');
  return [
    {
      command: createEmbodiedActionCommand(world, actorId, 'open_granary', 'region', frame.region.id),
      label: '开仓赈济',
      targetLabel: frame.region.name,
      intent: `动用${frame.region.name}仓粮，先缓解饥困、流民与地方不安。`,
      cost: `预计动用${compact(frame.grainCost)}石州粮`,
      obstacle: `${pressureCopy(frame, 'open_granary')}；开仓后下一季储粮会更薄`,
      nextSignal: `观察${frame.region.name}动荡、人口迁出与下一季粮食支撑`,
      available: reliefUnavailable === null,
      unavailableReason: reliefUnavailable,
    },
    {
      command: createEmbodiedActionCommand(world, actorId, 'reduce_levy', 'region', frame.region.id),
      label: '减免本季赋',
      targetLabel: frame.region.name,
      intent: `请朝廷把本季部分赋款退回${frame.region.name}，让百姓与市井缓一口气。`,
      cost: `预计由国库退还${compact(frame.treasuryCost)}财力`,
      obstacle: `${pressureCopy(frame, 'reduce_levy')}；朝廷会衡量国库与地方治理成效`,
      nextSignal: `观察${frame.region.name}动荡、地方财货与朝廷对这名长官的评价`,
      available: levyUnavailable === null,
      unavailableReason: levyUnavailable,
    },
  ];
}

export function isEmbodiedLocalGovernanceAction(
  command: EmbodiedActionCommand | null | undefined,
): command is EmbodiedActionCommand & { kind: (typeof EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS)[number] } {
  return Boolean(command && EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS.includes(
    command.kind as (typeof EMBODIED_LOCAL_GOVERNANCE_ACTION_KINDS)[number],
  ));
}

function governancePriority(frame: GovernanceFrame, pressure: number): number {
  return Math.round((
    pressure * 0.55
    + frame.actor.governance * 0.25
    + frame.actor.loyalty * 0.12
    + frame.actor.caution * 0.08
    - frame.actor.ambition * 0.05
  ) * 10) / 10;
}

export function localGovernanceCandidateFor(
  world: WorldState,
  actorId: string,
): LocalGovernanceActionCandidate | null {
  const frame = governanceFrame(world, actorId);
  if (!frame?.region || !frame.polity || !frame.permission) return null;
  const available = projectEmbodiedLocalGovernanceActions(world, actorId).filter((item) => item.available);
  if (!available.length) return null;
  const relief = available.find((item) => item.command.kind === 'open_granary');
  const levy = available.find((item) => item.command.kind === 'reduce_levy');
  const selected = relief && (!levy || frame.foodSeasons < 0.72 || frame.reliefPressure >= frame.levyPressure + 5)
    ? relief
    : levy ?? relief;
  if (!selected || (selected.command.kind !== 'open_granary' && selected.command.kind !== 'reduce_levy')) return null;
  const pressure = selected.command.kind === 'open_granary' ? frame.reliefPressure : frame.levyPressure;
  const willingness = governancePriority(frame, pressure);
  if (willingness < 45) return null;
  return {
    actorId,
    polityId: frame.polity.id,
    regionId: frame.region.id,
    action: selected.command.kind,
    pressure,
    priority: willingness,
  };
}

export function localGovernanceCandidateFromCommand(
  world: WorldState,
  command: EmbodiedActionCommand,
): { candidate: LocalGovernanceActionCandidate | null; option: EmbodiedActionProjection | null } {
  const option = projectEmbodiedLocalGovernanceActions(world, command.actorId).find((item) => (
    item.command.actionId === command.actionId
    && item.command.issuedTurn === command.issuedTurn
    && item.command.kind === command.kind
    && item.command.targetKind === command.targetKind
    && item.command.targetId === command.targetId
  )) ?? null;
  const frame = governanceFrame(world, command.actorId);
  if (!option?.available || !frame?.region || !frame.polity
    || (command.kind !== 'open_granary' && command.kind !== 'reduce_levy')) {
    return { candidate: null, option };
  }
  return {
    option,
    candidate: {
      actorId: command.actorId,
      polityId: frame.polity.id,
      regionId: frame.region.id,
      action: command.kind,
      pressure: command.kind === 'open_granary' ? frame.reliefPressure : frame.levyPressure,
      priority: governancePriority(
        frame,
        command.kind === 'open_granary' ? frame.reliefPressure : frame.levyPressure,
      ),
      embodiedCommand: command,
    },
  };
}

function addDelta(
  deltas: StateDelta[],
  entityType: StateDelta['entityType'],
  entityId: string,
  field: string,
  before: number,
  after: number,
): void {
  if (before === after) return;
  deltas.push({ entityType, entityId, field, before, after, delta: after - before });
}

function appendBiography(character: CharacterState, event: HistoryEvent, kind: string): void {
  character.biography.push({
    id: `${character.id}:bio:${event.id}:${kind}`,
    turn: event.turn,
    kind,
    summary: event.summary,
    importance: event.importance,
    eventId: event.id,
    factId: null,
  });
  if (character.biography.length > 80) character.biography.splice(0, character.biography.length - 80);
  character.biographyDigest = stableHash(character.biography);
}

export function resolveLocalGovernanceAction(
  world: WorldState,
  context: LocalGovernanceTurnContext,
  candidate: LocalGovernanceActionCandidate,
  emit: EmitLocalGovernanceEvent,
): LocalGovernanceResolution {
  const frame = governanceFrame(world, candidate.actorId);
  const actor = frame?.actor ?? world.characters.find((item) => item.id === candidate.actorId);
  const polity = frame?.polity;
  const region = frame?.region;
  const actionLabel = candidate.action === 'open_granary' ? '开仓赈济' : '减免本季赋';
  const pressure = candidate.action === 'open_granary'
    ? frame?.reliefPressure ?? 0
    : frame?.levyPressure ?? 0;
  const threshold = candidate.action === 'open_granary' ? 47 : 54;
  const variance = (Number.parseInt(stableHash([
    world.seed,
    context.turn,
    candidate.actorId,
    candidate.regionId,
    candidate.action,
    'local-governance-resolver-v1',
  ]).slice(0, 8), 16) % 13) - 6;
  const score = clamp(
    (actor?.governance ?? 0) * (candidate.action === 'open_granary' ? 0.42 : 0.36)
    + (polity?.administration ?? 0) * 0.24
    + (polity?.authority ?? 0) * (candidate.action === 'open_granary' ? 0.08 : 0.14)
    + (actor?.loyalty ?? 0) * 0.1
    + pressure * (candidate.action === 'open_granary' ? 0.16 : 0.12)
    + variance,
  );
  const unavailable = frame ? unavailableReason(world, frame, candidate.action) : '任所已经不存在';
  let outcome: Extract<WorldState['facts'][number], { kind: 'local_governance_resolved' }>['payload']['outcome'] = 'invalidated';
  let reasonCode: Extract<WorldState['facts'][number], { kind: 'local_governance_resolved' }>['payload']['reasonCode'] = 'permission_lost';
  if (!actor?.alive || !frame?.permission || !polity || !region || region.id !== candidate.regionId) {
    outcome = 'invalidated';
    reasonCode = 'permission_lost';
  } else if (unavailable) {
    outcome = unavailable.includes('仓粮不足') || unavailable.includes('国库不足')
      ? 'deferred'
      : 'invalidated';
    reasonCode = unavailable.includes('仓粮不足')
      ? 'insufficient_grain'
      : unavailable.includes('国库不足')
        ? 'insufficient_treasury'
        : 'pressure_eased';
  } else if (score >= threshold) {
    outcome = 'enacted';
    reasonCode = 'measure_enacted';
  } else if (score >= threshold - 9) {
    outcome = 'deferred';
    reasonCode = 'institution_deferred';
  } else {
    outcome = 'refused';
    reasonCode = 'institution_refused';
  }

  const deltas: StateDelta[] = [];
  const foodSeasonsBefore = frame?.foodSeasons ?? 0;
  const unrestBefore = region?.unrest ?? 0;
  let foodSpent = 0;
  let treasurySpent = 0;
  let resultSummary: string;
  if (outcome === 'enacted' && actor && polity && region && frame) {
    const influenceBefore = actor.influence;
    const meritBefore = actor.merit;
    const legitimacyBefore = polity.legitimacy;
    const unrestRelief = candidate.action === 'open_granary'
      ? 6 + Math.round(actor.governance / 25) + Math.round(pressure / 35)
      : 4 + Math.round(actor.governance / 30) + Math.round(pressure / 45);
    region.unrest = clamp(region.unrest - unrestRelief);
    actor.influence = clamp(actor.influence + (candidate.action === 'open_granary' ? 2 : 1));
    actor.merit = clamp(actor.merit + (candidate.action === 'open_granary' ? 2 : 1));
    if (unrestBefore >= 45) polity.legitimacy = clamp(polity.legitimacy + 1);
    if (candidate.action === 'open_granary') {
      const foodBefore = region.food;
      foodSpent = Math.min(region.food, frame.grainCost);
      region.food -= foodSpent;
      context.food.civilianConsumed += foodSpent;
      addDelta(deltas, 'region', region.id, 'food', foodBefore, region.food);
      resultSummary = `${actor.name}获准在${region.name}开仓，实际发出${compact(foodSpent)}石粮；当地动荡由${Math.round(unrestBefore)}降至${Math.round(region.unrest)}，但州仓储粮随之减少。`;
    } else {
      const treasuryBefore = polity.treasury;
      const wealthBefore = region.wealth;
      treasurySpent = Math.min(polity.treasury, frame.treasuryCost);
      polity.treasury -= treasurySpent;
      region.wealth += treasurySpent;
      addDelta(deltas, 'polity', polity.id, 'treasury', treasuryBefore, polity.treasury);
      addDelta(deltas, 'region', region.id, 'wealth', wealthBefore, region.wealth);
      resultSummary = `${actor.name}获准为${region.name}减免本季赋，国库退回${compact(treasurySpent)}财力；当地动荡由${Math.round(unrestBefore)}降至${Math.round(region.unrest)}。`;
    }
    addDelta(deltas, 'region', region.id, 'unrest', unrestBefore, region.unrest);
    addDelta(deltas, 'character', actor.id, 'influence', influenceBefore, actor.influence);
    addDelta(deltas, 'character', actor.id, 'merit', meritBefore, actor.merit);
    addDelta(deltas, 'polity', polity.id, 'legitimacy', legitimacyBefore, polity.legitimacy);
  } else if (outcome === 'deferred') {
    resultSummary = actor && region
      ? `${actor.name}提出为${region.name}${actionLabel}，但${reasonCode === 'insufficient_grain' ? '州仓可用粮不足' : reasonCode === 'insufficient_treasury' ? '国库无力承担' : '朝廷要求再核地方与财政'}，本季没有动用粮财。`
      : '这项地方措施因任所变化而未能进入裁决。';
  } else if (outcome === 'refused') {
    resultSummary = actor && region
      ? `${actor.name}提出为${region.name}${actionLabel}，朝廷认为地方压力与财政代价尚不足以破例，本季没有准行。`
      : '这项地方措施没有得到准行。';
  } else {
    resultSummary = actor
      ? `${actor.name}原定的${actionLabel}因任所、职权或地方压力已经变化，未能成行。`
      : '原定地方长官已经失去人物载体，这项措施未能成行。';
  }
  const actualUnrestAfter = region?.unrest ?? unrestBefore;
  const fact = emitSimulationFact(world, context, {
    kind: 'local_governance_resolved',
    category: '经济',
    importance: outcome === 'enacted' && pressure >= 62 ? 3 : outcome === 'enacted' ? 2 : 1,
    actorIds: actor ? [actor.id] : [],
    polityIds: polity ? [polity.id] : candidate.polityId ? [candidate.polityId] : [],
    regionIds: region ? [region.id] : candidate.regionId ? [candidate.regionId] : [],
    causes: [
      {
        label: '地方压力', role: '结构', weight: 0.3,
        evidence: region ? `${region.name}粮可支${foodSeasonsBefore.toFixed(1)}季、动荡${Math.round(unrestBefore)}、破坏${Math.round(region.devastation)}` : '原任所已不可核验',
      },
      {
        label: '长官主张', role: '选择', weight: 0.25,
        evidence: actor && region ? `${actor.name}以地方长官身份提出为${region.name}${actionLabel}` : `原定措施为${actionLabel}`,
      },
      {
        label: '朝廷审核', role: '条件', weight: 0.2,
        evidence: actor && polity ? `政略${actor.governance}、行政${Math.round(polity.administration)}、权威${Math.round(polity.authority)}，合计${score}/${threshold}` : '任所或职权已经失效',
      },
      { label: '实际结果', role: '结果', weight: 0.25, evidence: resultSummary },
    ],
    stateDeltas: deltas,
    sourceFactIds: [],
    payload: {
      actorId: candidate.actorId,
      polityId: polity?.id ?? candidate.polityId,
      regionId: region?.id ?? candidate.regionId,
      authorityId: polity?.rulerId ?? '',
      action: candidate.action,
      outcome,
      reasonCode,
      score,
      threshold,
      pressure,
      foodSeasonsBefore: Math.round(foodSeasonsBefore * 100) / 100,
      unrestBefore: Math.round(unrestBefore),
      unrestAfter: Math.round(actualUnrestAfter),
      foodSpent,
      treasurySpent,
    },
  }) as Extract<WorldState['facts'][number], { kind: 'local_governance_resolved' }>;
  const event = emit({
    category: '经济',
    kind: `${candidate.action}_${outcome}`,
    title: outcome === 'enacted' && actor && region
      ? `${actor.name}${candidate.action === 'open_granary' ? `在${region.name}开仓赈济` : `为${region.name}减免本季赋`}`
      : actor && region
        ? `${actor.name}所请${region.name}${actionLabel}${outcome === 'deferred' ? '暂缓' : outcome === 'refused' ? '未准' : '未行'}`
        : `地方措施${outcome === 'invalidated' ? '未行' : '未准'}`,
    summary: resultSummary,
    importance: fact.importance,
    actorIds: fact.actorIds,
    polityIds: fact.polityIds,
    regionIds: fact.regionIds,
    causes: fact.causes,
    stateDeltas: deltas,
    sourceFactIds: [fact.id],
  });
  if (actor) appendBiography(actor, event, outcome === 'enacted' ? actionLabel : `${actionLabel}未成`);
  return { fact, event };
}

export function compareLocalGovernanceCandidates(
  left: LocalGovernanceActionCandidate,
  right: LocalGovernanceActionCandidate,
): number {
  return right.priority - left.priority
    || right.pressure - left.pressure
    || stableCompare(left.polityId, right.polityId)
    || stableCompare(left.actorId, right.actorId);
}
