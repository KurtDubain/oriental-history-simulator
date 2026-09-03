import type { WorldState } from '../sim/types';
import type {
  MapArmyView,
  MapFleetView,
  MapMarkerView,
  MapOverlay,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
} from './map-contract';
import {
  projectCapitalPoliticalPulses,
  projectFactionSpatialPowerRoots,
} from './political-map-projection';
import { projectMilitaryAuthority } from './military-authority-reading';
import { armyOrderPath } from '../sim/military/orders';
import { factionForArmy } from './war-group-projection';
import { polity, region } from './dossier-adapter-shared';

function foodSafetyRatio(population: number, food: number) {
  return food / Math.max(1, population);
}

function supplyPressureNote(
  population: number,
  foodRatio: number,
  unrest: number,
  devastation: number,
  refugeePopulation: number,
  infectiousPopulation: number,
  hasTrade: boolean,
  netFoodImported: number,
) {
  if (foodRatio < 0.55) return '粮储危急，已难支撑军民';
  if (infectiousPopulation > Math.max(80, population * 0.008)) return '疫病正在削弱地方供养';
  if (refugeePopulation > Math.max(500, population * 0.04)) return '流民涌入，粮秣承压';
  if (devastation >= 45 || unrest >= 70) return '战乱与民怨妨碍征粮';
  if (netFoodImported > 0) return '粮食净流入，正在补充地方供养';
  if (hasTrade) return '商路仍有往来';
  return foodRatio < 1 ? '粮储偏紧，尚可维持' : '供养尚稳';
}

function regionalTradeReading(world: WorldState, regionId: string) {
  const shipments = world.lastTurn?.trade.shipments.filter((shipment) => (
    shipment.kind === '贸易'
    && shipment.deliveredAmount > 0
    && (shipment.originRegionId === regionId || shipment.destinationRegionId === regionId)
  ));
  if (shipments) {
    const netFoodImported = shipments.reduce((net, shipment) => {
      if (shipment.commodity !== '粮食') return net;
      if (shipment.destinationRegionId === regionId) return net + shipment.deliveredAmount;
      return net - shipment.acceptedAmount;
    }, 0);
    return { hasTrade: shipments.length > 0, netFoodImported };
  }

  // T0 没有季度运输账。此时只使用本季有实际到货量的商路，
  // 不把仍在保留期的旧 active 商路误认为当前补给。
  const corridors = world.tradeCorridors.filter((corridor) => (
    corridor.lastVolume > 0
    && (corridor.originRegionId === regionId || corridor.destinationRegionId === regionId)
  ));
  const netFoodImported = corridors.reduce((net, corridor) => {
    if (corridor.commodity !== '粮食') return net;
    if (corridor.destinationRegionId === regionId) return net + corridor.lastVolume;
    return net - corridor.lastVolume;
  }, 0);
  return { hasTrade: corridors.length > 0, netFoodImported };
}

export function regionSupplyNote(world: WorldState, item: WorldState['regions'][number]) {
  const infection = world.infections.find((entry) => entry.hostKind === 'region' && entry.hostId === item.id);
  const trade = regionalTradeReading(world, item.id);
  return supplyPressureNote(
    item.population,
    foodSafetyRatio(item.population, item.food),
    item.unrest,
    item.devastation,
    item.refugeePopulation,
    (infection?.infectious ?? 0) + (infection?.exposed ?? 0),
    trade.hasTrade,
    trade.netFoodImported,
  );
}

