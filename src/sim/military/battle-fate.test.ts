import { describe, expect, it } from 'vitest';

import { createWorld, keyedRandom } from '../index';
import { repairDepletedFormationCommands, resolveVacantRulers } from '../engine';
import type { BattleFact } from '../facts';
import type { HistoryEvent, WorldState } from '../types';
import { createTurnContext, totalWorldPopulation } from '../turn-context-state';
import { processCharacterDeathConsequences } from '../v02';
import { syncOfficeAppointments } from '../v02';
import { settleFactionDeaths } from '../politics/faction-lifecycle';
import { refreshFactionPowerLedgers } from '../politics/power-ledger';
import type { V03EventInput } from '../v03-context';
import { syncFormationStrength } from './personal-forces';
import { battleFateChances, resolveBattleFates } from './battle-fate';

function emitEvent(world: WorldState, context: ReturnType<typeof createTurnContext>) {
  return (input: V03EventInput): HistoryEvent => {
    world.counters.event += 1;
    const event: HistoryEvent = {
      ...input,
      id: `event_${String(world.counters.event).padStart(6, '0')}`,
      turn: context.turn,
      year: context.year,
      season: context.season,
      actorIds: input.actorIds ?? [],
      polityIds: input.polityIds ?? [],
      regionIds: input.regionIds ?? [],
      evidence: input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: input.sourceFactIds ?? [],
      situationIds: [],
    };
    world.history.push(event);
    context.events.push(event);
    return event;
  };
}

function battleForCommander(world: WorldState): { fact: BattleFact; commanderId: string; otherId: string } {
  const army = world.armies.find((item) => item.participantIds.length >= 2)!;
  const commanderId = army.commanderId;
  const otherId = army.participantIds.find((id) => id !== commanderId)!;
  const force = world.personalForces.find((item) => item.ownerId === commanderId)!;
  const before = force.soldiers;
  const losses = Math.max(1, Math.floor(before * 0.36));
  force.soldiers -= losses;
  syncFormationStrength(world, army);
  const participant = {
    characterId: commanderId,
    soldiersBefore: before,
    soldiersAfter: force.soldiers,
    losses,
    factionId: world.characters.find((item) => item.id === commanderId)?.factionId ?? null,
    formationCommanderId: commanderId,
    role: 'commander' as const,
  };
  return {
    commanderId,
    otherId,
    fact: {
      id: 'battle-fate-placeholder',
      turn: world.turn,
      year: world.year,
      season: world.season,
      kind: 'battle',
      category: '军事',
      importance: 3,
      actorIds: [commanderId],
      polityIds: [army.polityId],
      regionIds: [army.regionId],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        warId: 'war-fate-test',
        targetRegionId: army.regionId,
        routeId: world.routes[0]!.id,
        attackerWon: false,
        attackerPower: 1,
        defenderPower: 2,
        militiaLosses: 0,
        attacker: {
          armyId: army.id,
          polityId: army.polityId,
          commanderId,
          deputyCommanderId: army.deputyCommanderId,
          allegianceCharacterId: army.allegiance.characterId,
          allegianceStrength: army.allegiance.strength,
          soldiersBefore: before,
          soldiersAfter: force.soldiers,
          moraleBefore: army.morale,
          moraleAfter: army.morale,
          trainingBefore: army.training,
          supplyBefore: army.supply,
          losses,
          participants: [participant],
        },
        defenders: [],
      },
    },
  };
}

function idForOutcome(
  world: WorldState,
  fact: BattleFact,
  characterId: string,
  outcome: 'death' | 'wound',
): string {
  const character = world.characters.find((item) => item.id === characterId)!;
  const participant = fact.payload.attacker.participants![0]!;
  const chances = battleFateChances(participant, false, character.health, character.caution);
  for (let index = 0; index < 20_000; index += 1) {
    const id = `battle-fate-${outcome}-${index}`;
    const roll = keyedRandom(world.seed, world.turn, 'battle-fate', id, characterId);
    if (outcome === 'death' ? roll < chances.death : roll >= chances.death && roll < chances.death + chances.wound) return id;
  }
  throw new Error(`unable to find deterministic ${outcome} id`);
}

