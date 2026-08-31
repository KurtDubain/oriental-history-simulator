import { describe, expect, it } from 'vitest';

import { advanceWorldBy, createWorld, serializeWorld } from '../sim';
import {
  toMapArmies as toMapArmiesFromBarrel,
  toMapRegions as toMapRegionsFromBarrel,
  toSystemInspector as toSystemInspectorFromBarrel,
} from './adapters';
import {
  toMapArmies,
  toMapFleets,
  toMapFlows,
  toMapMarkers,
  toMapRegions,
  toMapRoutes,
  toMapSeaZones,
} from './map-adapter';
import { toSystemInspector } from './map-dossier-adapter';
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
  layoutMapArmyIcons,
  layoutMapRegionNodes,
  panMapCamera,
  resolveMapSceneHit,
  screenToWorldPoint,
  worldToScreenPoint,
  zoomMapCameraAtPoint,
} from './map-scene-geometry';
import { isPoliticalMapMarker, layoutMapMarkers } from './map-marker-layout';

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
      toMapFlows(world, 'war'),
      toMapMarkers(world, 'war'),
    ),
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
    const flows = ['trade', 'migration', 'naval', 'disease', 'knowledge']
      .flatMap((overlay) => toMapFlows(world, overlay as Parameters<typeof toMapFlows>[1]));

    expect(regions).toHaveLength(82);
    expect(routes.length).toBeGreaterThan(0);
    expect(armies.length).toBeGreaterThan(0);
    expect(zones.length).toBeGreaterThan(0);
    expect(fleets.length).toBeGreaterThan(0);
    expect(flows.every((flow) => Number.isFinite(flow.magnitude))).toBe(true);
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
    const overlays = [
      'food', 'population', 'war', 'trade', 'migration', 'naval', 'disease', 'knowledge', 'none',
    ] as const;

    for (const overlay of overlays) {
      expect(toMapMarkers(world, overlay).filter(isPoliticalMapMarker)).toEqual([]);
    }
  });
});

