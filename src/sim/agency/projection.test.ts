import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld, serializeWorld } from '../index';
import type { CharacterState, RelationshipState, WorldState } from '../types';
import {
  MAX_PLAN_STEPS,
  MAX_SECONDARY_GOALS,
  PRIMARY_GOAL_MINIMUM_TURNS,
  PRIMARY_REPLACEMENT_CONFIRMATIONS,
  ROOT_DESIRES,
  evaluateGoalTerminalState,
  projectCharacterAgency,
  projectCharacterDesires,
  toCharacterAgencyPlayerProjection,
} from './projection';

function worldWithDeputy(seed: string): { world: WorldState; character: CharacterState; unitId: string } {
  const world = advanceWorld(createWorld(seed));
  const army = world.armies.find((item) => item.deputyCommanderId !== null);
  const fleet = world.fleets.find((item) => item.deputyCommanderId !== null);
  const characterId = army?.deputyCommanderId ?? fleet?.deputyCommanderId;
  const unitId = army?.id ?? fleet?.id;
  if (!characterId || !unitId) throw new Error('Expected the first settled quarter to assign a deputy');
  const character = world.characters.find((item) => item.id === characterId);
  if (!character) throw new Error('Deputy does not resolve to a character');
  return { world, character, unitId };
}

function forceCommandGoal(character: CharacterState): void {
  character.ambition = 100;
  character.leadership = 100;
  character.cunning = 90;
  character.governance = 65;
  character.merit = 75;
  character.deputyExperience = 100;
  character.renown = 85;
  character.influence = 70;
  character.caution = 12;
  character.loyalty = 45;
}

function forceRevengeChallenge(world: WorldState, character: CharacterState): void {
  character.ambition = 0;
  character.leadership = 0;
  character.governance = 0;
  character.merit = 0;
  character.deputyExperience = 0;
  character.renown = 0;
  character.influence = 0;
  character.caution = 0;
  character.loyalty = 0;
  character.cunning = 100;
  const target = world.characters.find((item) => item.alive && item.id !== character.id) as CharacterState;
  const relation: RelationshipState = {
    id: `agency-test-grievance:${character.id}:${target.id}`,
    sourceId: character.id,
    targetId: target.id,
    kinship: '无',
    affinity: 0,
    trust: 0,
    fear: 0,
    grievance: 100,
    gratitude: 0,
    lastInteractionTurn: world.turn,
    memories: [{ turn: world.turn, kind: '背叛', impact: -100, summary: '测试用旧怨', eventId: null }],
  };
  const existing = world.relationships.findIndex((item) => item.sourceId === relation.sourceId && item.targetId === relation.targetId);
  if (existing >= 0) world.relationships[existing] = relation;
  else world.relationships.push(relation);
}

