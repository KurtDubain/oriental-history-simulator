import type { CharacterState, InvariantViolation, PolityState, WorldState } from './types';

/** Family names and branch IDs do not erase recorded parentage. No cousin inference. */
export function closeKin(world: Pick<WorldState, 'characters'>, a: CharacterState, b: CharacterState): boolean {
  const ancestors = (p: CharacterState) => [...p.parentIds,
    ...p.parentIds.flatMap(id => world.characters.find(c => c.id === id)?.parentIds ?? [])];
  return a.id === b.id || a.parentIds.some(id => b.parentIds.includes(id))
    || ancestors(a).includes(b.id) || ancestors(b).includes(a.id);
}

/** Existing biological-birth ages, assigned to the actual mother/father, not spouse order. */
export function biologicalParents(a: CharacterState, b: CharacterState): boolean {
  return a.sex !== b.sex && [a,b].every(p => p.alive && p.age >= 18 && p.age <= (p.sex === '女' ? 44 : 55));
}

export function validateLineage(world: WorldState, person: CharacterState): InvariantViolation[] {
  const errors: InvariantViolation[] = [];
  const add = (code: string, message: string) => errors.push({ code, message, entityId: person.id });
  for (const id of person.spouseIds) {
    const spouse = world.characters.find(p => p.id === id);
    if (spouse && closeKin(world, person, spouse)) add('character.spouse-kin', `${person.name}配偶为可确认的近亲`);
  }
  if (person.parentIds.length === 2 && person.birthTurn >= 0) {
    const parents = person.parentIds.map(id => world.characters.find(p => p.id === id));
    if (parents.every((p): p is CharacterState => Boolean(p))) {
      const atBirth = parents.map(p => ({ ...p, alive: p.deathTurn === null || p.deathTurn >= person.birthTurn,
        age: p.age - (Math.floor(((p.deathTurn ?? world.turn - 1) + 1) / 4) - Math.floor((person.birthTurn + 1) / 4)) }));
      if (!biologicalParents(atBirth[0], atBirth[1]) || closeKin(world, parents[0], parents[1])) {
        add('character.birth-parents', `${person.name}双亲不具生育资格`);
      }
    }
  }
  return errors;
}

export function continuesRulingLine(world: Pick<WorldState, 'families' | 'characters' | 'polities'>, polity: PolityState, successor: CharacterState): boolean {
  const ruling = world.families.find(f => f.id === polity.rulingFamilyId);
  if (!ruling) return false;
  if (ruling.id === successor.familyId) return true;
  const path = (id: string) => {
    const ids = new Set<string>();
    while (id && !ids.has(id)) { ids.add(id); id = world.families.find(f => f.id === id)?.parentFamilyId ?? ''; }
    return ids;
  };
  const candidate = path(successor.familyId), dynasty = path(ruling.id);
  // Another polity's established ruling branch is not merely a local family division.
  if (world.polities.some(p => p.id !== polity.id && p.rulingFamilyId && candidate.has(p.rulingFamilyId))) return false;
  if (![...candidate].some(id => dynasty.has(id))) return false;
  if (candidate.has(ruling.id)) return true;
  // Children born before the founder changed branch can remain in the source family.
  const pending = [...successor.parentIds], seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === ruling.founderId) return true;
    if (!seen.has(id)) { seen.add(id); pending.push(...(world.characters.find(p => p.id === id)?.parentIds ?? [])); }
  }
  return false;
}
