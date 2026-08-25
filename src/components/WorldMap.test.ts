import { describe, expect, it } from 'vitest';

import { REGION_DEFINITIONS } from '../sim/data';
import { getRegionDisplaySite } from '../view/map-geography';
import {
  buildMapPresentation,
  clampMapCamera,
  createMapViewportTransform,
  MAP_MAX_ZOOM,
  panMapCamera,
  reframeMapCamera,
  regionAtScreenPoint,
  screenToWorldPoint,
  zoomMapCameraAtPoint,
  type MapRegionView,
} from './WorldMap';

function sourceRegions(): MapRegionView[] {
  return REGION_DEFINITIONS.map((region) => ({
    id: region.id,
    name: region.name,
    center: { x: region.x, y: region.y },
    polygon: [
      { x: region.x - 4, y: region.y - 4 },
      { x: region.x + 4, y: region.y - 4 },
      { x: region.x + 4, y: region.y + 4 },
      { x: region.x - 4, y: region.y + 4 },
    ],
    terrain: region.terrain,
    population: region.populationBase,
    foodRatio: 1,
  }));
}

describe('WorldBox-style presentation atlas', () => {
  it('reprojects all 82 authoritative regions without mutating simulation coordinates', () => {
    const source = sourceRegions();
    const rawYanjing = { ...source.find((region) => region.id === 'r_yanjing')?.center };
    const presentation = buildMapPresentation(source, [], [], [], [], [], []);

    expect(presentation.regions).toHaveLength(82);
    expect(presentation.regions.every((region) => region.polygon.length >= 3)).toBe(true);
    expect(source.find((region) => region.id === 'r_yanjing')?.center).toEqual(rawYanjing);
    expect(presentation.regions.find((region) => region.id === 'r_yanjing')?.center)
      .toEqual({ x: 367, y: 188 });
  });

  it('makes each display site hit its continuous territory on wide and compact maps', () => {
    const presentation = buildMapPresentation(sourceRegions(), [], [], [], [], [], []);
    const viewports = [
      { width: 1210, height: 560 },
      { width: 390, height: 644 },
    ];

    for (const viewport of viewports) {
      const transform = createMapViewportTransform(viewport.width, viewport.height);
      expect(transform.yScale).toBe(1);
      for (const region of presentation.regions) {
        const site = getRegionDisplaySite(region.id);
        expect(site, region.id).toBeDefined();
        const screenPoint = {
          x: transform.offsetX + (site?.x ?? 0) * transform.scale,
          y: transform.offsetY + (site?.y ?? 0) * transform.scale * transform.yScale,
        };
        expect(regionAtScreenPoint(
          presentation.regions,
          screenPoint,
          viewport.width,
          viewport.height,
        )?.id, `${region.id}@${viewport.width}`).toBe(region.id);
      }
    }
  });

  it('keeps the deep Bohai bay unowned and unclickable', () => {
    const presentation = buildMapPresentation(sourceRegions(), [], [], [], [], [], []);
    const viewport = { width: 1210, height: 720 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const bayPoint = {
      x: transform.offsetX + 455 * transform.scale,
      y: transform.offsetY + 240 * transform.scale,
    };

    expect(regionAtScreenPoint(
      presentation.regions,
      bayPoint,
      viewport.width,
      viewport.height,
    )).toBeNull();
  });

  it('projects region- and sea-anchored overlays onto the illustrated atlas', () => {
    const source = sourceRegions();
    const yanjing = source.find((region) => region.id === 'r_yanjing') as MapRegionView;
    const presentation = buildMapPresentation(
      source,
      [],
      [],
      [{
        id: 'sea_bohai',
        name: '环内海',
        center: { x: 650, y: 150 },
        climate: '内海',
        contested: false,
        traffic: 0,
        stormRisk: 0,
        piracy: 0,
        powerShare: 0,
      }],
      [{
        id: 'fleet-test',
        name: '试航水师',
        position: { x: 650, y: 150 },
        strength: 10,
        readiness: 80,
        mission: '护航',
      }],
      [{
        id: 'flow-test',
        kind: 'trade',
        from: yanjing.center,
        to: { x: 650, y: 150 },
        magnitude: 1,
        label: '试航',
        selectedKind: 'tradeCorridor',
        selectedId: 'flow-test',
      }],
      [],
    );

    expect(presentation.seaZones[0].center).toEqual({ x: 455, y: 240 });
    expect(presentation.fleets[0].position).toEqual({ x: 455, y: 240 });
    expect(presentation.flows[0].from).toEqual({ x: 367, y: 188 });
    expect(presentation.flows[0].to).toEqual({ x: 455, y: 240 });
  });

  it('keeps the world point beneath a zoom anchor stable', () => {
    const viewport = { width: 390, height: 644 };
    const anchor = { x: 214, y: 322 };
    const before = screenToWorldPoint(anchor, viewport.width, viewport.height);
    const camera = zoomMapCameraAtPoint(
      { zoom: 1, panX: 0, panY: 0 },
      2.35,
      anchor,
      viewport.width,
      viewport.height,
    );
    const after = screenToWorldPoint(anchor, viewport.width, viewport.height, 8, camera);

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
    expect(camera.zoom).toBeCloseTo(2.35, 8);
  });

  it('clamps invalid zoom and extreme pan without hiding the entire atlas', () => {
    const viewport = { width: 390, height: 644 };
    const invalid = clampMapCamera(
      { zoom: Number.POSITIVE_INFINITY, panX: Number.NaN, panY: Number.NEGATIVE_INFINITY },
      viewport.width,
      viewport.height,
    );
    expect(invalid).toEqual({ zoom: 1, panX: 0, panY: 0 });

    const extreme = clampMapCamera(
      { zoom: 99, panX: 100_000, panY: -100_000 },
      viewport.width,
      viewport.height,
    );
    const transform = createMapViewportTransform(viewport.width, viewport.height, 8, extreme);
    expect(extreme.zoom).toBe(MAP_MAX_ZOOM);
    expect(Number.isFinite(extreme.panX) && Number.isFinite(extreme.panY)).toBe(true);
    expect(transform.offsetX).toBeLessThan(viewport.width);
    expect(transform.offsetY + transform.renderHeight * transform.scale).toBeGreaterThan(0);
  });

  it('preserves the viewed world center across a portrait-to-landscape resize', () => {
    const portrait = { width: 390, height: 644 };
    const landscape = { width: 844, height: 390 };
    const zoomed = zoomMapCameraAtPoint(
      { zoom: 1, panX: 0, panY: 0 },
      2.2,
      { x: 160, y: 300 },
      portrait.width,
      portrait.height,
    );
    const camera = panMapCamera(zoomed, -46, 28, portrait.width, portrait.height);
    const before = screenToWorldPoint(
      { x: portrait.width / 2, y: portrait.height / 2 },
      portrait.width,
      portrait.height,
      8,
      camera,
    );
    const reframed = reframeMapCamera(
      camera,
      portrait.width,
      portrait.height,
      landscape.width,
      landscape.height,
    );
    const after = screenToWorldPoint(
      { x: landscape.width / 2, y: landscape.height / 2 },
      landscape.width,
      landscape.height,
      8,
      reframed,
    );

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
    expect(reframed.zoom).toBeCloseTo(camera.zoom, 8);
  });

  it('resolves visible territories and keeps the visible Bohai bay as sea after zoom and pan', () => {
    const presentation = buildMapPresentation(sourceRegions(), [], [], [], [], [], []);
    const viewport = { width: 390, height: 644 };
    const zoomed = zoomMapCameraAtPoint(
      { zoom: 1, panX: 0, panY: 0 },
      2.6,
      { x: 210, y: 280 },
      viewport.width,
      viewport.height,
    );
    const camera = panMapCamera(zoomed, -84, 46, viewport.width, viewport.height);
    const transform = createMapViewportTransform(viewport.width, viewport.height, 8, camera);

    let visibleRegionCount = 0;
    for (const region of presentation.regions) {
      const site = getRegionDisplaySite(region.id);
      expect(site, region.id).toBeDefined();
      const screenPoint = {
        x: transform.offsetX + (site?.x ?? 0) * transform.scale,
        y: transform.offsetY + (site?.y ?? 0) * transform.scale * transform.yScale,
      };
      if (
        screenPoint.x < 0 || screenPoint.x > viewport.width
        || screenPoint.y < 0 || screenPoint.y > viewport.height
      ) continue;
      visibleRegionCount += 1;
      expect(regionAtScreenPoint(
        presentation.regions,
        screenPoint,
        viewport.width,
        viewport.height,
        8,
        camera,
      )?.id, region.id).toBe(region.id);
    }
    expect(visibleRegionCount).toBeGreaterThan(10);

    const base = createMapViewportTransform(viewport.width, viewport.height);
    const bayAnchor = {
      x: base.offsetX + 455 * base.scale,
      y: base.offsetY + 240 * base.scale,
    };
    const bayCamera = zoomMapCameraAtPoint(
      { zoom: 1, panX: 0, panY: 0 },
      2.6,
      bayAnchor,
      viewport.width,
      viewport.height,
    );
    const bayTransform = createMapViewportTransform(viewport.width, viewport.height, 8, bayCamera);
    const bayPoint = {
      x: bayTransform.offsetX + 455 * bayTransform.scale,
      y: bayTransform.offsetY + 240 * bayTransform.scale,
    };
    expect(bayPoint.x).toBeGreaterThanOrEqual(0);
    expect(bayPoint.x).toBeLessThanOrEqual(viewport.width);
    expect(bayPoint.y).toBeGreaterThanOrEqual(0);
    expect(bayPoint.y).toBeLessThanOrEqual(viewport.height);
    expect(regionAtScreenPoint(
      presentation.regions,
      bayPoint,
      viewport.width,
      viewport.height,
      8,
      bayCamera,
    )).toBeNull();
  });
});
