import { computeWorldHash, getDateForTurn } from './engine';
import { keyedInt, stableCompare, stableHash } from './random';
import type {
  CharacterState,
  EventCause,
  HistoryEvent,
  RelationshipState,
  StateDelta,
  WorldState,
} from './types';

export type V03InterventionAction =
  | { kind: 'modify_mandate'; polityId: string; delta: number }
  | { kind: 'support_character'; characterId: string }
  | { kind: 'create_disaster'; regionId: string; severity: 1 | 2 | 3 }
  | { kind: 'relationship_opportunity'; sourceCharacterId: string; targetCharacterId: string }
  | { kind: 'protect_character'; characterId: string; quarters?: number };

export const V03_INTERVENTION_BASE_COST = {
  modify_mandate: 2,
  support_character: 3,
  relationship_opportunity: 2,
  protect_character: 4,
} as const;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function interventionCost(action: V03InterventionAction): number {
  if (action.kind === 'create_disaster') return 4 + action.severity;
  return V03_INTERVENTION_BASE_COST[action.kind];
}

export function isV03InterventionEvent(event: HistoryEvent): boolean {
  return event.kind.startsWith('observer_intervention_');
}

function recordedCost(event: HistoryEvent): number {
  if (!isV03InterventionEvent(event)) return 0;
  const evidence = event.causes.find((cause) => cause.label === '天命消耗')?.evidence ?? '';
  const parsed = Number(evidence.match(/消耗(\d+)点/)?.[1] ?? Number.NaN);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  if (event.kind === 'observer_intervention_modify_mandate') return V03_INTERVENTION_BASE_COST.modify_mandate;
  if (event.kind === 'observer_intervention_support_character') return V03_INTERVENTION_BASE_COST.support_character;
  if (event.kind === 'observer_intervention_relationship_opportunity') return V03_INTERVENTION_BASE_COST.relationship_opportunity;
  if (event.kind === 'observer_intervention_protect_character') return V03_INTERVENTION_BASE_COST.protect_character;
  return 0;
}

/**
 * Eight points are available after the first observation. One point returns per
 * simulated year, the bank is capped at twelve, and only one intervention may
 * be made at a given quarterly boundary. Nothing outside history is hidden.
 */
export function availableMandate(world: WorldState): number {
  if (world.history.some((event) => isV03InterventionEvent(event) && event.turn === world.turn)) return 0;
  let balance = 8;
  let settledTurn = 0;
  const interventions = world.history
    .filter(isV03InterventionEvent)
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  for (const event of interventions) {
    const recharge = Math.max(0, Math.floor(event.turn / 4) - Math.floor(settledTurn / 4));
    balance = Math.min(12, balance + recharge) - recordedCost(event);
    settledTurn = Math.max(settledTurn, event.turn);
  }
  const recharge = Math.max(0, Math.floor(world.turn / 4) - Math.floor(settledTurn / 4));
  return Math.max(0, Math.min(12, balance + recharge));
}

interface InterventionEventInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  stateDeltas: StateDelta[];
}

function branchCause(oldHash: string): EventCause {
  return {
    label: '分支凭证',
    role: '结构',
    weight: 0.18,
    evidence: `干预前世界哈希${oldHash}`,
    refs: [{ kind: 'entity', entityType: 'world', entityId: 'world', field: 'hash', label: '干预前世界快照' }],
  };
}

function costCause(cost: number): EventCause {
  return {
    label: '天命消耗',
    role: '条件',
    weight: 0.12,
    evidence: `消耗${cost}点有限天命`,
    refs: [{ kind: 'ledger', entityType: 'world', entityId: 'observer-mandate', label: '观察者天命账' }],
  };
}

function appendEvent(world: WorldState, input: InterventionEventInput): HistoryEvent {
  world.counters.event += 1;
  const event: HistoryEvent = {
    id: `event_${String(world.counters.event).padStart(6, '0')}`,
    turn: world.turn,
    year: world.year,
    season: world.season,
    category: input.category,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    importance: input.importance,
    actorIds: [...new Set(input.actorIds ?? [])].sort(stableCompare),
    polityIds: [...new Set(input.polityIds ?? [])].sort(stableCompare),
    regionIds: [...new Set(input.regionIds ?? [])].sort(stableCompare),
    causes: input.causes,
    evidence: input.causes.map((cause) => cause.evidence),
    stateDeltas: input.stateDeltas,
  };
  world.history.push(event);
  world.historyDigest = world.history.length === 1
    ? stableHash(event)
    : stableHash([world.historyDigest, event]);
  return event;
}

