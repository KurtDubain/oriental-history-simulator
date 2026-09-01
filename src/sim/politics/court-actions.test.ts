import { describe, expect, it } from 'vitest';
import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  getDateForTurn,
  keyedRandom,
  serializeWorld,
  stableHash,
  validateWorld,
} from '../index';
import type {
  CharacterState,
  FactionState,
  HistoryEvent,
  PolityState,
  WorldState,
} from '../types';
import {
  calculateFactionPowerLedger,
  refreshFactionPowerLedgers,
} from './power-ledger';
import type { CourtActionKind } from '../facts';
import { changeFactionRelation } from './faction-lifecycle';
import { detectCourtStruggleCandidates } from '../situations/court-struggle-detector';

const COURT_MARKERS = new Set(['成为权臣', '权臣失势', '遭到清洗', '发动政变']);

interface PreparedCourtWorld {
  world: WorldState;
  polityId: string;
  factionId: string;
  leaderId: string;
}

function factContext(world: WorldState): FactTurnBuffer {
  return { turn: world.turn, year: world.year, season: world.season, facts: [] };
}

function priorFactContext(world: WorldState): FactTurnBuffer {
  const turn = Math.max(0, world.turn - 1);
  const date = getDateForTurn(turn);
  return { turn, year: date.year, season: date.season, facts: [] };
}

function projectTestCourtFact(
  world: WorldState,
  fact: Extract<WorldState['facts'][number], { kind: 'court_action_resolved' }>,
): void {
  world.counters.event += 1;
  const event: HistoryEvent = {
    id: `event_${String(world.counters.event).padStart(6, '0')}`,
    turn: fact.turn, year: fact.year, season: fact.season,
    category: fact.category, kind: `test_${fact.payload.action}`,
    title: '朝堂行动测试投影', summary: '朝堂行动事实已经投影。', importance: fact.importance,
    actorIds: [...fact.actorIds], polityIds: [...fact.polityIds], regionIds: [...fact.regionIds],
    causes: fact.causes.map((cause) => ({ ...cause })), evidence: [],
    stateDeltas: fact.stateDeltas.map((delta) => ({ ...delta })),
    sourceFactIds: [fact.id], situationIds: [],
  };
  world.history.push(event);
  world.historyDigest = stableHash([world.historyDigest, event]);
  if (world.lastTurn?.turn === fact.turn) {
    world.lastTurn.factIds.push(fact.id);
    world.lastTurn.eventIds.push(event.id);
  }
}

function recordPowerBrokerFormation(
  world: WorldState,
  polity: PolityState,
  faction: FactionState,
  leader: CharacterState,
  ruler: CharacterState,
): void {
  const influenceBefore = leader.influence;
  leader.influence = Math.min(100, leader.influence + 1);
  const fact = emitSimulationFact(world, priorFactContext(world), {
    kind: 'court_action_resolved',
    category: '政治',
    importance: 3,
    actorIds: [leader.id, ruler.id],
    polityIds: [polity.id],
    regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
    causes: [{ label: '既有权臣事实', role: '结果', weight: 1, evidence: `${leader.name}已据权力中枢` }],
    stateDeltas: [{
      entityType: 'character', entityId: leader.id, field: 'influence',
      before: influenceBefore, after: leader.influence, delta: leader.influence - influenceBefore,
    }],
    sourceFactIds: [],
    payload: {
      action: 'power_broker_formed',
      polityId: polity.id,
      actorFactionId: faction.id,
      targetFactionId: ruler.factionId,
      initiatorId: leader.id,
      targetId: ruler.id,
      reasonCode: 'pol06_test_existing_broker',
      score: Math.max(66, faction.power),
      threshold: 66,
      rulerBeforeId: ruler.id,
      rulerAfterId: ruler.id,
      affectedFactionIds: [...new Set([faction.id, ...(ruler.factionId ? [ruler.factionId] : [])])].sort(),
      removedMemberIds: [],
    },
  });
  if (fact.kind !== 'court_action_resolved') throw new Error('expected court formation fixture');
  projectTestCourtFact(world, fact);
}

function clearCourtMarkers(character: CharacterState): void {
  character.biography = character.biography.filter((fact) => !COURT_MARKERS.has(fact.kind));
  character.biographyDigest = stableHash(character.biography);
}

