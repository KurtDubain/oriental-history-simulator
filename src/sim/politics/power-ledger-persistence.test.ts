import { describe, expect, it } from 'vitest';
import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import { createWorld, deserializeWorld, serializeWorld } from '../index';
import { computeWorldHash } from '../world-hash';
import { calculateFactionPowerLedger } from './power-ledger';

function factContext(world: ReturnType<typeof createWorld>): FactTurnBuffer {
  return { turn: world.turn, year: world.year, season: world.season, facts: [] };
}

describe('POL01 power cache save migration', () => {
  it('authenticates an older schema-4 save before adopting support-backed ledger totals', () => {
    const world = createWorld('POL06-旧档权势账');
    const faction = world.factions.find((item) => item.active && item.memberIds.length > 0);
    const actor = world.characters.find((item) => item.id === faction?.memberIds[0]);
    const target = world.characters.find((item) => (
      item.alive && item.polityId === faction?.polityId && item.id !== actor?.id
    ));
    const army = world.armies.find((item) => item.polityId === faction?.polityId);
    if (!faction || !actor || !target || !army) throw new Error('expected support migration participants');

    emitSimulationFact(world, factContext(world), {
      kind: 'agency_support_resolved',
      category: '政治',
      importance: 2,
      actorIds: [actor.id, target.id],
      polityIds: [faction.polityId],
      regionIds: [actor.locationRegionId],
      causes: [{ label: '旧版背书', role: '结果', weight: 1, evidence: `${target.name}支持${actor.name}` }],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        actorId: actor.id,
        goalId: 'goal_legacy_support',
        planId: 'plan_legacy_support',
        planStepId: 'plan_legacy_support:step',
        action: 'request_backing',
        attemptOrdinal: 1,
        targetKind: 'ruler',
        targetId: target.id,
        targetArmyId: army.id,
        targetArmyName: army.name,
        polityId: faction.polityId,
        outcome: 'secured',
        strength: 80,
        retryAfterTurn: null,
      },
    });
    const currentTotal = calculateFactionPowerLedger(world, faction).total;
    faction.power = Math.max(0, currentTotal - 5);
    world.hash = computeWorldHash(world);
    const authenticatedOldHash = world.hash;

    const restored = deserializeWorld(serializeWorld(world));
    const restoredFaction = restored.factions.find((item) => item.id === faction.id);
    if (!restoredFaction) throw new Error('expected migrated faction');
    expect(restoredFaction.power).toBe(calculateFactionPowerLedger(restored, restoredFaction).total);
    expect(restored.hash).toBe(computeWorldHash(restored));
    expect(restored.hash).not.toBe(authenticatedOldHash);
    expect(serializeWorld(deserializeWorld(serializeWorld(restored)))).toBe(serializeWorld(restored));
  });
});