function requireAliveCharacter(world: WorldState, id: string): CharacterState {
  const character = world.characters.find((candidate) => candidate.id === id);
  if (!character?.alive) throw new Error(`不可干预不存在或已故的人物：${id}`);
  return character;
}

function relationshipId(world: WorldState): string {
  world.counters.relationship += 1;
  return `rel_${String(world.counters.relationship).padStart(5, '0')}`;
}

function ensureRelationship(world: WorldState, sourceId: string, targetId: string): RelationshipState {
  const existing = world.relationships.find((relation) => relation.sourceId === sourceId && relation.targetId === targetId);
  if (existing) return existing;
  const relation: RelationshipState = {
    id: relationshipId(world),
    sourceId,
    targetId,
    kinship: '无',
    affinity: keyedInt(world.seed, 35, 65, 'observer-relationship', sourceId, targetId, 'affinity'),
    trust: keyedInt(world.seed, 30, 62, 'observer-relationship', sourceId, targetId, 'trust'),
    fear: 0,
    grievance: 0,
    gratitude: 0,
    lastInteractionTurn: world.turn,
    memories: [],
  };
  world.relationships.push(relation);
  world.relationships.sort((left, right) => stableCompare(left.id, right.id));
  return relation;
}

function rebalanceInfectionHost(world: WorldState, regionId: string, targetPopulation: number): StateDelta[] {
  const keys = ['susceptible', 'exposed', 'infectious', 'recovered'] as const;
  const deltas: StateDelta[] = [];
  for (const infection of world.infections.filter((candidate) => candidate.hostKind === 'region' && candidate.hostId === regionId)) {
    const before = Object.fromEntries(keys.map((key) => [key, infection[key]])) as Record<(typeof keys)[number], number>;
    const start = keys.reduce((sum, key) => sum + infection[key], 0);
    if (start === targetPopulation) continue;
    if (start <= 0 || targetPopulation <= 0) {
      for (const key of keys) infection[key] = 0;
    } else {
      const scaled = keys.map((key) => {
        const exact = infection[key] * targetPopulation / start;
        return { key, whole: Math.floor(exact), fraction: exact - Math.floor(exact) };
      });
      let assigned = scaled.reduce((sum, item) => sum + item.whole, 0);
      scaled.sort((left, right) => right.fraction - left.fraction || stableCompare(left.key, right.key));
      for (const item of scaled) {
        if (assigned >= targetPopulation) break;
        item.whole += 1;
        assigned += 1;
      }
      for (const item of scaled) infection[item.key] = item.whole;
    }
    for (const key of keys) {
      if (before[key] === infection[key]) continue;
      deltas.push({
        entityType: 'infection',
        entityId: infection.id,
        field: key,
        before: before[key],
        after: infection[key],
        delta: infection[key] - before[key],
      });
    }
  }
  return deltas;
}

function applyMandate(
  world: WorldState,
  action: Extract<V03InterventionAction, { kind: 'modify_mandate' }>,
  oldHash: string,
  cost: number,
): void {
  if (!Number.isSafeInteger(action.delta) || action.delta === 0 || Math.abs(action.delta) > 6) {
    throw new Error('天命调整必须是-6至6之间的非零整数');
  }
  const polity = world.polities.find((candidate) => candidate.id === action.polityId && candidate.alive);
  if (!polity) throw new Error(`不可干预不存在或已灭亡的政权：${action.polityId}`);
  const before = polity.legitimacy;
  polity.legitimacy = Math.round(clamp(polity.legitimacy + action.delta));
  if (before === polity.legitimacy) throw new Error('该政权合法性已在边界，干预不会产生效果');
  appendEvent(world, {
    category: '政治',
    kind: 'observer_intervention_modify_mandate',
    title: `${polity.name}天命出现微澜`,
    summary: `观察者只改变了${Math.abs(polity.legitimacy - before)}点合法性机会；此后政权仍须以治理、战争与继承承受后果。`,
    importance: 3,
    actorIds: [polity.rulerId],
    polityIds: [polity.id],
    regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
    causes: [
      branchCause(oldHash),
      costCause(cost),
      { label: '有限偏转', role: '选择', weight: 0.34, evidence: `合法性${before}→${polity.legitimacy}`, refs: [{ kind: 'entity', entityType: 'polity', entityId: polity.id, field: 'legitimacy', label: '政权合法性' }] },
      { label: '不保证结果', role: '结果', weight: 0.36, evidence: '权威、行政、财政、战争与人物意志均未被强制改变', refs: [{ kind: 'entity', entityType: 'polity', entityId: polity.id, label: polity.name }] },
    ],
    stateDeltas: [{ entityType: 'polity', entityId: polity.id, field: 'legitimacy', before, after: polity.legitimacy, delta: polity.legitimacy - before }],
  });
}

