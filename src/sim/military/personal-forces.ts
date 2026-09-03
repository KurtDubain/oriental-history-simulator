import { keyedInt, stableCompare } from '../random';
import type {
  ArmyState,
  CharacterState,
  PersonalForceState,
  PersonalForceStatus,
  RegionState,
  WorldState,
} from '../types';

interface LegacyRetinue {
  ownerId: string;
  soldiers: number;
}

interface LegacyArmy extends Omit<ArmyState, 'participantIds'> {
  participantIds?: string[];
  retinues?: LegacyRetinue[];
}

export interface PersonalForceLoss {
  characterId: string;
  soldiersBefore: number;
  soldiersAfter: number;
  losses: number;
}

function eligibleOwner(world: Pick<WorldState, 'characters' | 'polities'>, character: CharacterState): boolean {
  return character.alive && (character.age >= 16 || world.polities.some((polity) => polity.alive
    && polity.rulerId === character.id));
}

function homeRegion(world: Pick<WorldState, 'polities' | 'regions'>, character: CharacterState): RegionState | undefined {
  return world.regions.find((region) => region.id === character.governedRegionId)
    ?? world.regions.find((region) => region.id === character.locationRegionId)
    ?? world.regions.find((region) => region.id === world.polities.find((polity) => polity.id === character.polityId)?.capitalRegionId)
    ?? world.regions.find((region) => region.controllerId === character.polityId);
}

