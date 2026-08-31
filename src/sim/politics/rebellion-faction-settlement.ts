import type { FactTurnBuffer } from '../facts';
import type { CharacterState, StateDelta, WorldState } from '../types';
import {
  expelFactionMembers,
  settleFactionDepartures,
  type EmitFactionChronicle,
} from './faction-lifecycle';

/**
 * Collects the faction consequences of a breakaway while the engine transfers
 * the rebel leader and any defecting officers. The batch preserves departure
 * order for Fact deltas, then repairs every affected faction once the
 * territory-change Fact is available as causal evidence.
 */
export function createRebellionFactionSettlement(
  world: WorldState,
  context: FactTurnBuffer,
): {
  stateDeltas: StateDelta[];
  detach: (character: CharacterState) => void;
  settle: (sourceFactIds: readonly string[], emit: EmitFactionChronicle) => void;
} {
  const factionIds = new Set<string>();
  const stateDeltas: StateDelta[] = [];
  return {
    stateDeltas,
    detach(character) {
      if (!character.factionId) return;
      const factionId = character.factionId;
      factionIds.add(factionId);
      stateDeltas.push({
        entityType: 'character',
        entityId: character.id,
        field: 'factionId',
        before: factionId,
        after: null,
      });
      expelFactionMembers(world, factionId, [character.id]);
    },
    settle(sourceFactIds, emit) {
      settleFactionDepartures(world, context, [...factionIds], sourceFactIds, emit);
    },
  };
}

/** Reduce parallel governors' preparations after the court responds to a breakaway. */
export function suppressParallelRebellions(world: WorldState, parentPolityId: string): StateDelta[] {
  const stateDeltas: StateDelta[] = [];
  for (const governor of world.characters.filter((character) => (
    character.alive
    && character.polityId === parentPolityId
    && Boolean(character.governedRegionId)
    && character.rebellionReadiness > 0
  ))) {
    const before = governor.rebellionReadiness;
    governor.rebellionReadiness = Math.round(before * 0.45);
    stateDeltas.push({
      entityType: 'character',
      entityId: governor.id,
      field: 'rebellionReadiness',
      before,
      after: governor.rebellionReadiness,
      delta: governor.rebellionReadiness - before,
    });
  }
  return stateDeltas;
}