describe('shared map scene hit boundary', () => {
  it('uses the painted army badge geometry as the first interactive target', () => {
    const { presentation } = mapProjection('地图命中边界');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [layout] = layoutMapArmyIcons(presentation.armies, presentation.regions, transform);

    expect(layout).toBeDefined();
    expect(resolveMapSceneHit(
      presentation,
      layout.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'army', army: { id: layout.army.id } });
  });

  it('keeps mobile taps on a zoomed and panned army aligned with the same scene model', () => {
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
    const [layout] = layoutMapArmyIcons(presentation.armies, presentation.regions, transform);

    expect(resolveMapSceneHit(
      presentation,
      { x: layout.point.x + 19, y: layout.point.y },
      viewport.width,
      viewport.height,
      camera,
      { coarsePointer: true, includeSeaZones: true, tolerateRegionEdge: true },
    )).toMatchObject({ kind: 'army', army: { id: layout.army.id } });
  });

  it('uses the same LOD slice for visibility and hit testing', () => {
    const { presentation } = mapProjection('层级命中边界');
    const scene = buildMapLodScene(presentation, 'overview');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const visibleIds = new Set(scene.armies.map((army) => army.id));
    const hiddenLayout = layoutMapArmyIcons(presentation.armies, presentation.regions, transform)
      .find((layout) => !visibleIds.has(layout.army.id));

    expect(hiddenLayout).toBeDefined();
    const hiddenHit = resolveMapSceneHit(
      scene,
      hiddenLayout?.point ?? { x: 0, y: 0 },
      viewport.width,
      viewport.height,
    );
    expect(hiddenHit?.kind === 'army' && hiddenHit.army.id === hiddenLayout?.army.id).toBe(false);
  });

  it('applies the observer focus offset equally to painting anchors and hits', () => {
    const { presentation } = mapProjection('避让命中边界');
    const scene = { ...buildMapLodScene(presentation, 'regional'), fleets: [] };
    const viewport = { width: 390, height: 644 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [layout] = layoutMapArmyIcons(scene.armies, scene.regions, transform);
    const focusOffset = { x: 0, y: -84 };

    expect(resolveMapSceneHit(
      scene,
      { x: layout.point.x + focusOffset.x, y: layout.point.y + focusOffset.y },
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true, focusOffset },
    )).toMatchObject({ kind: 'army', army: { id: layout.army.id } });
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
      flows: [],
      markers: [{
        id: 'marker-under-node',
        kind: 'practice' as const,
        position: node.region.center,
        magnitude: 80,
        label: '节点下方标记',
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
      flows: [],
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

  it('keeps fleets and armies ahead of a political marker at the same painted point', () => {
    const { presentation } = mapProjection('军队优先于朝局印记');
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [armyLayout] = layoutMapArmyIcons(presentation.armies, presentation.regions, transform);
    const markerAtArmy = {
      id: 'root-under-army',
      kind: 'capitalPulse' as const,
      position: screenToWorldPoint(
        { x: armyLayout.point.x + 20, y: armyLayout.point.y + 18 },
        viewport.width,
        viewport.height,
      ),
      magnitude: 70,
      label: '军中朝局',
      targetKind: 'country' as const,
      targetId: armyLayout.army.polityId ?? 'polity-test',
    };
    expect(layoutMapMarkers([markerAtArmy], transform)[0].point.x).toBeCloseTo(armyLayout.point.x, 5);
    expect(layoutMapMarkers([markerAtArmy], transform)[0].point.y).toBeCloseTo(armyLayout.point.y, 5);
    expect(resolveMapSceneHit(
      { ...presentation, fleets: [], markers: [markerAtArmy], armies: [armyLayout.army] },
      armyLayout.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'army', army: { id: armyLayout.army.id } });

    const fleetMarker = {
      ...markerAtArmy,
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

  it('chooses the nearer painted center when a coarse army and power-root target overlap', () => {
    const { presentation } = mapProjection('军令与军队粗指针重叠');
    const viewport = { width: 390, height: 644 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const [armyLayout] = layoutMapArmyIcons(presentation.armies, presentation.regions, transform);
    const armyRegion = presentation.regions.find((region) => region.id === armyLayout.army.regionId);
    if (!armyRegion) throw new Error('expected the army region to resolve');
    const marker = {
      id: 'power-root-near-army',
      kind: 'powerRoot' as const,
      position: armyRegion.center,
      magnitude: 16,
      label: `${armyRegion.name}军令`,
      targetKind: 'army' as const,
      targetId: armyLayout.army.id,
      polityId: armyLayout.army.polityId,
      factionId: 'faction-test',
      rootKind: 'army_command' as const,
    };
    const [rootLayout] = layoutMapMarkers([marker], transform);
    const centerDistance = Math.hypot(
      rootLayout.point.x - armyLayout.point.x,
      rootLayout.point.y - armyLayout.point.y,
    );
    const scene = {
      ...presentation,
      fleets: [],
      flows: [],
      markers: [marker],
      armies: [armyLayout.army],
    };

    expect(centerDistance).toBeGreaterThan(0);
    expect(centerDistance).toBeLessThan(22);
    expect(resolveMapSceneHit(
      scene,
      rootLayout.point,
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true },
    )).toMatchObject({ kind: 'marker', marker: { id: marker.id } });
    expect(resolveMapSceneHit(
      scene,
      armyLayout.point,
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true },
    )).toMatchObject({ kind: 'army', army: { id: armyLayout.army.id } });
    expect(resolveMapSceneHit(
      scene,
      {
        x: (rootLayout.point.x + armyLayout.point.x) / 2,
        y: (rootLayout.point.y + armyLayout.point.y) / 2,
      },
      viewport.width,
      viewport.height,
      undefined,
      { coarsePointer: true },
    )).toMatchObject({ kind: 'army', army: { id: armyLayout.army.id } });
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
      flows: [],
      seaZones: [],
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

  it('hits the same quadratic flow curve that the renderer paints', () => {
    const { presentation } = mapProjection('曲线命中边界');
    const viewport = { width: 1_000, height: 700 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const flow = {
      id: 'curved-flow',
      kind: 'trade' as const,
      from: { x: 100, y: 350 },
      to: { x: 900, y: 350 },
      magnitude: 100,
      label: '曲线商路',
      selectedKind: 'tradeCorridor' as const,
      selectedId: 'corridor-curved',
    };
    const from = worldToScreenPoint(flow.from, transform);
    const to = worldToScreenPoint(flow.to, transform);
    const bend = Math.min(24, Math.hypot(to.x - from.x, to.y - from.y) * 0.16);
    const paintedMidpoint = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 - bend / 2,
    };
    const scene = {
      ...buildMapLodScene(presentation, 'local'),
      regions: [],
      armies: [],
      fleets: [],
      markers: [],
      seaZones: [],
      flows: [flow],
    };

    expect(resolveMapSceneHit(
      scene,
      paintedMidpoint,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'flow', flow: { id: flow.id } });
    expect(resolveMapSceneHit(
      scene,
      { x: paintedMidpoint.x, y: paintedMidpoint.y + bend / 2 },
      viewport.width,
      viewport.height,
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
