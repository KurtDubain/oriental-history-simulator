import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  projectCharacterEmbodiedActions,
  stableHash,
  validateTurnRuntime,
  type EmbodiedActionCommand,
  type WorldState,
} from '../index';
import { MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN } from './embodied-governance';

const LOCAL_ACTIONS = new Set(['open_granary', 'reduce_levy']);

function pressuredGovernor(seed: string): { world: WorldState; actorId: string; regionId: string } {
  const world = createWorld(seed);
  const actor = world.characters.find((item) => item.alive && item.governedRegionId);
  if (!actor?.governedRegionId) throw new Error('fixture requires a living governor');
  const region = world.regions.find((item) => item.id === actor.governedRegionId);
  const polity = world.polities.find((item) => item.id === actor.polityId);
  if (!region || !polity) throw new Error('fixture requires governor region and polity');
  actor.age = 35;
  actor.lifeStage = '盛年';
  actor.health = 100;
  actor.governance = 96;
  actor.loyalty = 88;
  actor.caution = 72;
  actor.ambition = 36;
  polity.administration = 92;
  polity.authority = 90;
  polity.treasury = Math.max(polity.treasury, Math.round(region.population * 0.2));
  region.unrest = 88;
  region.devastation = 42;
  region.food = Math.max(region.food, Math.round(region.population * 1.5));
  for (const other of world.characters.filter((item) => item.id !== actor.id && item.polityId === actor.polityId && item.governedRegionId)) {
    const otherRegion = world.regions.find((item) => item.id === other.governedRegionId);
    if (!otherRegion) continue;
    otherRegion.unrest = 2;
    otherRegion.devastation = 0;
    otherRegion.food = Math.max(otherRegion.food, otherRegion.population * 3);
  }
  world.hash = computeWorldHash(world);
  return { world, actorId: actor.id, regionId: region.id };
}

