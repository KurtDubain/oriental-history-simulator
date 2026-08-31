import { describe, expect, it } from 'vitest';
import {
  advanceWorldBy,
  createWorld,
  serializeWorld,
} from '../sim';
import { calculateFactionPowerLedger } from '../sim/politics/power-ledger';
import { projectCourt } from './court-projection';
import { toMapFleets, toMapMarkers } from './map-adapter';
import {
  POLITICAL_MAP_PROJECTION_LIMITS,
  projectCapitalPoliticalPulses,
  projectFactionSpatialPowerRoots,
  projectPoliticalMap,
} from './political-map-projection';

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function worldWithFactionRivalry(seed: string) {
  const world = advanceWorldBy(createWorld(seed), 8);
  const polity = world.polities.find((candidate) => (
    candidate.alive
    && world.factions.filter((faction) => faction.active && faction.polityId === candidate.id).length >= 2
  ));
  if (!polity) throw new Error('expected a living polity with at least two factions');
  return { world, polity };
}

describe('POL04/POL05 political map projection', () => {
  it('places roots only where a current faction member actually governs or commands', () => {
    const world = advanceWorldBy(createWorld('权力落在何处'), 8);
    const before = serializeWorld(world);
    const roots = projectFactionSpatialPowerRoots(world);

    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThanOrEqual(POLITICAL_MAP_PROJECTION_LIMITS.rootsPerWorld);
    expect(new Set(roots.map((root) => root.id)).size).toBe(roots.length);
    expect(roots.every((root) => [
      'regional_governance',
      'army_command',
      'fleet_command',
    ].includes(root.kind))).toBe(true);

    for (const root of roots) {
      const faction = world.factions.find((candidate) => (
        candidate.id === root.factionId && candidate.active
      ));
      const region = world.regions.find((candidate) => candidate.id === root.regionId);
      if (!faction || !region) throw new Error('root references must resolve');
      expect(root.assets.length).toBeLessThanOrEqual(POLITICAL_MAP_PROJECTION_LIMITS.assetsPerRoot);
      expect(root.assetCount).toBeGreaterThanOrEqual(root.assets.length);
      const ledger = calculateFactionPowerLedger(world, faction);
      const resources = root.assets.flatMap((asset) => (
        asset.ledgerResourceId
          ? ledger.resources.filter((resource) => resource.id === asset.ledgerResourceId)
          : []
      ));
      expect(root.powerContribution).toBe(rounded(resources.reduce((sum, resource) => sum + resource.value, 0)));
      expect(resources.every((resource) => (
        resource.category === 'regional_office' || resource.category === 'military_command'
      ))).toBe(true);

      for (const asset of root.assets) {
        const holder = world.characters.find((candidate) => candidate.id === asset.holderId);
        expect(holder).toMatchObject({ alive: true, factionId: faction.id, polityId: faction.polityId });
        if (asset.kind === 'governorship') {
          expect(root.kind).toBe('regional_governance');
          expect(asset.id).toBe(holder?.id);
          expect(holder?.governedRegionId).toBe(root.regionId);
          expect(region.controllerId).toBe(faction.polityId);
        } else if (asset.kind === 'army') {
          const army = world.armies.find((candidate) => candidate.id === asset.id);
          expect(root.kind).toBe('army_command');
          expect(army).toMatchObject({ commanderId: holder?.id, regionId: root.regionId });
          expect(holder?.commandingArmyId).toBe(army?.id);
        } else {
          const fleet = world.fleets.find((candidate) => candidate.id === asset.id);
          expect(root.kind).toBe('fleet_command');
          expect(fleet).toMatchObject({ commanderId: holder?.id, homePortRegionId: root.regionId });
          expect(holder?.commandingFleetId).toBe(fleet?.id);
        }
      }
    }
    for (const factionId of new Set(roots.map((root) => root.factionId))) {
      expect(roots.filter((root) => root.factionId === factionId).length)
        .toBeLessThanOrEqual(POLITICAL_MAP_PROJECTION_LIMITS.rootsPerFaction);
    }
    expect(serializeWorld(world)).toBe(before);
  });

  it('does not turn central office, family wealth, renown, cohesion or legacy power into land', () => {
    const world = advanceWorldBy(createWorld('不把声势画成领地'), 4);
    const centralOffice = world.offices.find((office) => (
      office.active && ['君主', '宰辅', '枢密使', '廷臣'].includes(office.kind)
    ));
    const holder = world.characters.find((character) => character.id === centralOffice?.holderId);
    const faction = holder?.factionId
      ? world.factions.find((candidate) => candidate.id === holder.factionId && candidate.active)
      : null;
    if (!centralOffice || !holder || !faction) throw new Error('expected a faction-aligned central office holder');

    for (const character of world.characters) {
      if (character.factionId === faction.id) character.factionId = null;
    }
    holder.factionId = faction.id;
    holder.governedRegionId = null;
    holder.commandingArmyId = null;
    holder.commandingFleetId = null;
    holder.renown = 100;
    holder.influence = 100;
    faction.memberIds = [holder.id];
    faction.coreMemberIds = [holder.id];
    faction.leaderId = holder.id;
    faction.power = 100;
    faction.cohesion = 100;
    const family = world.families.find((candidate) => candidate.id === holder.familyId);
    if (family) {
      family.wealth = 999_999;
      family.prestige = 100;
      family.politicalInfluence = 100;
    }

    const ledger = calculateFactionPowerLedger(world, faction);
    expect(ledger.resources.some((resource) => resource.category === 'central_office')).toBe(true);
    expect(ledger.resources.some((resource) => resource.category === 'family_backing')).toBe(true);
    expect(ledger.total).toBeGreaterThan(0);
    expect(projectFactionSpatialPowerRoots(world, faction.id)).toEqual([]);
  });

  it('rejects stale governorships, empty armies and broken fleet command links', () => {
    const base = advanceWorldBy(createWorld('权力根基必须仍然在手'), 4);
    const initial = projectFactionSpatialPowerRoots(base);
    const governorship = initial
      .flatMap((root) => root.assets.map((asset) => ({ root, asset })))
      .find(({ asset }) => asset.kind === 'governorship');
    const armyCommand = initial
      .flatMap((root) => root.assets.map((asset) => ({ root, asset })))
      .find(({ asset }) => asset.kind === 'army');
    const fleetCommand = initial
      .flatMap((root) => root.assets.map((asset) => ({ root, asset })))
      .find(({ asset }) => asset.kind === 'fleet');
    if (!governorship || !armyCommand || !fleetCommand) throw new Error('expected all three concrete root kinds');

    const withoutOffice = structuredClone(base);
    const governorOffice = withoutOffice.offices.find((office) => (
      office.active
      && office.kind === '地方长官'
      && office.holderId === governorship.asset.holderId
      && office.regionId === governorship.root.regionId
    ));
    if (!governorOffice) throw new Error('expected an active governor appointment');
    governorOffice.active = false;
    governorOffice.endedTurn = withoutOffice.turn;
    expect(projectFactionSpatialPowerRoots(withoutOffice, governorship.root.factionId)
      .flatMap((root) => root.assets)
      .some((asset) => asset.kind === 'governorship' && asset.id === governorship.asset.id)).toBe(false);

    const emptyArmyWorld = structuredClone(base);
    const army = emptyArmyWorld.armies.find((candidate) => candidate.id === armyCommand.asset.id);
    if (!army) throw new Error('expected a current army');
    army.soldiers = 0;
    expect(projectFactionSpatialPowerRoots(emptyArmyWorld, armyCommand.root.factionId)
      .flatMap((root) => root.assets)
      .some((asset) => asset.kind === 'army' && asset.id === army.id)).toBe(false);

    const brokenFleetWorld = structuredClone(base);
    const fleet = brokenFleetWorld.fleets.find((candidate) => candidate.id === fleetCommand.asset.id);
    const commander = brokenFleetWorld.characters.find((candidate) => candidate.id === fleet?.commanderId);
    if (!fleet || !commander) throw new Error('expected a current fleet and commander');
    commander.commandingFleetId = null;
    expect(projectFactionSpatialPowerRoots(brokenFleetWorld, fleetCommand.root.factionId)
      .flatMap((root) => root.assets)
      .some((asset) => asset.kind === 'fleet' && asset.id === fleet.id)).toBe(false);
  });

  it('projects each commanded fleet at its current position without merging or calling it a home port', () => {
    const world = advanceWorldBy(createWorld('舰令跟着舰队走'), 8);
    const initialFleetRoot = projectFactionSpatialPowerRoots(world)
      .find((root) => root.kind === 'fleet_command');
    const fleetAsset = initialFleetRoot?.assets.find((asset) => asset.kind === 'fleet');
    const faction = world.factions.find((candidate) => candidate.id === initialFleetRoot?.factionId);
    const fleet = world.fleets.find((candidate) => candidate.id === fleetAsset?.id);
    const commander = world.characters.find((candidate) => candidate.id === fleet?.commanderId);
    const currentSea = world.seaZones.find((zone) => zone.id !== fleet?.seaZoneId) ?? world.seaZones[0];
    if (!initialFleetRoot || !fleetAsset || !faction || !fleet || !commander || !currentSea) {
      throw new Error('expected a faction-commanded fleet and a current sea position');
    }

    for (const character of world.characters) {
      if (character.factionId === faction.id && character.id !== commander.id) character.factionId = null;
    }
    commander.governedRegionId = null;
    commander.commandingArmyId = null;
    commander.commandingFleetId = fleet.id;
    fleet.portRegionId = null;
    fleet.seaZoneId = currentSea.id;
    const secondCommander = structuredClone(commander);
    secondCommander.id = `${commander.id}-second-fleet`;
    secondCommander.name = `${commander.name}乙`;
    secondCommander.commandingFleetId = `${fleet.id}-second`;
    const secondFleet = structuredClone(fleet);
    secondFleet.id = `${fleet.id}-second`;
    secondFleet.name = `${fleet.name}乙队`;
    secondFleet.commanderId = secondCommander.id;
    secondFleet.deputyCommanderId = null;
    world.characters.push(secondCommander);
    world.fleets.push(secondFleet);
    faction.memberIds = [commander.id, secondCommander.id];
    faction.coreMemberIds = [commander.id, secondCommander.id];

    const roots = projectFactionSpatialPowerRoots(world, faction.id)
      .filter((root) => root.kind === 'fleet_command');
    const markers = toMapMarkers(world, 'political', faction.id)
      .filter((marker) => marker.kind === 'powerRoot' && marker.rootKind === 'fleet_command');
    const fleetPositions = new Map(toMapFleets(world).map((item) => [item.id, item.position]));

    expect(roots).toHaveLength(2);
    expect(roots.every((root) => root.assetCount === 1 && root.assets.length === 1)).toBe(true);
    expect(roots.flatMap((root) => root.assets.map((asset) => asset.id)).sort())
      .toEqual([fleet.id, secondFleet.id].sort());
    expect(roots.every((root) => !root.label.includes('母港') && !root.detail.includes('母港'))).toBe(true);
    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.targetId).sort()).toEqual([fleet.id, secondFleet.id].sort());
    for (const marker of markers) {
      expect(marker.targetKind).toBe('fleet');
      expect(marker.categoryLabel).toBe('舰队军令');
      expect(marker.position).toEqual(fleetPositions.get(marker.targetId ?? ''));
      expect(marker.label).not.toContain('母港');
    }
  });

  it('emits exactly one restrained capital pulse per living polity from current faction relations', () => {
    const { world, polity } = worldWithFactionRivalry('首都只说当下朝局');
    for (const faction of world.factions.filter((candidate) => candidate.polityId === polity.id)) {
      faction.alliedFactionIds = [];
      faction.rivalFactionIds = [];
      faction.relationSinceTurns = {};
    }
    const court = projectCourt(world, polity.id);
    const dominant = court.factionPositions[0];
    const opponent = court.factionPositions.find((candidate) => candidate.factionId !== dominant?.factionId);
    const dominantState = world.factions.find((candidate) => candidate.id === dominant?.factionId);
    const opponentState = world.factions.find((candidate) => candidate.id === opponent?.factionId);
    if (!dominant || !opponent || !dominantState || !opponentState) throw new Error('expected two projected factions');
    dominantState.rivalFactionIds = [opponentState.id];
    opponentState.rivalFactionIds = [dominantState.id];
    dominantState.relationSinceTurns[opponentState.id] = world.turn;
    opponentState.relationSinceTurns[dominantState.id] = world.turn;
    polity.authority = 44;

    const pulses = projectCapitalPoliticalPulses(world);
    const pulse = pulses.find((candidate) => candidate.polityId === polity.id);
    expect(pulses).toHaveLength(world.polities.filter((candidate) => candidate.alive).length);
    expect(new Set(pulses.map((candidate) => candidate.polityId)).size).toBe(pulses.length);
    expect(pulse).toMatchObject({
      capitalRegionId: polity.capitalRegionId,
      dominantFactionId: dominant.factionId,
      dominantFactionName: dominant.name,
      rulerConstrained: true,
      tone: 'alert',
      constraintReasons: expect.arrayContaining(['weak_central_authority']),
      conflict: {
        label: '公开相争',
      },
    });
    expect([pulse?.conflict?.leftFactionId, pulse?.conflict?.rightFactionId].sort())
      .toEqual([dominantState.id, opponentState.id].sort());
    expect(pulse?.headline).toContain('公开相争');
    expect(pulse?.detail).toContain(dominant.name);

    dominantState.rivalFactionIds = [];
    opponentState.rivalFactionIds = [];
    expect(projectCapitalPoliticalPulses(world).find((candidate) => candidate.polityId === polity.id)?.conflict).toBeNull();
  });

  it('is deterministic under source-array reordering and leaves the world hash input untouched', () => {
    const world = advanceWorldBy(createWorld('政治投影排序'), 12);
    const before = serializeWorld(world);
    const first = projectPoliticalMap(world, 'all');
    expect(serializeWorld(world)).toBe(before);

    const reordered = structuredClone(world);
    reordered.polities.reverse();
    reordered.factions.reverse();
    reordered.characters.reverse();
    reordered.families.reverse();
    reordered.offices.reverse();
    reordered.armies.reverse();
    reordered.fleets.reverse();
    reordered.regions.reverse();
    const reorderedBefore = serializeWorld(reordered);
    expect(projectPoliticalMap(reordered, 'all')).toEqual(first);
    expect(serializeWorld(reordered)).toBe(reorderedBefore);
  });
});
