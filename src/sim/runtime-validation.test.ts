import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  deriveRuntimeTurnArtifacts,
  measureFullValidation,
  measureRuntimeValidation,
  stableHash,
  validateTurnRuntime,
  validateWorld,
  validateWorldFull,
  type HistoryEvent,
  type SimulationFact,
  type WorldState,
} from './index';
import { authoritativeTransientArmyIds } from './invariants';

function violationCodes(previous: WorldState, next: WorldState): Set<string> {
  return new Set(validateTurnRuntime(previous, next).map((violation) => violation.code));
}

describe('quarterly runtime validation', () => {
  it('accepts a real quarter while retaining the exhaustive validator for boundaries', () => {
    const previous = createWorld('runtime-validator-real-turn');
    const next = advanceWorld(previous);

    const artifacts = deriveRuntimeTurnArtifacts(previous, next);
    expect(artifacts.factChain?.appendedItems).toHaveLength(next.facts.length - previous.facts.length);
    expect(Object.values(artifacts.changedEntityIds ?? {}).flat().length).toBeGreaterThan(0);
    expect(validateTurnRuntime(previous, next)).toEqual([]);
    expect(validateWorldFull(next)).toEqual([]);
    expect(validateWorld(next)).toEqual(validateWorldFull(next));
  });

  it('detects a tampered current-quarter ledger independently of the snapshot hash', () => {
    const previous = createWorld('runtime-validator-ledger');
    const next = structuredClone(advanceWorld(previous));
    if (!next.lastTurn) throw new Error('expected a completed turn report');
    next.lastTurn.population.end += 1;
    next.hash = computeWorldHash(next);

    expect(violationCodes(previous, next)).toContain('runtime.population-ledger');
  });

  it('authenticates incremental Event and Fact chains', () => {
    const previous = createWorld('runtime-validator-digest');
    const next = structuredClone(advanceWorld(previous));
    next.historyDigest = stableHash('tampered-history-digest');
    next.factDigest = stableHash('tampered-fact-digest');
    next.hash = computeWorldHash(next);

    const codes = violationCodes(previous, next);
    expect(codes).toContain('runtime.history-digest');
    expect(codes).toContain('runtime.fact-digest');
  });

  it('validates optional detailed-turn artifacts and changed entity IDs', () => {
    const previous = createWorld('runtime-validator-artifacts');
    const next = advanceWorld(previous);
    const appendedItems = [{ id: 'fact_buffer_1', value: 4 }];
    const previousDigest = stableHash([]);
    const nextDigest = stableHash([previousDigest, appendedItems[0]]);

    expect(validateTurnRuntime(previous, next, {
      changedEntityIds: { region: [next.regions[0]?.id ?? ''] },
      factChain: { label: 'test-buffer', previousDigest, nextDigest, appendedItems },
    })).toEqual([]);

    const codes = new Set(validateTurnRuntime(previous, next, {
      changedEntityIds: { region: ['missing-region'], polity: ['missing-polity', 'missing-polity'] },
      factChain: { label: 'test-buffer', previousDigest, nextDigest: 'bad-digest', appendedItems },
    }).map((violation) => violation.code));
    expect(codes).toContain('runtime.changed-id');
    expect(codes).toContain('runtime.changed-id-duplicate');
    expect(codes).toContain('runtime.fact-digest');
  });

  it('accepts an army raised, committed to battle and removed within one quarter as transient', () => {
    const transientArmyId = 'army_transient_runtime';
    const raisedEvent = {
      kind: 'army_raised',
      stateDeltas: [{
        entityType: 'army', entityId: transientArmyId, field: 'soldiers', before: 0, after: 900, delta: 900,
      }],
    } as unknown as HistoryEvent;
    const battleFact = {
      kind: 'battle',
      payload: { attacker: { armyId: transientArmyId }, defenders: [] },
      stateDeltas: [{
        entityType: 'army', entityId: transientArmyId, field: 'soldiers', before: 900, after: 0, delta: -900,
      }],
    } as unknown as SimulationFact;

    expect([...authoritativeTransientArmyIds([battleFact], [raisedEvent])]).toEqual([transientArmyId]);
    expect([...authoritativeTransientArmyIds([], [raisedEvent])]).toEqual([]);
  });

  it('normalizes regional practice-state deltas to their authoritative collection', () => {
    const previous = createWorld('runtime-validator-practice-state-artifact');
    const next = structuredClone(advanceWorld(previous));
    const event = next.history[previous.history.length];
    const state = next.practiceStates.find((candidate) => candidate.regionId === 'r_guangzhou')
      ?? next.practiceStates[0];
    if (!event || !state) throw new Error('expected an appended event and regional practice state');
    event.stateDeltas.push({
      entityType: 'practice',
      entityId: state.id,
      field: 'adoption',
      before: state.adoption,
      after: state.adoption,
      delta: 0,
    });
    next.historyDigest = next.history.slice(previous.history.length).reduce(
      (digest, appended) => stableHash([digest, appended]),
      previous.historyDigest,
    );
    next.hash = computeWorldHash(next);

    const artifacts = deriveRuntimeTurnArtifacts(previous, next);
    expect(artifacts.changedEntityIds?.practiceState).toContain(state.id);
    expect(artifacts.changedEntityIds?.practice ?? []).not.toContain(state.id);
    expect(validateTurnRuntime(previous, next, artifacts)).toEqual([]);
  });

  it('does not iterate either pre-existing archive during runtime validation', () => {
    let previous = createWorld('北境军令');
    for (let turn = 0; turn < 12; turn += 1) previous = advanceWorld(previous);
    const next = advanceWorld(previous);
    expect(next.agencyDecisionSystem.actors.some((actor) => actor.goal.sourceFactIds.length > 0)).toBe(true);

    const guardedArchive = <Item>(
      items: Item[],
      prefixLength: number,
      allowedPrefixIndices: ReadonlySet<number>,
      label: string,
    ): Item[] => new Proxy(items, {
      get(target, property, receiver) {
        if (property === Symbol.iterator
          || (typeof property === 'string' && ['map', 'filter', 'find', 'some', 'reduce', 'forEach', 'flatMap'].includes(property))) {
          throw new Error(`runtime validator scanned ${label}`);
        }
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          const index = Number(property);
          if (index < prefixLength && !allowedPrefixIndices.has(index)) {
            throw new Error(`runtime validator read unreferenced ${label} prefix index ${index}`);
          }
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const previousFactTail = new Set([previous.facts.length - 1]);
    const nextAllowedFactPrefix = new Set(previousFactTail);
    for (const actor of next.agencyDecisionSystem.actors) {
      for (const factId of actor.goal.sourceFactIds) nextAllowedFactPrefix.add(Number(factId.slice(5)) - 1);
      for (const action of actor.supportActions) nextAllowedFactPrefix.add(Number(action.sourceFactId.slice(5)) - 1);
      if (actor.lastResolutionFactId) nextAllowedFactPrefix.add(Number(actor.lastResolutionFactId.slice(5)) - 1);
    }
    const previousEventTail = new Set([previous.history.length - 1]);
    previous.facts = guardedArchive(previous.facts, previous.facts.length, previousFactTail, 'previous Fact archive');
    previous.history = guardedArchive(previous.history, previous.history.length, previousEventTail, 'previous Chronicle archive');
    next.facts = guardedArchive(next.facts, previous.facts.length, nextAllowedFactPrefix, 'next Fact prefix');
    next.history = guardedArchive(next.history, previous.history.length, previousEventTail, 'next Chronicle prefix');

    const validate = (): ReturnType<typeof validateTurnRuntime> => validateTurnRuntime(previous, next);
    expect(validate).not.toThrow();
    expect(validate()).toEqual([]);
  });

  it('accepts authoritative dynamic sea-capacity snapshots across a longer run', () => {
    let previous = createWorld('北辰');
    for (let index = 0; index < 32; index += 1) {
      const next = advanceWorld(previous);
      const violations = validateTurnRuntime(previous, next);
      const seaViolation = violations.find((violation) => violation.code === 'runtime.sea-capacity');
      if (seaViolation) {
        const usage = next.lastTurn?.logistics.seaUsage.find((item) => item.edgeId === seaViolation.entityId);
        const link = next.portLinks.find((item) => item.id === seaViolation.entityId);
        const lane = next.seaLanes.find((item) => item.id === seaViolation.entityId);
        throw new Error(JSON.stringify({
          turn: next.turn,
          usage,
          link,
          lane,
          full: validateWorldFull(next).filter((violation) => violation.entityId === seaViolation.entityId),
        }));
      }
      expect(violations).toEqual([]);
      previous = next;
    }
    expect(validateWorldFull(previous)).toEqual([]);
  });

  it('rejects duplicate war lifecycle Facts and inconsistent ending roles at a full boundary', () => {
    let world = createWorld('春战副将');
    for (let index = 0; index < 40; index += 1) world = advanceWorld(world);
    const start = world.facts.find(
      (fact): fact is Extract<SimulationFact, { kind: 'war_started' }> => fact.kind === 'war_started',
    );
    const ending = world.facts.find(
      (fact): fact is Extract<SimulationFact, { kind: 'war_ended' }> => fact.kind === 'war_ended',
    );
    if (!start || !ending) throw new Error('expected a completed war lifecycle');

    const duplicated = structuredClone(world);
    duplicated.counters.fact += 1;
    duplicated.facts.push({
      ...structuredClone(start),
      id: `fact_${String(duplicated.counters.fact).padStart(7, '0')}`,
    });
    expect(validateWorldFull(duplicated).map((violation) => violation.code)).toContain('fact.war-start-count');

    const inconsistent = structuredClone(world);
    const inconsistentEnding = inconsistent.facts.find((fact) => fact.id === ending.id);
    if (inconsistentEnding?.kind !== 'war_ended') throw new Error('expected cloned war ending');
    inconsistentEnding.payload.winnerId = inconsistentEnding.payload.attackerId;
    inconsistentEnding.payload.loserId = inconsistentEnding.payload.attackerId;
    expect(validateWorldFull(inconsistent).map((violation) => violation.code)).toContain('fact.war-end');
  }, 15_000);

  it('exposes separately measurable runtime and full validation modes', () => {
    const previous = createWorld('runtime-validator-measurement');
    const next = advanceWorld(previous);
    const runtimeClock = [10, 12.5];
    const fullClock = [20, 27];

    expect(measureRuntimeValidation(previous, next, {}, () => runtimeClock.shift() ?? 0)).toMatchObject({
      mode: 'runtime',
      durationMs: 2.5,
      violations: [],
    });
    expect(measureFullValidation(next, () => fullClock.shift() ?? 0)).toMatchObject({
      mode: 'full',
      durationMs: 7,
      violations: [],
    });
  });

  it('uses an unpublished BattleFact, not Chronicle prose, as deputy promotion evidence', () => {
    const world = structuredClone(advanceWorld(createWorld('runtime-validator-hidden-battle')));
    const army = world.armies.find((candidate) => candidate.deputyCommanderId !== null);
    if (!army?.deputyCommanderId || !world.lastTurn) throw new Error('expected an army with a deputy and a completed report');
    const region = world.regions.find((candidate) => candidate.id === army.regionId);
    if (!region) throw new Error('expected the army region');

    world.counters.fact += 1;
    const hiddenBattle: Extract<SimulationFact, { kind: 'battle' }> = {
      id: `fact_${String(world.counters.fact).padStart(7, '0')}`,
      turn: world.lastTurn.turn,
      year: world.lastTurn.year,
      season: world.lastTurn.season,
      kind: 'battle',
      category: '军事',
      importance: 1,
      actorIds: [army.commanderId, army.deputyCommanderId].sort(),
      polityIds: [army.polityId],
      regionIds: [region.id],
      causes: [{ label: '战场接触', weight: 1, evidence: '小规模遭遇仅进入事实档案' }],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        warId: 'unpublished-skirmish',
        targetRegionId: region.id,
        routeId: region.routeIds[0] ?? world.routes[0]?.id ?? 'unpublished-route',
        attackerWon: true,
        attackerPower: 1,
        defenderPower: 0,
        militiaLosses: 0,
        attacker: {
          armyId: army.id,
          polityId: army.polityId,
          commanderId: army.commanderId,
          deputyCommanderId: army.deputyCommanderId,
          soldiersBefore: army.soldiers,
          soldiersAfter: army.soldiers,
          moraleBefore: army.morale,
          moraleAfter: army.morale,
          trainingBefore: army.training,
          supplyBefore: army.supply,
          losses: 0,
        },
        defenders: [],
      },
    };
    world.facts.push(hiddenBattle);
    world.factDigest = stableHash([world.factDigest, hiddenBattle]);
    world.lastTurn.factIds.push(hiddenBattle.id);

    world.counters.event += 1;
    const promotion: HistoryEvent = {
      id: `event_${String(world.counters.event).padStart(6, '0')}`,
      turn: world.lastTurn.turn,
      year: world.lastTurn.year,
      season: world.lastTurn.season,
      category: '军事',
      kind: 'deputy_promoted',
      title: '副将升任主帅',
      summary: '一场未被史官公开的小规模遭遇，仍在事实档案中支撑其军旅履历。',
      importance: 4,
      actorIds: [army.commanderId, army.deputyCommanderId].sort(),
      polityIds: [army.polityId],
      regionIds: [region.id],
      causes: [{ label: '事实履历', weight: 1, evidence: hiddenBattle.id }],
      evidence: [hiddenBattle.id],
      stateDeltas: [{
        entityType: 'army',
        entityId: army.id,
        field: 'commanderId',
        before: army.commanderId,
        after: army.deputyCommanderId,
      }],
      sourceFactIds: [],
      situationIds: [],
    };
    world.history.push(promotion);
    world.historyDigest = stableHash([world.historyDigest, promotion]);
    world.lastTurn.eventIds.push(promotion.id);
    world.hash = computeWorldHash(world);

    expect(world.history.some((event) => event.kind === 'battle' && event.actorIds.includes(army.deputyCommanderId as string))).toBe(false);
    expect(validateWorldFull(world).map((violation) => violation.code)).not.toContain('event.deputy-promotion-evidence');

    hiddenBattle.payload.attacker.deputyCommanderId = null;
    world.factDigest = world.facts.reduce((digest, fact) => stableHash([digest, fact]), stableHash([]));
    world.hash = computeWorldHash(world);
    expect(validateWorldFull(world).map((violation) => violation.code)).toContain('event.deputy-promotion-evidence');
  });
});