function integerAllocation<T>(
  items: readonly T[],
  total: number,
  weightOf: (item: T) => number,
  idOf: (item: T) => string,
): Map<string, number> {
  if (items.length === 0 || total <= 0) return new Map();
  const ordered = [...items].sort((left, right) => stableCompare(idOf(left), idOf(right)));
  const weights = ordered.map((item) => Math.max(0, weightOf(item)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || ordered.length;
  const shares = ordered.map((item, index) => {
    const exact = total * (weights[index] || 1) / weightTotal;
    return { id: idOf(item), amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remainder = total - shares.reduce((sum, share) => sum + share.amount, 0);
  shares.sort((left, right) => right.remainder - left.remainder || stableCompare(left.id, right.id));
  for (let index = 0; index < remainder; index += 1) shares[index % shares.length]!.amount += 1;
  return new Map(shares.map((share) => [share.id, share.amount]));
}

function adjustRegionalDiseaseHosts(world: WorldState, regionId: string, delta: number): void {
  for (const state of world.infections.filter((item) => item.hostKind === 'region' && item.hostId === regionId)) {
    if (delta >= 0) {
      state.susceptible += delta;
      continue;
    }
    let remaining = -delta;
    for (const key of ['susceptible', 'exposed', 'infectious', 'recovered'] as const) {
      const removed = Math.min(remaining, state[key]);
      state[key] -= removed;
      remaining -= removed;
      if (remaining === 0) break;
    }
  }
}

function withdrawPopulation(world: WorldState, character: CharacterState, requested: number): number {
  let remaining = requested;
  const preferred = homeRegion(world, character);
  const regions = world.regions
    .filter((region) => region.controllerId === character.polityId)
    .sort((left, right) => (
      Number(right.id === preferred?.id) - Number(left.id === preferred?.id)
      || right.population - left.population
      || stableCompare(left.id, right.id)
    ));
  for (const region of regions) {
    const available = Math.max(0, Math.floor(region.population * 0.08));
    const taken = Math.min(remaining, available);
    region.population -= taken;
    adjustRegionalDiseaseHosts(world, region.id, -taken);
    remaining -= taken;
    if (remaining === 0) break;
  }
  return requested - remaining;
}

function initialWeight(character: CharacterState): number {
  const roleWeight = character.role === '将领' ? 8
    : character.role === '君主' ? 6
      : character.role === '地方长官' ? 4
        : 2;
  return roleWeight * 100 + character.leadership * 3 + character.influence + character.renown;
}

export function createInitialPersonalForces(world: WorldState): void {
  world.personalForces = [];
  for (const polity of [...world.polities].sort((left, right) => stableCompare(left.id, right.id))) {
    const owners = world.characters
      .filter((character) => character.polityId === polity.id && eligibleOwner(world, character))
      .sort((left, right) => stableCompare(left.id, right.id));
    const civilianPopulation = world.regions
      .filter((region) => region.controllerId === polity.id)
      .reduce((sum, region) => sum + region.population, 0);
    const target = Math.min(
      Math.floor(civilianPopulation * 0.08),
      Math.max(owners.length * 45, Math.floor(civilianPopulation * 0.012)),
    );
    const shares = integerAllocation(owners, target, initialWeight, (character) => character.id);
    for (const owner of owners) {
      const requested = shares.get(owner.id) ?? 0;
      const soldiers = withdrawPopulation(world, owner, requested);
      const home = homeRegion(world, owner);
      if (!home || soldiers <= 0) continue;
      world.personalForces.push({
        ownerId: owner.id,
        soldiers,
        cohesion: keyedInt(world.seed, 42, 78, 'personal-force', owner.id, 'cohesion'),
        readiness: keyedInt(world.seed, 38, 74, 'personal-force', owner.id, 'readiness'),
        homeRegionId: home.id,
        formationId: null,
        status: '驻留',
      });
    }
  }
  world.personalForces.sort((left, right) => stableCompare(left.ownerId, right.ownerId));
}

export function personalForce(world: Pick<WorldState, 'personalForces'>, ownerId: string): PersonalForceState | undefined {
  return world.personalForces.find((force) => force.ownerId === ownerId);
}

export function formationForces(
  world: Pick<WorldState, 'personalForces'>,
  army: Pick<ArmyState, 'id' | 'participantIds'>,
): PersonalForceState[] {
  const participants = new Set(army.participantIds);
  return world.personalForces
    .filter((force) => force.formationId === army.id && participants.has(force.ownerId))
    .sort((left, right) => stableCompare(left.ownerId, right.ownerId));
}

export function syncFormationStrength(world: WorldState, army: ArmyState): number {
  const valid = formationForces(world, army);
  for (const force of valid) {
    if (force.soldiers > 0) continue;
    force.formationId = null;
    force.status = '驻留';
  }
  const validIds = new Set(valid.filter((force) => force.soldiers > 0).map((force) => force.ownerId));
  army.participantIds = army.participantIds.filter((id, index, ids) => validIds.has(id) && ids.indexOf(id) === index);
  army.soldiers = valid.reduce((sum, force) => sum + force.soldiers, 0);
  return army.soldiers;
}

export function syncAllFormationStrengths(world: WorldState): void {
  for (const army of world.armies) syncFormationStrength(world, army);
}

export function attachPersonalForces(
  world: WorldState,
  army: ArmyState,
  participantIds: readonly string[],
  status: PersonalForceStatus = '集结',
): void {
  const unique = [...new Set(participantIds)].filter((ownerId) => {
    const force = personalForce(world, ownerId);
    return force && (force.formationId === null || force.formationId === army.id) && force.soldiers > 0;
  });
  army.participantIds = unique;
  for (const ownerId of unique) {
    const force = personalForce(world, ownerId)!;
    force.formationId = army.id;
    force.status = status;
  }
  syncFormationStrength(world, army);
}

export function detachFormation(world: WorldState, army: ArmyState, status: PersonalForceStatus = '驻留'): void {
  for (const force of world.personalForces) {
    if (force.formationId !== army.id) continue;
    force.formationId = null;
    force.status = status;
  }
  army.participantIds = [];
  army.soldiers = 0;
}

export function detachPersonalForce(
  world: WorldState,
  ownerId: string,
  status: PersonalForceStatus = '驻留',
): void {
  const force = personalForce(world, ownerId);
  if (!force?.formationId) return;
  const army = world.armies.find((item) => item.id === force.formationId);
  force.formationId = null;
  force.status = status;
  if (!army) return;
  army.participantIds = army.participantIds.filter((id) => id !== ownerId);
  if (army.deputyCommanderId === ownerId) army.deputyCommanderId = null;
  if (army.allegiance.characterId === ownerId) {
    army.allegiance = {
      characterId: army.commanderId,
      strength: Math.max(0, Math.min(100, Math.round((army.morale + 50) / 2))),
      sinceTurn: world.turn,
      provenance: 'system',
      sourceFactId: null,
    };
  }
  syncFormationStrength(world, army);
}

export function setFormationStatus(world: WorldState, army: ArmyState, status: PersonalForceStatus): void {
  for (const force of formationForces(world, army)) force.status = status;
}

export function distributeFormationGain(world: WorldState, army: ArmyState, amount: number): number {
  const forces = formationForces(world, army);
  if (forces.length === 0 || amount <= 0) return 0;
  const shares = integerAllocation(forces, Math.floor(amount), (force) => Math.max(1, force.soldiers), (force) => force.ownerId);
  for (const force of forces) force.soldiers += shares.get(force.ownerId) ?? 0;
  syncFormationStrength(world, army);
  return amount;
}

export function applyFormationLosses(world: WorldState, armies: readonly ArmyState[], requested: number): PersonalForceLoss[] {
  const armyIds = new Set(armies.map((army) => army.id));
  const forces = world.personalForces
    .filter((force) => force.formationId && armyIds.has(force.formationId) && force.soldiers > 0)
    .sort((left, right) => stableCompare(left.ownerId, right.ownerId));
  const total = forces.reduce((sum, force) => sum + force.soldiers, 0);
  const casualties = Math.min(total, Math.max(0, Math.floor(requested)));
  const shares = integerAllocation(forces, casualties, (force) => force.soldiers, (force) => force.ownerId);
  const losses = forces.map((force) => {
    const before = force.soldiers;
    const loss = Math.min(before, shares.get(force.ownerId) ?? 0);
    force.soldiers -= loss;
    const lossRate = loss / Math.max(1, before);
    force.cohesion = Math.max(0, Math.round(force.cohesion - lossRate * 24));
    force.readiness = Math.max(0, Math.round(force.readiness - lossRate * 18));
    return { characterId: force.ownerId, soldiersBefore: before, soldiersAfter: force.soldiers, losses: loss };
  });
  for (const army of armies) syncFormationStrength(world, army);
  return losses;
}

export function demobilizePersonalForce(world: WorldState, ownerId: string): number {
  const force = personalForce(world, ownerId);
  if (!force) return 0;
  const owner = world.characters.find((character) => character.id === ownerId);
  const region = world.regions.find((item) => item.id === owner?.locationRegionId)
    ?? world.regions.find((item) => item.id === force.homeRegionId);
  if (!region) throw new Error(`Cannot settle personal force ${ownerId}`);
  const soldiers = force.soldiers;
  region.population += soldiers;
  adjustRegionalDiseaseHosts(world, region.id, soldiers);
  world.personalForces = world.personalForces.filter((item) => item.ownerId !== ownerId);
  for (const army of world.armies) {
    if (army.participantIds.includes(ownerId)) {
      army.participantIds = army.participantIds.filter((id) => id !== ownerId);
      syncFormationStrength(world, army);
    }
  }
  return soldiers;
}

export function ensureEligiblePersonalForces(world: WorldState): void {
  for (const force of [...world.personalForces]) {
    const owner = world.characters.find((character) => character.id === force.ownerId);
    if (!owner || !eligibleOwner(world, owner)) demobilizePersonalForce(world, force.ownerId);
  }
  for (const owner of world.characters.filter((character) => eligibleOwner(world, character)).sort((a, b) => stableCompare(a.id, b.id))) {
    if (personalForce(world, owner.id)) continue;
    const home = homeRegion(world, owner);
    if (!home) continue;
    const soldiers = withdrawPopulation(world, owner, Math.min(80, Math.max(1, Math.floor(home.population * 0.0004))));
    if (soldiers <= 0) continue;
    world.personalForces.push({
      ownerId: owner.id,
      soldiers,
      cohesion: Math.max(25, Math.min(85, Math.round((owner.loyalty + owner.leadership) / 2))),
      readiness: Math.max(20, Math.min(80, Math.round((owner.caution + owner.leadership) / 2))),
      homeRegionId: home.id,
      formationId: null,
      status: '驻留',
    });
  }
  world.personalForces.sort((left, right) => stableCompare(left.ownerId, right.ownerId));
}

export function migrateSchema4PersonalForces(world: WorldState): void {
  const legacyArmies = world.armies as LegacyArmy[];
  const total = legacyArmies.reduce((sum, army) => sum + Math.max(0, Math.floor(army.soldiers)), 0);
  const owners = world.characters
    .filter((character) => eligibleOwner(world, character))
    .sort((left, right) => stableCompare(left.id, right.id));
  const weight = (owner: CharacterState): number => {
    let result = 10 + initialWeight(owner) / 100;
    for (const army of legacyArmies) {
      if (army.commanderId === owner.id) result += 80;
      if (army.deputyCommanderId === owner.id) result += 45;
      if (army.allegiance?.characterId === owner.id) result += 60;
      result += (army.retinues ?? []).find((retinue) => retinue.ownerId === owner.id)?.soldiers ?? 0;
    }
    return result;
  };
  const minimum = total >= owners.length ? 1 : 0;
  const shares = integerAllocation(owners, total - minimum * owners.length, weight, (owner) => owner.id);
  world.personalForces = owners.flatMap((owner) => {
    const home = homeRegion(world, owner);
    const soldiers = minimum + (shares.get(owner.id) ?? 0);
    if (!home || soldiers <= 0) return [];
    return [{
      ownerId: owner.id,
      soldiers,
      cohesion: Math.max(25, Math.min(90, Math.round((owner.loyalty + owner.leadership) / 2))),
      readiness: Math.max(20, Math.min(90, Math.round((owner.caution + owner.leadership) / 2))),
      homeRegionId: home.id,
      formationId: null,
      status: '驻留' as const,
    }];
  });

  const preferredFormation = new Map<string, string>();
  for (const owner of owners) {
    const commanderArmy = legacyArmies.find((army) => army.commanderId === owner.id);
    const deputyArmy = legacyArmies.find((army) => army.deputyCommanderId === owner.id);
    const allegianceArmy = legacyArmies.find((army) => army.allegiance?.characterId === owner.id);
    const retinueArmy = legacyArmies.find((army) => (army.retinues ?? []).some((retinue) => retinue.ownerId === owner.id));
    const chosen = commanderArmy ?? deputyArmy ?? allegianceArmy ?? retinueArmy;
    if (chosen) preferredFormation.set(owner.id, chosen.id);
  }
  for (const army of legacyArmies.sort((left, right) => stableCompare(left.id, right.id))) {
    const candidates = [
      army.commanderId,
      army.deputyCommanderId,
      army.allegiance?.characterId,
      ...(army.retinues ?? []).map((retinue) => retinue.ownerId),
    ].filter((id): id is string => Boolean(id));
    const participantIds = [...new Set(candidates)].filter((id) => preferredFormation.get(id) === army.id && personalForce(world, id));
    if (!participantIds.includes(army.commanderId) && personalForce(world, army.commanderId)) {
      participantIds.unshift(army.commanderId);
    }
    if (army.deputyCommanderId && !participantIds.includes(army.deputyCommanderId)) army.deputyCommanderId = null;
    army.participantIds = participantIds;
    delete army.retinues;
    attachPersonalForces(world, army as ArmyState, participantIds, army.order?.warId ? '出征' : '驻留');
  }
  world.personalForces.sort((left, right) => stableCompare(left.ownerId, right.ownerId));
  ensureEligiblePersonalForces(world);
  syncAllFormationStrengths(world);
  for (const host of world.infections.filter((state) => state.hostKind === 'army')) {
    const target = world.armies.find((army) => army.id === host.hostId)?.soldiers ?? 0;
    const previous = host.susceptible + host.exposed + host.infectious + host.recovered;
    const scale = previous > 0 ? target / previous : 0;
    host.exposed = Math.floor(host.exposed * scale);
    host.infectious = Math.floor(host.infectious * scale);
    host.recovered = Math.floor(host.recovered * scale);
    host.susceptible = target - host.exposed - host.infectious - host.recovered;
  }
}
