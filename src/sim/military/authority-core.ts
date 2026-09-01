/**
 * Leaf-level military authority mutations. The structural contracts keep this
 * module independent from the aggregate WorldState type, so Agency can apply a
 * command transfer without creating a type-only cycle through sim/types.
 */
interface AuthorityCharacter {
  id: string;
  alive: boolean;
  polityId: string;
  leadership: number;
  renown: number;
  loyalty: number;
  caution: number;
  personalWealth: number;
  merit: number;
  locationRegionId: string;
}

interface AuthorityRetinue {
  ownerId: string;
  soldiers: number;
  cohesion: number;
  attachedTurn: number;
  sourceFactId: string | null;
}

interface AuthorityArmy {
  id: string;
  polityId: string;
  commanderId: string;
  deputyCommanderId: string | null;
  regionId: string;
  soldiers: number;
  morale: number;
  allegiance: {
    characterId: string;
    strength: number;
    sinceTurn: number;
    provenance: 'opening' | 'legacy' | 'system' | 'fact';
    sourceFactId: string | null;
  };
  retinues: AuthorityRetinue[];
}

interface AuthorityWorld {
  turn: number;
  characters: AuthorityCharacter[];
}

export const clampMilitaryValue = (value: number, minimum = 0, maximum = 100) => (
  Math.max(minimum, Math.min(maximum, Math.round(value)))
);

export function militaryAllegianceStrength(
  world: AuthorityWorld,
  army: Pick<AuthorityArmy, 'morale'>,
  ownerId: string,
): number {
  const owner = world.characters.find((character) => character.id === ownerId);
  return clampMilitaryValue(48 + army.morale * 0.18 + (owner?.leadership ?? 40) * 0.14
    + (owner?.renown ?? 20) * 0.1 + (owner?.loyalty ?? 50) * 0.08);
}

export function militaryRetinueFor(
  world: AuthorityWorld,
  army: Pick<AuthorityArmy, 'polityId' | 'soldiers'>,
  ownerId: string,
  role: 'commander' | 'deputy',
  attachedTurn: number,
  sourceFactId: string | null,
): AuthorityRetinue | null {
  const owner = world.characters.find((character) => character.id === ownerId && character.alive);
  if (!owner || owner.polityId !== army.polityId || army.soldiers <= 0) return null;
  const ratio = role === 'commander' ? 0.075 : 0.045;
  const personalCapacity = 45 + owner.personalWealth * 3 + owner.renown * 2 + owner.merit * 2;
  const soldiers = Math.max(1, Math.min(Math.floor(army.soldiers * ratio), Math.floor(personalCapacity)));
  return {
    ownerId,
    soldiers,
    cohesion: clampMilitaryValue(38 + owner.loyalty * 0.22 + owner.leadership * 0.18 + owner.caution * 0.12),
    attachedTurn,
    sourceFactId,
  };
}

export function refreshMilitaryRetinues(
  world: AuthorityWorld,
  army: AuthorityArmy,
  sourceFactId: string | null,
): void {
  const existing = new Map(army.retinues.map((retinue) => [retinue.ownerId, retinue]));
  const owners = [
    { id: army.commanderId, role: 'commander' as const },
    ...(army.deputyCommanderId ? [{ id: army.deputyCommanderId, role: 'deputy' as const }] : []),
  ].sort((left, right) => left.id === right.id ? 0 : left.id < right.id ? -1 : 1);
  army.retinues = owners.flatMap(({ id, role }) => {
    const previous = existing.get(id);
    const next = militaryRetinueFor(
      world,
      army,
      id,
      role,
      previous?.attachedTurn ?? world.turn,
      previous?.sourceFactId ?? sourceFactId,
    );
    if (!next) return [];
    return [{
      ...next,
      soldiers: Math.min(next.soldiers, previous?.soldiers ?? next.soldiers),
      cohesion: previous ? clampMilitaryValue(previous.cohesion) : next.cohesion,
    }];
  });
}

export function syncArmyPersonnelLocations(world: AuthorityWorld, army: AuthorityArmy): void {
  const ids = new Set([
    army.commanderId,
    army.deputyCommanderId,
    army.allegiance.characterId,
    ...army.retinues.map((retinue) => retinue.ownerId),
  ].filter((id): id is string => Boolean(id)));
  for (const id of ids) {
    const person = world.characters.find((character) => character.id === id && character.alive);
    if (person) person.locationRegionId = army.regionId;
  }
}

export function markLawfulCommandTransfer(
  world: AuthorityWorld,
  army: AuthorityArmy,
  previousCommanderId: string,
  sourceFactId: string,
): void {
  const priorAllegiance = { ...army.allegiance };
  refreshMilitaryRetinues(world, army, sourceFactId);
  const priorStillAttached = army.commanderId === priorAllegiance.characterId
    || army.deputyCommanderId === priorAllegiance.characterId
    || army.retinues.some((retinue) => retinue.ownerId === priorAllegiance.characterId);
  const priorOwner = world.characters.find((character) => (
    character.id === priorAllegiance.characterId
    && character.alive
    && character.polityId === army.polityId
  ));
  const previousStillAttached = army.deputyCommanderId === previousCommanderId
    || army.retinues.some((retinue) => retinue.ownerId === previousCommanderId);
  army.allegiance = priorStillAttached && priorOwner
    ? { ...priorAllegiance, provenance: 'fact', sourceFactId }
    : previousStillAttached
      ? {
          characterId: previousCommanderId,
          strength: clampMilitaryValue(Math.max(army.allegiance.strength, 62)),
          sinceTurn: army.allegiance.characterId === previousCommanderId
            ? army.allegiance.sinceTurn
            : world.turn,
          provenance: 'fact',
          sourceFactId,
        }
      : {
          characterId: army.commanderId,
          strength: militaryAllegianceStrength(world, army, army.commanderId),
          sinceTurn: world.turn,
          provenance: 'fact',
          sourceFactId,
        };
  syncArmyPersonnelLocations(world, army);
}
