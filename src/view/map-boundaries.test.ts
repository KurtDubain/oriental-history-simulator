import { describe, expect, it } from 'vitest';

import { advanceWorldBy, createWorld, serializeWorld } from '../sim';
import type { CommodityKind, ShipmentRecord, WorldState } from '../sim';
import {
  toMapArmies as toMapArmiesFromBarrel,
  toMapRegions as toMapRegionsFromBarrel,
  toSystemInspector as toSystemInspectorFromBarrel,
} from './adapters';
import {
  toMapArmies,
  toMapFleets,
  toMapMarkers,
  toMapPersonForces,
  toMapRegions,
  toMapRoutes,
  toMapSeaZones,
} from './map-adapter';
import { toRegionInspector, toSystemInspector } from './map-dossier-adapter';
import {
  cameraForPinch,
  createMultiPointerGesture,
  createSinglePointerGesture,
  mapDragThreshold,
  shouldCancelMapTap,
} from './map-gestures';
import { buildMapPresentation } from './map-presentation';
import { buildMapLodScene } from './map-lod';
import {
  createMapViewportTransform,
  layoutMapPersonForces,
  layoutMapRegionNodes,
  panMapCamera,
  resolveMapSceneHit,
  screenToWorldPoint,
  worldToScreenPoint,
  zoomMapCameraAtPoint,
} from './map-scene-geometry';
import { layoutMapMarkers } from './map-marker-layout';

function mapProjection(seed: string) {
  const world = createWorld(seed);
  const regions = toMapRegions(world);
  const routes = toMapRoutes(world);
  const armies = toMapArmies(world);
  const seaZones = toMapSeaZones(world);
  const fleets = toMapFleets(world);
  return {
    world,
    presentation: buildMapPresentation(
      regions,
      routes,
      armies,
      seaZones,
      fleets,
      toMapMarkers(world, 'war'),
      undefined,
      toMapPersonForces(world),
    ),
  };
}

function quietSupplyRegion(world: WorldState) {
  const target = world.regions[0];
  target.population = 10_000;
  target.food = 20_000;
  target.unrest = 0;
  target.devastation = 0;
  target.refugeePopulation = 0;
  for (const infection of world.infections) {
    if (infection.hostKind === 'region' && infection.hostId === target.id) {
      infection.exposed = 0;
      infection.infectious = 0;
    }
  }
  return target;
}

function deliveredTrade(
  id: string,
  commodity: CommodityKind,
  originRegionId: string,
  destinationRegionId: string,
  acceptedAmount: number,
  deliveredAmount = acceptedAmount,
): ShipmentRecord {
  return {
    id,
    kind: '贸易',
    commodity,
    originRegionId,
    destinationRegionId,
    acceptedAmount,
    deliveredAmount,
    lostAmount: acceptedAmount - deliveredAmount,
    raidedAmount: 0,
    peopleDeparted: 0,
    peopleArrived: 0,
    peopleLost: 0,
    contactVolume: acceptedAmount,
    legs: [],
    carrierArmyId: null,
    carrierFleetId: null,
    value: deliveredAmount,
    tariff: 0,
    status: acceptedAmount === deliveredAmount ? '交付' : '受损',
  };
}

