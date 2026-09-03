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

interface AuthorityArmy {
  id: string;
  polityId: string;
  commanderId: string;
  deputyCommanderId: string | null;
  regionId: string;
  soldiers: number;
  morale: number;
  participantIds: string[];
  allegiance: {
    characterId: string;
    strength: number;
    sinceTurn: number;
    provenance: 'opening' | 'legacy' | 'system' | 'fact';
    sourceFactId: string | null;
  };
}

interface AuthorityWorld {
  turn: number;
  characters: AuthorityCharacter[];
  personalForces: Array<{
    ownerId: string;
    formationId: string | null;
    status: '驻留' | '集结' | '出征' | '交战' | '撤退';
  }>;
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

export function syncArmyPersonnelLocations(world: AuthorityWorld, army: AuthorityArmy): void {
  const ids = new Set([
    ...army.participantIds,
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
  if (!army.participantIds.includes(army.commanderId)) {
    const force = world.personalForces.find((item) => item.ownerId === army.commanderId);
    if (force && (force.formationId === null || force.formationId === army.id)) {
      army.participantIds.push(army.commanderId);
      force.formationId = army.id;
      force.status = army.regionId ? '出征' : '集结';
    }
  }
  const priorStillAttached = army.commanderId === priorAllegiance.characterId
    || army.deputyCommanderId === priorAllegiance.characterId
    || army.participantIds.includes(priorAllegiance.characterId);
  const priorOwner = world.characters.find((character) => (
    character.id === priorAllegiance.characterId
    && character.alive
    && character.polityId === army.polityId
  ));
  const previousStillAttached = army.deputyCommanderId === previousCommanderId
    || army.participantIds.includes(previousCommanderId);
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
