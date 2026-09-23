import type { CharacterState, InvariantViolation, PolityState, WorldState } from './types';
import { stableCompare } from './random';

/** Annexation is reception, not immediate authorization to hold an office. */
export function trustedForOffice(world: WorldState, polity: PolityState, person: CharacterState, authorizerId = polity.rulerId): boolean {
  const former = world.polities.find(p => !p.alive && p.rulerId === person.id);
  if (!former) return true;
  const support = world.relationships.some(r => r.sourceId === authorizerId && r.targetId === person.id
    && r.trust > r.grievance + 40 && r.gratitude > 0);
  return support || person.loyalty >= 45 && world.turn - (former.eliminatedTurn ?? world.turn) >= 8;
}

export function selectRegent(world: WorldState, polity: PolityState, authorizerId = polity.rulerId): CharacterState | undefined {
  const adults = world.characters.filter(p => p.alive && p.age >= 16 && p.polityId === polity.id
    && p.id !== polity.rulerId && trustedForOffice(world, polity, p, authorizerId));
  const office = world.offices.find(o => o.active && o.polityId === polity.id && o.kind === '宰辅');
  const score = (p: CharacterState) => p.governance + p.cunning + p.loyalty + p.influence;
  return adults.find(p => p.id === office?.holderId) ?? adults.sort((a, b) =>
    score(b) - score(a)
    || stableCompare(a.id, b.id))[0];
}

/** One read-only ranking for execution and prediction. No promotion or random draws. */
export function lineageLegitimacy(candidate: CharacterState, ruler: CharacterState | undefined, familyId: string | null): number {
  if (!ruler) return candidate.familyId === familyId ? 42 : 0;
  if (candidate.parentIds.includes(ruler.id)) return 100;
  if (candidate.spouseIds.includes(ruler.id)) return 72;
  if (candidate.parentIds.some(id => ruler.parentIds.includes(id))) return 64;
  return candidate.familyId === familyId ? 46 : 0;
}

export function successionPlan(world: WorldState, polity: PolityState, ruler?: CharacterState) {
  const occupied = new Set(world.polities.filter(p => p.alive && p.rulerId).map(p => p.rulerId));
  const claims = world.characters.filter(p => p.alive && p.polityId === polity.id && !occupied.has(p.id))
    .map(character => {
      const lineage = lineageLegitimacy(character, ruler, polity.rulingFamilyId);
      const factionSupport = world.factions.filter(f => f.active && f.polityId === polity.id && f.memberIds.includes(character.id))
        .reduce((sum, f) => sum + f.power * .22, 0);
      const officeSupport = world.offices.filter(o => o.active && o.polityId === polity.id && o.holderId === character.id)
        .reduce((sum, o) => sum + o.rank * .14, 0);
      const familySupport = world.families.find(f => f.id === character.familyId)?.prestige ?? 0;
      const institutionalSupport = factionSupport + officeSupport + familySupport * .18
        + (character.commandingArmyId || character.commandingFleetId ? 24 : 0);
      const successionScore = lineage * .46 + institutionalSupport * .34
        + character.governance * .08 + character.cunning * .06 + character.renown * .04 + character.loyalty * .02;
      return { character, lineageLegitimacy: lineage, factionSupport, officeSupport, familySupport, institutionalSupport, successionScore };
    }).sort((a, b) => b.successionScore - a.successionScore || stableCompare(a.character.id, b.character.id));
  const minors = claims.filter(c => c.character.age < 16 && c.lineageLegitimacy >= 46);
  // Predict the vacancy, not a new appointment authorized by the outgoing ruler.
  const regent = minors.length ? selectRegent(world, polity, '') : undefined;
  const eligible = claims.filter(c => c.character.age >= 16 || regent && minors.includes(c));
  // A registered adult may support the existing emergency promotion path only
  // when the normal named pool cannot choose a successor.
  if (!eligible.length && world.backgroundPeople.some(p => p.polityId === polity.id
    && p.promotedCharacterId === null && Math.floor((world.turn - p.birthTurn) / 4) >= 16
    && Math.floor((world.turn - p.birthTurn) / 4) <= 75)) eligible.push(...minors);
  return { claims, minors, regent, eligible, successor: eligible[0] };
}

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