describe('map adapter boundary', () => {
  it('projects bounded map models without mutating the authoritative world', () => {
    const world = createWorld('地图投影边界');
    const before = serializeWorld(world);

    const regions = toMapRegions(world);
    const routes = toMapRoutes(world);
    const armies = toMapArmies(world);
    const zones = toMapSeaZones(world);
    const fleets = toMapFleets(world);

    expect(regions).toHaveLength(82);
    expect(routes.length).toBeGreaterThan(0);
    expect(armies.length).toBeGreaterThan(0);
    expect(zones.length).toBeGreaterThan(0);
    expect(fleets.length).toBeGreaterThan(0);
    expect(regions.every((region) => region.supplyNote.length > 0)).toBe(true);
    expect(toMapRegionsFromBarrel(world)).toEqual(regions);
    expect(toMapArmiesFromBarrel(world)).toEqual(armies);
    expect(toSystemInspectorFromBarrel(world, 'army', world.armies[0].id))
      .toEqual(toSystemInspector(world, 'army', world.armies[0].id));
    expect(serializeWorld(world)).toBe(before);
  });

  it('keeps the political overview to capital pulses until one faction is explicitly focused', () => {
    const world = advanceWorldBy(createWorld('朝局舆图聚焦边界'), 8);
    const before = serializeWorld(world);
    const overview = toMapMarkers(world, 'political');
    const livingPolityIds = world.polities
      .filter((polity) => polity.alive)
      .map((polity) => polity.id)
      .sort();

    expect(overview.every((marker) => marker.kind === 'capitalPulse')).toBe(true);
    expect(overview.map((marker) => marker.targetId).sort()).toEqual(livingPolityIds);

    const focusedFaction = world.factions.find((faction) => (
      faction.active
      && toMapMarkers(world, 'political', faction.id).some((marker) => marker.kind === 'powerRoot')
    ));
    if (!focusedFaction) throw new Error('expected a faction with at least one concrete spatial root');
    const focused = toMapMarkers(world, 'political', focusedFaction.id);
    const roots = focused.filter((marker) => marker.kind === 'powerRoot');

    expect(focused.filter((marker) => marker.kind === 'capitalPulse')).toEqual(overview);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every((marker) => marker.factionId === focusedFaction.id)).toBe(true);
    for (const marker of roots) {
      expect(['regional_governance', 'army_command', 'fleet_command']).toContain(marker.rootKind);
      if (marker.targetKind === 'region') {
        const target = world.regions.find((region) => region.id === marker.targetId);
        expect(target?.controllerId).toBe(focusedFaction.polityId);
      } else if (marker.targetKind === 'army') {
        const target = world.armies.find((army) => army.id === marker.targetId);
        const commander = world.characters.find((character) => character.id === target?.commanderId);
        expect(target?.polityId).toBe(focusedFaction.polityId);
        expect(commander?.factionId).toBe(focusedFaction.id);
      } else if (marker.targetKind === 'fleet') {
        const target = world.fleets.find((fleet) => fleet.id === marker.targetId);
        const commander = world.characters.find((character) => character.id === target?.commanderId);
        expect(target?.polityId).toBe(focusedFaction.polityId);
        expect(commander?.factionId).toBe(focusedFaction.id);
      } else {
        throw new Error(`unexpected political root target: ${marker.targetKind}`);
      }
    }
    expect(serializeWorld(world)).toBe(before);
  });

  it('never leaks political markers into another map overlay', () => {
    const world = advanceWorldBy(createWorld('图层不串色'), 4);
    const overlays = ['food', 'war', 'none'] as const;

    for (const overlay of overlays) {
      expect(toMapMarkers(world, overlay)).toEqual([]);
    }
  });

  it('projects an expected contact only when an active order has a verifiable enemy at its destination', () => {
    const world = createWorld('预计接敌投影');
    const attacker = world.armies[0];
    const defender = world.armies.find((army) => army.polityId !== attacker.polityId);
    if (!defender) throw new Error('expected armies from two polities');
    const warId = 'war_expected_contact_test';
    world.wars.push({
      id: warId,
      kind: 'interstate',
      attackerId: attacker.polityId,
      defenderId: defender.polityId,
      startedTurn: world.turn,
      endedTurn: null,
      active: true,
      attackerScore: 0,
      defenderScore: 0,
      reason: '投影测试',
      lastBattleTurn: -1,
      goal: '边境',
      targetRegionIds: [defender.regionId],
      exhaustion: 0,
    });
    attacker.order = {
      ...attacker.order,
      kind: 'intercept',
      warId,
      targetArmyId: defender.id,
      targetRegionId: defender.regionId,
      status: 'active',
    };
    const before = serializeWorld(world);

    expect(toMapArmies(world).find((army) => army.id === attacker.id)?.expectedContact).toEqual({
      armyId: defender.id,
      armyName: defender.name,
      regionId: defender.regionId,
      regionName: world.regions.find((region) => region.id === defender.regionId)?.name,
      steps: 1,
      commanderName: world.characters.find((character) => character.id === defender.commanderId)?.name,
      factionName: world.factions.find((faction) => faction.id === world.characters.find((character) => character.id === defender.allegiance.characterId)?.factionId)?.name,
    });
    expect(serializeWorld(world)).toBe(before);

    const emptyEnemyRegion = world.regions.find((item) => !world.armies.some((army) => (
      army.polityId === defender.polityId && army.regionId === item.id && army.soldiers > 0
    )));
    if (!emptyEnemyRegion) throw new Error('expected a region without the enemy army');
    attacker.order = { ...attacker.order, kind: 'advance', targetArmyId: null, targetRegionId: emptyEnemyRegion.id };
    expect(toMapArmies(world).find((army) => army.id === attacker.id)?.expectedContact).toBeUndefined();
  });

  it('uses the same supply note in the map and region dossier projections', () => {
    const world = createWorld('供养说明同源');
    const target = world.regions[0];
    expect(toRegionInspector(world, target).supplyNote)
      .toBe(toMapRegions(world).find((region) => region.id === target.id)?.supplyNote);
  });

  it('describes a verified net grain import as replenishing local supply', () => {
    const world = advanceWorldBy(createWorld('供养粮食进口'), 1);
    const target = quietSupplyRegion(world);
    const origin = world.regions[1];
    if (!world.lastTurn) throw new Error('expected a completed turn report');
    world.lastTurn.trade.shipments = [
      deliveredTrade('shipment_food_import', '粮食', origin.id, target.id, 900, 840),
      deliveredTrade('shipment_food_export', '粮食', target.id, origin.id, 200),
    ];

    expect(toMapRegions(world).find((region) => region.id === target.id)?.supplyNote)
      .toBe('粮食净流入，正在补充地方供养');
  });

  it('does not describe a grain-exporting region as receiving supply', () => {
    const world = advanceWorldBy(createWorld('供养粮食出口'), 1);
    const target = quietSupplyRegion(world);
    const destination = world.regions[1];
    if (!world.lastTurn) throw new Error('expected a completed turn report');
    world.lastTurn.trade.shipments = [
      deliveredTrade('shipment_food_export_only', '粮食', target.id, destination.id, 700),
    ];

    const note = toMapRegions(world).find((region) => region.id === target.id)?.supplyNote;
    expect(note).toBe('商路仍有往来');
    expect(note).not.toContain('补充');
  });

  it('does not treat an imported non-food commodity as local provisioning', () => {
    const world = advanceWorldBy(createWorld('供养非粮进口'), 1);
    const target = quietSupplyRegion(world);
    const origin = world.regions[1];
    if (!world.lastTurn) throw new Error('expected a completed turn report');
    world.lastTurn.trade.shipments = [
      deliveredTrade('shipment_luxury_import', '奢侈品', origin.id, target.id, 180),
    ];

    const note = toMapRegions(world).find((region) => region.id === target.id)?.supplyNote;
    expect(note).toBe('商路仍有往来');
    expect(note).not.toContain('供养');
  });
});