function makeFactionMembership(
  faction: FactionState,
  members: readonly CharacterState[],
  leader: CharacterState,
): void {
  faction.active = true;
  faction.endedTurn = null;
  faction.endedReason = null;
  faction.endedFactId = null;
  faction.leaderId = leader.id;
  faction.memberIds = members.map((member) => member.id).sort();
  faction.coreMemberIds = [leader.id, ...members.map((member) => member.id).filter((id) => id !== leader.id)]
    .slice(0, 6);
  for (const member of members) member.factionId = faction.id;
}

function purgeSeedRetainingAllMembers(
  world: WorldState,
  faction: FactionState,
  prefix: string,
): string {
  for (let ordinal = 0; ordinal < 1_000_000; ordinal += 1) {
    const candidate = `${prefix}-${ordinal}`;
    if (faction.memberIds.every((id) => (
      id === faction.leaderId || keyedRandom(candidate, world.turn, 'purge', faction.id, id) > 0.35
    ))) return candidate;
  }
  throw new Error('expected a deterministic purge seed retaining every member');
}

function suppressOtherCourtActions(world: WorldState): void {
  for (const character of world.characters) clearCourtMarkers(character);
  const activeBrokerFacts = new Map<string, Extract<WorldState['facts'][number], { kind: 'court_action_resolved' }>>();
  for (const fact of world.facts) {
    if (fact.kind !== 'court_action_resolved') continue;
    if (fact.payload.action === 'power_broker_formed') activeBrokerFacts.set(fact.payload.initiatorId, fact);
    else if (fact.payload.action === 'power_broker_fell') activeBrokerFacts.delete(fact.payload.targetId);
    else if (fact.payload.action === 'coup' || fact.payload.action === 'usurpation') activeBrokerFacts.delete(fact.payload.initiatorId);
  }
  for (const formed of activeBrokerFacts.values()) {
    const broker = world.characters.find((item) => item.id === formed.payload.initiatorId);
    const polity = world.polities.find((item) => item.id === formed.payload.polityId);
    const ruler = world.characters.find((item) => item.id === polity?.rulerId);
    if (!broker || !polity || !ruler || !formed.payload.actorFactionId) continue;
    const terminal = emitSimulationFact(world, priorFactContext(world), {
      kind: 'court_action_resolved', category: '政治', importance: 3,
      actorIds: [ruler.id, broker.id], polityIds: [polity.id], regionIds: [],
      causes: [{ label: '测试隔离', role: '结果', weight: 1, evidence: '先前权臣任期在夹具边界结案' }],
      stateDeltas: [], sourceFactIds: [formed.id],
      payload: {
        action: 'power_broker_fell', polityId: polity.id,
        actorFactionId: ruler.factionId, targetFactionId: formed.payload.actorFactionId,
        initiatorId: ruler.id, targetId: broker.id,
        reasonCode: 'pol06_fixture_boundary', score: 0, threshold: 54,
        rulerBeforeId: ruler.id, rulerAfterId: ruler.id,
        affectedFactionIds: [...new Set([formed.payload.actorFactionId, ...(ruler.factionId ? [ruler.factionId] : [])])].sort(),
        removedMemberIds: [],
      },
    });
    if (terminal.kind !== 'court_action_resolved') throw new Error('expected court terminal fixture');
    projectTestCourtFact(world, terminal);
  }
  for (const polity of world.polities.filter((item) => item.alive)) {
    // 50 is deliberately above the coup ceiling and below the purge floor.
    polity.authority = 50;
    polity.lastCourtCrisisTurn = world.turn;
  }
  for (const faction of world.factions.filter((item) => item.active)) {
    faction.lastActionTurn = world.turn;
  }
}

