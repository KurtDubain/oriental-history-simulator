import type { CharacterState, WorldState } from './types';
import { demobilizePersonalForce, personalForce } from './military/personal-forces';

export interface CharacterDeathSettlement {
  character: CharacterState;
  role: CharacterState['role'];
  locationRegionId: string;
  diseaseId: string | null;
  forceBefore: number;
  forceRegionId: string | null;
  forceRegionPopulationBefore: number | null;
  demobilized: number;
}

/** The only state-clearing entry for natural, disease and battle deaths. */
export function settleCharacterDeathState(
  world: WorldState,
  characterId: string,
  turn: number,
): CharacterDeathSettlement | null {
  const character = world.characters.find((item) => item.id === characterId);
  if (!character?.alive) return null;
  const force = personalForce(world, character.id);
  const forceBefore = force?.soldiers ?? 0;
  const forceRegion = world.regions.find((region) => region.id === character.locationRegionId)
    ?? world.regions.find((region) => region.id === force?.homeRegionId);
  const settlement: CharacterDeathSettlement = {
    character,
    role: character.role,
    locationRegionId: character.locationRegionId,
    diseaseId: character.activeDiseaseId,
    forceBefore,
    forceRegionId: forceRegion?.id ?? null,
    forceRegionPopulationBefore: forceRegion?.population ?? null,
    demobilized: 0,
  };

  settlement.demobilized = demobilizePersonalForce(world, character.id);
  character.alive = false;
  character.deathTurn = turn;
  character.lifeStage = '已故';
  character.activeDiseaseId = null;
  character.governedRegionId = null;
  if (character.commandingArmyId) {
    const army = world.armies.find((item) => item.id === character.commandingArmyId);
    if (army?.commanderId === character.id) army.commanderId = '';
    character.commandingArmyId = null;
  }
  if (character.commandingFleetId) {
    const fleet = world.fleets.find((item) => item.id === character.commandingFleetId);
    if (fleet?.commanderId === character.id) fleet.commanderId = '';
    character.commandingFleetId = null;
  }
  for (const army of world.armies) {
    if (army.deputyCommanderId === character.id) army.deputyCommanderId = null;
    if (army.allegiance.characterId === character.id) {
      army.allegiance = {
        characterId: army.commanderId,
        strength: Math.max(0, Math.min(100, Math.round((army.morale + 50) / 2))),
        sinceTurn: turn,
        provenance: 'system',
        sourceFactId: null,
      };
    }
  }
  const polity = world.polities.find((item) => item.id === character.polityId);
  if (polity?.rulerId === character.id) polity.rulerId = '';
  return settlement;
}
