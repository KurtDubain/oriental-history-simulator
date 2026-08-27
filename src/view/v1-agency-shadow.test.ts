import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  serializeWorld,
  stableHash,
  type HistoryEvent,
  type RelationshipState,
  type SimulationFact,
  type TurnReport,
  type WorldState,
} from '../sim';
import { stableCompare } from '../sim/random';
import {
  MAX_AGENCY_SHADOW_BRANCHES,
  MAX_AGENCY_SHADOW_CHARACTERS,
  MAX_AGENCY_SHADOW_COMPARISONS,
  MAX_AGENCY_SHADOW_RESTORE_CHARACTERS,
  MAX_AGENCY_SHADOW_RESTORE_POINTS,
  MAX_AGENCY_SHADOW_SERIALIZED_CHARS,
  advanceAgencyShadowBranch,
  attachAgencyShadowBranch,
  bindAgencyShadowRestorePoint,
  copyAgencyShadowRestorePoint,
  createAgencyShadowLedger,
  ensureAgencyShadowCharacters,
  forkAgencyShadowIntervention,
  getAgencyShadowPlayerQuarterComparisons,
  getAgencyShadowProjection,
  getAgencyShadowQuarterComparisons,
  observeLegacyDeputyPromotions,
  parseAgencyShadowLedger,
  prepareAgencyShadowTurn,
  serializeAgencyShadowLedger,
  toAgencyShadowPlayerEntries,
  type AgencyShadowAdvanceResult,
  type AgencyShadowComparison,
  type AgencyShadowLedger,
} from './v1-agency-shadow';

type AppointmentStartedFact = Extract<SimulationFact, { kind: 'appointment_started' }>;
type AgencyIntentResolvedFact = Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;

interface PromotionFixture {
  before: WorldState;
  after: WorldState;
  actorId: string;
  formerCommanderId: string;
  armyId: string;
  eventId: string;
  factId: string;
}

function settledWorld(seed: string): WorldState {
  return advanceWorld(createWorld(seed));
}

function promotionArmy(world: WorldState) {
  const withReverseSortedActor = world.armies.find((army) => (
    army.deputyCommanderId !== null
    && stableCompare(army.commanderId, army.deputyCommanderId) < 0
  ));
  const army = withReverseSortedActor ?? world.armies.find((item) => item.deputyCommanderId !== null);
  if (!army?.deputyCommanderId) throw new Error('Expected a settled army with a deputy');
  return army;
}

function nextTurnReport(before: WorldState, eventIds: string[], factIds: string[]): TurnReport {
  if (!before.lastTurn) throw new Error('Expected a settled turn report');
  return {
    ...structuredClone(before.lastTurn),
    turn: before.turn,
    year: before.year,
    season: before.season,
    eventIds,
    factIds,
  };
}

function plainAdjacentAfter(before: WorldState): WorldState {
  const after = structuredClone(before);
  after.turn = before.turn + 1;
  after.lastTurn = nextTurnReport(before, [], []);
  after.hash = stableHash(['agency-shadow-plain-after', before.seed, before.turn, before.hash]);
  return after;
}

