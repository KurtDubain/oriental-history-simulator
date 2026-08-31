import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld, serializeWorld } from '../index';
import type {
  ArmyState,
  CharacterState,
  CommitmentState,
  FactionState,
  PolityState,
  RelationshipState,
  WorldState,
} from '../types';
import type { BattleFact, CharacterDeathFact, SimulationFact } from '../facts';
import {
  buildMilitaryPowerCrisisIndex,
  detectMilitaryPowerCrisisCandidates,
  militaryPowerCrisisDetector,
  MILITARY_POWER_CRISIS_TEMPLATE,
  type MilitaryPowerCrisisCandidate,
} from './military-power-crisis-detector';

interface PreparedActor {
  world: WorldState;
  actor: CharacterState;
  polity: PolityState;
  army: ArmyState;
}

function relation(
  world: WorldState,
  sourceId: string,
  targetId: string,
  values: Partial<RelationshipState>,
): RelationshipState {
  let result = world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
  if (!result) {
    result = {
      id: `test-rel:${sourceId}:${targetId}`,
      sourceId,
      targetId,
      kinship: '无',
      affinity: 50,
      trust: 50,
      fear: 0,
      grievance: 0,
      gratitude: 0,
      lastInteractionTurn: world.turn,
      memories: [],
    };
    world.relationships.push(result);
  }
  Object.assign(result, values);
  return result;
}

function attachMilitaryFaction(world: WorldState, actor: CharacterState, polity: PolityState): FactionState {
  const existing = world.factions.find((faction) => faction.polityId === polity.id && faction.kind === '军门');
  const faction = existing ?? {
    id: `test-faction:${polity.id}`,
    polityId: polity.id,
    name: '北军宿将盟',
    kind: '军门' as const,
    leaderId: actor.id,
    memberIds: [actor.id],
    power: 90,
    cohesion: 90,
    agenda: '扩张权势' as const,
    alliedFactionIds: [],
    rivalFactionIds: [], relationSinceTurns: {},
    lastActionTurn: world.turn,
    active: true,
    endedTurn: null,
    origin: 'formed' as const, formedTurn: world.turn, coreMemberIds: [actor.id], predecessorFactionIds: [], successorFactionIds: [],
    leaderSinceTurn: world.turn, lastLifecycleTurn: world.turn, originFactId: null, endedReason: null, endedFactId: null, lifecycle: [],
  };
  faction.active = true;
  faction.leaderId = actor.id;
  faction.memberIds = [...new Set([actor.id, ...faction.memberIds])];
  faction.power = 94;
  faction.cohesion = 92;
  actor.factionId = faction.id;
  if (!existing) world.factions.push(faction);
  return faction;
}

function strengthenFamily(world: WorldState, actor: CharacterState): void {
  const family = world.families.find((item) => item.id === actor.familyId);
  if (!family) return;
  family.active = true;
  family.headId = actor.id;
  family.prestige = 92;
  family.politicalInfluence = 88;
  family.wealth = 300;
  family.traditions.military = 96;
}

function prepareCommander(seed: string): PreparedActor {
  const world = advanceWorld(createWorld(seed));
  const army = world.armies.find((candidate) => {
    const polity = world.polities.find((item) => item.id === candidate.polityId && item.alive);
    return Boolean(polity && candidate.commanderId !== polity.rulerId);
  });
  expect(army).toBeDefined();
  const polity = world.polities.find((item) => item.id === army?.polityId) as PolityState;
  const actor = world.characters.find((item) => item.id === army?.commanderId) as CharacterState;
  const ruler = world.characters.find((item) => item.id === polity.rulerId) as CharacterState;
  actor.commandingArmyId = army?.id ?? null;
  actor.ambition = 96;
  actor.loyalty = 8;
  actor.caution = 4;
  actor.merit = 80;
  actor.renown = 75;
  polity.authority = 10;
  if (army) {
    army.soldiers = 12_000;
    army.morale = 92;
    army.training = 88;
    army.supply = 90;
    army.experience = 82;
  }
  for (const other of world.armies.filter((item) => item.polityId === polity.id && item.id !== army?.id)) {
    other.soldiers = Math.min(other.soldiers, 1_000);
  }
  relation(world, actor.id, ruler.id, { trust: 8, grievance: 92, gratitude: 0, fear: 4 });
  relation(world, ruler.id, actor.id, { trust: 10, grievance: 75, gratitude: 0, fear: 82 });
  strengthenFamily(world, actor);
  attachMilitaryFaction(world, actor, polity);
  return { world, actor, polity, army: army as ArmyState };
}