function chooseCourtActors(world: WorldState): {
  polity: PolityState;
  ruler: CharacterState;
  rulerFaction: FactionState;
  dominant: FactionState;
  leader: CharacterState;
  members: CharacterState[];
} {
  for (const polity of world.polities.filter((item) => item.alive)) {
    const ruler = world.characters.find((character) => character.id === polity.rulerId && character.alive);
    const rulerFaction = ruler?.factionId
      ? world.factions.find((faction) => faction.id === ruler.factionId && faction.active)
      : undefined;
    const dominant = world.factions.find((faction) => (
      faction.active && faction.polityId === polity.id && faction.id !== rulerFaction?.id
    ));
    const members = world.characters.filter((character) => (
      character.alive && character.age >= 16 && character.polityId === polity.id && character.id !== ruler?.id
    ));
    const leader = members.find((character) => character.id === dominant?.leaderId) ?? members[0];
    if (ruler && rulerFaction && dominant && leader && members.length >= 6) {
      return { polity, ruler, rulerFaction, dominant, leader, members };
    }
  }
  throw new Error('expected a living polity with separate ruler and minister factions');
}

function prepareCourtWorld(seed: string, action: 'power_broker_formed' | 'purge', openingTurns = 8): PreparedCourtWorld {
  const world = advanceWorldBy(createWorld(seed), openingTurns);
  suppressOtherCourtActions(world);
  const { polity, ruler, rulerFaction, dominant, leader, members } = chooseCourtActors(world);

  const polityAdults = world.characters.filter((character) => (
    character.alive && character.age >= 16 && character.polityId === polity.id
  ));
  for (const faction of world.factions.filter((item) => item.active && item.polityId === polity.id)) {
    faction.alliedFactionIds = [];
    faction.rivalFactionIds = [];
    faction.relationSinceTurns = {};
    faction.memberIds = [];
    faction.coreMemberIds = [];
  }
  makeFactionMembership(rulerFaction, [ruler], ruler);
  makeFactionMembership(dominant, members, leader);
  for (const adult of polityAdults) {
    adult.health = 100;
    adult.ambition = 0;
    adult.loyalty = 100;
    adult.influence = adult.id === leader.id ? 40 : 0;
    adult.renown = adult.id === leader.id ? 20 : 0;
  }
  for (const family of world.families.filter((item) => (
    item.active && members.some((member) => member.familyId === item.id)
  ))) {
    family.prestige = 100;
    family.politicalInfluence = 100;
    family.wealth = Math.max(family.wealth, 5_000);
  }

  dominant.cohesion = 100;
  dominant.lastActionTurn = -100;
  polity.lastCourtCrisisTurn = -100;
  ruler.cunning = 100;
  ruler.caution = 100;
  if (action === 'power_broker_formed') {
    polity.authority = 82;
    leader.cunning = 82;
    leader.caution = 100;
  } else {
    polity.authority = 100;
    leader.loyalty = 0;
    recordPowerBrokerFormation(world, polity, dominant, leader, ruler);
  }

  refreshFactionPowerLedgers(world, polity.id);
  const ordered = world.factions
    .filter((faction) => faction.active && faction.polityId === polity.id && faction.memberIds.length > 0)
    .sort((left, right) => right.power - left.power || left.id.localeCompare(right.id));
  expect(ordered[0]?.id).toBe(dominant.id);
  expect(calculateFactionPowerLedger(world, dominant).total).toBeGreaterThanOrEqual(
    action === 'power_broker_formed' ? 66 : 64,
  );

  world.hash = computeWorldHash(world);
  return { world, polityId: polity.id, factionId: dominant.id, leaderId: leader.id };
}

function expectOneLinkedCourtAction(
  before: WorldState,
  after: WorldState,
  action: CourtActionKind,
) {
  const facts = after.facts.filter((fact) => (
    fact.turn === before.turn
    && fact.kind === 'court_action_resolved'
    && fact.payload.action === action
  ));
  expect(facts).toHaveLength(1);
  const fact = facts[0];
  if (!fact || fact.kind !== 'court_action_resolved') throw new Error('expected one court action Fact');
  expect(fact.payload.action).toBe(action);
  if (action !== 'power_broker_fell') {
    expect(fact.payload.score).toBeGreaterThanOrEqual(fact.payload.threshold);
  }
  const linkedEvents = after.history.filter((event) => event.sourceFactIds.includes(fact.id));
  expect(linkedEvents).toHaveLength(1);
  expect(linkedEvents[0]?.stateDeltas).toEqual(fact.stateDeltas);
  expect(linkedEvents[0]?.causes).toEqual(fact.causes);
  return fact;
}