function promotionFixture(seed: string, suppliedBefore?: WorldState): PromotionFixture {
  const before = suppliedBefore ?? settledWorld(seed);
  const army = promotionArmy(before);
  const actorId = army.deputyCommanderId as string;
  const formerCommanderId = army.commanderId;
  const actor = before.characters.find((character) => character.id === actorId);
  const formerCommander = before.characters.find((character) => character.id === formerCommanderId);
  if (!actor || !formerCommander) throw new Error('Expected army officers to resolve');
  expect(formerCommander.commandingArmyId).toBe(army.id);

  const after = structuredClone(before);
  after.turn = before.turn + 1;
  const afterArmy = after.armies.find((item) => item.id === army.id) as typeof army;
  const afterActor = after.characters.find((character) => character.id === actorId);
  const afterCommander = after.characters.find((character) => character.id === formerCommanderId);
  if (!afterActor || !afterCommander) throw new Error('Expected cloned army officers to resolve');
  afterArmy.commanderId = actorId;
  afterArmy.deputyCommanderId = formerCommanderId;
  afterActor.commandingArmyId = army.id;
  afterCommander.commandingArmyId = null;

  const eventId = `event-shadow-promotion:${seed}`;
  const factId = `fact-shadow-appointment:${seed}`;
  const event: HistoryEvent = {
    id: eventId,
    turn: before.turn,
    year: before.year,
    season: before.season,
    category: '军事',
    kind: 'deputy_promoted',
    title: `${actor.name}升任${army.name}主帅`,
    summary: `${actor.name}由副将升任主帅。`,
    importance: 4,
    // Engine sorts actorIds; the promoted actor must not be inferred from index 0.
    actorIds: [actorId, formerCommanderId].sort(stableCompare),
    polityIds: [army.polityId],
    regionIds: [army.regionId],
    causes: [],
    evidence: [],
    stateDeltas: [{
      entityType: 'army',
      entityId: army.id,
      field: 'commanderId',
      before: formerCommanderId,
      after: actorId,
    }],
    sourceFactIds: [],
    situationIds: [],
  };
  const fact: AppointmentStartedFact = {
    id: factId,
    turn: before.turn,
    year: before.year,
    season: before.season,
    kind: 'appointment_started',
    category: '政治',
    importance: 2,
    actorIds: [actorId],
    polityIds: [army.polityId],
    regionIds: [army.regionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      appointmentId: `office-shadow:${seed}`,
      action: 'started',
      officeKind: '军团主帅',
      holderId: actorId,
      polityId: army.polityId,
      regionId: null,
      armyId: army.id,
      fleetId: null,
      rank: 70,
    },
  };

  const decoyEvent: HistoryEvent = {
    ...event,
    id: `event-shadow-decoy-rebellion:${seed}`,
    category: '政治',
    kind: 'rebellion_succeeded',
    title: `${actor.name}另立旗号`,
    summary: '这条叙事不得被观察账猜成副将晋升。',
    stateDeltas: [{
      entityType: 'polity',
      entityId: army.polityId,
      field: 'rulerId',
      before: formerCommanderId,
      after: actorId,
    }],
  };
  const decoyFact: AppointmentStartedFact = {
    ...fact,
    id: `fact-shadow-decoy-ruler:${seed}`,
    payload: {
      ...fact.payload,
      appointmentId: `office-shadow-ruler:${seed}`,
      officeKind: '君主',
      armyId: null,
      rank: 100,
    },
  };
  after.history.push(event, decoyEvent);
  after.facts.push(fact, decoyFact);
  after.lastTurn = nextTurnReport(
    before,
    [event.id, decoyEvent.id],
    [fact.id, decoyFact.id],
  );
  after.hash = stableHash(['agency-shadow-promotion-after', before.hash, eventId, factId]);
  return { before, after, actorId, formerCommanderId, armyId: army.id, eventId, factId };
}

function forceActionableCommand(world: WorldState): { actorId: string; armyId: string } {
  const army = promotionArmy(world);
  const actorId = army.deputyCommanderId as string;
  const actor = world.characters.find((character) => character.id === actorId);
  if (!actor) throw new Error('Expected deputy actor');
  actor.ambition = 100;
  actor.leadership = 100;
  actor.cunning = 90;
  actor.governance = 65;
  actor.merit = 75;
  actor.deputyExperience = 100;
  actor.renown = 85;
  actor.influence = 70;
  actor.caution = 12;
  actor.loyalty = 45;
  const family = world.families.find((item) => item.id === actor.familyId);
  if (family) {
    family.prestige = 100;
    family.politicalInfluence = 100;
  }
  const patron = world.characters.find((item) => item.alive && item.id !== actorId);
  if (!patron) throw new Error('Expected a patron candidate');
  const relationship: RelationshipState = {
    id: `relationship-shadow-patron:${actorId}:${patron.id}`,
    sourceId: actorId,
    targetId: patron.id,
    kinship: '无',
    affinity: 70,
    trust: 90,
    fear: 0,
    grievance: 0,
    gratitude: 60,
    lastInteractionTurn: world.turn,
    memories: [],
  };
  const existing = world.relationships.findIndex((item) => (
    item.sourceId === actorId && item.targetId === patron.id
  ));
  if (existing >= 0) world.relationships[existing] = relationship;
  else world.relationships.push(relationship);
  world.hash = computeWorldHash(world);
  return { actorId, armyId: army.id };
}

