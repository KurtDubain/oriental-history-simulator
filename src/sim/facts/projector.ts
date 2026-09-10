import type { SimulationFact } from './types';

/** Same-quarter evidence only; a new address is not a new tenure. */
export function isContinuousAppointment(fact: SimulationFact, context: readonly SimulationFact[]): boolean {
  if (fact.kind !== 'appointment_started' && fact.kind !== 'appointment_ended') return false;
  const seat = fact.payload;
  let paired = false;
  for (const other of context) {
    if (other.turn !== fact.turn) continue;
    if (other.kind === 'character_death' && other.payload.characterId === seat.holderId) return false;
    if (other.stateDeltas.some(d => d.entityType === 'polity' && d.entityId === seat.polityId
      && (d.field === 'alive' && d.after === false || d.field === 'rulerId' && d.before !== d.after))) return false;
    if (other.kind === 'court_action_resolved' && other.payload.polityId === seat.polityId
      && ['coup', 'usurpation'].includes(other.payload.action)) return false;
    if ((other.kind !== 'appointment_started' && other.kind !== 'appointment_ended')
      || other.payload.officeKind !== seat.officeKind || other.payload.polityId !== seat.polityId) continue;
    if (other.kind === 'appointment_started' && other.payload.holderId !== seat.holderId
      && (seat.officeKind === '君主' || other.payload.regionId === seat.regionId)) return false;
    if (other.payload.holderId === seat.holderId) {
      if (seat.officeKind !== '君主' && (other.sourceFactIds.length !== fact.sourceFactIds.length
        || other.sourceFactIds.some(id => !fact.sourceFactIds.includes(id)))) return false;
      if (other.kind !== fact.kind && other.payload.regionId !== seat.regionId
        && (seat.officeKind === '君主' || other.payload.regionId && seat.regionId
          && other.payload.armyId === seat.armyId && other.payload.fleetId === seat.fleetId)) paired = true;
    }
  }
  return paired;
}

/** Batch callers already hold these facts; group once, never decode history per label. */
export function continuousAppointmentIds(facts: readonly SimulationFact[]): Set<string> {
  const turns = new Map<number, SimulationFact[]>();
  for (const fact of facts) {
    const rows = turns.get(fact.turn) ?? []; rows.push(fact); turns.set(fact.turn, rows);
  }
  return new Set(facts.filter(f => isContinuousAppointment(f, turns.get(f.turn)!)).map(f => f.id));
}

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
