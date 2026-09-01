import { describe, expect, it } from 'vitest';

import { createWorld } from '../engine';
import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import type { SimulationFact } from '../types';
import {
  createEmbodiedActionCommand,
  EMBODIED_ACTION_KINDS,
  EMBODIED_COURT_ACTION_KINDS,
  EMBODIED_IDENTITY_ACTION_KINDS,
} from './embodiment';
import {
  isEmbodiedIdentityAction,
  resolveEmbodiedIdentityEnvelope,
  submitEmbodiedIdentityAction,
} from './embodied-identity';
import { isEmbodiedMilitaryAction } from './embodied-military';

function contextFor(world: ReturnType<typeof createWorld>): FactTurnBuffer {
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    facts: [],
  };
}

describe('embodied identity boundary', () => {
  it('classifies the court action as identity without treating it as military', () => {
    const world = createWorld('朝臣身份动作契约');
    const actor = world.characters.find((item) => item.alive);
    const faction = world.factions.find((item) => item.active && item.polityId === actor?.polityId);
    if (!actor || !faction) throw new Error('fixture requires a living actor and faction');
    const command = createEmbodiedActionCommand(
      world,
      actor.id,
      'form_court_alliance',
      'faction',
      faction.id,
    );

    expect(EMBODIED_COURT_ACTION_KINDS).toEqual(['form_court_alliance']);
    expect(EMBODIED_ACTION_KINDS).toContain(command.kind);
    expect(EMBODIED_IDENTITY_ACTION_KINDS).toContain(command.kind);
    expect(isEmbodiedIdentityAction(command)).toBe(true);
    expect(isEmbodiedMilitaryAction(command)).toBe(false);
  });

  it('keeps existing domains and gives court envelopes political copy without state deltas', () => {
    const world = createWorld('朝中信封分类');
    const actor = world.characters.find((item) => item.alive);
    const faction = world.factions.find((item) => item.active && item.polityId === actor?.polityId);
    const army = world.armies.find((item) => item.polityId === actor?.polityId);
    const region = world.regions.find((item) => item.id === actor?.locationRegionId);
    if (!actor || !faction || !army || !region) throw new Error('fixture requires court, army and region targets');

    const military = submitEmbodiedIdentityAction(
      world,
      createEmbodiedActionCommand(world, actor.id, 'request_independent_command', 'army', army.id),
      null,
      (input) => emitSimulationFact(world, contextFor(world), input) as Extract<SimulationFact, { kind: 'embodied_action_submitted' }>,
    );
    const local = submitEmbodiedIdentityAction(
      world,
      createEmbodiedActionCommand(world, actor.id, 'open_granary', 'region', region.id),
      null,
      (input) => emitSimulationFact(world, contextFor(world), input) as Extract<SimulationFact, { kind: 'embodied_action_submitted' }>,
    );
    const courtCommand = createEmbodiedActionCommand(
      world,
      actor.id,
      'form_court_alliance',
      'faction',
      faction.id,
    );
    const courtContext = contextFor(world);
    const court = submitEmbodiedIdentityAction(
      world,
      courtCommand,
      null,
      (input) => emitSimulationFact(world, courtContext, input) as Extract<SimulationFact, { kind: 'embodied_action_submitted' }>,
    );
    const resolved = resolveEmbodiedIdentityEnvelope(
      world,
      courtCommand,
      null,
      court,
      {
        outcome: 'invalidated',
        reasonCode: 'conditions_changed',
        score: 0,
        threshold: 0,
        summary: '朝中结盟尚未进入实际裁决。',
        domainFact: null,
      },
      (input) => emitSimulationFact(world, courtContext, input) as Extract<SimulationFact, { kind: 'embodied_action_resolved' }>,
    );

    expect(military).toMatchObject({
      category: '军事',
      causes: expect.arrayContaining([expect.objectContaining({ label: '军中身份' })]),
    });
    expect(local).toMatchObject({
      category: '经济',
      causes: expect.arrayContaining([expect.objectContaining({ label: '地方职权' })]),
    });
    expect(court).toMatchObject({
      category: '政治',
      stateDeltas: [],
      causes: expect.arrayContaining([expect.objectContaining({ label: '朝臣议事' })]),
      payload: { action: 'form_court_alliance' },
    });
    expect(resolved).toMatchObject({
      category: '政治',
      stateDeltas: [],
      sourceFactIds: [court.id],
      causes: expect.arrayContaining([expect.objectContaining({ label: '朝中裁决' })]),
      payload: {
        action: 'form_court_alliance',
        submissionFactId: court.id,
        domainFactId: null,
      },
    });
  });
});