function openTrackedBranch(world: WorldState, characterIds: readonly string[]): { ledger: AgencyShadowLedger; branchId: string } {
  const opened = attachAgencyShadowBranch(createAgencyShadowLedger(), world, 'create');
  return {
    ledger: ensureAgencyShadowCharacters(opened.ledger, opened.branchId, world, characterIds),
    branchId: opened.branchId,
  };
}

describe('C09 observer-side Agency shadow ledger', () => {
  it('starts create/import branches fresh and restores only an exact token plus seed/turn/hash snapshot', () => {
    const world = settledWorld('agency-shadow-restore');
    const watchedId = world.characters[17].id;
    const created = openTrackedBranch(world, [watchedId]);
    let ledger = bindAgencyShadowRestorePoint(created.ledger, created.branchId, world, 'autosave', [watchedId]);
    ledger = bindAgencyShadowRestorePoint(ledger, created.branchId, world, 'collection:slot-a', [watchedId]);
    ledger = copyAgencyShadowRestorePoint(ledger, 'collection:slot-a', 'collection:slot-copy');

    expect(ledger.restorePoints).toHaveLength(3);
    expect(ledger.restorePoints.map((point) => point.anchor)).toEqual([
      expect.objectContaining({ seed: world.seed, turn: world.turn, hash: world.hash }),
      expect.objectContaining({ seed: world.seed, turn: world.turn, hash: world.hash }),
      expect.objectContaining({ seed: world.seed, turn: world.turn, hash: world.hash }),
    ]);
    expect(ledger.restorePoints.find((point) => point.token === 'collection:slot-copy')?.projections).toEqual(
      ledger.restorePoints.find((point) => point.token === 'collection:slot-a')?.projections,
    );
    expect(copyAgencyShadowRestorePoint(ledger, 'collection:missing', 'collection:unused')).toBe(ledger);

    const restored = attachAgencyShadowBranch(ledger, world, 'restore', 'collection:slot-a');
    expect(restored.restored).toBe(true);
    expect(restored.branchId).not.toBe(created.branchId);
    expect(getAgencyShadowProjection(restored.ledger, restored.branchId, watchedId)).toEqual(
      getAgencyShadowProjection(ledger, created.branchId, watchedId),
    );

    const wrongHash = structuredClone(world);
    wrongHash.hash = stableHash(['different-branch', world.hash]);
    const missed = attachAgencyShadowBranch(restored.ledger, wrongHash, 'restore', 'collection:slot-a');
    expect(missed.restored).toBe(false);
    expect(getAgencyShadowProjection(missed.ledger, missed.branchId, watchedId)).toBeNull();

    const createdAgain = attachAgencyShadowBranch(missed.ledger, world, 'create', 'autosave');
    const imported = attachAgencyShadowBranch(createdAgain.ledger, world, 'import', 'autosave');
    expect(createdAgain.restored).toBe(false);
    expect(imported.restored).toBe(false);
    expect(new Set([created.branchId, createdAgain.branchId, imported.branchId]).size).toBe(3);
    expect(getAgencyShadowProjection(imported.ledger, imported.branchId, watchedId)).toBeNull();
  });

  it('advances only from an exact adjacent head and retains projection continuity without mutating WorldState', () => {
    const before = settledWorld('agency-shadow-adjacent');
    const actorId = promotionArmy(before).deputyCommanderId as string;
    const originalSerialized = serializeWorld(before);
    const originalHash = before.hash;
    const opened = openTrackedBranch(before, [actorId]);
    const previous = getAgencyShadowProjection(opened.ledger, opened.branchId, actorId);
    const prepared = prepareAgencyShadowTurn(opened.ledger, opened.branchId, before, [actorId]);
    const after = advanceWorld(before);
    const advanced = advanceAgencyShadowBranch(opened.ledger, opened.branchId, before, after, [actorId]);
    const next = getAgencyShadowProjection(advanced.ledger, advanced.branchId, actorId);

    expect(advanced.branchId).toBe(opened.branchId);
    expect(next?.reviewedTurn).toBe(after.turn);
    expect(next?.sourceWorldHash).toBe(after.hash);
    expect(next?.primaryGoal?.id).toBe(previous?.primaryGoal?.id);
    expect(advanced.ledger.branches.find((branch) => branch.id === opened.branchId)?.lineage.at(-1)).toEqual({
      kind: 'advance',
      from: expect.objectContaining({ seed: before.seed, turn: before.turn, hash: before.hash }),
      to: expect.objectContaining({ seed: after.seed, turn: after.turn, hash: after.hash }),
    });
    expect(prepared.before.hash).toBe(originalHash);
    expect(serializeWorld(before)).toBe(originalSerialized);
    expect(before.hash).toBe(originalHash);
    expect(computeWorldHash(before)).toBe(originalHash);
    expect(before).not.toHaveProperty('agencyShadow');

    expect(() => advanceAgencyShadowBranch(advanced.ledger, advanced.branchId, before, after)).toThrow(/seed\/turn\/hash/);
    const skipped = plainAdjacentAfter(before);
    skipped.turn = before.turn + 2;
    expect(() => advanceAgencyShadowBranch(opened.ledger, opened.branchId, before, skipped)).toThrow(/相邻回合/);
  });

  it('forks a same-turn intervention copy-on-write and rejects an unchanged or cross-seed intervention', () => {
    const before = settledWorld('agency-shadow-intervention');
    const actorId = promotionArmy(before).deputyCommanderId as string;
    const opened = openTrackedBranch(before, [actorId]);
    const originalBranch = structuredClone(opened.ledger.branches.find((branch) => branch.id === opened.branchId));
    const intervention = structuredClone(before);
    intervention.characters.find((character) => character.id === actorId)!.ambition += 1;
    intervention.hash = computeWorldHash(intervention);

    const forked = forkAgencyShadowIntervention(opened.ledger, opened.branchId, before, intervention);
    const source = forked.ledger.branches.find((branch) => branch.id === opened.branchId);
    const child = forked.ledger.branches.find((branch) => branch.id === forked.branchId);
    expect(forked.branchId).not.toBe(opened.branchId);
    expect(source).toEqual(originalBranch);
    expect(child?.parent).toEqual({ branchId: opened.branchId, turn: before.turn, hash: before.hash });
    expect(child?.head).toEqual(expect.objectContaining({
      seed: before.seed,
      turn: before.turn,
      hash: intervention.hash,
    }));
    expect(child?.lineage).toEqual([{
      kind: 'intervention',
      from: expect.objectContaining({ hash: before.hash }),
      to: expect.objectContaining({ hash: intervention.hash }),
    }]);
    expect(getAgencyShadowProjection(forked.ledger, forked.branchId, actorId)?.sourceWorldHash).toBe(intervention.hash);

    expect(() => forkAgencyShadowIntervention(opened.ledger, opened.branchId, before, before)).toThrow(/不同的世界 hash/);
    const otherSeed = structuredClone(intervention);
    otherSeed.seed = 'another-seed';
    otherSeed.hash = stableHash(['another-seed', intervention.hash]);
    expect(() => forkAgencyShadowIntervention(opened.ledger, opened.branchId, before, otherSeed)).toThrow(/保持 seed 与 turn/);
  });

  it('round-trips natural multi-quarter projections without dropping their bounded twelve-Fact desire evidence', () => {
    let world = settledWorld('agency-shadow-natural-roundtrip');
    const tracked = world.characters.slice(0, MAX_AGENCY_SHADOW_CHARACTERS).map((character) => character.id);
    const opened = openTrackedBranch(world, tracked);
    let ledger = opened.ledger;
    const branchId = opened.branchId;

    for (let index = 0; index < 8; index += 1) {
      const after = advanceWorld(world);
      ledger = advanceAgencyShadowBranch(ledger, branchId, world, after, tracked).ledger;
      const beforeRoundtrip = ledger.branches.find((branch) => branch.id === branchId)?.projections ?? [];
      const parsed = parseAgencyShadowLedger(serializeAgencyShadowLedger(ledger));
      const afterRoundtrip = parsed.branches.find((branch) => branch.id === branchId)?.projections ?? [];
      expect(afterRoundtrip.map((projection) => projection.characterId)).toEqual(
        beforeRoundtrip.map((projection) => projection.characterId),
      );
      // JSON storage canonicalizes harmless numeric -0 values to 0.
      expect(JSON.stringify(afterRoundtrip)).toBe(JSON.stringify(beforeRoundtrip));
      ledger = parsed;
      world = after;
    }
  });

  it('bounds branches, restore snapshots, tracked projections, comparisons and serialized input globally', () => {
    const world = settledWorld('agency-shadow-bounds');
    let ledger = createAgencyShadowLedger();
    let currentBranchId = '';
    for (let index = 0; index < MAX_AGENCY_SHADOW_BRANCHES + 4; index += 1) {
      const opened = attachAgencyShadowBranch(ledger, world, index % 2 ? 'create' : 'import');
      ledger = opened.ledger;
      currentBranchId = opened.branchId;
    }
    expect(ledger.branches).toHaveLength(MAX_AGENCY_SHADOW_BRANCHES);
    expect(ledger.branches.some((branch) => branch.id === currentBranchId)).toBe(true);
    expect(ledger.overflow.discardedBranches).toBe(4);

    ledger = ensureAgencyShadowCharacters(
      ledger,
      currentBranchId,
      world,
      world.characters.map((character) => character.id),
    );
    expect(ledger.branches.find((branch) => branch.id === currentBranchId)?.projections).toHaveLength(
      MAX_AGENCY_SHADOW_CHARACTERS,
    );

    for (let index = 0; index < MAX_AGENCY_SHADOW_RESTORE_POINTS + 3; index += 1) {
      ledger = bindAgencyShadowRestorePoint(
        ledger,
        currentBranchId,
        world,
        `collection:slot-${index}`,
        world.characters.slice(0, 10).map((character) => character.id),
      );
    }
    expect(ledger.restorePoints).toHaveLength(MAX_AGENCY_SHADOW_RESTORE_POINTS);
    expect(ledger.restorePoints.every((point) => point.projections.length <= MAX_AGENCY_SHADOW_RESTORE_CHARACTERS)).toBe(true);
    expect(ledger.overflow.discardedRestorePoints).toBe(3);

    const sample: AgencyShadowComparison = {
      id: 'comparison-sample',
      recordedOrdinal: 1,
      turn: world.turn,
      beforeWorldHash: world.hash,
      afterWorldHash: stableHash(['sample-after']),
      actorId: world.characters[0].id,
      actorLabel: world.characters[0].name,
      targetId: world.armies[0].id,
      targetLabel: world.armies[0].name,
      status: 'legacy-only',
      suggestion: null,
      legacy: {
        turn: world.turn,
        eventId: 'event-comparison-sample',
        appointmentFactId: 'fact-comparison-sample',
        actorId: world.characters[0].id,
        actorLabel: world.characters[0].name,
        formerCommanderId: world.characters[1].id,
        formerCommanderLabel: world.characters[1].name,
        armyId: world.armies[0].id,
        armyLabel: world.armies[0].name,
      },
      sourceFactIds: ['fact-comparison-sample'],
      sourceEventIds: ['event-comparison-sample'],
    };
    const branchesWithTooMany = ledger.branches.map((branch, branchIndex) => ({
      ...branch,
      comparisons: Array.from({ length: 12 }, (_, index) => ({
        ...sample,
        id: `comparison-${branchIndex}-${index}`,
        recordedOrdinal: 1000 + branchIndex * 12 + index,
      })),
    }));
    const parsed = parseAgencyShadowLedger(JSON.stringify({ ...ledger, branches: branchesWithTooMany }));
    expect(parsed.branches.reduce((sum, branch) => sum + branch.comparisons.length, 0)).toBe(
      MAX_AGENCY_SHADOW_COMPARISONS,
    );
    expect(serializeAgencyShadowLedger(parsed).length).toBeLessThanOrEqual(MAX_AGENCY_SHADOW_SERIALIZED_CHARS);
    expect(parseAgencyShadowLedger('{broken')).toEqual(createAgencyShadowLedger());
    expect(parseAgencyShadowLedger('x'.repeat(MAX_AGENCY_SHADOW_SERIALIZED_CHARS + 1))).toEqual(createAgencyShadowLedger());
  });

  it('recognizes deputy_promoted only from unordered actors plus exact role swap and one appointment Fact', () => {
    const fixture = promotionFixture('agency-shadow-exact-observer');
    const event = fixture.after.history.find((item) => item.id === fixture.eventId) as HistoryEvent;
    expect(event.actorIds).toContain(fixture.actorId);
    expect(event.actorIds).toContain(fixture.formerCommanderId);
    expect(stableCompare(fixture.formerCommanderId, fixture.actorId)).toBeLessThan(0);
    expect(event.actorIds.indexOf(fixture.actorId)).toBeGreaterThan(event.actorIds.indexOf(fixture.formerCommanderId));

    const observed = observeLegacyDeputyPromotions(fixture.before, fixture.after);
    expect(observed).toEqual([expect.objectContaining({
      eventId: fixture.eventId,
      appointmentFactId: fixture.factId,
      actorId: fixture.actorId,
      formerCommanderId: fixture.formerCommanderId,
      armyId: fixture.armyId,
    })]);
    expect(observed.some((item) => item.eventId.includes('rebellion'))).toBe(false);

    const missingEventLink = structuredClone(fixture.after);
    missingEventLink.lastTurn!.eventIds = missingEventLink.lastTurn!.eventIds.filter((id) => id !== fixture.eventId);
    expect(observeLegacyDeputyPromotions(fixture.before, missingEventLink)).toEqual([]);

    const brokenRole = structuredClone(fixture.after);
    brokenRole.armies.find((army) => army.id === fixture.armyId)!.deputyCommanderId = null;
    expect(observeLegacyDeputyPromotions(fixture.before, brokenRole)).toEqual([]);

    const missingFact = structuredClone(fixture.after);
    missingFact.lastTurn!.factIds = missingFact.lastTurn!.factIds.filter((id) => id !== fixture.factId);
    expect(observeLegacyDeputyPromotions(fixture.before, missingFact)).toEqual([]);

    const duplicateFact = structuredClone(fixture.after);
    const originalFact = duplicateFact.facts.find((fact) => fact.id === fixture.factId) as AppointmentStartedFact;
    const duplicate: AppointmentStartedFact = {
      ...structuredClone(originalFact),
      id: `${fixture.factId}:duplicate`,
    };
    duplicateFact.facts.push(duplicate);
    duplicateFact.lastTurn!.factIds.push(duplicate.id);
    expect(observeLegacyDeputyPromotions(fixture.before, duplicateFact)).toEqual([]);

    const ownedByC10 = structuredClone(fixture.after);
    const ownedArmy = ownedByC10.armies.find((army) => army.id === fixture.armyId);
    const ownedPolity = ownedByC10.polities.find((polity) => polity.id === ownedArmy?.polityId);
    if (!ownedArmy || !ownedPolity) throw new Error('Expected authoritative promotion references');
    const resolution: AgencyIntentResolvedFact = {
      id: `fact-agency-resolution:${fixture.eventId}`,
      turn: fixture.before.turn,
      year: fixture.before.year,
      season: fixture.before.season,
      kind: 'agency_intent_resolved',
      category: '军事',
      importance: 4,
      actorIds: [fixture.actorId, fixture.formerCommanderId, ownedPolity.rulerId],
      polityIds: [ownedPolity.id],
      regionIds: [ownedArmy.regionId],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        submissionFactId: `fact-agency-submission:${fixture.eventId}`,
        actorId: fixture.actorId,
        goalId: `goal-agency:${fixture.actorId}`,
        planId: `plan-agency:${fixture.actorId}`,
        planStepId: `plan-agency:${fixture.actorId}:request`,
        action: 'request_independent_command',
        attemptOrdinal: 1,
        targetArmyId: fixture.armyId,
        polityId: ownedPolity.id,
        previousCommanderId: fixture.formerCommanderId,
        appointingAuthorityId: ownedPolity.rulerId,
        outcome: 'executed',
        reasonCode: 'command_granted',
        institutionResponse: 'command_granted',
        retryAfterTurn: null,
        checks: [
          { kind: 'permission', passed: true, value: 100, threshold: 100, comparison: 'at_least' },
          { kind: 'resource', passed: true, value: 70, threshold: 34, comparison: 'at_least' },
          { kind: 'relationship', passed: true, value: 60, threshold: 40, comparison: 'at_least' },
          { kind: 'risk', passed: true, value: 30, threshold: 55, comparison: 'at_most' },
        ],
        decisionScore: 50,
        decisionThreshold: 24,
      },
    };
    ownedByC10.facts.push(resolution);
    ownedByC10.lastTurn!.factIds.push(resolution.id);
    ownedByC10.history.find((item) => item.id === fixture.eventId)!.sourceFactIds.push(resolution.id);
    expect(observeLegacyDeputyPromotions(fixture.before, ownedByC10)).toEqual([]);

    const actionable = forceActionableCommand(fixture.before);
    expect(actionable.actorId).toBe(fixture.actorId);
    const opened = openTrackedBranch(fixture.before, [fixture.actorId]);
    const advanced = advanceAgencyShadowBranch(
      opened.ledger,
      opened.branchId,
      fixture.before,
      ownedByC10,
      [fixture.actorId],
    );
    expect(advanced.comparisons).toEqual([]);
    expect(getAgencyShadowPlayerQuarterComparisons(advanced.ledger, opened.branchId)).toEqual([]);
  });

  it('records exact and suggestion-only quarter comparisons while keeping player wording natural and non-authoritative', () => {
    const before = settledWorld('agency-shadow-comparison');
    const { actorId, armyId } = forceActionableCommand(before);
    const opened = openTrackedBranch(before, [actorId]);
    const projection = getAgencyShadowProjection(opened.ledger, opened.branchId, actorId);
    const available = projection?.plans
      .find((plan) => plan.goalId === projection.primaryGoal?.id)
      ?.steps.find((step) => step.status === 'available');
    expect(projection?.primaryGoal?.type).toBe('secure_independent_command');
    expect(projection?.primaryGoal?.target).toEqual({ kind: 'army', id: armyId });
    expect(available?.action).toBe('request_independent_command');

    const promotion = promotionFixture('agency-shadow-comparison', before);
    const exact = advanceAgencyShadowBranch(opened.ledger, opened.branchId, before, promotion.after, [actorId]);
    expect(exact.comparisons).toHaveLength(1);
    expect(exact.comparisons[0]).toEqual(expect.objectContaining({
      actorId,
      targetId: armyId,
      status: 'exact',
      beforeWorldHash: before.hash,
      afterWorldHash: promotion.after.hash,
    }));
    expect(exact.comparisons[0].legacy).toEqual(expect.objectContaining({ eventId: promotion.eventId }));
    expect(exact.comparisons[0].suggestion).toEqual(expect.objectContaining({
      action: 'request_independent_command',
      readiness: 'actionable',
    }));

    const exactQuarter = getAgencyShadowQuarterComparisons(exact.ledger, exact.branchId, before.turn);
    const player = getAgencyShadowPlayerQuarterComparisons(exact.ledger, exact.branchId, before.turn);
    expect(exactQuarter).toHaveLength(1);
    expect(player).toEqual([expect.objectContaining({
      actorId,
      sourceEventId: promotion.eventId,
      conclusion: '相合',
      intended: expect.stringContaining('请领独立军令'),
      actual: expect.stringContaining('升任'),
      reason: expect.stringContaining('相合'),
    })]);
    const visibleText = JSON.stringify(player);
    expect(visibleText).not.toContain('request_independent_command');
    expect(visibleText).not.toContain(before.hash);
    expect(visibleText).not.toMatch(/影子盘算|影子计划|影子账|篡位|叛乱/);

    const fresh = openTrackedBranch(before, [actorId]);
    const quietAfter = plainAdjacentAfter(before);
    const suggestionOnly: AgencyShadowAdvanceResult = advanceAgencyShadowBranch(
      fresh.ledger,
      fresh.branchId,
      before,
      quietAfter,
      [actorId],
    );
    expect(suggestionOnly.comparisons).toEqual([expect.objectContaining({ status: 'shadow-only' })]);
    const suggestionPlayer = toAgencyShadowPlayerEntries(suggestionOnly.comparisons);
    expect(suggestionPlayer[0]).toEqual(expect.objectContaining({
      conclusion: '仅见盘算',
      actual: null,
      sourceEventId: null,
    }));
    expect(suggestionPlayer[0].summary).toContain('不代表行动已经发生');
  });
});
