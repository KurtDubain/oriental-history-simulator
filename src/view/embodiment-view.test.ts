import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  createWorld,
  projectCharacterEmbodiedActions,
  stableHash,
  type EmbodiedActionCommand,
  type WorldState,
} from '../sim';
import {
  projectEmbodimentTextSnapshot,
  projectPersonEmbodimentView,
} from './embodiment-view';

function playableAction(world: WorldState): EmbodiedActionCommand {
  for (const actor of world.characters) {
    if (!actor.alive) continue;
    const action = projectCharacterEmbodiedActions(world, actor.id).find((item) => item.available);
    if (action) return action.command;
  }
  throw new Error('fixture requires one available embodied action');
}

describe('embodiment view projection boundary', () => {
  it('keeps the dossier and text snapshot on one pure action projection', () => {
    const world = createWorld('入世视图单一投影');
    const command = playableAction(world);
    const actor = world.characters.find((item) => item.id === command.actorId);
    if (!actor) throw new Error('fixture requires the embodied actor');
    const before = stableHash(world);

    const dossier = projectPersonEmbodimentView(world, actor.id, actor.id, command, null);
    const snapshot = projectEmbodimentTextSnapshot(world, actor.id, command, null);
    const dossierSummary = dossier.actions.map((action) => ({
      actionId: action.actionId,
      identityLabel: action.identityLabel,
      label: action.label,
      targetLabel: action.targetLabel,
      available: action.available,
      unavailableReason: action.unavailableReason,
    }));

    expect(dossier.active).toBe(true);
    expect(dossier.activeCharacterName).toBe(actor.name);
    expect(snapshot.actions).toEqual(dossierSummary);
    expect(snapshot.pending?.label).toBe(dossier.actions.find((item) => item.actionId === command.actionId)?.label);
    expect(dossier.pending?.label).toBe(snapshot.pending?.label);
    expect(dossier.pending?.targetLabel).toBe(snapshot.pending?.targetLabel);
    expect(stableHash(world)).toBe(before);
  });

  it('links the latest resolved action to the same authoritative history entry', () => {
    const world = createWorld('入世视图结果投影');
    const command = playableAction(world);
    const next = advanceWorld(world, { embodiedAction: command });
    const dossier = projectPersonEmbodimentView(next, command.actorId, command.actorId, null, null);
    const resultFact = [...next.facts].reverse().find((fact) => (
      fact.kind === 'embodied_action_resolved' && fact.payload.actionId === command.actionId
    ));

    expect(resultFact?.kind).toBe('embodied_action_resolved');
    expect(dossier.lastResult?.periodLabel).toBe('第 1 年春');
    expect(dossier.lastResult?.summary).toBe(
      resultFact?.kind === 'embodied_action_resolved' ? resultFact.payload.resultSummary : null,
    );
    expect(dossier.lastResult?.sourceEventId).toBeTruthy();
    expect(next.history.find((event) => event.id === dossier.lastResult?.sourceEventId)?.sourceFactIds.some((id) => (
      id === resultFact?.id
      || (resultFact?.kind === 'embodied_action_resolved' && id === resultFact.payload.domainFactId)
    ))).toBe(true);
  });
});
