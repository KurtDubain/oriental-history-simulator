import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  projectEmbodiedActions,
  stableHash,
  validateTurnRuntime,
  type EmbodiedActionCommand,
  type WorldState,
} from '../index';

function playable(world: WorldState) {
  for (const character of world.characters) {
    const action = projectEmbodiedActions(world, character.id).find((item) => item.available);
    if (action) return { character, action };
  }
  throw new Error('Embodiment fixture requires one available action');
}

describe('EMB01-04 embodied character action', () => {
  it('projects actions without mutating authoritative state', () => {
    const world = createWorld('入世投影纯度');
    const before = stableHash(world);
    const hash = computeWorldHash(world);
    const { character } = playable(world);

    const actions = projectEmbodiedActions(world, character.id);

    expect(actions).toHaveLength(3);
    expect(actions.map((item) => item.label)).toEqual(['经营关系', '争取机会', expect.stringMatching(/表明支持|公开反对/)]);
    expect(actions.every((item) => item.targetLabel && item.cost && item.obstacle && item.nextSignal)).toBe(true);
    expect(stableHash(world)).toBe(before);
    expect(world.hash).toBe(hash);
  });

  it('resolves the same command deterministically through Facts, Chronicle, memory and biography', () => {
    const initial = createWorld('入世结算确定性');
    const { character, action } = playable(initial);
    const before = stableHash(initial);

    const first = advanceWorld(initial, { embodiedAction: action.command });
    const second = advanceWorld(initial, { embodiedAction: action.command });
    const submission = first.facts.find((fact) => fact.kind === 'embodied_action_submitted');
    const resolution = first.facts.find((fact) => fact.kind === 'embodied_action_resolved');

    expect(first).toEqual(second);
    expect(stableHash(initial)).toBe(before);
    expect(submission?.payload.source).toBe('player_embodied');
    expect(resolution?.payload.submissionFactId).toBe(submission?.id);
    if (action.command.targetKind === 'character') {
      expect(resolution?.payload.nextSignal).toContain(action.targetLabel.split(' · ')[0]);
    }
    expect(first.history.some((event) => event.sourceFactIds.includes(resolution?.id ?? 'missing'))).toBe(true);
    expect(first.characters.find((item) => item.id === character.id)?.biography.some((item) => item.factId === resolution?.id)).toBe(true);
    expect(first.agencySystem.characters.find((item) => item.characterId === character.id)?.memories.some((item) => item.sourceFactIds.includes(resolution?.id ?? 'missing'))).toBe(true);
    expect(validateTurnRuntime(initial, first)).toEqual([]);
  });

  it('records a forged or stale request as invalidated and applies no state delta', () => {
    const initial = createWorld('入世无权限审计');
    const { action } = playable(initial);
    const forged: EmbodiedActionCommand = { ...action.command, targetId: 'character_missing' };

    const next = advanceWorld(initial, { embodiedAction: forged });
    const resolution = next.facts.find((fact) => fact.kind === 'embodied_action_resolved');

    expect(resolution?.payload.outcome).toBe('invalidated');
    expect(resolution?.stateDeltas).toEqual([]);
    expect(next.facts.filter((fact) => fact.kind === 'embodied_action_submitted')).toHaveLength(1);
    expect(next.facts.filter((fact) => fact.kind === 'embodied_action_resolved')).toHaveLength(1);
    expect(validateTurnRuntime(initial, next)).toEqual([]);
  });
});