function expectedContact(world: WorldState, army: WorldState['armies'][number]): MapArmyView['expectedContact'] {
  if (army.order.status !== 'active' || !['advance', 'intercept'].includes(army.order.kind)) return undefined;
  const war = world.wars.find((item) => item.id === army.order.warId && item.active);
  if (!war) return undefined;
  const enemyPolityId = war.attackerId === army.polityId
    ? war.defenderId
    : war.defenderId === army.polityId
      ? war.attackerId
      : null;
  if (!enemyPolityId) return undefined;
  const explicitTarget = army.order.targetArmyId
    ? world.armies.find((item) => item.id === army.order.targetArmyId)
    : undefined;
  const path = armyOrderPath(world, army);
  const pathIndex = new Map((path ?? []).map((id, index) => [id, index]));
  const contact = explicitTarget?.polityId === enemyPolityId && explicitTarget.soldiers > 0
    ? explicitTarget
    : world.armies
      .filter((item) => item.polityId === enemyPolityId && item.soldiers > 0 && pathIndex.has(item.regionId))
      .sort((left, right) => (pathIndex.get(left.regionId) ?? 99) - (pathIndex.get(right.regionId) ?? 99)
        || right.soldiers - left.soldiers || left.id.localeCompare(right.id, 'zh-CN'))[0];
  const contactRegion = contact && world.regions.find((item) => item.id === contact.regionId);
  const contactFaction = contact ? factionForArmy(world, contact) : null;
  return contact && contactRegion ? {
    armyId: contact.id,
    armyName: contact.name,
    regionId: contactRegion.id,
    regionName: contactRegion.name,
    steps: Math.max(1, pathIndex.get(contactRegion.id) ?? 1),
    commanderName: world.characters.find((item) => item.id === contact.commanderId)?.name ?? '无名守将',
    factionName: contactFaction?.name ?? '未归集团',
  } : undefined;
}

export function toMapRegions(world: WorldState): MapRegionView[] {
  const polities = new Map(world.polities.map((item) => [item.id, item]));
  return world.regions.map((item) => {
    const owner = polities.get(item.controllerId);
    return {
      id: item.id,
      name: item.name,
      polygon: item.polygon,
      center: { x: item.x, y: item.y },
      terrain: item.terrain,
      polityId: owner?.id,
      polityName: owner?.name ?? '无主之地',
      polityColor: owner?.color ?? '#777267',
      population: item.population,
      foodRatio: foodSafetyRatio(item.population, item.food),
      unrest: item.unrest,
      warDamage: item.devastation,
      port: item.port,
      portLevel: item.portLevel,
      capital: owner?.capitalRegionId === item.id,
      cityLevel: item.cityLevel,
      strategicValue: item.strategicValue,
      supplyNote: regionSupplyNote(world, item),
    };
  });
}

export function toMapRoutes(world: WorldState): MapRouteView[] {
  return world.routes.map((item) => ({
    id: item.id,
    from: item.fromRegionId,
    to: item.toRegionId,
    type: item.kind === '河道' ? 'river' : item.kind === '海峡' ? 'sea' : 'land',
  }));
}

export function toMapArmies(world: WorldState): MapArmyView[] {
  const polities = new Map(world.polities.map((item) => [item.id, item]));
  return world.armies
    .filter((army) => army.soldiers > 0)
    .map((army) => {
      const reading = projectMilitaryAuthority(world, army);
      const faction = factionForArmy(world, army);
      const path = armyOrderPath(world, army);
      return {
        id: army.id,
        name: army.name,
        regionId: army.regionId,
        polityId: army.polityId,
        polityColor: polities.get(army.polityId)?.color,
        strength: army.soldiers,
        morale: army.morale,
        status: army.supply < 45 ? '补给吃紧' : reading.orderLabel,
        nominalPolityName: reading.nominalPolityName,
        lawfulCommanderName: reading.lawfulCommanderName,
        deputyCommanderName: reading.deputyCommanderName,
        actualAllegianceName: reading.actualAllegianceName,
        allegianceStrength: reading.allegianceStrength,
        commandDiverged: reading.commandDiverged,
        retinueSoldiers: reading.retinueSoldiers,
        retinueSummary: reading.retinueSummary,
        orderKind: reading.orderKind,
        orderLabel: reading.orderLabel,
        orderTargetRegionId: reading.orderTargetRegionId,
        orderIssuerName: reading.orderIssuerName,
        orderBlocked: reading.orderBlocked,
        warId: army.order.warId,
        factionId: faction?.id ?? null,
        factionName: faction?.name ?? '未归集团',
        factionShortName: (faction?.name ?? '无系').replace(/一系$|旧部$/, '').slice(0, 5),
        orderPathRegionIds: path ?? [],
        nextRegionId: path?.[1] ?? null,
        nextRegionName: world.regions.find((region) => region.id === path?.[1])?.name ?? null,
        recentMovement: army.recentMovement ? {
          ...army.recentMovement,
          current: army.recentMovement.turn === (world.lastTurn?.turn ?? world.turn),
        } : null,
        expectedContact: expectedContact(world, army),
      };
    });
}

