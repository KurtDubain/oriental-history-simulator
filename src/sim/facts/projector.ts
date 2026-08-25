import type { SimulationFact } from './types';

export interface ChronicleFactLinks {
  sourceFactIds: string[];
  situationIds: string[];
}

/**
 * The projector only links presentation records to facts. It never mutates the
 * world and never creates a fact from prose, which keeps Chronicle filtering
 * outside the authoritative simulation path.
 */
export function projectFactLinks(
  facts: readonly SimulationFact[] | SimulationFact,
  situationIds: readonly string[] = [],
): ChronicleFactLinks {
  const list = Array.isArray(facts) ? facts : [facts];
  return {
    sourceFactIds: [...new Set(list.map((fact) => fact.id))],
    situationIds: [...new Set(situationIds)],
  };
}
