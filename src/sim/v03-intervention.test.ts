import { describe, expect, it } from 'vitest';
import { advanceWorld, computeWorldHash, createWorld } from './engine';
import { validateWorld } from './invariants';
import { createSituationSystemState } from './situations';
import {
  applyV03Intervention,
  availableMandate,
  isV03InterventionEvent,
  type V03InterventionAction,
} from './v03-intervention';

describe('V0.3 limited observer interventions', () => {
  it('is immutable, deterministic and embeds the old hash as a branch credential', () => {
    const world = createWorld('v03-intervention-branch');
    const polity = world.polities.find((candidate) => candidate.alive && candidate.legitimacy <= 94) as typeof world.polities[number];
    const action: V03InterventionAction = { kind: 'modify_mandate', polityId: polity.id, delta: 4 };
    const sourceSnapshot = structuredClone(world);

    const first = applyV03Intervention(world, action);
    const second = applyV03Intervention(world, action);

    expect(world).toEqual(sourceSnapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(world);
    expect(first.hash).toBe(computeWorldHash(first));
    expect(first.hash).not.toBe(world.hash);
    const event = first.history.at(-1);
    expect(event && isV03InterventionEvent(event)).toBe(true);
    expect(event?.causes.find((cause) => cause.label === '分支凭证')?.evidence).toContain(world.hash);
    expect(event?.causes.every((cause) => (cause.refs?.length ?? 0) > 0)).toBe(true);
    expect(availableMandate(first)).toBe(0);
  });

  it('creates only bounded relationship memories and never forces loyalty', () => {
    const world = createWorld('v03-intervention-relationship');
    const [source, target] = world.characters.filter((character) => character.alive).slice(0, 2);
    if (!source || !target) throw new Error('test world lacks characters');
    const sourceLoyalty = source.loyalty;
    const targetLoyalty = target.loyalty;

    const next = applyV03Intervention(world, {
      kind: 'relationship_opportunity',
      sourceCharacterId: source.id,
      targetCharacterId: target.id,
    });

    const outward = next.relationships.find((relation) => relation.sourceId === source.id && relation.targetId === target.id);
    const inward = next.relationships.find((relation) => relation.sourceId === target.id && relation.targetId === source.id);
    const event = next.history.at(-1);
    expect(outward?.memories.at(-1)?.eventId).toBe(event?.id);
    expect(inward?.memories.at(-1)?.eventId).toBe(event?.id);
    expect(outward?.memories.at(-1)?.kind).toBe('恩义');
    expect(inward?.memories.at(-1)?.kind).toBe('恩义');
    expect((outward?.memories.length ?? 99) <= 8).toBe(true);
    expect((inward?.memories.length ?? 99) <= 8).toBe(true);
    expect(next.characters.find((character) => character.id === source.id)?.loyalty).toBe(sourceLoyalty);
    expect(next.characters.find((character) => character.id === target.id)?.loyalty).toBe(targetLoyalty);
    expect(validateWorld(next)).toEqual([]);
  });

  it('records real disaster losses, exact S/E/I/R deltas and remains advanceable', () => {
    const world = createWorld('v03-intervention-disaster');
    const region = world.regions.reduce((largest, candidate) => candidate.population > largest.population ? candidate : largest);
    const populationBefore = region.population;
    const foodBefore = region.food;
    const ledgerBefore = world.lastTurn;

    const disaster = applyV03Intervention(world, { kind: 'create_disaster', regionId: region.id, severity: 3 });
    const changed = disaster.regions.find((candidate) => candidate.id === region.id);
    const event = disaster.history.at(-1);
    expect(changed?.population).toBeLessThan(populationBefore);
    expect(changed?.food).toBeLessThan(foodBefore);
    expect(disaster.lastTurn).toEqual(ledgerBefore);
    expect(event?.stateDeltas.some((delta) => delta.entityType === 'infection' && delta.field === 'susceptible')).toBe(true);
    for (const infection of disaster.infections.filter((candidate) => candidate.hostKind === 'region' && candidate.hostId === region.id)) {
      expect(infection.susceptible + infection.exposed + infection.infectious + infection.recovered).toBe(changed?.population);
    }
    expect(validateWorld(disaster)).toEqual([]);

    const advanced = advanceWorld(disaster);
    expect(advanced.turn).toBe(1);
    expect(validateWorld(advanced)).toEqual([]);
  });

  it('enforces cost, cooldown, input bounds and authenticated turn boundaries', () => {
    const world = createWorld('v03-intervention-limits');
    const regionId = world.regions[0]?.id ?? '';
    const expensive = applyV03Intervention(world, { kind: 'create_disaster', regionId, severity: 3 });
    expect(availableMandate(expensive)).toBe(0);
    expect(() => applyV03Intervention(expensive, {
      kind: 'modify_mandate',
      polityId: world.polities[0]?.id ?? '',
      delta: 1,
    })).toThrow(/天命不足|冷却/);

    const nextBoundary = advanceWorld(expensive);
    expect(availableMandate(nextBoundary)).toBe(1);
    expect(() => applyV03Intervention(nextBoundary, {
      kind: 'support_character',
      characterId: nextBoundary.characters.find((character) => character.alive)?.id ?? '',
    })).toThrow(/天命不足|冷却/);
    expect(() => applyV03Intervention(world, {
      kind: 'modify_mandate',
      polityId: world.polities[0]?.id ?? '',
      delta: 20,
    })).toThrow(/-6至6/);

    const tampered = structuredClone(world);
    tampered.season = '冬';
    expect(() => applyV03Intervention(tampered, {
      kind: 'protect_character',
      characterId: tampered.characters[0]?.id ?? '',
    })).toThrow(/季度边界/);
    const staleHash = structuredClone(world);
    staleHash.polities[0]!.treasury += 1;
    expect(() => applyV03Intervention(staleHash, {
      kind: 'protect_character',
      characterId: staleHash.characters[0]?.id ?? '',
    })).toThrow(/哈希不一致/);
  });

  it('caps banked mandate before each historical spend instead of carrying overflow', () => {
    let world = createWorld('v03-intervention-bank-cap');
    // Wait fifty years: the visible bank is still twelve, not an unbounded reserve.
    world.turn = 200;
    world.year = 51;
    world.season = '春';
    world.situationSystem = createSituationSystemState(world.turn - 1);
    world.hash = computeWorldHash(world);
    expect(availableMandate(world)).toBe(12);
    const characterId = world.characters.find((character) => character.alive)?.id;
    if (!characterId) throw new Error('test world lacks a living character');
    world = applyV03Intervention(world, { kind: 'protect_character', characterId, quarters: 1 });
    world = advanceWorld(world);
    // Only the capped balance minus four plus this year's recharge remains.
    expect(availableMandate(world)).toBe(8);
  });
});