describe('shared map scene hit boundary', () => {
  it('uses the painted person force as the first interactive target', () => {
    const { presentation } = mapProjection('地图命中边界');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [layout] = layoutMapPersonForces(presentation.persons, transform);

    expect(layout).toBeDefined();
    expect(resolveMapSceneHit(
      presentation,
      layout.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'person', person: { id: layout.person.id } });
  });

  it('keeps mobile taps on a zoomed and panned person aligned with the same scene model', () => {
    const { presentation } = mapProjection('移动命中边界');
    const viewport = { width: 390, height: 644 };
    const zoomed = zoomMapCameraAtPoint(
      { zoom: 1, panX: 0, panY: 0 },
      2.6,
      { x: 210, y: 280 },
      viewport.width,
      viewport.height,
    );
    const camera = panMapCamera(zoomed, -52, 38, viewport.width, viewport.height);
    const transform = createMapViewportTransform(viewport.width, viewport.height, 8, camera);
    const [layout] = layoutMapPersonForces(presentation.persons, transform);

    expect(resolveMapSceneHit(
      presentation,
      layout.point,
      viewport.width,
      viewport.height,
      camera,
      { coarsePointer: true, includeSeaZones: true, tolerateRegionEdge: true },
    )).toMatchObject({ kind: 'person', person: { id: layout.person.id } });
  });

  it('uses the same LOD slice for visibility and hit testing', () => {
    const { presentation } = mapProjection('层级命中边界');
    const scene = buildMapLodScene(presentation, 'overview');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const visibleIds = new Set(scene.persons.map((person) => person.id));
    const hiddenLayout = layoutMapPersonForces(presentation.persons, transform)
      .find((layout) => !visibleIds.has(layout.person.id));

    expect(hiddenLayout).toBeDefined();
    const hiddenHit = resolveMapSceneHit(
      scene,
      hiddenLayout?.point ?? { x: 0, y: 0 },
      viewport.width,
      viewport.height,
    );
    expect(hiddenHit?.kind === 'person' && hiddenHit.person.id === hiddenLayout?.person.id).toBe(false);
  });

  it('keeps a painted sea zone touchable at overview LOD', () => {
    const { presentation } = mapProjection('海域总览命中');
    const scene = buildMapLodScene(presentation, 'overview');
    const seaZone = scene.seaZones[0];
    const viewport = { width: 390, height: 644 };
    const point = worldToScreenPoint(
      seaZone.center,
      createMapViewportTransform(viewport.width, viewport.height),
    );

    expect(scene.interactiveSeaZoneIds.has(seaZone.id)).toBe(true);
    expect(resolveMapSceneHit(
      { ...scene, regions: [], armies: [], fleets: [], markers: [], persons: [], personClusters: [] },
      point,
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true, includeSeaZones: true },
    )).toMatchObject({ kind: 'seaZone', seaZone: { id: seaZone.id } });
  });

  it('applies the observer focus offset equally to painting anchors and hits', () => {
    const { presentation } = mapProjection('避让命中边界');
    const scene = { ...buildMapLodScene(presentation, 'regional'), fleets: [] };
    const viewport = { width: 390, height: 644 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [layout] = layoutMapPersonForces(scene.persons, transform);
    const focusOffset = { x: 0, y: -84 };

    expect(resolveMapSceneHit(
      scene,
      { x: layout.point.x + focusOffset.x, y: layout.point.y + focusOffset.y },
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true, focusOffset },
    )).toMatchObject({ kind: 'person', person: { id: layout.person.id } });
  });

  it('gives a painted city node priority over a marker drawn beneath it', () => {
    const { presentation } = mapProjection('节点层级边界');
    const scene = buildMapLodScene(presentation, 'local');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [node] = layoutMapRegionNodes(scene.regions, scene.seaZones, transform, {
      cityRegionIds: scene.cityRegionIds,
      portRegionIds: scene.portRegionIds,
    });
    const layeredScene = {
      ...scene,
      armies: [],
      fleets: [],
      persons: [],
      personClusters: [],
      markers: [{
        id: 'marker-under-node',
        kind: 'capitalPulse' as const,
        position: screenToWorldPoint(
          { x: node.point.x + 20, y: node.point.y + 18 },
          viewport.width,
          viewport.height,
        ),
        magnitude: 80,
        label: '节点下方标记',
        targetKind: 'country' as const,
        targetId: node.region.polityId ?? 'polity-test',
      }],
    };

    expect(resolveMapSceneHit(
      layeredScene,
      node.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'regionNode', node: { region: { id: node.region.id } } });
  });

  it('resolves a capital pulse and its nearby city by the closer painted anchor', () => {
    const { presentation } = mapProjection('朝局印记与城点距离');
    const scene = buildMapLodScene(presentation, 'local');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const node = layoutMapRegionNodes(scene.regions, scene.seaZones, transform, {
      cityRegionIds: scene.cityRegionIds,
      portRegionIds: scene.portRegionIds,
    }).find((candidate) => candidate.kind === 'city');
    if (!node) throw new Error('expected a painted city node');
    const marker = {
      id: 'capital-pulse-near-city',
      kind: 'capitalPulse' as const,
      position: node.region.center,
      magnitude: 60,
      label: '朝局',
      targetKind: 'country' as const,
      targetId: node.region.polityId ?? 'polity-test',
    };
    const [markerLayout] = layoutMapMarkers([marker], transform);
    const layeredScene = {
      ...scene,
      armies: [],
      fleets: [],
      persons: [],
      personClusters: [],
      markers: [marker],
    };

    expect(resolveMapSceneHit(
      layeredScene,
      markerLayout.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'marker', marker: { id: marker.id } });
    expect(resolveMapSceneHit(
      layeredScene,
      node.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'regionNode', node: { region: { id: node.region.id } } });
  });

  it('keeps fleets and people ahead of a political marker at the same painted point', () => {
    const { presentation } = mapProjection('人物优先于朝局印记');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [personLayout] = layoutMapPersonForces(presentation.persons, transform);
    const markerAtPerson = {
      id: 'root-under-person',
      kind: 'capitalPulse' as const,
      position: screenToWorldPoint(
        { x: personLayout.point.x + 20, y: personLayout.point.y + 18 },
        viewport.width,
        viewport.height,
      ),
      magnitude: 70,
      label: '军中朝局',
      targetKind: 'country' as const,
      targetId: personLayout.person.polityId,
    };
    expect(layoutMapMarkers([markerAtPerson], transform)[0].point.x).toBeCloseTo(personLayout.point.x, 5);
    expect(layoutMapMarkers([markerAtPerson], transform)[0].point.y).toBeCloseTo(personLayout.point.y, 5);
    expect(resolveMapSceneHit(
      { ...presentation, fleets: [], markers: [markerAtPerson], persons: [personLayout.person] },
      personLayout.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'person', person: { id: personLayout.person.id } });

    const fleetMarker = {
      ...markerAtPerson,
      id: 'root-under-fleet',
      position: { x: 420, y: 260 },
    };
    const fleetPoint = layoutMapMarkers([fleetMarker], transform)[0].point;
    const fleet = {
      id: 'fleet-priority',
      name: '试验舟师',
      polityId: fleetMarker.targetId,
      position: screenToWorldPoint(fleetPoint, viewport.width, viewport.height),
      strength: 20,
      readiness: 70,
      mission: '巡逻',
    };
    expect(resolveMapSceneHit(
      { ...presentation, armies: [], fleets: [fleet], markers: [fleetMarker] },
      fleetPoint,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'fleet', fleet: { id: fleet.id } });
  });

  it('uses deterministic marker offsets and a 22px coarse political hit radius', () => {
    const { presentation } = mapProjection('政治标记粗指针');
    const viewport = { width: 390, height: 644 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const markers = [
      {
        id: 'capital-offset', kind: 'capitalPulse' as const, position: { x: 500, y: 350 },
        magnitude: 60, label: '首都朝局', targetKind: 'country' as const, targetId: 'polity-a',
      },
      {
        id: 'root-offset-a', kind: 'powerRoot' as const, position: { x: 500, y: 350 },
        magnitude: 12, label: '州治', targetKind: 'region' as const, targetId: 'region-a',
      },
      {
        id: 'root-offset-b', kind: 'powerRoot' as const, position: { x: 500, y: 350 },
        magnitude: 10, label: '军令', targetKind: 'army' as const, targetId: 'army-a',
      },
    ];
    const layouts = layoutMapMarkers(markers, transform);
    const repeated = layoutMapMarkers(markers, transform);
    expect(repeated).toEqual(layouts);
    expect(new Set(layouts.map((layout) => `${layout.point.x}:${layout.point.y}`)).size).toBe(3);

    const target = layouts[0];
    const bareScene = {
      ...presentation,
      regions: [],
      armies: [],
      fleets: [],
      seaZones: [],
      persons: [],
      personClusters: [],
      markers: [target.marker],
    };
    expect(resolveMapSceneHit(
      bareScene,
      { x: target.point.x + 21.5, y: target.point.y },
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true },
    )).toMatchObject({ kind: 'marker', marker: { id: target.marker.id } });
    expect(resolveMapSceneHit(
      bareScene,
      { x: target.point.x + 22.5, y: target.point.y },
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true },
    )).toBeNull();
  });

});