function candidateFor(world: WorldState, actorId: string, facts: readonly SimulationFact[] = []): MilitaryPowerCrisisCandidate {
  const candidate = detectMilitaryPowerCrisisCandidates(world, facts).find((item) => (
    item.participants.coreCharacterIds.includes(actorId)
  ));
  expect(candidate).toBeDefined();
  return candidate as MilitaryPowerCrisisCandidate;
}

function battleFact(world: WorldState, actor: CharacterState, polity: PolityState, army: ArmyState): BattleFact {
  return {
    id: `test-battle:${world.turn}:${army.id}`,
    turn: world.turn,
    year: world.year,
    season: world.season,
    kind: 'battle',
    category: '军事',
    importance: 4,
    actorIds: [actor.id],
    polityIds: [polity.id],
    regionIds: [army.regionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      warId: 'test-war',
      targetRegionId: army.regionId,
      routeId: 'test-route',
      attackerWon: true,
      attackerPower: 100,
      defenderPower: 60,
      militiaLosses: 0,
      attacker: {
        armyId: army.id,
        polityId: polity.id,
        commanderId: actor.id,
        deputyCommanderId: army.deputyCommanderId,
        soldiersBefore: army.soldiers + 500,
        soldiersAfter: army.soldiers,
        moraleBefore: army.morale - 2,
        moraleAfter: army.morale,
        trainingBefore: army.training,
        supplyBefore: army.supply,
        losses: 500,
      },
      defenders: [],
    },
  };
}

