import { describe, expect, it } from 'vitest';

import { createWorld, serializeWorld } from '../sim';
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
import {
  createMapViewportTransform,
  layoutMapArmyIcons,
  panMapCamera,
  resolveMapSceneHit,
  zoomMapCameraAtPoint,
} from './map-scene-geometry';

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
