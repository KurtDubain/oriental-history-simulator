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
  it('forms deterministic military and inheritance stories from real Facts and preserves identity across saves', () => {
    const first = advanceWorldBy(createWorld('春战副将'), 12);
    const replay = advanceWorldBy(createWorld('春战副将'), 12);

    expect(first.hash).toBe(replay.hash);
    expect(first.situationSystem).toEqual(replay.situationSystem);
    expect(first.situationSystem.situations.length).toBeGreaterThan(0);
    const open = first.situationSystem.situations.filter((situation) => situation.status === 'open');
    expect(open.length).toBeLessThanOrEqual(12);
    expect(open.filter((situation) => situation.type === 'military_power_crisis').length).toBeLessThanOrEqual(8);
    expect(open.filter((situation) => situation.type === 'inheritance_crisis').length).toBeLessThanOrEqual(4);
    expect(first.situationSystem.candidates.length).toBeLessThanOrEqual(64);
    expect(new Set(first.situationSystem.candidates.map((candidate) => candidate.type))).toEqual(new Set([
      'inheritance_crisis',
      'military_power_crisis',
    ]));

    const factById = new Map(first.facts.map((fact) => [fact.id, fact]));
    const milestones = first.facts.filter((fact) => fact.kind === 'situation_milestone');
    expect(milestones.some((fact) => fact.payload.transition === 'formed')).toBe(true);
    expect(new Set(milestones.map((fact) => fact.payload.situationType))).toEqual(new Set([
      'inheritance_crisis',
      'military_power_crisis',
    ]));
    for (const fact of milestones) {
      expect(fact.sourceFactIds.length).toBeGreaterThan(0);
      expect(fact.sourceFactIds.every((id) => {
        const source = factById.get(id);
        return Boolean(source && source.id !== fact.id && source.turn <= fact.turn);
      })).toBe(true);
      const state = first.situationSystem.situations.find((situation) => situation.id === fact.payload.situationId);
      expect(state?.milestoneFactIds).toContain(fact.id);
      const historyEvent = first.history.find((event) => (
        event.sourceFactIds.includes(fact.id) && event.situationIds.includes(fact.payload.situationId)
      ));
      expect(historyEvent).toBeDefined();
      if (fact.payload.transition === 'phase_changed') {
        const lifecycleEvidence = historyEvent?.causes.find(
          (cause) => cause.label === '生命周期规则',
        )?.evidence ?? '';
        expect(lifecycleEvidence).toMatch(/萌芽|发展|临界/);
        expect(lifecycleEvidence).not.toMatch(/emerging|active|critical|none/);
      }
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

  it('renders resolved Situation outcomes as Chinese history instead of raw keys', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 40);
    const resolvedEvents = world.history.filter((event) => event.kind === 'situation_resolved');

    expect(resolvedEvents.length).toBeGreaterThan(0);
    for (const event of resolvedEvents) {
      const situation = world.situationSystem.situations.find((item) => event.situationIds.includes(item.id));
      const rawOutcome = situation?.resolution?.outcomeKey;
      expect(rawOutcome).toBeTruthy();
      if (!rawOutcome) throw new Error('expected resolved Situation outcome');
      expect(event.summary).not.toContain(rawOutcome);
      expect(event.causes.find((cause) => cause.label === '生命周期规则')?.evidence).not.toContain(rawOutcome);
    }
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