describe('map gesture boundary', () => {
  it('preserves the existing touch thresholds and pure pinch camera result', () => {
    const resting = { zoom: 1, panX: 0, panY: 0 };
    const zoomed = { zoom: 2, panX: -80, panY: 20 };
    expect(mapDragThreshold('touch', resting)).toBe(14);
    expect(mapDragThreshold('touch', zoomed)).toBe(10);
    expect(mapDragThreshold('mouse', resting)).toBe(5);

    const contacts = [
      { pointerType: 'touch', current: { x: 120, y: 220 } },
      { pointerType: 'touch', current: { x: 220, y: 220 } },
    ];
    const gesture = createMultiPointerGesture('touch', contacts[1].current, contacts, resting);
    const spread = [
      { ...contacts[0], current: { x: 90, y: 220 } },
      { ...contacts[1], current: { x: 250, y: 220 } },
    ];
    const camera = cameraForPinch(gesture.pinch!, spread, 390, 644);
    expect(camera.zoom).toBeCloseTo(1.6, 8);
    expect(Number.isFinite(camera.panX) && Number.isFinite(camera.panY)).toBe(true);

    const single = createSinglePointerGesture('touch', { x: 100, y: 100 });
    expect(shouldCancelMapTap(single, resting, resting, 13)).toEqual({
      cameraMoved: false,
      cancelTap: false,
    });
  });
});