function expectDerivedPowerCannotBeForged(world: WorldState, faction: FactionState): void {
  const expected = calculateFactionPowerLedger(world, faction).total;
  expect(faction.power).toBe(expected);
  faction.power = expected === 100 ? 0 : 100;
  expect(faction.power).not.toBe(expected);
  refreshFactionPowerLedgers(world, faction.polityId);
  expect(faction.power).toBe(expected);
  expect(faction.power).toBe(calculateFactionPowerLedger(world, faction).total);
}

describe('POL06 court actions use the concrete political power account', () => {
  it('forms one power broker Fact/Event pair by changing member renown rather than trusting the old total', () => {
    const prepared = prepareCourtWorld('POL06-权臣形成定向', 'power_broker_formed');
    const beforeFaction = prepared.world.factions.find((item) => item.id === prepared.factionId);
    if (!beforeFaction) throw new Error('missing prepared dominant faction');
    const forgedLeader = prepared.world.characters.find((item) => item.id === prepared.leaderId);
    if (!forgedLeader) throw new Error('missing future power broker');
    forgedLeader.biography.push({
      id: `${forgedLeader.id}:bio:forged-power-broker`,
      turn: prepared.world.turn,
      kind: '成为权臣',
      summary: '这只是一条展示层伪造记录。',
      importance: 3,
      eventId: null,
      factId: null,
    });
    forgedLeader.biographyDigest = stableHash(forgedLeader.biography);
    prepared.world.hash = computeWorldHash(prepared.world);
    const beforeLedger = calculateFactionPowerLedger(prepared.world, beforeFaction);
    const beforeRenown = beforeLedger.resources.find((resource) => resource.id === `renown:${prepared.leaderId}`);
    if (!beforeRenown) throw new Error('expected the future power broker to have a renown resource');

    const after = advanceWorld(prepared.world);
    const fact = expectOneLinkedCourtAction(prepared.world, after, 'power_broker_formed');
    const afterFaction = after.factions.find((item) => item.id === prepared.factionId);
    if (!afterFaction) throw new Error('missing dominant faction after the court action');
    const afterRenown = calculateFactionPowerLedger(after, afterFaction).resources
      .find((resource) => resource.id === `renown:${prepared.leaderId}`);

    expect(fact.stateDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'character',
        entityId: prepared.leaderId,
        field: 'influence',
      }),
    ]));
    expect(afterRenown?.value).toBeGreaterThan(beforeRenown.value);
    expect(afterRenown?.evidence).toEqual(expect.arrayContaining([
      { entityType: 'character', entityId: prepared.leaderId, field: 'influence' },
    ]));
    expectDerivedPowerCannotBeForged(after, afterFaction);
    expect(validateWorld(after).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
  });

  it('does not form the same broker twice when the capped biography no longer contains the marker', () => {
    const prepared = prepareCourtWorld('POL06-权臣事实防重复', 'power_broker_formed');
    const established = advanceWorld(prepared.world);
    expectOneLinkedCourtAction(prepared.world, established, 'power_broker_formed');
    const polity = established.polities.find((item) => item.id === prepared.polityId);
    const faction = established.factions.find((item) => item.id === prepared.factionId);
    const leader = established.characters.find((item) => item.id === prepared.leaderId);
    if (!polity || !faction || !leader) throw new Error('missing established broker state');

    clearCourtMarkers(leader);
    faction.lastActionTurn = -100;
    polity.lastCourtCrisisTurn = -100;
    polity.authority = 50;
    established.hash = computeWorldHash(established);
    const after = advanceWorld(established);
    expect(after.facts.filter((fact) => (
      fact.turn === established.turn
      && fact.kind === 'court_action_resolved'
      && fact.payload.action === 'power_broker_formed'
      && fact.payload.initiatorId === leader.id
    ))).toEqual([]);
  });

  it('forms a Fact-backed broker at influence 100 without inventing a positive delta and round-trips the save', () => {
    const prepared = prepareCourtWorld('POL06-权臣影响上限', 'power_broker_formed', 0);
    const leader = prepared.world.characters.find((item) => item.id === prepared.leaderId);
    if (!leader) throw new Error('missing capped broker');
    leader.influence = 100;
    prepared.world.hash = computeWorldHash(prepared.world);
    const after = advanceWorld(prepared.world);
    const fact = expectOneLinkedCourtAction(prepared.world, after, 'power_broker_formed');
    expect(fact.stateDeltas.some((delta) => (
      delta.entityType === 'character' && delta.entityId === leader.id && delta.field === 'influence'
    ))).toBe(false);
    expect(validateWorld(after).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
    const saved = serializeWorld(after);
    const restored = deserializeWorld(saved);
    expect(serializeWorld(restored)).toBe(saved);
    expect(validateWorld(restored).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
  });

  it('records one purge Fact/Event pair and leaves the faction total equal to its surviving real roots', () => {
    const prepared = prepareCourtWorld('POL06-清洗定向', 'purge');
    const beforeFaction = prepared.world.factions.find((item) => item.id === prepared.factionId);
    const beforeLeader = prepared.world.characters.find((item) => item.id === prepared.leaderId);
    if (!beforeFaction || !beforeLeader) throw new Error('missing prepared purge target');
    const beforeResourceIds = calculateFactionPowerLedger(prepared.world, beforeFaction).resources
      .map((resource) => resource.id);
    const beforeInfluence = beforeLeader.influence;

    const after = advanceWorld(prepared.world);
    const fact = expectOneLinkedCourtAction(prepared.world, after, 'purge');
    const afterFaction = after.factions.find((item) => item.id === prepared.factionId);
    const afterLeader = after.characters.find((item) => item.id === prepared.leaderId);
    if (!afterFaction || !afterLeader) throw new Error('missing purge survivors');
    const afterLedger = calculateFactionPowerLedger(after, afterFaction);

    expect(afterLeader.influence).toBeLessThan(beforeInfluence);
    expect(fact.stateDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'character',
        entityId: prepared.leaderId,
        field: 'influence',
      }),
    ]));
    expect(fact.payload.removedMemberIds.every((id) => !afterFaction.memberIds.includes(id))).toBe(true);
    expect(afterLedger.resources.map((resource) => resource.id)).not.toEqual(beforeResourceIds);
    expectDerivedPowerCannotBeForged(after, afterFaction);
    expect(validateWorld(after).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
  });

  it('records a floor-bound purge only when a real office root changes and never says it expelled zero people', () => {
    const prepared = prepareCourtWorld('POL06-清洗数值下限', 'purge', 1);
    const polity = prepared.world.polities.find((item) => item.id === prepared.polityId);
    const faction = prepared.world.factions.find((item) => item.id === prepared.factionId);
    const leader = prepared.world.characters.find((item) => item.id === prepared.leaderId);
    const governed = prepared.world.regions.find((item) => item.controllerId === polity?.id);
    if (!polity || !faction || !leader || !governed) throw new Error('missing purge floor fixture');
    leader.influence = 0;
    leader.loyalty = 0;
    leader.governedRegionId = governed.id;
    prepared.world.seed = purgeSeedRetainingAllMembers(prepared.world, faction, 'POL06-清洗零逐出');
    refreshFactionPowerLedgers(prepared.world, polity.id);
    prepared.world.hash = computeWorldHash(prepared.world);

    const after = advanceWorld(prepared.world);
    const fact = expectOneLinkedCourtAction(prepared.world, after, 'purge');
    expect(fact.payload.removedMemberIds).toEqual([]);
    expect(fact.stateDeltas).toContainEqual(expect.objectContaining({
      entityType: 'character', entityId: leader.id, field: 'governedRegionId', before: governed.id, after: null,
    }));
    expect(fact.stateDeltas.some((delta) => delta.before === delta.after)).toBe(false);
    const event = after.history.find((item) => item.sourceFactIds.includes(fact.id));
    expect(event?.summary).toContain('未拆散成员网络');
    expect(event?.summary).not.toContain('逐出0');
    const saved = serializeWorld(after);
    const restored = deserializeWorld(saved);
    expect(serializeWorld(restored)).toBe(saved);
    expect(validateWorld(restored).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
  });

  it('does not call loyalty loss alone a successful purge', () => {
    const prepared = prepareCourtWorld('POL06-清洗仅忠诚下降', 'purge', 1);
    const polity = prepared.world.polities.find((item) => item.id === prepared.polityId);
    const faction = prepared.world.factions.find((item) => item.id === prepared.factionId);
    const leader = prepared.world.characters.find((item) => item.id === prepared.leaderId);
    if (!polity || !faction || !leader) throw new Error('missing loyalty-only purge fixture');
    leader.influence = 0;
    leader.loyalty = 80;
    leader.governedRegionId = null;
    prepared.world.seed = purgeSeedRetainingAllMembers(prepared.world, faction, 'POL06-清洗仅忠诚下降');
    refreshFactionPowerLedgers(prepared.world, polity.id);
    const loyaltyBefore = leader.loyalty;
    prepared.world.hash = computeWorldHash(prepared.world);

    const after = advanceWorld(prepared.world);
    expect(after.facts.filter((fact) => (
      fact.turn === prepared.world.turn
      && fact.kind === 'court_action_resolved'
      && fact.payload.action === 'purge'
      && fact.payload.targetId === leader.id
    ))).toEqual([]);
    expect(after.characters.find((item) => item.id === leader.id)?.loyalty).toBe(loyaltyBefore);
  });

  it('records a former power broker falling only after the concrete roots drop below the threshold', () => {
    const prepared = prepareCourtWorld('POL06-权臣失势定向', 'power_broker_formed');
    const established = advanceWorld(prepared.world);
    expectOneLinkedCourtAction(prepared.world, established, 'power_broker_formed');
    const faction = established.factions.find((item) => item.id === prepared.factionId);
    const leader = established.characters.find((item) => item.id === prepared.leaderId);
    if (!faction || !leader) throw new Error('missing established power broker');

    const memberIds = new Set(faction.memberIds);
    for (const member of established.characters.filter((item) => memberIds.has(item.id))) {
      member.influence = 0;
      member.renown = 0;
      member.governedRegionId = null;
      member.commandingArmyId = null;
    }
    for (const family of established.families.filter((item) => (
      established.characters.some((character) => memberIds.has(character.id) && character.familyId === item.id)
    ))) {
      family.prestige = 0;
      family.politicalInfluence = 0;
      family.wealth = 0;
    }
    for (const office of established.offices.filter((item) => item.active && memberIds.has(item.holderId))) {
      office.active = false;
      office.endedTurn = established.turn;
    }
    faction.cohesion = 0;
    faction.alliedFactionIds = [];
    for (const member of established.characters.filter((item) => memberIds.has(item.id))) {
      member.factionId = null;
    }
    refreshFactionPowerLedgers(established, faction.polityId);
    expect(calculateFactionPowerLedger(established, faction).total).toBeLessThan(54);
    established.hash = computeWorldHash(established);

    const after = advanceWorld(established);
    const fact = expectOneLinkedCourtAction(established, after, 'power_broker_fell');
    expect(fact.payload.targetId).toBe(leader.id);
    expect(fact.payload.targetFactionId).toBe(faction.id);
    const endedFaction = after.factions.find((item) => item.id === faction.id);
    expect(endedFaction?.active).toBe(false);
    expect(endedFaction?.endedFactId).toBeTruthy();
    expect(fact.sourceFactIds).toContain(endedFaction?.endedFactId);
    const turnFacts = after.facts.filter((item) => item.turn === established.turn);
    const candidate = detectCourtStruggleCandidates(after, turnFacts)
      .find((item) => item.scopeKey === prepared.polityId);
    expect(candidate?.challengerFactionId).toBe(faction.id);
    expect(candidate?.resolution).toEqual({ outcomeKey: 'power_broker_fell', resultFactIds: [fact.id] });
    expect(after.characters.find((item) => item.id === leader.id)?.biography.some((item) => item.kind === '权臣失势')).toBe(true);
    expect(validateWorld(after).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
  });

  it('does not carry a power-broker tenure into another polity', () => {
    const prepared = prepareCourtWorld('POL06-权臣转籍任期终止', 'power_broker_formed');
    const established = advanceWorld(prepared.world);
    expectOneLinkedCourtAction(prepared.world, established, 'power_broker_formed');
    const leader = established.characters.find((item) => item.id === prepared.leaderId);
    const destination = established.polities.find((item) => item.alive && item.id !== prepared.polityId);
    if (!leader || !destination) throw new Error('missing transferred power-broker fixture');
    leader.polityId = destination.id;
    established.hash = computeWorldHash(established);

    const after = advanceWorld(established);
    expect(after.facts.filter((fact) => (
      fact.turn === established.turn
      && fact.kind === 'court_action_resolved'
      && fact.payload.action === 'power_broker_fell'
      && fact.payload.polityId === prepared.polityId
      && fact.payload.targetId === leader.id
    ))).toEqual([]);
  });

  it('records a palace seizure with the complete ruler transfer instead of a narrative-only event', () => {
    const prepared = prepareCourtWorld('POL06-宫变定向', 'power_broker_formed');
    const polity = prepared.world.polities.find((item) => item.id === prepared.polityId);
    const faction = prepared.world.factions.find((item) => item.id === prepared.factionId);
    const leader = prepared.world.characters.find((item) => item.id === prepared.leaderId);
    if (!polity || !faction || !leader) throw new Error('missing prepared coup actors');
    const oldRulerId = polity.rulerId;
    const ruler = prepared.world.characters.find((item) => item.id === oldRulerId);
    if (!ruler) throw new Error('missing prepared ruler');
    recordPowerBrokerFormation(prepared.world, polity, faction, leader, ruler);
    leader.ambition = 100;
    leader.loyalty = 0;
    leader.cunning = 100;
    leader.caution = 0;
    for (const member of prepared.world.characters.filter((item) => faction.memberIds.includes(item.id))) {
      member.influence = 100;
      member.renown = 100;
    }
    polity.authority = 0;
    const rulerFaction = ruler.factionId
      ? prepared.world.factions.find((item) => item.id === ruler.factionId)
      : undefined;
    const unrelated = prepared.world.factions
      .filter((item) => item.active && item.polityId === polity.id && item.id !== faction.id && item.id !== rulerFaction?.id)
      .slice(0, 2);
    expect(unrelated).toHaveLength(2);
    changeFactionRelation(prepared.world, factContext(prepared.world), faction.id, unrelated[0]!.id, 'alliance', 'formed', 'pol06_coup_relevant');
    changeFactionRelation(prepared.world, factContext(prepared.world), unrelated[0]!.id, unrelated[1]!.id, 'alliance', 'formed', 'pol06_coup_unrelated');
    refreshFactionPowerLedgers(prepared.world, polity.id);
    expect(faction.power).toBeGreaterThanOrEqual(72);
    prepared.world.hash = computeWorldHash(prepared.world);

    const after = advanceWorld(prepared.world);
    const fact = expectOneLinkedCourtAction(prepared.world, after, leader.familyId === (
      prepared.world.characters.find((item) => item.id === oldRulerId)?.familyId
    ) ? 'coup' : 'usurpation');
    expect(fact.payload.rulerBeforeId).toBe(oldRulerId);
    expect(fact.payload.rulerAfterId).toBe(leader.id);
    expect(after.polities.find((item) => item.id === polity.id)?.rulerId).toBe(leader.id);
    expect(fact.stateDeltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'polity', entityId: polity.id, field: 'rulerId' }),
      expect.objectContaining({ entityType: 'polity', entityId: polity.id, field: 'authority' }),
      expect.objectContaining({ entityType: 'polity', entityId: polity.id, field: 'legitimacy' }),
    ]));
    const coupFactionIds = new Set([faction.id, rulerFaction?.id].filter(Boolean));
    const sourceRelationFacts = fact.sourceFactIds.map((factId) => after.facts.find((item) => item.id === factId));
    expect(sourceRelationFacts.length).toBeGreaterThan(0);
    expect(sourceRelationFacts.every((item) => (
      item?.kind === 'faction_relation_changed'
      && (coupFactionIds.has(item.payload.leftFactionId) || coupFactionIds.has(item.payload.rightFactionId))
    ))).toBe(true);
    const unrelatedEnded = after.facts.find((item) => (
      item.turn === prepared.world.turn
      && item.kind === 'faction_relation_changed'
      && item.payload.action === 'ended'
      && [item.payload.leftFactionId, item.payload.rightFactionId].every((id) => unrelated.some((factionItem) => factionItem.id === id))
    ));
    expect(unrelatedEnded).toBeDefined();
    expect(fact.sourceFactIds).not.toContain(unrelatedEnded?.id);
    expect(validateWorld(after).filter((violation) => violation.code.startsWith('fact.court-'))).toEqual([]);
  });
});
