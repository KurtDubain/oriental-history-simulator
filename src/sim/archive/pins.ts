import type { SimulationFact } from '../facts';
import type { HistoryEvent } from '../types';
import type { ArchiveWorldState } from './types';

function collectFactIdStrings(value: unknown, output: Set<string>, seen: Set<object>): void {
  if (typeof value === 'string') {
    if (value.startsWith('fact_')) output.add(value);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectFactIdStrings(item, output, seen);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectFactIdStrings(item, output, seen);
  }
}

/**
 * Only references that can still influence a live decision are pinned. Other
 * memories remain resolvable through cold lookup and do not grow the hot set.
 */
export function collectReferencedFactIds(world: ArchiveWorldState): Set<string> {
  const result = new Set<string>();
  const seen = new Set<object>();
  collectFactIdStrings(world.situationSystem, result, seen);
  collectFactIdStrings(world.agencyDecisionSystem, result, seen);
  collectFactIdStrings(world.lastTurn?.factIds ?? [], result, seen);
  return result;
}

export function collectPinnedFactIds(
  world: ArchiveWorldState,
  allFacts: readonly SimulationFact[],
): Set<string> {
  const factById = new Map(allFacts.map((fact) => [fact.id, fact]));
  const pinned = collectReferencedFactIds(world);
  const pending = [...pinned];
  while (pending.length > 0) {
    const factId = pending.pop() as string;
    const fact = factById.get(factId);
    if (!fact) continue;
    for (const sourceFactId of fact.sourceFactIds) {
      if (pinned.has(sourceFactId)) continue;
      pinned.add(sourceFactId);
      pending.push(sourceFactId);
    }
  }
  return pinned;
}

export function isPermanentlyPinnedEvent(event: HistoryEvent): boolean {
  return event.kind === 'world_created' || event.kind.startsWith('observer_intervention_');
}
