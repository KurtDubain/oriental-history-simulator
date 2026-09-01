import { stableCompare, stableHash } from '../random';
import {
  clampMilitaryValue as clamp,
  markLawfulCommandTransfer,
  militaryAllegianceStrength as allegianceStrength,
  militaryRetinueFor as retinueFor,
  refreshMilitaryRetinues as refreshRetinues,
  syncArmyPersonnelLocations,
} from './authority-core';
import type {
  ArmyOrderState,
  ArmyState,
  MilitaryStateProvenance,
  WorldState,
} from '../types';

type ArmyMilitarySeed = Pick<
  ArmyState,
  'id' | 'polityId' | 'commanderId' | 'deputyCommanderId' | 'regionId' | 'soldiers' | 'morale'
>;

export type ArmyMilitaryFields = Pick<ArmyState, 'allegiance' | 'retinues' | 'order'>;

function initialOrder(
  army: ArmyMilitarySeed,
  turn: number,
  provenance: MilitaryStateProvenance,
): ArmyOrderState {
  return {
    kind: 'hold',
    warId: null,
    issuerId: army.commanderId,
    issuedTurn: turn,
    lastReviewedTurn: turn,
    targetRegionId: army.regionId,
    targetArmyId: null,
    status: 'active',
    reasonCode: 'peace_garrison',
    provenance,
    sourceFactId: null,
  };
}

export function createArmyMilitaryFields(
  world: WorldState,
  army: ArmyMilitarySeed,
  provenance: MilitaryStateProvenance = 'opening',
): ArmyMilitaryFields {
  const commanderRetinue = retinueFor(world, army, army.commanderId, 'commander', world.turn, null);
  return {
    allegiance: {
      characterId: army.commanderId,
      strength: allegianceStrength(world, army, army.commanderId),
      sinceTurn: world.turn,
      provenance,
      sourceFactId: null,
    },
    retinues: commanderRetinue ? [commanderRetinue] : [],
    order: initialOrder(army, world.turn, provenance),
  };
}

export function creditBattleCommandRenown(world: WorldState, army: ArmyState, gain: number): void {
  const lawful = world.characters.find((character) => character.id === army.commanderId && character.alive);
  const actual = world.characters.find((character) => character.id === army.allegiance.characterId && character.alive);
  if (!lawful && !actual) return;
  if (!lawful || !actual || lawful.id === actual.id) {
    const credited = actual ?? lawful;
    if (credited) credited.renown = clamp(credited.renown + gain);
    return;
  }
  const lawfulGain = Math.round(gain * 0.35);
  lawful.renown = clamp(lawful.renown + lawfulGain);
  actual.renown = clamp(actual.renown + gain - lawfulGain);
}

export function refreshArmyMilitaryAuthority(
  world: WorldState,
  army: ArmyState,
  sourceFactId: string | null = null,
): void {
  refreshRetinues(world, army, sourceFactId);
  const eligibleIds = new Set([
    army.commanderId,
    army.deputyCommanderId,
    ...army.retinues.map((retinue) => retinue.ownerId),
  ].filter((id): id is string => Boolean(id)));
  const allegiance = world.characters.find((character) => (
    character.id === army.allegiance.characterId
    && character.alive
    && character.polityId === army.polityId
  ));
  if (!allegiance || !eligibleIds.has(allegiance.id)) {
    army.allegiance = {
      characterId: army.commanderId,
      strength: allegianceStrength(world, army, army.commanderId),
      sinceTurn: world.turn,
      provenance: sourceFactId ? 'fact' : 'system',
      sourceFactId,
    };
  } else {
    army.allegiance.strength = clamp(army.allegiance.strength);
    if (sourceFactId && army.allegiance.provenance === 'system') {
      army.allegiance.provenance = 'fact';
      army.allegiance.sourceFactId = sourceFactId;
    }
  }
  syncArmyPersonnelLocations(world, army);
}

export function refreshAllArmyMilitaryAuthority(
  world: WorldState,
  sourceFactIdsByArmyId: Readonly<Record<string, string>> = {},
): void {
  for (const army of [...world.armies].sort((left, right) => stableCompare(left.id, right.id))) {
    refreshArmyMilitaryAuthority(world, army, sourceFactIdsByArmyId[army.id] ?? null);
  }
}

export function migrateArmyMilitaryState(world: WorldState): boolean {
  let migrated = false;
  for (const army of world.armies) {
    const raw = army as ArmyState & Partial<ArmyMilitaryFields>;
    const hadOrder = Boolean(raw.order);
    if (!raw.allegiance || !Array.isArray(raw.retinues) || !raw.order) {
      const fields = createArmyMilitaryFields(world, army, 'legacy');
      raw.allegiance ??= fields.allegiance;
      raw.retinues = Array.isArray(raw.retinues) ? raw.retinues : fields.retinues;
      raw.order ??= fields.order;
      migrated = true;
    }
    const operation = !hadOrder && army.embarkedOperationId
      ? world.navalOperations.find((item) => (
          item.id === army.embarkedOperationId && item.stage !== '完成' && item.stage !== '失败'
        ))
      : null;
    if (operation) {
      army.order = {
        ...army.order,
        kind: 'advance',
        warId: operation.warId,
        targetRegionId: operation.targetRegionId,
        targetArmyId: null,
        status: 'active',
        reasonCode: 'amphibious_landing',
      };
    }
    const trackedCharacterIds = new Set([
      army.commanderId,
      army.deputyCommanderId,
      army.allegiance.characterId,
      ...army.retinues.map((retinue) => retinue.ownerId),
    ].filter((id): id is string => Boolean(id)));
    const snapshot = () => ({
      allegiance: army.allegiance,
      retinues: army.retinues,
      locations: world.characters
        .filter((character) => trackedCharacterIds.has(character.id))
        .map((character) => [character.id, character.locationRegionId] as const)
        .sort(([left], [right]) => stableCompare(left, right)),
    });
    const before = stableHash(snapshot());
    refreshArmyMilitaryAuthority(world, army);
    if (stableHash(snapshot()) !== before) migrated = true;
  }
  return migrated;
}

export { markLawfulCommandTransfer, syncArmyPersonnelLocations };