describe('EMB05/06 local governor identity action', () => {
  it('projects exactly two concrete local measures without mutating the world', () => {
    const { world, actorId, regionId } = pressuredGovernor('地方官入世投影');
    const before = stableHash(world);
    const actions = projectCharacterEmbodiedActions(world, actorId);
    const local = actions.filter((item) => LOCAL_ACTIONS.has(item.command.kind));

    expect(actions).toHaveLength(4);
    expect(local.map((item) => item.label)).toEqual(['开仓赈济', '减免本季赋']);
    expect(local.every((item) => (
      item.command.targetKind === 'region'
      && item.command.targetId === regionId
      && item.targetLabel
      && item.cost
      && item.obstacle
      && item.nextSignal
    ))).toBe(true);
    expect(stableHash(world)).toBe(before);
  });

  it('uses the autonomous governor result unchanged when the player chooses the same measure', () => {
    const { world, actorId } = pressuredGovernor('地方官共用裁决');
    const autonomous = advanceWorld(world);
    const autonomousFact = autonomous.facts.find((fact) => (
      fact.turn === world.turn
      && fact.kind === 'local_governance_resolved'
      && fact.payload.actorId === actorId
    ));
    if (autonomousFact?.kind !== 'local_governance_resolved') throw new Error('fixture requires an autonomous local measure');
    const option = projectCharacterEmbodiedActions(world, actorId).find((item) => (
      item.command.kind === autonomousFact.payload.action && item.available
    ));
    if (!option) throw new Error('player must see the same available local measure');

    const played = advanceWorld(world, { embodiedAction: option.command });
    const wrapper = played.facts.find((fact) => (
      fact.turn === world.turn
      && fact.kind === 'embodied_action_resolved'
      && fact.payload.actionId === option.command.actionId
    ));
    if (wrapper?.kind !== 'embodied_action_resolved' || !wrapper.payload.domainFactId) {
      throw new Error('player measure must have one domain result');
    }
    const playerFact = played.facts.find((fact) => fact.id === wrapper.payload.domainFactId);
    expect(playerFact?.kind).toBe('local_governance_resolved');
    if (playerFact?.kind !== 'local_governance_resolved') throw new Error('missing local governance domain fact');
    expect(playerFact.payload.outcome).toBe(autonomousFact.payload.outcome);
    expect(playerFact.payload.reasonCode).toBe(autonomousFact.payload.reasonCode);
    expect(playerFact.payload.score).toBe(autonomousFact.payload.score);
    expect(playerFact.payload.threshold).toBe(autonomousFact.payload.threshold);
    expect(playerFact.stateDeltas).toEqual(autonomousFact.stateDeltas);
    expect(wrapper.stateDeltas).toEqual([]);
    expect(wrapper.sourceFactIds).toEqual([
      wrapper.payload.submissionFactId,
      wrapper.payload.domainFactId,
    ]);
    expect(played.history.some((event) => event.sourceFactIds.includes(playerFact.id))).toBe(true);
    expect(played.characters.find((item) => item.id === actorId)?.biography.some((item) => (
      item.eventId && played.history.find((event) => event.id === item.eventId)?.sourceFactIds.includes(playerFact.id)
    ))).toBe(true);
    expect(played.agencySystem.characters.find((item) => item.characterId === actorId)?.memories.some((item) => (
      item.sourceFactIds.includes(playerFact.id)
    ))).toBe(true);
    expect(validateTurnRuntime(world, played)).toEqual([]);
  });

  it('lets an embodied governor replace the same polity AI proposal without gaining a resolver bonus', () => {
    const { world, actorId } = pressuredGovernor('地方官替代政权提案');
    const actor = world.characters.find((item) => item.id === actorId);
    const other = world.characters.find((item) => (
      item.id !== actorId
      && item.alive
      && item.polityId === actor?.polityId
      && item.governedRegionId
    ));
    const otherRegion = world.regions.find((item) => item.id === other?.governedRegionId);
    if (!actor || !other || !otherRegion) throw new Error('fixture requires two governors in one polity');
    other.age = 35;
    other.lifeStage = '盛年';
    other.health = 100;
    other.governance = 99;
    other.loyalty = 95;
    other.caution = 80;
    otherRegion.unrest = 96;
    otherRegion.devastation = 55;
    otherRegion.food = Math.max(otherRegion.food, Math.round(otherRegion.population * 1.5));
    world.hash = computeWorldHash(world);

    const option = projectCharacterEmbodiedActions(world, actorId).find((item) => (
      LOCAL_ACTIONS.has(item.command.kind) && item.available
    ));
    if (!option) throw new Error('fixture requires a player local measure');
    const next = advanceWorld(world, { embodiedAction: option.command });
    const polityMeasures = next.facts.filter((fact) => (
      fact.turn === world.turn
      && fact.kind === 'local_governance_resolved'
      && fact.payload.polityId === actor.polityId
    ));

    expect(polityMeasures).toHaveLength(1);
    expect(polityMeasures[0]?.kind === 'local_governance_resolved' && polityMeasures[0].payload.actorId).toBe(actorId);
    expect(validateTurnRuntime(world, next)).toEqual([]);
  });

  it('conserves food and wealth while applying visible local consequences', () => {
    const { world, actorId } = pressuredGovernor('地方治理守恒');
    const options = projectCharacterEmbodiedActions(world, actorId)
      .filter((item) => LOCAL_ACTIONS.has(item.command.kind) && item.available);
    expect(options).toHaveLength(2);

    for (const option of options) {
      const next = advanceWorld(world, { embodiedAction: option.command });
      const wrapper = next.facts.find((fact) => (
        fact.turn === world.turn
        && fact.kind === 'embodied_action_resolved'
        && fact.payload.actionId === option.command.actionId
      ));
      const domain = wrapper?.kind === 'embodied_action_resolved' && wrapper.payload.domainFactId
        ? next.facts.find((fact) => fact.id === wrapper.payload.domainFactId)
        : null;
      expect(domain?.kind).toBe('local_governance_resolved');
      if (domain?.kind !== 'local_governance_resolved') throw new Error('missing local result');
      expect(domain.payload.outcome).toBe('enacted');
      expect(domain.payload.unrestAfter).toBeLessThan(domain.payload.unrestBefore);
      if (domain.payload.action === 'open_granary') {
        const foodDelta = domain.stateDeltas.find((delta) => delta.entityType === 'region' && delta.field === 'food');
        expect(foodDelta?.delta).toBe(-domain.payload.foodSpent);
        expect(next.lastTurn?.food.civilianConsumed).toBeGreaterThanOrEqual(domain.payload.foodSpent);
      } else {
        const treasuryDelta = domain.stateDeltas.find((delta) => delta.entityType === 'polity' && delta.field === 'treasury');
        const wealthDelta = domain.stateDeltas.find((delta) => delta.entityType === 'region' && delta.field === 'wealth');
        expect((treasuryDelta?.delta ?? 0) + (wealthDelta?.delta ?? 0)).toBe(0);
        expect(domain.payload.treasurySpent).toBeGreaterThan(0);
      }
      expect(validateTurnRuntime(world, next)).toEqual([]);
    }
  });

  it('invalidates a forged region and never invokes the local resolver', () => {
    const { world, actorId } = pressuredGovernor('地方官防滥用');
    const option = projectCharacterEmbodiedActions(world, actorId).find((item) => (
      LOCAL_ACTIONS.has(item.command.kind) && item.available
    ));
    if (!option) throw new Error('fixture requires a local action');
    const forged: EmbodiedActionCommand = { ...option.command, targetId: 'region_missing' };
    const next = advanceWorld(world, { embodiedAction: forged });
    const wrapper = next.facts.find((fact) => (
      fact.turn === world.turn
      && fact.kind === 'embodied_action_resolved'
      && fact.payload.actionId === forged.actionId
    ));
    expect(wrapper?.kind).toBe('embodied_action_resolved');
    if (wrapper?.kind !== 'embodied_action_resolved') throw new Error('missing invalid wrapper');
    expect(wrapper.payload.outcome).toBe('invalidated');
    expect(wrapper.payload.domainFactId).toBeNull();
    expect(wrapper.stateDeltas).toEqual([]);
    expect(next.facts.some((fact) => fact.kind === 'local_governance_resolved' && fact.payload.actorId === actorId)).toBe(false);
    expect(validateTurnRuntime(world, next)).toEqual([]);
  });

  it('keeps autonomous measures bounded and exposes a real cooldown after enactment', () => {
    const { world, actorId } = pressuredGovernor('地方治理冷却');
    const next = advanceWorld(world);
    const measures = next.facts.filter((fact): fact is Extract<WorldState['facts'][number], { kind: 'local_governance_resolved' }> => (
      fact.turn === world.turn && fact.kind === 'local_governance_resolved'
    ));
    const actorMeasure = measures.find((fact) => fact.payload.actorId === actorId);
    expect(measures.length).toBeLessThanOrEqual(MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN);
    expect(actorMeasure?.payload.outcome).toBe('enacted');
    const local = projectCharacterEmbodiedActions(next, actorId)
      .filter((item) => LOCAL_ACTIONS.has(item.command.kind));
    expect(local).toHaveLength(2);
    expect(local.every((item) => !item.available && item.unavailableReason?.includes('上一项地方措施'))).toBe(true);
  });
});
