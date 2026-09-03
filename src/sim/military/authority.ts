import { stableCompare, stableHash } from '../random';
import {
  clampMilitaryValue as clamp,
  markLawfulCommandTransfer,
  militaryAllegianceStrength as allegianceStrength,
  syncArmyPersonnelLocations,
} from './authority-core';
import type {
  ArmyOrderKind,
  ArmyOrderState,
  ArmyState,
  CharacterState,
  MilitaryStateProvenance,
  WorldState,
} from '../types';

type ArmyMilitarySeed = Pick<
  ArmyState,
  'id' | 'polityId' | 'commanderId' | 'deputyCommanderId' | 'regionId' | 'soldiers' | 'morale'
>;

export type ArmyMilitaryFields = Pick<ArmyState, 'allegiance' | 'order'>;

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
  return {
    allegiance: {
      characterId: army.commanderId,
      strength: allegianceStrength(world, army, army.commanderId),
      sinceTurn: world.turn,
      provenance,
      sourceFactId: null,
    },
    order: initialOrder(army, world.turn, provenance),
  };
}

export function selectOpeningArmyDeputy(
  world: WorldState,
  polityId: string,
  commanders: readonly CharacterState[],
  assignedIds: ReadonlySet<string>,
  commander: CharacterState,
): CharacterState | null {
  return world.characters
    .filter((character) => (
      character.alive
      && character.age >= 16
      && character.polityId === polityId
      && character.id !== world.polities.find((polity) => polity.id === polityId)?.rulerId
      && character.id !== commander.id
      && !character.governedRegionId
      && !commanders.some((candidate) => candidate.id === character.id)
      && !assignedIds.has(character.id)
      && world.personalForces.some((force) => force.ownerId === character.id && force.formationId === null && force.soldiers > 0)
    ))
    .sort((left, right) => (
      right.leadership + right.loyalty * 0.45 - (left.leadership + left.loyalty * 0.45)
      || stableCompare(left.id, right.id)
    ))[0] ?? null;
}

export function recordArmyMovement(
  army: ArmyState,
  fromRegionId: string,
  toRegionId: string,
  turn: number,
  orderKind: ArmyOrderKind = army.order.kind,
  warId: string | null = army.order.warId,
): void {
  army.recentMovement = { fromRegionId, toRegionId, turn, orderKind, warId };
  army.lastMovedTurn = turn;
}

export function creditBattleCommandStanding(world: WorldState, army: ArmyState, gain: number): void {
  const lawful = world.characters.find((character) => character.id === army.commanderId && character.alive);
  const actual = world.characters.find((character) => character.id === army.allegiance.characterId && character.alive);
  if (!lawful && !actual) return;
  if (!lawful || !actual || lawful.id === actual.id) {
    const credited = actual ?? lawful;
    if (credited) {
      credited.renown = clamp(credited.renown + gain);
      credited.merit = clamp(credited.merit + Math.max(1, Math.round(gain * 0.8)));
    }
    return;
  }
  const lawfulGain = Math.round(gain * 0.35);
  lawful.renown = clamp(lawful.renown + lawfulGain);
  lawful.merit = clamp(lawful.merit + Math.max(1, Math.round(lawfulGain * 0.8)));
  actual.renown = clamp(actual.renown + gain - lawfulGain);
  actual.merit = clamp(actual.merit + Math.max(1, Math.round((gain - lawfulGain) * 0.8)));
}

export function refreshArmyMilitaryAuthority(
  world: WorldState,
  army: ArmyState,
  sourceFactId: string | null = null,
): void {
  const eligibleIds = new Set([
    ...army.participantIds,
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
    const raw = army as ArmyState & Partial<ArmyMilitaryFields & Pick<ArmyState, 'recentMovement' | 'participantIds'>>;
    if (!Object.prototype.hasOwnProperty.call(raw, 'recentMovement')) {
      raw.recentMovement = null;
      migrated = true;
    }
    const hadOrder = Boolean(raw.order);
    if (!raw.allegiance || !raw.order) {
      const fields = createArmyMilitaryFields(world, army, 'legacy');
      raw.allegiance ??= fields.allegiance;
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
      ...(army.participantIds ?? []),
    ].filter((id): id is string => Boolean(id)));
    const snapshot = () => ({
      allegiance: army.allegiance,
      participantIds: army.participantIds,
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
