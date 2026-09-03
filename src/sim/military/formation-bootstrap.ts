import { keyedInt, stableCompare } from '../random';
import type { ArmyState, PolityState, RegionState, WorldState } from '../types';
import { createArmyMilitaryFields, selectOpeningArmyDeputy } from './authority';
import { attachPersonalForces, personalForce } from './personal-forces';

function borderRegionFor(world: WorldState, polityId: string, ordinal: number): RegionState {
  const owned = world.regions.filter((region) => region.controllerId === polityId);
  const border = owned
    .filter((region) => region.neighbors.some((neighborId) => (
      world.regions.find((item) => item.id === neighborId)?.controllerId !== polityId
    )))
    .sort((left, right) => right.strategicValue - left.strategicValue || stableCompare(left.id, right.id));
  return border[ordinal % Math.max(1, border.length)] ?? owned[ordinal % owned.length] as RegionState;
}

export function desiredFieldFormationCount(world: WorldState, polity: PolityState): number {
  const openingGarrisons = Math.max(1, Math.ceil((polity.controlledRegionIds.length
    + keyedInt(world.seed, 0, 6, 'opening', 'formation-count', polity.id)) / 7));
  const activeWars = world.wars.filter((war) => war.active
    && (war.attackerId === polity.id || war.defenderId === polity.id));
  if (activeWars.length === 0) return openingGarrisons;
  const fronts = new Set(activeWars.flatMap((war) => war.targetRegionIds));
  return Math.max(openingGarrisons, activeWars.length + Math.max(1, Math.ceil(fronts.size / 2)));
}

export function formationStagingRegions(world: WorldState, polity: PolityState): RegionState[] {
  const enemyIds = new Set(world.wars
    .filter((war) => war.active && (war.attackerId === polity.id || war.defenderId === polity.id))
    .map((war) => war.attackerId === polity.id ? war.defenderId : war.attackerId));
  return world.regions
    .filter((region) => region.controllerId === polity.id)
    .sort((left, right) => (
      Number(right.neighbors.some((id) => enemyIds.has(world.regions.find((item) => item.id === id)?.controllerId ?? '')))
      - Number(left.neighbors.some((id) => enemyIds.has(world.regions.find((item) => item.id === id)?.controllerId ?? '')))
      || right.strategicValue - left.strategicValue
      || right.population - left.population
      || stableCompare(left.id, right.id)
    ));
}

/** Forms variable opening field commands from the people and frontiers that actually exist. */
export function createInitialFormations(world: WorldState): void {
  for (const polity of world.polities.sort((left, right) => stableCompare(left.id, right.id))) {
    const commanders = world.characters
      .filter((character) => character.polityId === polity.id && personalForce(world, character.id))
      .sort((left, right) => (
        Number(right.role === '将领') - Number(left.role === '将领')
        || right.leadership - left.leadership
        || stableCompare(left.id, right.id)
      ));
    const formationCount = desiredFieldFormationCount(world, polity);
    const openingLeaders = commanders.slice(0, formationCount);
    const assignedParticipants = new Set<string>();
    for (let index = 0; index < formationCount; index += 1) {
      const commander = openingLeaders[index];
      if (!commander) break;
      const region = index === 0
        ? world.regions.find((item) => item.id === polity.capitalRegionId) as RegionState
        : borderRegionFor(world, polity.id, index);
      const deputy = selectOpeningArmyDeputy(world, polity.id, openingLeaders, assignedParticipants, commander);
      const participantIds = [commander, ...(deputy ? [deputy] : []), ...commanders
        .filter((candidate) => !openingLeaders.includes(candidate)
          && !assignedParticipants.has(candidate.id)
          && candidate.id !== deputy?.id
          && candidate.id !== polity.rulerId)
        .sort((left, right) => Number(right.locationRegionId === region.id) - Number(left.locationRegionId === region.id)
          || right.leadership + right.loyalty - left.leadership - left.loyalty
          || stableCompare(left.id, right.id))]
        .slice(0, 3)
        .map((candidate) => candidate.id);
      participantIds.forEach((id) => assignedParticipants.add(id));
      world.counters.army += 1;
      const armyId = `a_${String(world.counters.army).padStart(3, '0')}`;
      const morale = keyedInt(world.seed, 58, 78, 'initial', 'army', polity.id, index, 'morale');
      const army: ArmyState = {
        id: armyId,
        name: `${region.name}${index === 0 ? '中军' : '行营'}`,
        polityId: polity.id,
        commanderId: commander.id,
        deputyCommanderId: deputy?.id ?? null,
        participantIds,
        regionId: region.id,
        originRegionId: region.id,
        soldiers: 0,
        morale,
        training: keyedInt(world.seed, 42, 70, 'initial', 'army', polity.id, index, 'training'),
        experience: keyedInt(world.seed, 10, 35, 'initial', 'army', polity.id, index, 'experience'),
        supply: 100,
        food: 0,
        lastMovedTurn: -1,
        recentMovement: null,
        embarkedOperationId: null,
        ...createArmyMilitaryFields(world, {
          id: armyId,
          polityId: polity.id,
          commanderId: commander.id,
          deputyCommanderId: deputy?.id ?? null,
          regionId: region.id,
          soldiers: 0,
          morale,
        }),
      };
      attachPersonalForces(world, army, participantIds, '驻留');
      army.food = Math.min(region.food, army.soldiers * 2);
      region.food -= army.food;
      commander.commandingArmyId = army.id;
      commander.governedRegionId = null;
      commander.locationRegionId = region.id;
      if (deputy) deputy.governedRegionId = null;
      for (const participantId of participantIds) {
        const participant = world.characters.find((character) => character.id === participantId);
        if (participant) participant.locationRegionId = region.id;
      }
      world.armies.push(army);
    }
  }
}