describe('military power crisis detector', () => {
  it('is deterministic, read-only, bounded and emits only index/fact evidence', () => {
    const { world, actor } = prepareCommander('B03-detector-determinism');
    const before = serializeWorld(world);
    const left = detectMilitaryPowerCrisisCandidates(world, []);
    const right = detectMilitaryPowerCrisisCandidates(world, []);

    expect(left).toEqual(right);
    expect(serializeWorld(world)).toBe(before);
    const candidate = left.find((item) => item.participants.coreCharacterIds.includes(actor.id));
    expect(candidate).toBeDefined();
    if (!candidate) return;
    expect(candidate.candidateKey).toBe(`military_power_crisis:${candidate.scopeKey}`);
    expect(candidate.hasExecutableActor).toBe(true);
    expect(candidate.participants.armyIds.length).toBeLessThanOrEqual(4);
    expect(candidate.participants.supportingCharacterIds.length).toBeLessThanOrEqual(6);
    expect(candidate.signals.flatMap((signal) => signal.refs).every((ref) => (
      ref.kind === 'fact' || ref.kind === 'index'
    ))).toBe(true);
    expect(candidate.structureSignals.some((signal) => signal.key === 'actual_army_command')).toBe(true);
    expect(candidate.structureSignals.some((signal) => signal.key === 'military_network_support')).toBe(true);
    expect(candidate.structureSignals.some((signal) => signal.key === 'family_mobilization_capacity')).toBe(true);
  });

  it('separates structural pressure from loyalty, authority and relationship inhibition', () => {
    const risky = prepareCommander('B03-detector-inhibitors');
    const riskyCandidate = candidateFor(risky.world, risky.actor.id);
    const suppressedWorld = structuredClone(risky.world);
    const suppressedActor = suppressedWorld.characters.find((item) => item.id === risky.actor.id) as CharacterState;
    const suppressedPolity = suppressedWorld.polities.find((item) => item.id === risky.polity.id) as PolityState;
    const suppressedRuler = suppressedWorld.characters.find((item) => item.id === suppressedPolity.rulerId) as CharacterState;
    suppressedActor.ambition = 16;
    suppressedActor.loyalty = 96;
    suppressedActor.caution = 94;
    suppressedPolity.authority = 96;
    relation(suppressedWorld, suppressedActor.id, suppressedRuler.id, {
      trust: 96, affinity: 88, grievance: 0, gratitude: 82, fear: 0,
    });
    relation(suppressedWorld, suppressedRuler.id, suppressedActor.id, {
      trust: 94, affinity: 86, grievance: 0, gratitude: 75, fear: 0,
    });

    const suppressed = candidateFor(suppressedWorld, suppressedActor.id);
    expect(suppressed.pressure).toBeLessThan(riskyCandidate.pressure - 35);
    expect(suppressed.inhibitorSignals.map((signal) => signal.key)).toEqual(expect.arrayContaining([
      'low_ambition',
      'strong_loyalty',
      'strong_central_authority',
      'ruler_court_relationship',
    ]));
    expect(riskyCandidate.triggerSignals.some((signal) => signal.key === 'ruler_court_relationship')).toBe(true);
  });

  it('does not mark a deputy critical-capable without a real order, then exposes refusal as an executable next step', () => {
    const world = advanceWorld(createWorld('B03-deputy-executable-gate'));
    const army = world.armies.find((item) => (
      item.deputyCommanderId
      && !world.armies.some((other) => other.commanderId === item.deputyCommanderId)
    ));
    expect(army?.deputyCommanderId).toBeTruthy();
    const actor = world.characters.find((item) => item.id === army?.deputyCommanderId) as CharacterState;
    const commander = world.characters.find((item) => item.id === army?.commanderId) as CharacterState;
    const polity = world.polities.find((item) => item.id === army?.polityId) as PolityState;
    const ruler = world.characters.find((item) => item.id === polity.rulerId) as CharacterState;
    actor.ambition = 100;
    actor.loyalty = 0;
    actor.caution = 0;
    actor.deputyExperience = 90;
    actor.merit = 80;
    actor.renown = 70;
    actor.insubordination = 85;
    polity.authority = 0;
    if (army) {
      army.morale = 100;
      army.training = 100;
      army.supply = 100;
      army.experience = 100;
    }
    world.commitments = world.commitments.filter((item) => (
      item.kind !== '军令' || item.promisorId !== actor.id
    ));
    relation(world, actor.id, commander.id, { trust: 0, grievance: 100, gratitude: 0 });
    relation(world, actor.id, ruler.id, { trust: 0, grievance: 100, gratitude: 0 });
    relation(world, ruler.id, actor.id, { trust: 0, grievance: 100, fear: 100, gratitude: 0 });
    strengthenFamily(world, actor);
    attachMilitaryFaction(world, actor, polity);

    const withoutOrder = candidateFor(world, actor.id);
    expect(withoutOrder.pressure).toBeGreaterThanOrEqual(75);
    expect(withoutOrder.hasExecutableActor).toBe(false);
    expect(withoutOrder.executableActorIds).toEqual([]);

    const order: CommitmentState = {
      id: 'test-military-order',
      kind: '军令',
      promisorId: actor.id,
      promiseeId: commander.id,
      polityIds: [polity.id],
      terms: '遵从主帅调遣并于北境驻防',
      madeTurn: world.turn,
      dueTurn: world.turn + 2,
      status: '生效',
      resolvedTurn: null,
      eventId: 'legacy-event-link-not-read',
      resolutionEventId: null,
      trustStake: 20,
    };
    world.commitments.push(order);
    const withOrder = candidateFor(world, actor.id);
    expect(withOrder.hasExecutableActor).toBe(true);
    expect(withOrder.executableActorIds).toEqual([actor.id]);
    expect(withOrder.structureSignals.some((signal) => signal.key === 'active_military_order')).toBe(true);
    expect(withOrder.nextWatchSignal.key).toBe('watch_military_order_resolution');
    expect(withOrder.nextWatchSignal.refs).toContainEqual(expect.objectContaining({
      kind: 'index', entityType: 'commitment', entityId: order.id, field: 'status', value: '生效',
    }));
  });

  it('uses only current-turn Facts and ignores Chronicle text as an authority source', () => {
    const prepared = prepareCommander('B03-fact-boundary');
    const baseline = candidateFor(prepared.world, prepared.actor.id);
    const polluted = structuredClone(prepared.world);
    const oldEvent = polluted.history[0];
    if (oldEvent) {
      polluted.history.push({
        ...structuredClone(oldEvent),
        id: 'fake-chronicle-order-refused',
        turn: polluted.turn,
        kind: 'order_refused',
        title: '伪造的史册抗命',
        summary: '这段文案不得改变权威检测结果。',
        actorIds: [prepared.actor.id],
        polityIds: [prepared.polity.id],
      });
    }
    expect(candidateFor(polluted, prepared.actor.id)).toEqual(baseline);

    const currentBattle = battleFact(prepared.world, prepared.actor, prepared.polity, prepared.army);
    const withFact = candidateFor(prepared.world, prepared.actor.id, [currentBattle]);
    expect(withFact.triggerSignals.some((signal) => signal.key === 'recent_battle_record')).toBe(true);
    expect(withFact.sourceFactIds).toContain(currentBattle.id);
    expect(withFact.signals.flatMap((signal) => signal.refs)).toContainEqual({
      kind: 'fact', factId: currentBattle.id,
    });

    const staleBattle = { ...currentBattle, id: `${currentBattle.id}:stale`, turn: prepared.world.turn - 1 };
    expect(candidateFor(prepared.world, prepared.actor.id, [staleBattle])).toEqual(baseline);
  });

  it('emits an explicit, Fact-linked resolution when a military actor dies', () => {
    const prepared = prepareCommander('B03-death-resolution');
    const world = structuredClone(prepared.world);
    const actor = world.characters.find((item) => item.id === prepared.actor.id) as CharacterState;
    const army = world.armies.find((item) => item.id === prepared.army.id) as ArmyState;
    actor.alive = false;
    actor.deathTurn = world.turn;
    actor.commandingArmyId = null;
    actor.role = '将领';
    army.commanderId = prepared.polity.rulerId;
    for (const office of world.offices.filter((item) => item.holderId === actor.id && item.kind === '军团主帅')) {
      office.active = false;
      office.endedTurn = world.turn;
    }
    const deathFact: CharacterDeathFact = {
      id: `test-death:${world.turn}:${actor.id}`,
      turn: world.turn,
      year: world.year,
      season: world.season,
      kind: 'character_death',
      category: '人口',
      importance: 4,
      actorIds: [actor.id],
      polityIds: [prepared.polity.id],
      regionIds: [actor.locationRegionId],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        characterId: actor.id,
        age: actor.age,
        role: actor.role,
        health: 0,
        diseaseId: null,
      },
    };

    const resolution = candidateFor(world, actor.id, [deathFact]);
    expect(resolution.pressure).toBe(0);
    expect(resolution.hasExecutableActor).toBe(false);
    expect(resolution.resolution).toEqual({
      outcomeKey: 'actor_died',
      resultFactIds: [deathFact.id],
    });
    expect(resolution.sourceFactIds).toEqual([deathFact.id]);
    expect(resolution.signals).toEqual([
      expect.objectContaining({ key: 'actor_died', role: 'outcome', sourceFactIds: [deathFact.id] }),
    ]);
    expect(resolution.signals[0]?.refs).toContainEqual({ kind: 'fact', factId: deathFact.id });
  });

  it('keeps natural-world pressure selective while retaining low-pressure cooling observations', () => {
    let world = createWorld('B03-natural-calibration');
    let observations = 0;
    let qualifying = 0;
    for (let index = 0; index < 12; index += 1) {
      world = advanceWorld(world);
      const resolvedTurn = world.turn - 1;
      const facts = world.facts.filter((fact) => fact.turn === resolvedTurn);
      const candidates = militaryPowerCrisisDetector.detect({
        turn: resolvedTurn,
        facts,
        index: buildMilitaryPowerCrisisIndex(world),
      });
      observations += candidates.length;
      qualifying += candidates.filter((candidate) => (
        candidate.pressure >= MILITARY_POWER_CRISIS_TEMPLATE.formationThreshold
      )).length;
      const resolutionFacts = facts.filter((fact) => (
        fact.kind === 'character_death' || fact.kind === 'appointment_ended'
      )).length;
      expect(candidates.length).toBeLessThanOrEqual(world.armies.length * 2 + resolutionFacts);
      expect(candidates.every((candidate) => candidate.pressure >= 0 && candidate.pressure <= 100)).toBe(true);
    }
    expect(observations).toBeGreaterThan(0);
    expect(qualifying / observations).toBeLessThan(0.45);
  });
});