function applySupport(
  world: WorldState,
  action: Extract<V03InterventionAction, { kind: 'support_character' }>,
  oldHash: string,
  cost: number,
): void {
  const character = requireAliveCharacter(world, action.characterId);
  const beforeInfluence = character.influence;
  const beforeRenown = character.renown;
  const beforeMerit = character.merit;
  character.influence = Math.round(clamp(character.influence + 5));
  character.renown = Math.round(clamp(character.renown + 4));
  character.merit = Math.round(clamp(character.merit + 3));
  if (beforeInfluence === character.influence && beforeRenown === character.renown && beforeMerit === character.merit) {
    throw new Error('该人物已无可扶持的成长空间');
  }
  appendEvent(world, {
    category: '政治',
    kind: 'observer_intervention_support_character',
    title: `${character.name}得到一次被看见的机会`,
    summary: `观察者提高了${character.name}进入政治视野的机会，却没有替其授官、赢得战争或强迫他人效忠。`,
    importance: 3,
    actorIds: [character.id],
    polityIds: [character.polityId],
    regionIds: [character.locationRegionId],
    causes: [
      branchCause(oldHash),
      costCause(cost),
      { label: '有限扶持', role: '选择', weight: 0.34, evidence: `影响${beforeInfluence}→${character.influence}、声望${beforeRenown}→${character.renown}`, refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, label: character.name }] },
      { label: '机会而非结果', role: '结果', weight: 0.36, evidence: `职位、忠诚与能力未被直接改写，功绩仅${beforeMerit}→${character.merit}`, refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, field: 'merit', label: '人物功绩' }] },
    ],
    stateDeltas: [
      { entityType: 'character', entityId: character.id, field: 'influence', before: beforeInfluence, after: character.influence, delta: character.influence - beforeInfluence },
      { entityType: 'character', entityId: character.id, field: 'renown', before: beforeRenown, after: character.renown, delta: character.renown - beforeRenown },
      { entityType: 'character', entityId: character.id, field: 'merit', before: beforeMerit, after: character.merit, delta: character.merit - beforeMerit },
    ],
  });
}

