import type { SimulationFact, WarState, WorldState } from '../sim/types';

export function warKey(fact: SimulationFact): string | null {
  return fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle'
    || fact.kind === 'territory_control_changed' ? fact.payload.warId : null;
}

export function warFactMatches(fact: SimulationFact, warId: string, byId: ReadonlyMap<string, SimulationFact>): boolean {
  if (warKey(fact) === warId) return true;
  if (fact.kind === 'character_wounded' || fact.kind === 'character_death') {
    const battle = fact.payload.battleFactId && byId.get(fact.payload.battleFactId);
    return Boolean(battle && warKey(battle) === warId);
  }
  return fact.kind === 'army_order_changed'
    && (fact.payload.previous.warId === warId || fact.payload.next.warId === warId);
}

/** Settled war time, not the later date an observer started tracking it. */
export function warEndTurn(world: WorldState, war: WarState): number {
  return war.endedTurn ?? world.lastTurn?.turn ?? Math.max(0, world.turn - 1);
}