describe('battle participant fate', () => {
  it('wounds only a real participant, lowers health and keeps the battle source', () => {
    const world = createWorld('参战者负伤');
    const { fact, commanderId, otherId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'wound');
    const context = createTurnContext(world);
    const healthBefore = world.characters.find((item) => item.id === commanderId)!.health;
    const otherHealth = world.characters.find((item) => item.id === otherId)!.health;
    const soldiersBefore = world.personalForces.find((item) => item.ownerId === commanderId)!.soldiers;
    const populationBefore = totalWorldPopulation(world);

    const result = resolveBattleFates(world, context, fact, emitEvent(world, context));
    const wound = context.facts.find((item) => item.kind === 'character_wounded');

    expect(result).toContainEqual(expect.objectContaining({ characterId: commanderId, outcome: 'wounded' }));
    expect(world.characters.find((item) => item.id === commanderId)!.health).toBeLessThan(healthBefore);
    expect(world.characters.find((item) => item.id === otherId)!.health).toBe(otherHealth);
    expect(world.personalForces.find((item) => item.ownerId === commanderId)!.soldiers).toBe(soldiersBefore);
    expect(totalWorldPopulation(world)).toBe(populationBefore);
    expect(wound?.sourceFactIds).toEqual([fact.id]);
    expect(wound?.stateDeltas).toContainEqual(expect.objectContaining({ entityId: commanderId, field: 'health' }));
  });

  it('is deterministic and keeps high-loss defeats riskier than ordinary victories', () => {
    const world = createWorld('战后命运确定性');
    const { fact, commanderId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'wound');
    const copy = structuredClone(world);
    const firstContext = createTurnContext(world);
    const secondContext = createTurnContext(copy);
    const first = resolveBattleFates(world, firstContext, fact, emitEvent(world, firstContext));
    const second = resolveBattleFates(copy, secondContext, structuredClone(fact), emitEvent(copy, secondContext));
    const participant = fact.payload.attacker.participants![0]!;
    const safe = battleFateChances({ ...participant, losses: 10, soldiersAfter: participant.soldiersBefore - 10 }, true, 100, 90, 90);
    const dangerous = battleFateChances({ ...participant, losses: participant.soldiersBefore, soldiersAfter: 0 }, false, 30, 10, 20);

    expect(first).toEqual(second);
    expect(firstContext.facts).toEqual(secondContext.facts);
    expect(dangerous.death).toBeGreaterThan(safe.death);
    expect(dangerous.wound).toBeGreaterThan(safe.wound);
    expect(dangerous.death).toBeLessThanOrEqual(.055);
    expect(dangerous.wound).toBeLessThanOrEqual(.42);
  });

  it('turns a protected battlefield death into one wound and consumes protection', () => {
    const world = createWorld('护住战阵死劫');
    const { fact, commanderId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'death');
    const character = world.characters.find((item) => item.id === commanderId)!;
    character.protectedUntilTurn = world.turn;
    const context = createTurnContext(world);

    const result = resolveBattleFates(world, context, fact, emitEvent(world, context));

    expect(result[0]).toMatchObject({ outcome: 'wounded' });
    expect(character.alive).toBe(true);
    expect(character.protectedUntilTurn).toBeNull();
    expect(context.facts).toHaveLength(1);
    expect(context.facts[0]?.kind).toBe('character_wounded');
  });

  it('settles a commander death, inheritance and command replacement in the same turn', () => {
    const world = createWorld('主将阵亡当季善后');
    const { fact, commanderId, otherId } = battleForCommander(world);
    fact.id = idForOutcome(world, fact, commanderId, 'death');
    const army = world.armies.find((item) => item.id === fact.payload.attacker.armyId)!;
    const deceased = world.characters.find((item) => item.id === commanderId)!;
    const heir = world.characters.find((item) => item.id === otherId)!;
    const family = world.families.find((item) => item.id === deceased.familyId)!;
    const factionId = deceased.factionId;
    expect(world.offices.some((office) => office.active && office.holderId === commanderId)).toBe(true);
    if (!family.memberIds.includes(heir.id)) family.memberIds.push(heir.id);
    heir.familyId = family.id;
    heir.parentIds.push(deceased.id);
    deceased.personalWealth = 41;
    const inheritorWealthBefore = heir.personalWealth;
    const totalBefore = totalWorldPopulation(world);
    const context = createTurnContext(world);

    resolveBattleFates(world, context, fact, emitEvent(world, context));
    const deaths = context.facts.filter((item): item is Extract<typeof item, { kind: 'character_death' }> => item.kind === 'character_death');
    processCharacterDeathConsequences(world, context, emitEvent(world, context), deaths);
    repairDepletedFormationCommands(world, context);
    settleFactionDeaths(world, context, deaths.map((fact) => fact.id), emitEvent(world, context));
    syncOfficeAppointments(world, context.turn, context);
    refreshFactionPowerLedgers(world);

    expect(deceased).toMatchObject({ alive: false, deathTurn: world.turn, personalWealth: 0, commandingArmyId: null });
    expect(world.personalForces.some((force) => force.ownerId === commanderId)).toBe(false);
    expect(army.participantIds).not.toContain(commanderId);
    expect(army.commanderId).toBe(otherId);
    expect(world.offices.some((office) => office.active && office.holderId === commanderId)).toBe(false);
    expect(deceased.factionId).toBeNull();
    expect(world.factions.find((faction) => faction.id === factionId)?.memberIds).not.toContain(commanderId);
    expect(heir.personalWealth).toBe(inheritorWealthBefore + 41);
    expect(totalWorldPopulation(world)).toBe(totalBefore);
    expect(context.facts.find((item) => item.kind === 'character_death')).toMatchObject({
      payload: { cause: 'battle', battleFactId: fact.id },
      sourceFactIds: [fact.id],
    });
  });

  it('fills a ruler vacancy during the same turn as a recorded death', () => {
    const world = createWorld('君主阵亡同季继承');
    const polity = world.polities[0]!;
    const ruler = world.characters.find((item) => item.id === polity.rulerId)!;
    ruler.alive = false;
    ruler.deathTurn = world.turn;
    polity.rulerId = '';
    const context = createTurnContext(world);

    resolveVacantRulers(world, context);

    expect(polity.rulerId).not.toBe('');
    expect(polity.rulerId).not.toBe(ruler.id);
    expect(world.characters.find((item) => item.id === polity.rulerId)?.alive).toBe(true);
  });
});
