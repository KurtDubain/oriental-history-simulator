import { stableCompare, stableHash } from '../random';
import type { Season, WorldState } from '../types';
import type { SimulationFact, SimulationFactInput } from './types';

export interface FactTurnBuffer {
  turn: number;
  year: number;
  season: Season;
  facts: SimulationFact[];
}

function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`SimulationFact cannot contain undefined at ${path}`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) assertNoUndefined(item, `${path}.${key}`);
}

export function emitSimulationFact(
  world: WorldState,
  context: FactTurnBuffer,
  input: SimulationFactInput,
): SimulationFact {
  const nextFactCounter = world.counters.fact + 1;
  const fact = {
    ...input,
    id: `fact_${String(nextFactCounter).padStart(7, '0')}`,
    turn: context.turn,
    year: context.year,
    season: context.season,
    actorIds: [...new Set(input.actorIds)].sort(stableCompare),
    polityIds: [...new Set(input.polityIds)].sort(stableCompare),
    regionIds: [...new Set(input.regionIds)].sort(stableCompare),
    sourceFactIds: [...new Set(input.sourceFactIds)].sort(stableCompare),
    causes: input.causes.map((cause) => cause.refs
      ? { ...cause, refs: cause.refs.map((reference) => ({ ...reference })) }
      : { ...cause }),
    stateDeltas: input.stateDeltas.map((delta) => ({ ...delta })),
  } as SimulationFact;
  assertNoUndefined(fact, fact.id);
  world.counters.fact = nextFactCounter;
  context.facts.push(fact);
  world.facts.push(fact);
  world.factDigest = stableHash([world.factDigest, fact]);
  return fact;
}
