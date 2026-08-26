import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  serializeWorld,
  validateTurnRuntime,
  validateWorld,
  type WorldState,
} from '../index';

describe('authoritative Situation engine integration', () => {
  it('forms a deterministic military-power story from real Facts and keeps its identity across quarters and saves', () => {
    const first = advanceWorldBy(createWorld('春战副将'), 12);
    const replay = advanceWorldBy(createWorld('春战副将'), 12);

    expect(first.hash).toBe(replay.hash);
    expect(first.situationSystem).toEqual(replay.situationSystem);
    expect(first.situationSystem.situations.length).toBeGreaterThan(0);
    expect(first.situationSystem.situations.filter((situation) => situation.status === 'open').length).toBeLessThanOrEqual(12);
    expect(first.situationSystem.candidates.length).toBeLessThanOrEqual(64);

    const factById = new Map(first.facts.map((fact) => [fact.id, fact]));
    const milestones = first.facts.filter((fact) => fact.kind === 'situation_milestone');
    expect(milestones.some((fact) => fact.payload.transition === 'formed')).toBe(true);
    for (const fact of milestones) {
      expect(fact.sourceFactIds.length).toBeGreaterThan(0);
      expect(fact.sourceFactIds.every((id) => {
        const source = factById.get(id);
        return Boolean(source && source.id !== fact.id && source.turn <= fact.turn);
      })).toBe(true);
      const state = first.situationSystem.situations.find((situation) => situation.id === fact.payload.situationId);
      expect(state?.milestoneFactIds).toContain(fact.id);
      expect(first.history.some((event) => (
        event.sourceFactIds.includes(fact.id) && event.situationIds.includes(fact.payload.situationId)
      ))).toBe(true);
    }

    const retainedId = first.situationSystem.situations[0]?.id;
    expect(retainedId).toBeDefined();
    const restored = deserializeWorld(serializeWorld(first));
    expect(serializeWorld(restored)).toBe(serializeWorld(first));
    expect(restored.hash).toBe(first.hash);
    const continued = advanceWorld(restored);
    expect(continued.hash).toBe(advanceWorld(first).hash);
    expect(continued.situationSystem.situations.some((situation) => situation.id === retainedId)).toBe(true);
    expect(validateWorld(continued)).toEqual([]);
  }, 15_000);

  it('migrates a Phase-A schema-4 save without inventing retrospective Situations', () => {
    const phaseA = JSON.parse(serializeWorld(createWorld('Phase-A旧档'))) as Record<string, unknown>;
    delete phaseA.situationSystem;
    phaseA.hash = computeWorldHash(phaseA as unknown as WorldState);
    const authenticatedSourceHash = phaseA.hash;

    const restored = deserializeWorld(JSON.stringify(phaseA));
    expect(restored.situationSystem.lastReducedTurn).toBe(-1);
    expect(restored.situationSystem.candidates).toEqual([]);
    expect(restored.situationSystem.situations).toEqual([]);
    expect(restored.hash).not.toBe(authenticatedSourceHash);
    expect(validateWorld(restored)).toEqual([]);
    expect(() => advanceWorld(restored)).not.toThrow();
  });

  it('rejects a Situation transition when its matching milestone attachment is removed', () => {
    let previous = createWorld('春战副将');
    let next = advanceWorld(previous);
    let milestone = next.facts
      .slice(previous.facts.length)
      .find((fact) => fact.kind === 'situation_milestone');

    for (let quarter = 1; quarter < 16 && milestone === undefined; quarter += 1) {
      previous = next;
      next = advanceWorld(previous);
      milestone = next.facts
        .slice(previous.facts.length)
        .find((fact) => fact.kind === 'situation_milestone');
    }

    expect(milestone?.kind).toBe('situation_milestone');
    if (milestone?.kind !== 'situation_milestone') throw new Error('expected a Situation milestone');
    const situation = next.situationSystem.situations.find(
      (entry) => entry.id === milestone.payload.situationId,
    );
    expect(situation).toBeDefined();
    if (!situation) throw new Error('expected a retained Situation');

    situation.milestoneFactIds = situation.milestoneFactIds.filter((id) => id !== milestone.id);
    next.hash = computeWorldHash(next);

    expect(validateTurnRuntime(previous, next).map((violation) => violation.code)).toContain(
      'runtime.situation-transition-milestone',
    );
    expect(validateWorld(next).map((violation) => violation.code)).toContain(
      'situation.transition-milestone',
    );
  }, 15_000);
});
