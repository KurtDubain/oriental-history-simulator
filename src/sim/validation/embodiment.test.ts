import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  createWorld,
  projectCharacterEmbodiedActions,
  type EmbodiedActionCommand,
  type SimulationFact,
  type WorldState,
} from '../index';
import { validateRuntimeEmbodiedActions } from './embodiment';

function playableAction(world: WorldState): EmbodiedActionCommand {
  for (const actor of world.characters) {
    if (!actor.alive) continue;
    const action = projectCharacterEmbodiedActions(world, actor.id).find((item) => item.available);
    if (action) return action.command;
  }
  throw new Error('fixture requires one available embodied action');
}

function embodiedQuarter(): SimulationFact[] {
  const world = createWorld('入世运行时校验边界');
  const next = advanceWorld(world, { embodiedAction: playableAction(world) });
  return next.facts.slice(world.facts.length);
}

describe('runtime embodiment validation boundary', () => {
  it('accepts the complete submission, resolution and domain chain from a real quarter', () => {
    expect(validateRuntimeEmbodiedActions(embodiedQuarter())).toEqual([]);
  });

  it('detects duplicate submissions and orphaned resolutions', () => {
    const facts = embodiedQuarter();
    const submission = facts.find((fact) => fact.kind === 'embodied_action_submitted');
    const resolution = facts.find((fact) => fact.kind === 'embodied_action_resolved');
    if (!submission || !resolution) throw new Error('fixture requires an embodied envelope');

    const duplicateCodes = validateRuntimeEmbodiedActions([...facts, submission]).map((item) => item.code);
    expect(duplicateCodes).toContain('runtime.embodied-action-limit');
    const orphanCodes = validateRuntimeEmbodiedActions([resolution]).map((item) => item.code);
    expect(orphanCodes).toContain('runtime.embodied-action-orphan');
  });

  it('rejects a result whose named domain fact is absent from the quarter', () => {
    const facts = structuredClone(embodiedQuarter());
    const submission = facts.find((fact) => fact.kind === 'embodied_action_submitted');
    const resolution = facts.find((fact) => fact.kind === 'embodied_action_resolved');
    if (!submission || resolution?.kind !== 'embodied_action_resolved') {
      throw new Error('fixture requires an embodied envelope');
    }
    resolution.payload.domainFactId = 'fact_missing_domain';
    resolution.sourceFactIds = [submission.id, 'fact_missing_domain'];
    const codes = validateRuntimeEmbodiedActions(facts).map((item) => item.code);
    expect(codes).toContain('runtime.embodied-action-domain');
  });
});