function applyDisaster(
  world: WorldState,
  action: Extract<V03InterventionAction, { kind: 'create_disaster' }>,
  oldHash: string,
  cost: number,
): void {
  if (![1, 2, 3].includes(action.severity)) throw new Error('灾害强度只能是1、2或3');
  const region = world.regions.find((candidate) => candidate.id === action.regionId);
  if (!region) throw new Error(`不存在区域：${action.regionId}`);
  const populationBefore = region.population;
  const foodBefore = region.food;
  const wealthBefore = region.wealth;
  const devastationBefore = region.devastation;
  const unrestBefore = region.unrest;
  const sanitationBefore = region.sanitation;
  const refugeesBefore = region.refugeePopulation;
  const deathBasisPoints = keyedInt(world.seed, 18 * action.severity, 38 * action.severity, 'observer-disaster', oldHash, region.id, 'deaths');
  const deaths = Math.min(region.population, Math.round(region.population * deathBasisPoints / 10_000));
  const foodLost = Math.min(region.food, Math.round(region.food * (0.025 + action.severity * 0.035)));
  const wealthLost = Math.min(region.wealth, Math.round(region.wealth * (0.015 + action.severity * 0.025)));
  region.population -= deaths;
  region.food -= foodLost;
  region.wealth -= wealthLost;
  region.devastation = Math.round(clamp(region.devastation + 7 + action.severity * 7));
  region.unrest = Math.round(clamp(region.unrest + 4 + action.severity * 5));
  region.sanitation = Math.round(clamp(region.sanitation - 3 - action.severity * 3));
  region.refugeePopulation = Math.min(region.population, region.refugeePopulation + Math.round(region.population * action.severity * 0.004));
  const infectionDeltas = rebalanceInfectionHost(world, region.id, region.population);
  appendEvent(world, {
    category: '世界',
    kind: 'observer_intervention_create_disaster',
    title: `${region.name}遭遇异变灾害`,
    summary: `灾害造成${deaths}人死亡、${foodLost}粮食与${wealthLost}财富毁损；损失直接落入世界快照，并未伪装成常规季度产消账。`,
    importance: action.severity === 3 ? 5 : 4,
    polityIds: [region.controllerId],
    regionIds: [region.id],
    causes: [
      branchCause(oldHash),
      costCause(cost),
      { label: '观察者造灾', role: '触发', weight: 0.28, evidence: `强度${action.severity}，死亡率基点${deathBasisPoints}`, refs: [{ kind: 'entity', entityType: 'region', entityId: region.id, label: region.name }] },
      { label: '真实损失', role: '结果', weight: 0.42, evidence: `人口-${deaths}、粮食-${foodLost}、财富-${wealthLost}、破坏${devastationBefore}→${region.devastation}`, refs: [{ kind: 'entity', entityType: 'region', entityId: region.id, field: 'devastation', label: '区域灾情' }] },
    ],
    stateDeltas: [
      { entityType: 'region', entityId: region.id, field: 'population', before: populationBefore, after: region.population, delta: -deaths },
      { entityType: 'region', entityId: region.id, field: 'food', before: foodBefore, after: region.food, delta: -foodLost },
      { entityType: 'region', entityId: region.id, field: 'wealth', before: wealthBefore, after: region.wealth, delta: -wealthLost },
      { entityType: 'region', entityId: region.id, field: 'devastation', before: devastationBefore, after: region.devastation, delta: region.devastation - devastationBefore },
      { entityType: 'region', entityId: region.id, field: 'unrest', before: unrestBefore, after: region.unrest, delta: region.unrest - unrestBefore },
      { entityType: 'region', entityId: region.id, field: 'sanitation', before: sanitationBefore, after: region.sanitation, delta: region.sanitation - sanitationBefore },
      { entityType: 'region', entityId: region.id, field: 'refugeePopulation', before: refugeesBefore, after: region.refugeePopulation, delta: region.refugeePopulation - refugeesBefore },
      ...infectionDeltas,
    ],
  });
}

function applyRelationshipOpportunity(
  world: WorldState,
  action: Extract<V03InterventionAction, { kind: 'relationship_opportunity' }>,
  oldHash: string,
  cost: number,
): void {
  if (action.sourceCharacterId === action.targetCharacterId) throw new Error('关系机缘需要两个不同人物');
  const source = requireAliveCharacter(world, action.sourceCharacterId);
  const target = requireAliveCharacter(world, action.targetCharacterId);
  const outward = ensureRelationship(world, source.id, target.id);
  const inward = ensureRelationship(world, target.id, source.id);
  const outwardBefore = outward.trust;
  const inwardBefore = inward.trust;
  outward.trust = Math.round(clamp(outward.trust + 5));
  inward.trust = Math.round(clamp(inward.trust + 5));
  outward.affinity = Math.round(clamp(outward.affinity + 4));
  inward.affinity = Math.round(clamp(inward.affinity + 4));
  outward.gratitude = Math.round(clamp(outward.gratitude + 6));
  inward.gratitude = Math.round(clamp(inward.gratitude + 6));
  outward.lastInteractionTurn = world.turn;
  inward.lastInteractionTurn = world.turn;
  const event = appendEvent(world, {
    category: '政治',
    kind: 'observer_intervention_relationship_opportunity',
    title: `${source.name}与${target.name}获得一次相识机缘`,
    summary: `两人留下了轻微恩义记忆；忠诚、派系与未来选择均未被强制，关系仍会被后续经历改写。`,
    importance: 2,
    actorIds: [source.id, target.id],
    polityIds: [source.polityId, target.polityId],
    regionIds: [source.locationRegionId, target.locationRegionId],
    causes: [
      branchCause(oldHash),
      costCause(cost),
      { label: '相识机会', role: '选择', weight: 0.32, evidence: `${source.name}与${target.name}形成双向恩义记忆`, refs: [{ kind: 'entity', entityType: 'character', entityId: source.id, label: source.name }, { kind: 'entity', entityType: 'character', entityId: target.id, label: target.name }] },
      { label: '有限关系变化', role: '结果', weight: 0.38, evidence: `双向信任${outwardBefore}/${inwardBefore}→${outward.trust}/${inward.trust}，双方忠诚未变`, refs: [{ kind: 'entity', entityType: 'character', entityId: source.id, field: 'loyalty', label: '人物忠诚' }, { kind: 'entity', entityType: 'character', entityId: target.id, field: 'loyalty', label: '人物忠诚' }] },
    ],
    stateDeltas: [
      { entityType: 'relationship', entityId: outward.id, field: 'trust', before: outwardBefore, after: outward.trust, delta: outward.trust - outwardBefore },
      { entityType: 'relationship', entityId: inward.id, field: 'trust', before: inwardBefore, after: inward.trust, delta: inward.trust - inwardBefore },
    ],
  });
  for (const [relation, other] of [[outward, target], [inward, source]] as const) {
    relation.memories.push({
      turn: world.turn,
      kind: '恩义',
      impact: 6,
      summary: `因一次偶然机缘结识${other.name}`,
      eventId: event.id,
    });
    if (relation.memories.length > 8) relation.memories.shift();
  }
}