export function toMapSeaZones(world: WorldState): MapSeaZoneView[] {
  return world.seaZones.map((item) => {
    const totalPower = Object.values(item.powerByPolity)
      .reduce((sum, value) => sum + Math.max(0, value), 0);
    const controllerPower = item.controllerId
      ? Math.max(0, item.powerByPolity[item.controllerId] ?? 0)
      : 0;
    return {
      id: item.id,
      name: item.name,
      center: { x: item.x, y: item.y },
      climate: item.climate,
      contested: item.contested,
      powerShare: totalPower > 0 ? controllerPower / totalPower : 0,
    };
  });
}

function fleetPoint(world: WorldState, fleetId: string) {
  const fleet = world.fleets.find((item) => item.id === fleetId);
  if (!fleet) return undefined;
  const zone = world.seaZones.find((item) => item.id === fleet.seaZoneId);
  const portRegion = region(world, fleet.portRegionId ?? fleet.homePortRegionId);
  return zone
    ? { x: zone.x, y: zone.y }
    : portRegion
      ? { x: portRegion.x, y: portRegion.y }
      : undefined;
}

export function toMapFleets(world: WorldState): MapFleetView[] {
  return world.fleets.flatMap((item) => {
    const position = fleetPoint(world, item.id);
    if (!position) return [];
    return [{
      id: item.id,
      name: item.name,
      seaZoneId: item.seaZoneId,
      regionId: item.portRegionId,
      position,
      polityId: item.polityId,
      polityColor: polity(world, item.polityId)?.color,
      strength: item.warships * 3 + item.patrolShips + item.transports * 0.4,
      readiness: item.readiness,
      mission: item.mission,
      warId: world.navalOperations.find((operation) => (
        operation.fleetIds.includes(item.id) && operation.stage !== '完成' && operation.stage !== '失败'
      ))?.warId ?? null,
    }];
  });
}

export function toMapMarkers(
  world: WorldState,
  overlay: MapOverlay,
  focusedFactionId: string | null = null,
): MapMarkerView[] {
  if (overlay === 'political') {
    const capitalPulses: MapMarkerView[] = projectCapitalPoliticalPulses(world, 'active')
      .flatMap((pulse) => {
        const capital = region(world, pulse.capitalRegionId);
        return capital ? [{
          id: pulse.id,
          kind: 'capitalPulse' as const,
          position: { x: capital.x, y: capital.y },
          magnitude: pulse.dominantFactionPower,
          label: `${capital.name}朝局`,
          targetKind: 'country' as const,
          targetId: pulse.polityId,
          polityId: pulse.polityId,
          factionId: pulse.dominantFactionId ?? undefined,
          factionName: pulse.dominantFactionName ?? undefined,
          categoryLabel: pulse.headline,
          detail: pulse.detail,
          tone: pulse.tone,
          color: polity(world, pulse.polityId)?.color,
        }] : [];
      });
    const roots: MapMarkerView[] = focusedFactionId
      ? projectFactionSpatialPowerRoots(world, focusedFactionId).flatMap((root) => {
        const anchor = root.anchor.kind === 'region'
          ? region(world, root.anchor.id)
          : world.seaZones.find((zone) => zone.id === root.anchor.id);
        const asset = root.assets[0];
        if (!anchor || !asset) return [];
        const targetKind = root.kind === 'regional_governance'
          ? 'region' as const
          : root.kind === 'army_command'
            ? 'army' as const
            : 'fleet' as const;
        return [{
          id: root.id,
          kind: 'powerRoot' as const,
          position: { x: anchor.x, y: anchor.y },
          magnitude: root.powerContribution,
          label: root.label,
          targetKind,
          targetId: targetKind === 'region' ? root.regionId : asset.id,
          polityId: root.polityId,
          factionId: root.factionId,
          factionName: root.factionName,
          categoryLabel: root.kindLabel,
          detail: root.detail,
          rootKind: root.kind,
          color: polity(world, root.polityId)?.color,
        }];
      })
      : [];
    return [...capitalPulses, ...roots];
  }
  return [];
}
