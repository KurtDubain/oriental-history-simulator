import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld, serializeWorld } from '../index';
import type {
  CharacterState,
  FactionState,
  FamilyState,
  PolityState,
  WorldState,
} from '../types';
import type {
  AppointmentStartedFact,
  AppointmentEndedFact,
  CharacterDeathFact,
  SimulationFact,
  TerritoryControlFact,
} from '../facts';
import {
  buildInheritanceCrisisIndex,
  detectInheritanceCrisisCandidates,
  inheritanceCrisisDetector,
  INHERITANCE_CRISIS_TEMPLATE,
  type InheritanceCrisisCandidate,
} from './inheritance-crisis-detector';
import { createSituationSystemState, reduceSituationTurn } from './reducer';

interface PreparedSuccession {
  world: WorldState;
  polity: PolityState;
  ruler: CharacterState;
  first: CharacterState;
  second: CharacterState;
  external: CharacterState;
}

function localCharacters(world: WorldState, polity: PolityState): CharacterState[] {
  return world.characters
    .filter((character) => character.alive && character.polityId === polity.id && character.id !== polity.rulerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function activeFamily(world: WorldState, character: CharacterState): FamilyState {
  const family = world.families.find((item) => item.id === character.familyId);
  expect(family).toBeDefined();
  if (!family) throw new Error(`Missing family ${character.familyId}`);
  family.active = true;
  return family;
}

function attachFaction(
  world: WorldState,
  polity: PolityState,
  character: CharacterState,
  suffix: string,
): FactionState {
  const faction: FactionState = {
    id: `test-succession-faction:${polity.id}:${suffix}`,
    polityId: polity.id,
    name: `${character.familyName}氏拥立会`,
    kind: suffix === 'external' ? '官僚' : '宗室',
    leaderId: character.id,
    memberIds: [character.id],
    power: 92,
    cohesion: 90,
    agenda: '扩张权势',
    alliedFactionIds: [],
    rivalFactionIds: [], relationSinceTurns: {},
    lastActionTurn: world.turn,
    active: true,
    endedTurn: null,
    origin: 'formed', formedTurn: world.turn, coreMemberIds: [character.id], predecessorFactionIds: [], successorFactionIds: [],
    leaderSinceTurn: world.turn, lastLifecycleTurn: world.turn, originFactId: null, endedReason: null, endedFactId: null, lifecycle: [],
  };
  character.factionId = faction.id;
  world.factions.push(faction);
  return faction;
}

function prepareSuccession(seed: string): PreparedSuccession {
  const world = advanceWorld(createWorld(seed));
  const polity = world.polities
    .filter((item) => item.alive && localCharacters(world, item).length >= 3)
    .sort((left, right) => left.id.localeCompare(right.id))[0] as PolityState;
  expect(polity).toBeDefined();
  const ruler = world.characters.find((character) => character.id === polity.rulerId) as CharacterState;
  const [first, second, external] = localCharacters(world, polity);
  expect(ruler).toBeDefined();
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(external).toBeDefined();

  ruler.age = 82;
  ruler.health = 14;
  polity.legitimacy = 14;
  polity.authority = 12;

  first.age = 31;
  first.parentIds = [ruler.id];
  first.ambition = 78;
  first.influence = 78;
  first.renown = 72;
  first.governance = 72;

  second.age = 29;
  second.parentIds = [ruler.id];
  second.ambition = 82;
  second.influence = 76;
  second.renown = 70;
  second.governance = 70;

  external.age = 38;
  external.politicalClass = '外戚';
  external.spouseIds = [ruler.id];
  ruler.spouseIds = [external.id];
  external.ambition = 88;
  external.influence = 86;
  external.renown = 76;

  const rulingFamily = polity.rulingFamilyId
    ? world.families.find((family) => family.id === polity.rulingFamilyId)
    : undefined;
  expect(rulingFamily).toBeDefined();
  if (rulingFamily) {
    rulingFamily.active = true;
    rulingFamily.prestige = 12;
    rulingFamily.politicalInfluence = 10;
  }
  const externalFamily = activeFamily(world, external);
  externalFamily.prestige = 96;
  externalFamily.politicalInfluence = 94;
  externalFamily.headId = external.id;

  attachFaction(world, polity, first, 'first');
  attachFaction(world, polity, second, 'second');
  attachFaction(world, polity, external, 'external');

  const armies = world.armies.filter((army) => army.polityId === polity.id);
  expect(armies.length).toBeGreaterThan(0);
  const army = armies[0];
  if (army) {
    army.commanderId = first.id;
    army.soldiers = Math.max(12_000, army.soldiers);
    first.commandingArmyId = army.id;
  }
  for (const other of armies.slice(1)) other.soldiers = Math.min(900, other.soldiers);
  return { world, polity, ruler, first, second, external };
}

function appointmentFact(
  prepared: PreparedSuccession,
  holder: CharacterState = prepared.first,
): AppointmentStartedFact {
  return {
    id: `test-succession-appointment:${prepared.world.turn}:${holder.id}`,
    turn: prepared.world.turn,
    year: prepared.world.year,
    season: prepared.world.season,
    kind: 'appointment_started',
    category: '政治',
    importance: 3,
    actorIds: [holder.id],
    polityIds: [prepared.polity.id],
    regionIds: prepared.polity.capitalRegionId ? [prepared.polity.capitalRegionId] : [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: `test-office:${holder.id}`,
      action: 'started',
      officeKind: '宰辅',
      holderId: holder.id,
      polityId: prepared.polity.id,
      regionId: prepared.polity.capitalRegionId,
      armyId: null,
      fleetId: null,
      rank: 85,
    },
  };
}

function candidateFor(
  world: WorldState,
  polityId: string,
  facts: readonly SimulationFact[] = [],
): InheritanceCrisisCandidate {
  const candidate = detectInheritanceCrisisCandidates(world, facts)
    .find((item) => item.scopeKey === polityId);
  expect(candidate).toBeDefined();
  return candidate as InheritanceCrisisCandidate;
}

function makeClearSuccession(world: WorldState, polity: PolityState, ruler: CharacterState): CharacterState {
  const candidates = localCharacters(world, polity);
  const heir = candidates[0] as CharacterState;
  ruler.age = 34;
  ruler.health = 100;
  ruler.parentIds = [];
  ruler.spouseIds = [];
  polity.legitimacy = 96;
  polity.authority = 94;
  expect(polity.rulingFamilyId).toBeTruthy();

  for (const character of candidates) {
    character.parentIds = [];
    character.spouseIds = [];
    character.ambition = 12;
    character.influence = 20;
    character.renown = 20;
    const replacementFamily = world.families.find((family) => (
      family.polityId === polity.id && family.id !== polity.rulingFamilyId && family.id !== heir.familyId
    ));
    if (replacementFamily) character.familyId = replacementFamily.id;
  }
  heir.parentIds = [ruler.id];
  heir.familyId = polity.rulingFamilyId as string;
  heir.age = 26;
  heir.influence = 72;
  heir.renown = 65;
  const rulingFamily = world.families.find((family) => family.id === polity.rulingFamilyId) as FamilyState;
  rulingFamily.active = true;
  rulingFamily.prestige = 95;
  rulingFamily.politicalInfluence = 94;
  rulingFamily.headId = ruler.id;
  world.factions = world.factions.filter((faction) => faction.polityId !== polity.id);
  for (const army of world.armies.filter((item) => item.polityId === polity.id)) {
    army.commanderId = ruler.id;
    army.deputyCommanderId = null;
  }
  for (const fleet of world.fleets.filter((item) => item.polityId === polity.id)) {
    fleet.commanderId = ruler.id;
    fleet.deputyCommanderId = null;
  }
  for (const character of candidates) {
    character.commandingArmyId = null;
    character.commandingFleetId = null;
  }
  return heir;
}

function deathFact(
  world: WorldState,
  polity: PolityState,
  ruler: CharacterState,
): CharacterDeathFact {
  return {
    id: `test-ruler-death:${world.turn}:${ruler.id}`,
    turn: world.turn,
    year: world.year,
    season: world.season,
    kind: 'character_death',
    category: '政治',
    importance: 4,
    actorIds: [ruler.id],
    polityIds: [polity.id],
    regionIds: [ruler.locationRegionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      characterId: ruler.id,
      age: ruler.age,
      role: '君主',
      health: 0,
      diseaseId: null,
    },
  };
}

function rulerAppointmentFact(
  world: WorldState,
  polity: PolityState,
  holder: CharacterState,
  action: 'started',
): AppointmentStartedFact;
function rulerAppointmentFact(
  world: WorldState,
  polity: PolityState,
  holder: CharacterState,
  action: 'ended',
): AppointmentEndedFact;
function rulerAppointmentFact(
  world: WorldState,
  polity: PolityState,
  holder: CharacterState,
  action: 'started' | 'ended',
): AppointmentStartedFact | AppointmentEndedFact {
  return {
    id: `test-ruler-office:${world.turn}:${action}:${holder.id}`,
    turn: world.turn,
    year: world.year,
    season: world.season,
    kind: action === 'started' ? 'appointment_started' : 'appointment_ended',
    category: '政治',
    importance: 4,
    actorIds: [holder.id],
    polityIds: [polity.id],
    regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: `test-ruler-office:${holder.id}`,
      action,
      officeKind: '君主',
      holderId: holder.id,
      polityId: polity.id,
      regionId: null,
      armyId: null,
      fleetId: null,
      rank: 100,
    },
  } as AppointmentStartedFact | AppointmentEndedFact;
}

describe('inheritance crisis detector', () => {
  it('is deterministic, read-only, bounded, and exposes indexed succession pressure', () => {
    const prepared = prepareSuccession('B04-determinism');
    const fact = appointmentFact(prepared);
    const before = serializeWorld(prepared.world);
    const left = detectInheritanceCrisisCandidates(prepared.world, [fact]);
    const right = detectInheritanceCrisisCandidates(prepared.world, [fact]);

    expect(left).toEqual(right);
    expect(serializeWorld(prepared.world)).toBe(before);
    const candidate = left.find((item) => item.scopeKey === prepared.polity.id);
    expect(candidate).toBeDefined();
    if (!candidate) return;
    expect(candidate.candidateKey).toBe(`inheritance_crisis:${prepared.polity.id}`);
    expect(candidate.pressure).toBeGreaterThanOrEqual(INHERITANCE_CRISIS_TEMPLATE.formationThreshold);
    expect(candidate.hasExecutableActor).toBe(true);
    expect(candidate.executableActorIds).toContain(prepared.first.id);
    expect(candidate.participants.coreCharacterIds.length).toBeLessThanOrEqual(4);
    expect(candidate.participants.familyIds.length).toBeLessThanOrEqual(4);
    expect(candidate.participants.factionIds.length).toBeLessThanOrEqual(5);
    expect(candidate.participants.armyIds.length).toBeLessThanOrEqual(4);
    expect(candidate.participants.opposingCharacterIds.every((id) => (
      !candidate.participants.coreCharacterIds.includes(id)
    ))).toBe(true);
    expect(candidate.participants.supportingCharacterIds.every((id) => (
      !candidate.participants.coreCharacterIds.includes(id)
      && !candidate.participants.opposingCharacterIds.includes(id)
    ))).toBe(true);
    expect(candidate.sourceFactIds).toContain(fact.id);
    expect(candidate.signals.flatMap((signal) => signal.refs).every((ref) => (
      ref.kind === 'index' || (ref.kind === 'fact' && ref.factId === fact.id)
    ))).toBe(true);
    expect(candidate.structureSignals.map((signal) => signal.key)).toEqual(expect.arrayContaining([
      'ruler_mortality_exposure',
      'competing_legal_claims',
      'weak_dynastic_legitimacy',
      'factional_succession_split',
      'consort_clan_pressure',
      'claimant_military_support',
    ]));
    expect(candidate.startSnapshot.legalCandidateCount).toBeGreaterThanOrEqual(3);
    expect(candidate.startSnapshot.leadingCandidateId).toBeTruthy();
  });

  it('keeps a healthy ruler and one clear legal heir below a contested succession', () => {
    const risky = prepareSuccession('B04-clear-heir');
    const riskyCandidate = candidateFor(risky.world, risky.polity.id);
    const clearWorld = structuredClone(risky.world);
    const clearPolity = clearWorld.polities.find((item) => item.id === risky.polity.id) as PolityState;
    const clearRuler = clearWorld.characters.find((item) => item.id === risky.ruler.id) as CharacterState;
    const heir = makeClearSuccession(clearWorld, clearPolity, clearRuler);
    const clear = candidateFor(clearWorld, clearPolity.id);

    expect(clear.pressure).toBeLessThan(riskyCandidate.pressure - 45);
    expect(clear.startSnapshot.legalCandidateCount).toBe(1);
    expect(clear.startSnapshot.leadingCandidateId).toBe(heir.id);
    expect(clear.inhibitorSignals.map((signal) => signal.key)).toEqual(expect.arrayContaining([
      'ruler_health_stable',
      'clear_legal_successor',
      'strong_dynastic_legitimacy',
      'strong_succession_enforcement',
      'strong_ruling_family_capacity',
    ]));
  });

  it('requires a real adult actor before a critical succession step is executable', () => {
    const prepared = prepareSuccession('B04-executable-gate');
    prepared.ruler.health = 8;
    for (const character of localCharacters(prepared.world, prepared.polity)) character.age = 12;

    const candidate = candidateFor(prepared.world, prepared.polity.id);
    expect(candidate.pressure).toBeGreaterThanOrEqual(INHERITANCE_CRISIS_TEMPLATE.formationThreshold);
    expect(candidate.hasExecutableActor).toBe(false);
    expect(candidate.executableActorIds).toEqual([]);
  });

  it('treats actual fleet command as military support and an executable power base', () => {
    const prepared = prepareSuccession('B04-fleet-support');
    const fleets = prepared.world.fleets.filter((fleet) => fleet.polityId === prepared.polity.id);
    expect(fleets.length).toBeGreaterThan(0);
    for (const army of prepared.world.armies.filter((item) => item.polityId === prepared.polity.id)) {
      army.commanderId = prepared.ruler.id;
      army.deputyCommanderId = null;
    }
    prepared.first.commandingArmyId = null;
    const fleet = fleets[0];
    if (!fleet) return;
    fleet.commanderId = prepared.first.id;
    fleet.deputyCommanderId = null;
    fleet.sailors = Math.max(2_400, fleet.sailors);
    prepared.first.commandingFleetId = fleet.id;
    for (const other of fleets.slice(1)) other.sailors = Math.min(100, other.sailors);

    const index = buildInheritanceCrisisIndex(prepared.world);
    const claim = index.claimsByPolity.get(prepared.polity.id)
      ?.find((item) => item.characterId === prepared.first.id);
    expect(claim?.navalSupport).toBeGreaterThan(70);
    expect(claim?.supportingFleetIds).toContain(fleet.id);
    expect(claim?.executable).toBe(true);
    const candidate = candidateFor(prepared.world, prepared.polity.id);
    expect(candidate.executableActorIds).toContain(prepared.first.id);
    expect(candidate.participants.fleetIds).toContain(fleet.id);
    expect(candidate.structureSignals.some((signal) => (
      signal.key === 'claimant_military_support'
      && signal.refs.some((ref) => ref.kind === 'index' && ref.entityType === 'fleet')
    ))).toBe(true);
  });

  it('uses only current-turn Facts and never reads Chronicle prose', () => {
    const prepared = prepareSuccession('B04-fact-boundary');
    const baseline = candidateFor(prepared.world, prepared.polity.id);
    const polluted = structuredClone(prepared.world);
    const event = polluted.history[0];
    if (event) {
      polluted.history.push({
        ...structuredClone(event),
        id: 'fake-chronicle-succession',
        turn: polluted.turn,
        kind: 'succession',
        title: '伪造的储君册立',
        summary: '这段史册文案不得改变继承危机检测结果。',
        actorIds: [prepared.first.id],
        polityIds: [prepared.polity.id],
      });
    }
    expect(candidateFor(polluted, prepared.polity.id)).toEqual(baseline);

    const currentFact = appointmentFact(prepared);
    const withCurrent = candidateFor(prepared.world, prepared.polity.id, [currentFact]);
    expect(withCurrent.sourceFactIds).toContain(currentFact.id);
    expect(withCurrent.triggerSignals.some((signal) => signal.key === 'current_succession_evidence')).toBe(true);

    const stale = { ...currentFact, id: `${currentFact.id}:stale`, turn: prepared.world.turn - 1 };
    expect(candidateFor(prepared.world, prepared.polity.id, [stale])).toEqual(baseline);

    const otherPolity = prepared.world.polities.find((item) => item.alive && item.id !== prepared.polity.id) as PolityState;
    const otherRuler = prepared.world.characters.find((item) => item.id === otherPolity.rulerId) as CharacterState;
    const unrelated: AppointmentStartedFact = {
      ...currentFact,
      id: `${currentFact.id}:other-polity`,
      actorIds: [otherRuler.id],
      polityIds: [otherPolity.id],
      payload: {
        ...currentFact.payload,
        holderId: otherRuler.id,
        polityId: otherPolity.id,
      },
    };
    expect(candidateFor(prepared.world, prepared.polity.id, [unrelated])).toEqual(baseline);
  });

  it('cannot form from structural index pressure alone without a related current-turn Fact', () => {
    const prepared = prepareSuccession('B04-fact-required-to-form');
    const index = buildInheritanceCrisisIndex(prepared.world);
    const candidate = inheritanceCrisisDetector.detect({
      turn: prepared.world.turn,
      facts: [],
      index,
    }).find((item) => item.scopeKey === prepared.polity.id);
    expect(candidate?.pressure).toBeGreaterThanOrEqual(INHERITANCE_CRISIS_TEMPLATE.formationThreshold);
    expect(candidate?.signals.flatMap((signal) => signal.refs).some((ref) => ref.kind === 'fact')).toBe(false);

    let state = createSituationSystemState(prepared.world.turn - 1);
    for (let offset = 0; offset < 3; offset += 1) {
      state = reduceSituationTurn(
        state,
        {
          turn: prepared.world.turn + offset,
          facts: [],
          index,
          detectors: [inheritanceCrisisDetector],
        },
        { templates: [INHERITANCE_CRISIS_TEMPLATE] },
      ).state;
    }
    expect(state.situations).toEqual([]);
  });

  it('keeps claim scoring exactly aligned with the engine legacy succession formula', () => {
    const prepared = prepareSuccession('B04-engine-score-parity');
    const index = buildInheritanceCrisisIndex(prepared.world);
    const claim = index.claimsByPolity.get(prepared.polity.id)
      ?.find((item) => item.characterId === prepared.first.id);
    expect(claim).toBeDefined();
    if (!claim) return;
    const family = prepared.world.families.find((item) => item.id === prepared.first.familyId);
    const factionSupport = prepared.world.factions
      .filter((faction) => (
        faction.active
        && faction.polityId === prepared.polity.id
        && faction.memberIds.includes(prepared.first.id)
      ))
      .reduce((sum, faction) => sum + faction.power * 0.22, 0);
    const officeSupport = prepared.world.offices
      .filter((office) => (
        office.active
        && office.polityId === prepared.polity.id
        && office.holderId === prepared.first.id
      ))
      .reduce((sum, office) => sum + office.rank * 0.14, 0);
    const institutionalSupport = factionSupport
      + officeSupport
      + (family?.prestige ?? 0) * 0.18
      + (prepared.first.commandingArmyId || prepared.first.commandingFleetId ? 24 : 0);
    const expected = Math.round((
      100 * 0.46
      + institutionalSupport * 0.34
      + prepared.first.governance * 0.08
      + prepared.first.cunning * 0.06
      + prepared.first.renown * 0.04
      + prepared.first.loyalty * 0.02
    ) * 10) / 10;
    expect(claim.claimStrength).toBe(expected);
  });

  it('prioritizes a legal minor with a real regent over a stronger adult claimant', () => {
    const prepared = prepareSuccession('B04-minor-priority-parity');
    prepared.first.age = 34;
    prepared.first.parentIds = [prepared.ruler.id];
    prepared.first.influence = 100;
    prepared.first.governance = 100;
    prepared.first.cunning = 100;
    prepared.first.renown = 100;
    prepared.second.age = 12;
    prepared.second.parentIds = [prepared.ruler.id];
    prepared.second.influence = 5;
    prepared.second.governance = 5;
    prepared.second.cunning = 5;
    prepared.second.renown = 5;
    prepared.second.commandingArmyId = null;
    prepared.second.commandingFleetId = null;

    const index = buildInheritanceCrisisIndex(prepared.world);
    const adultClaim = index.claimsByPolity.get(prepared.polity.id)
      ?.find((claim) => claim.characterId === prepared.first.id);
    const minorClaim = index.claimsByPolity.get(prepared.polity.id)
      ?.find((claim) => claim.characterId === prepared.second.id);
    expect(adultClaim?.claimStrength).toBeGreaterThan(minorClaim?.claimStrength ?? 0);
    expect(index.expectedSuccessorByPolity.get(prepared.polity.id)).toBe(prepared.second.id);
    expect(index.expectedRegentByPolity.get(prepared.polity.id)).toBe(prepared.first.id);

    const candidate = candidateFor(prepared.world, prepared.polity.id, [appointmentFact(prepared)]);
    expect(candidate.startSnapshot.leadingCandidateId).toBe(prepared.second.id);
    expect(candidate.participants.supportingCharacterIds).toContain(prepared.first.id);
    expect(candidate.participants.opposingCharacterIds).not.toContain(prepared.first.id);
    expect(candidate.possibleOutcomes.find((outcome) => outcome.key === 'regency_established')?.confidence)
      .toBe(72);
  });

  it('uses stable character id as the adult succession tie-break', () => {
    const prepared = prepareSuccession('B04-adult-tie-break');
    const candidates = localCharacters(prepared.world, prepared.polity);
    expect(candidates.length).toBeGreaterThan(1);
    for (const character of candidates) {
      character.age = 30;
      character.parentIds = [];
      character.spouseIds = [];
      character.familyId = prepared.ruler.familyId;
      character.governance = 50;
      character.cunning = 50;
      character.renown = 50;
      character.loyalty = 50;
      character.commandingArmyId = null;
      character.commandingFleetId = null;
    }
    prepared.world.factions = prepared.world.factions.filter(
      (faction) => faction.polityId !== prepared.polity.id,
    );
    prepared.world.offices = prepared.world.offices.filter(
      (office) => office.polityId !== prepared.polity.id,
    );
    for (const army of prepared.world.armies.filter((item) => item.polityId === prepared.polity.id)) {
      army.commanderId = prepared.ruler.id;
      army.deputyCommanderId = null;
    }
    for (const fleet of prepared.world.fleets.filter((item) => item.polityId === prepared.polity.id)) {
      fleet.commanderId = prepared.ruler.id;
      fleet.deputyCommanderId = null;
    }

    const expectedId = candidates.map((character) => character.id).sort()[0];
    const index = buildInheritanceCrisisIndex(prepared.world);
    expect(index.expectedSuccessorByPolity.get(prepared.polity.id)).toBe(expectedId);
  });

  it('uses death plus both ruler-office Facts for an orderly same-dynasty succession', () => {
    const prepared = prepareSuccession('B04-lawful-resolution');
    const world = structuredClone(prepared.world);
    const polity = world.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    const predecessor = world.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const successor = world.characters.find((item) => item.id === prepared.first.id) as CharacterState;
    successor.parentIds = [predecessor.id];
    successor.familyId = predecessor.familyId;
    successor.alive = true;
    predecessor.alive = false;
    predecessor.deathTurn = world.turn;
    polity.rulerId = successor.id;
    polity.rulingFamilyId = successor.familyId;
    const fact = deathFact(world, polity, predecessor);
    const ended = rulerAppointmentFact(world, polity, predecessor, 'ended');
    const started = rulerAppointmentFact(world, polity, successor, 'started');

    const resolution = candidateFor(world, polity.id, [fact, ended, started]);
    expect(resolution.pressure).toBe(0);
    expect(resolution.hasExecutableActor).toBe(false);
    expect(resolution.resolution).toEqual({
      outcomeKey: 'orderly_succession',
      resultFactIds: [ended.id, started.id, fact.id].sort(),
    });
    expect(resolution.sourceFactIds).toEqual([ended.id, started.id, fact.id].sort());
    expect(resolution.participants.coreCharacterIds).toEqual(expect.arrayContaining([
      predecessor.id,
      successor.id,
    ]));
    for (const source of [fact, ended, started]) {
      expect(resolution.signals[0]?.refs).toContainEqual({ kind: 'fact', factId: source.id });
    }
    expect(resolution.signals[0]?.refs).toContainEqual(expect.objectContaining({
      kind: 'index', entityType: 'polity', entityId: polity.id, field: 'rulerId', value: successor.id,
    }));
  });

  it('distinguishes a minor regency and an unrelated post-death dynasty replacement', () => {
    const prepared = prepareSuccession('B04-minor-and-dynasty');
    const minorWorld = structuredClone(prepared.world);
    const minorPolity = minorWorld.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    const oldRuler = minorWorld.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const minor = minorWorld.characters.find((item) => item.id === prepared.first.id) as CharacterState;
    minor.age = 12;
    minor.parentIds = [oldRuler.id];
    minor.familyId = oldRuler.familyId;
    oldRuler.alive = false;
    oldRuler.deathTurn = minorWorld.turn;
    minorPolity.rulerId = minor.id;
    minorPolity.rulingFamilyId = minor.familyId;
    const minorDeath = deathFact(minorWorld, minorPolity, oldRuler);
    const minorEnded = rulerAppointmentFact(minorWorld, minorPolity, oldRuler, 'ended');
    const minorStarted = rulerAppointmentFact(minorWorld, minorPolity, minor, 'started');
    expect(candidateFor(minorWorld, minorPolity.id, [minorDeath, minorEnded, minorStarted]).resolution)
      .toEqual(expect.objectContaining({ outcomeKey: 'regency_established' }));

    const dynastyWorld = structuredClone(prepared.world);
    const dynastyPolity = dynastyWorld.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    const predecessor = dynastyWorld.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const successor = dynastyWorld.characters.find((item) => item.id === prepared.second.id) as CharacterState;
    successor.age = 36;
    successor.parentIds = [];
    successor.spouseIds = [];
    predecessor.spouseIds = [];
    expect(successor.familyId).not.toBe(predecessor.familyId);
    predecessor.alive = false;
    predecessor.deathTurn = dynastyWorld.turn;
    dynastyPolity.rulerId = successor.id;
    dynastyPolity.rulingFamilyId = successor.familyId;
    const dynastyDeath = deathFact(dynastyWorld, dynastyPolity, predecessor);
    const dynastyEnded = rulerAppointmentFact(dynastyWorld, dynastyPolity, predecessor, 'ended');
    const dynastyStarted = rulerAppointmentFact(dynastyWorld, dynastyPolity, successor, 'started');
    expect(candidateFor(dynastyWorld, dynastyPolity.id, [dynastyDeath, dynastyEnded, dynastyStarted]).resolution)
      .toEqual(expect.objectContaining({ outcomeKey: 'dynasty_replaced' }));
  });

  it('distinguishes a living same-family palace transfer from an unrelated usurpation', () => {
    const prepared = prepareSuccession('B04-palace-transfer');
    const palaceWorld = structuredClone(prepared.world);
    const palacePolity = palaceWorld.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    const predecessor = palaceWorld.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const successor = palaceWorld.characters.find((item) => item.id === prepared.first.id) as CharacterState;
    predecessor.alive = true;
    successor.familyId = predecessor.familyId;
    successor.parentIds = [predecessor.id];
    palacePolity.rulerId = successor.id;
    palacePolity.rulingFamilyId = successor.familyId;
    const ended = rulerAppointmentFact(palaceWorld, palacePolity, predecessor, 'ended');
    const started = rulerAppointmentFact(palaceWorld, palacePolity, successor, 'started');
    const palace = candidateFor(palaceWorld, palacePolity.id, [ended, started]);
    expect(palace.resolution).toEqual({
      outcomeKey: 'palace_transfer',
      resultFactIds: [ended.id, started.id].sort(),
    });
    for (const source of [ended, started]) {
      expect(palace.signals[0]?.refs).toContainEqual({ kind: 'fact', factId: source.id });
    }

    const usurpWorld = structuredClone(prepared.world);
    const usurpPolity = usurpWorld.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    const oldRuler = usurpWorld.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const usurper = usurpWorld.characters.find((item) => item.id === prepared.second.id) as CharacterState;
    usurper.parentIds = [];
    usurper.spouseIds = [];
    expect(usurper.familyId).not.toBe(oldRuler.familyId);
    usurpPolity.rulerId = usurper.id;
    usurpPolity.rulingFamilyId = usurper.familyId;
    const usurpEnded = rulerAppointmentFact(usurpWorld, usurpPolity, oldRuler, 'ended');
    const usurpStarted = rulerAppointmentFact(usurpWorld, usurpPolity, usurper, 'started');
    expect(candidateFor(usurpWorld, usurpPolity.id, [usurpEnded, usurpStarted]).resolution)
      .toEqual(expect.objectContaining({ outcomeKey: 'usurpation' }));
  });

  it('classifies administrative absorption separately from military destruction', () => {
    const prepared = prepareSuccession('B04-extinction-resolution');
    const world = structuredClone(prepared.world);
    const polity = world.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    const recipient = world.polities.find((item) => item.alive && item.id !== polity.id) as PolityState;
    polity.alive = false;
    polity.eliminatedTurn = world.turn;
    const regionId = polity.controlledRegionIds[0] ?? prepared.ruler.locationRegionId;
    const fact: TerritoryControlFact = {
      id: `test-extinction:${world.turn}:${polity.id}`,
      turn: world.turn,
      year: world.year,
      season: world.season,
      kind: 'territory_control_changed',
      category: '政治',
      importance: 5,
      actorIds: [prepared.ruler.id],
      polityIds: [polity.id, recipient.id],
      regionIds: [regionId],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        regionId,
        previousControllerId: polity.id,
        nextControllerId: recipient.id,
        reason: 'administrative_transfer',
        warId: null,
      },
    };

    const predecessor = world.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const intermediateSuccessor = world.characters.find((item) => item.id === prepared.first.id) as CharacterState;
    predecessor.alive = false;
    predecessor.deathTurn = world.turn;
    intermediateSuccessor.parentIds = [predecessor.id];
    intermediateSuccessor.familyId = predecessor.familyId;
    polity.rulerId = intermediateSuccessor.id;
    const rulerDeath = deathFact(world, polity, predecessor);
    const ended = rulerAppointmentFact(world, polity, predecessor, 'ended');
    const started = rulerAppointmentFact(world, polity, intermediateSuccessor, 'started');
    const resolution = candidateFor(world, polity.id, [fact, rulerDeath, ended, started]);
    expect(resolution.resolution).toEqual({
      outcomeKey: 'lineage_extinguished_and_absorbed',
      resultFactIds: [ended.id, fact.id, rulerDeath.id, started.id].sort(),
    });
    expect(resolution.signals).toEqual([
      expect.objectContaining({
        key: 'lineage_extinguished_and_absorbed',
        role: 'outcome',
        sourceFactIds: [ended.id, fact.id, rulerDeath.id, started.id].sort(),
      }),
    ]);
    for (const source of [fact, rulerDeath, ended, started]) {
      expect(resolution.signals[0]?.refs).toContainEqual({ kind: 'fact', factId: source.id });
    }
    expect(resolution.participants.coreCharacterIds).toEqual(expect.arrayContaining([
      predecessor.id,
      intermediateSuccessor.id,
    ]));
    expect(resolution.nextWatchSignal.key).toBe('watch_successor_states');

    const destroyedWorld = structuredClone(prepared.world);
    const destroyedPolity = destroyedWorld.polities.find((item) => item.id === prepared.polity.id) as PolityState;
    destroyedPolity.alive = false;
    destroyedPolity.eliminatedTurn = destroyedWorld.turn;
    const battleCapture: TerritoryControlFact = {
      ...fact,
      id: `test-battle-destruction:${destroyedWorld.turn}:${destroyedPolity.id}`,
      payload: { ...fact.payload, reason: 'battle_capture', warId: 'test-war' },
    };
    const destroyedRuler = destroyedWorld.characters.find((item) => item.id === prepared.ruler.id) as CharacterState;
    const destroyedEnd = rulerAppointmentFact(destroyedWorld, destroyedPolity, destroyedRuler, 'ended');
    expect(candidateFor(destroyedWorld, destroyedPolity.id, [battleCapture, destroyedEnd]).resolution)
      .toEqual({ outcomeKey: 'polity_destroyed', resultFactIds: [destroyedEnd.id, battleCapture.id].sort() });
  });

  it('keeps natural-world output bounded and mostly below the formation threshold', () => {
    let world = createWorld('B04-natural-calibration');
    let observations = 0;
    let qualifying = 0;
    for (let quarter = 0; quarter < 12; quarter += 1) {
      world = advanceWorld(world);
      const turn = world.turn - 1;
      const facts = world.facts.filter((fact) => fact.turn === turn);
      const candidates = inheritanceCrisisDetector.detect({
        turn,
        facts,
        index: buildInheritanceCrisisIndex(world),
      });
      observations += candidates.length;
      qualifying += candidates.filter((candidate) => (
        candidate.pressure >= INHERITANCE_CRISIS_TEMPLATE.formationThreshold
      )).length;
      expect(candidates.length).toBeLessThanOrEqual(world.polities.length);
      expect(candidates.every((candidate) => candidate.pressure >= 0 && candidate.pressure <= 100)).toBe(true);
    }
    expect(observations).toBeGreaterThan(0);
    expect(qualifying / observations).toBeLessThan(0.4);
  });
});