function applyProtection(
  world: WorldState,
  action: Extract<V03InterventionAction, { kind: 'protect_character' }>,
  oldHash: string,
  cost: number,
): void {
  const character = requireAliveCharacter(world, action.characterId);
  const quarters = action.quarters ?? 4;
  if (!Number.isSafeInteger(quarters) || quarters < 1 || quarters > 8) throw new Error('人物保护期必须为1至8个季度');
  const before = character.protectedUntilTurn;
  character.protectedUntilTurn = Math.max(character.protectedUntilTurn ?? world.turn, world.turn + quarters);
  appendEvent(world, {
    category: '政治',
    kind: 'observer_intervention_protect_character',
    title: `${character.name}暂得天命庇护`,
    summary: `庇护持续至第${character.protectedUntilTurn}回合，只避免非必然死亡；衰老、疾病、失势与他人的选择仍会继续。`,
    importance: 3,
    actorIds: [character.id],
    polityIds: [character.polityId],
    regionIds: [character.locationRegionId],
    causes: [
      branchCause(oldHash),
      costCause(cost),
      { label: '限时庇护', role: '选择', weight: 0.34, evidence: `保护${quarters}季，至第${character.protectedUntilTurn}回合`, refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, field: 'protectedUntilTurn', label: '人物保护期限' }] },
      { label: '非绝对控制', role: '结果', weight: 0.36, evidence: '健康、职务、关系与政治行为均未被直接改写', refs: [{ kind: 'entity', entityType: 'character', entityId: character.id, label: character.name }] },
    ],
    stateDeltas: [{ entityType: 'character', entityId: character.id, field: 'protectedUntilTurn', before, after: character.protectedUntilTurn }],
  });
}

/**
 * Applies one authenticated, deterministic observer intervention to a cloned
 * world. The source snapshot is never mutated and the old hash is embedded in
 * the new history event as the branch credential.
 */
export function applyV03Intervention(world: WorldState, action: V03InterventionAction): WorldState {
  const expectedDate = getDateForTurn(world.turn);
  if (world.year !== expectedDate.year || world.season !== expectedDate.season) {
    throw new Error('观察者只能在完整季度边界干预');
  }
  const authenticatedHash = computeWorldHash(world);
  if (world.hash !== authenticatedHash) throw new Error('世界快照哈希不一致，拒绝在未结算状态干预');
  const cost = interventionCost(action);
  const available = availableMandate(world);
  if (available < cost) throw new Error(`天命不足或本季仍在冷却：需要${cost}，可用${available}`);

  const next = structuredClone(world);
  if (action.kind === 'modify_mandate') applyMandate(next, action, authenticatedHash, cost);
  else if (action.kind === 'support_character') applySupport(next, action, authenticatedHash, cost);
  else if (action.kind === 'create_disaster') applyDisaster(next, action, authenticatedHash, cost);
  else if (action.kind === 'relationship_opportunity') applyRelationshipOpportunity(next, action, authenticatedHash, cost);
  else applyProtection(next, action, authenticatedHash, cost);
  next.hash = computeWorldHash(next);
  return next;
}