describe('C06/C07 Character Agency projection contract', () => {
  it('derives all eight bounded desires from five auditable inputs without touching world state or hash', () => {
    const world = createWorld('agency-desire-purity');
    const character = world.characters[17] as CharacterState;
    const serialized = serializeWorld(world);
    const hash = world.hash;

    const first = projectCharacterDesires(world, character.id);
    const second = projectCharacterDesires(world, character.id);

    expect(second).toEqual(first);
    expect(first.authority).toBe('projection');
    expect(first.axes).toHaveLength(ROOT_DESIRES.length);
    expect(new Set(first.axes.map((axis) => axis.kind))).toEqual(new Set(ROOT_DESIRES));
    expect(first.axes.filter((axis) => axis.core)).toHaveLength(2);
    expect(first.coreDesireKinds).toHaveLength(2);
    expect(first.pressures.length).toBeLessThanOrEqual(4);
    for (const axis of first.axes) {
      expect(axis.weight).toBeGreaterThanOrEqual(0);
      expect(axis.weight).toBeLessThanOrEqual(100);
      expect(axis.sources.map((source) => source.kind)).toEqual(['origin', 'personality', 'family', 'experience', 'seed']);
    }
    expect(world.hash).toBe(hash);
    expect(serializeWorld(world)).toBe(serialized);
  });

  it('does not treat Chronicle or biography prose as an Agency input', () => {
    const world = createWorld('agency-prose-isolation');
    const character = world.characters[17] as CharacterState;
    const before = projectCharacterAgency(world, character.id);

    world.history = world.history.map((event) => ({
      ...event,
      title: `改写标题：${event.title}`,
      summary: `改写正文：${event.summary}`,
    }));
    character.biography = character.biography.map((entry) => ({
      ...entry,
      summary: `改写传记：${entry.summary}`,
    }));

    expect(projectCharacterAgency(world, character.id)).toEqual(before);
  });

  it('exposes one primary goal, at most two secondary goals and plans of no more than five ordered steps', () => {
    const { world, character } = worldWithDeputy('agency-contract-shape');
    forceCommandGoal(character);

    const agency = projectCharacterAgency(world, character.id);

    expect(agency.authority).toBe('projection');
    expect(agency.availability).toBe('active');
    expect(agency.primaryGoal?.type).toBe('secure_independent_command');
    expect(agency.primaryGoal?.createdTurn).toBe(world.turn);
    expect(agency.primaryGoal?.minimumCommitUntilTurn).toBe(world.turn + PRIMARY_GOAL_MINIMUM_TURNS);
    expect(agency.primaryGoal?.reason.length).toBeGreaterThan(0);
    expect(agency.primaryGoal?.barrier.length).toBeGreaterThan(0);
    expect(agency.secondaryGoals.length).toBeLessThanOrEqual(MAX_SECONDARY_GOALS);
    expect(agency.plans).toHaveLength(1 + agency.secondaryGoals.length);
    for (const plan of agency.plans) {
      expect(plan.steps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
      expect(plan.steps.map((step) => step.order)).toEqual(plan.steps.map((_, index) => index + 1));
      expect(plan.steps.filter((step) => step.status === 'available').length).toBeLessThanOrEqual(1);
      expect(plan.steps.every((step) => step.id.endsWith(`:step:${step.action}`))).toBe(true);
    }
  });

  it('anchors no-ledger goal and plan IDs to the person instead of the viewing quarter', () => {
    const { world, character } = worldWithDeputy('agency-stable-id-without-ledger');
    forceCommandGoal(character);
    const first = projectCharacterAgency(world, character.id);
    const firstGoalId = first.primaryGoal?.id;
    const firstPlanId = first.plans.find((plan) => plan.goalId === firstGoalId)?.id;

    world.turn += 1;
    const nextQuarterWithoutPrevious = projectCharacterAgency(world, character.id);

    expect(nextQuarterWithoutPrevious.primaryGoal?.id).toBe(firstGoalId);
    expect(nextQuarterWithoutPrevious.primaryGoal?.createdTurn).toBe(world.turn);
    expect(nextQuarterWithoutPrevious.primaryGoal?.createdTurn).not.toBe(first.primaryGoal?.createdTurn);
    expect(nextQuarterWithoutPrevious.plans.find((plan) => plan.goalId === firstGoalId)?.id).toBe(firstPlanId);

    const player = toCharacterAgencyPlayerProjection(nextQuarterWithoutPrevious);
    expect(player).not.toHaveProperty('seed');
    expect(player).not.toHaveProperty('sourceWorldHash');
    expect(player).not.toHaveProperty('authority');
    expect(player.primaryGoal).not.toHaveProperty('target');
    expect(player.primaryGoal).not.toHaveProperty('context');
    expect(player.desires).toHaveLength(2);
    expect(player.desires.every((desire) => desire.reason.length > 0)).toBe(true);
    expect(JSON.stringify(player.desires)).not.toContain('成年前形成的个人倾向');
  });

  it('keeps the primary goal through its four-turn inertia and needs two adjacent superior reviews to replace it', () => {
    const { world, character } = worldWithDeputy('agency-primary-inertia');
    forceCommandGoal(character);
    const initial = projectCharacterAgency(world, character.id);
    expect(initial.primaryGoal?.type).toBe('secure_independent_command');
    const initialGoalId = initial.primaryGoal?.id;

    forceRevengeChallenge(world, character);
    world.turn = initial.reviewedTurn + 1;
    const held = projectCharacterAgency(world, character.id, initial);
    expect(held.primaryGoal?.id).toBe(initialGoalId);
    expect(held.pendingPrimaryChallenge).toBeNull();

    world.turn = initial.reviewedTurn + PRIMARY_GOAL_MINIMUM_TURNS;
    const firstChallenge = projectCharacterAgency(world, character.id, held);
    expect(firstChallenge.primaryGoal?.id).toBe(initialGoalId);
    expect(firstChallenge.pendingPrimaryChallenge?.consecutiveReviews).toBe(1);

    world.turn += 1;
    const replaced = projectCharacterAgency(world, character.id, firstChallenge);
    expect(PRIMARY_REPLACEMENT_CONFIRMATIONS).toBe(2);
    expect(replaced.primaryGoal?.id).not.toBe(initialGoalId);
    expect(replaced.primaryGoal?.type).toBe('settle_grievance');
    expect(replaced.recentlyClosedGoals).toContainEqual(expect.objectContaining({
      id: initialGoalId,
      status: 'abandoned',
      closureReason: 'superseded_after_inertia',
    }));
  });

  it('applies hard invalidation immediately when a target disappears, even inside the inertia window', () => {
    const { world, character, unitId } = worldWithDeputy('agency-hard-invalidation');
    forceCommandGoal(character);
    const initial = projectCharacterAgency(world, character.id);
    const original = initial.primaryGoal;
    expect(original?.target.id).toBe(unitId);

    world.armies = world.armies.filter((army) => army.id !== unitId);
    world.fleets = world.fleets.filter((fleet) => fleet.id !== unitId);
    world.turn += 1;
    const reviewed = projectCharacterAgency(world, character.id, initial);
    const freshAtSameTurn = projectCharacterAgency(world, character.id);

    expect(original && evaluateGoalTerminalState(world, original)).toEqual({ status: 'invalidated', reason: 'target_missing' });
    expect(reviewed.primaryGoal?.id).not.toBe(original?.id);
    expect(reviewed.primaryGoal?.id).toBe(freshAtSameTurn.primaryGoal?.id);
    expect(reviewed.recentlyClosedGoals).toContainEqual(expect.objectContaining({
      id: original?.id,
      status: 'invalidated',
      closureReason: 'target_missing',
    }));
    expect(toCharacterAgencyPlayerProjection(reviewed).recentDecision).toEqual({
      label: original?.label,
      status: 'invalidated',
      reason: '所指对象已经不复存在',
    });
  });

  it('promotes an existing secondary goal without duplicating its ID or signature', () => {
    const { world, character, unitId } = worldWithDeputy('agency-secondary-promotion');
    forceCommandGoal(character);
    const initial = projectCharacterAgency(world, character.id);
    expect(initial.primaryGoal?.target.id).toBe(unitId);

    world.armies = world.armies.filter((army) => army.id !== unitId);
    world.fleets = world.fleets.filter((fleet) => fleet.id !== unitId);
    world.turn += 1;
    const fresh = projectCharacterAgency(world, character.id);
    const promotedCandidate = fresh.primaryGoal;
    if (!promotedCandidate) throw new Error('Expected a fallback goal after the deputy unit disappeared');
    const syntheticPrevious = {
      ...initial,
      secondaryGoals: [promotedCandidate],
      plans: [...initial.plans, ...fresh.plans],
    };

    const transitioned = projectCharacterAgency(world, character.id, syntheticPrevious);
    const active = [
      ...(transitioned.primaryGoal ? [transitioned.primaryGoal] : []),
      ...transitioned.secondaryGoals,
    ];
    expect(transitioned.primaryGoal?.id).toBe(promotedCandidate.id);
    expect(transitioned.primaryGoal?.minimumCommitUntilTurn).toBeGreaterThanOrEqual(
      (transitioned.primaryGoal?.createdTurn ?? 0) + PRIMARY_GOAL_MINIMUM_TURNS,
    );
    expect(transitioned.secondaryGoals.some((goal) => goal.id === promotedCandidate.id)).toBe(false);
    expect(new Set(active.map((goal) => goal.id)).size).toBe(active.length);
    expect(new Set(active.map((goal) => goal.signature)).size).toBe(active.length);
  });

  it('keeps established core desires and long-term direction while current pressure changes', () => {
    const { world, character } = worldWithDeputy('agency-core-desire-inertia');
    const initial = projectCharacterAgency(world, character.id);
    const core = [...initial.desire.coreDesireKinds];
    const direction = initial.longTermDirection;

    forceRevengeChallenge(world, character);
    character.caution = 100;
    character.health = 5;
    character.activeDiseaseId = world.pathogens[0]?.id ?? 'test-disease-pressure';
    world.turn += 1;
    const rawCurrent = projectCharacterDesires(world, character.id);
    const reviewed = projectCharacterAgency(world, character.id, initial);

    expect(rawCurrent.pressures.length).toBeGreaterThan(0);
    expect(reviewed.desire.coreDesireKinds).toEqual(core);
    expect(reviewed.desire.axes.filter((axis) => axis.core).map((axis) => axis.kind)).toEqual(core);
    expect(reviewed.longTermDirection).toBe(direction);
  });

  it('keeps minors dormant and closes every active goal on death without inventing a replacement', () => {
    const minorWorld = createWorld('agency-minor-dormant');
    const minor = minorWorld.characters[10] as CharacterState;
    minor.age = 12;
    minor.lifeStage = '成长';
    minor.adultTurn = null;
    const dormant = projectCharacterAgency(minorWorld, minor.id);
    expect(dormant.availability).toBe('dormant');
    expect(dormant.primaryGoal).toBeNull();
    expect(dormant.plans).toEqual([]);
    expect(dormant.barrier).toBe('等待成年');

    const { world, character } = worldWithDeputy('agency-death-close');
    forceCommandGoal(character);
    const living = projectCharacterAgency(world, character.id);
    character.alive = false;
    character.lifeStage = '已故';
    character.deathTurn = world.turn + 1;
    world.turn += 1;
    const dead = projectCharacterAgency(world, character.id, living);
    expect(dead.availability).toBe('closed');
    expect(dead.primaryGoal).toBeNull();
    expect(dead.secondaryGoals).toEqual([]);
    expect(dead.recentlyClosedGoals.length).toBeGreaterThan(0);
    expect(dead.recentlyClosedGoals.every((goal) => goal.closureReason === 'actor_dead')).toBe(true);
  });
});
