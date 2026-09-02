import { describe, expect, it } from 'vitest';
// @ts-expect-error Tests read one local stylesheet; browser production code has no Node types.
import { readFileSync } from 'node:fs';

import { REGION_DEFINITIONS } from '../sim/data';
import { getRegionDisplaySite } from '../view/map-geography';
import {
  armyAtScreenPoint,
  buildMapPresentation,
  clampMapCamera,
  createMapViewportTransform,
  layoutMapArmyIcons,
  layoutMapRegionNodes,
  MAP_MAX_ZOOM,
  panMapCamera,
  reframeMapCamera,
  regionAtScreenPoint,
  regionNodeAtScreenPoint,
  screenToWorldPoint,
  zoomMapCameraAtPoint,
  type MapArmyView,
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
    supplyNote: '供养尚稳',
  }));
}

describe('WorldBox-style presentation atlas', () => {
  it('reprojects all 82 authoritative regions without mutating simulation coordinates', () => {
    const source = sourceRegions();
    const rawYanjing = { ...source.find((region) => region.id === 'r_yanjing')?.center };
    const presentation = buildMapPresentation(source, [], [], [], [], []);

    expect(presentation.regions).toHaveLength(82);
    expect(presentation.regions.every((region) => region.polygon.length >= 3)).toBe(true);
    expect(source.find((region) => region.id === 'r_yanjing')?.center).toEqual(rawYanjing);
    expect(presentation.regions.find((region) => region.id === 'r_yanjing')?.center)
      .toEqual({ x: 367, y: 188 });
  });

  it('makes each display site hit its continuous territory on wide and compact maps', () => {
    const presentation = buildMapPresentation(sourceRegions(), [], [], [], [], []);
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
    const presentation = buildMapPresentation(sourceRegions(), [], [], [], [], []);
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

  it('projects region-anchored fleets onto the illustrated sea atlas', () => {
    const source = sourceRegions();
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
      [],
    );

    expect(presentation.seaZones[0].center).toEqual({ x: 455, y: 240 });
    expect(presentation.fleets[0].position).toEqual({ x: 455, y: 240 });
  });

  it('uses the same offset screen anchors to draw and hit stacked land armies', () => {
    const armies: MapArmyView[] = [{
      id: 'army-a',
      name: '燕山军',
      regionId: 'r_yanjing',
      strength: 12_000,
    }, {
      id: 'army-b',
      name: '神策军',
      regionId: 'r_yanjing',
      strength: 8_000,
    }];
    const presentation = buildMapPresentation(sourceRegions(), [], armies, [], [], []);
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const layouts = layoutMapArmyIcons(presentation.armies, presentation.regions, transform);
    const region = presentation.regions.find((item) => item.id === 'r_yanjing') as MapRegionView;
    const regionPoint = {
      x: transform.offsetX + region.center.x * transform.scale,
      y: transform.offsetY + region.center.y * transform.scale * transform.yScale,
    };

    expect(layouts).toHaveLength(2);
    expect(layouts[0].point).toEqual({ x: regionPoint.x + 14, y: regionPoint.y - 12 });
    expect(layouts[1].point).toEqual({ x: regionPoint.x + 31, y: regionPoint.y - 12 });
    expect(armyAtScreenPoint(
      presentation.armies,
      presentation.regions,
      layouts[0].point,
      viewport.width,
      viewport.height,
    )?.id).toBe('army-a');
    expect(armyAtScreenPoint(
      presentation.armies,
      presentation.regions,
      layouts[1].point,
      viewport.width,
      viewport.height,
    )?.id).toBe('army-b');
  });

  it('keeps land-army taps aligned after mobile zoom and pan without mutating map inputs', () => {
    const regions = sourceRegions();
    const armies: MapArmyView[] = [{
      id: 'army-touch',
      name: '河朔军',
      regionId: 'r_yanjing',
      strength: 15_000,
    }];
    const presentation = buildMapPresentation(regions, [], armies, [], [], []);
    const inputBefore = JSON.stringify({ regions, armies, presentation });
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
    const forgivingTouchPoint = { x: layout.point.x + 19, y: layout.point.y };

    expect(armyAtScreenPoint(
      presentation.armies,
      presentation.regions,
      forgivingTouchPoint,
      viewport.width,
      viewport.height,
      8,
      camera,
      true,
    )?.id).toBe('army-touch');
    expect(armyAtScreenPoint(
      presentation.armies,
      presentation.regions,
      forgivingTouchPoint,
      viewport.width,
      viewport.height,
      8,
      camera,
      false,
    )).toBeNull();
    expect(JSON.stringify({ regions, armies, presentation })).toBe(inputBefore);
  });

  it('uses shared city and offshore port anchors as region click targets', () => {
    const source = sourceRegions().map((region, index) => index === 0 ? {
      ...region,
      cityLevel: 4,
      capital: true,
      port: true,
      portLevel: 3,
    } : region);
    const presentation = buildMapPresentation(source, [], [], [{
      id: 'sea-node-test',
      name: '试港外海',
      center: { x: 650, y: 150 },
      climate: '近海',
      contested: false,
      powerShare: 0,
    }], [], []);
    const viewport = { width: 1210, height: 560 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const target = presentation.regions[0];
    const nodes = layoutMapRegionNodes([target], presentation.seaZones, transform);

    expect(nodes.map((node) => node.kind)).toEqual(['city', 'port']);
    const port = nodes.find((node) => node.kind === 'port');
    expect(port).toBeDefined();
    expect(regionNodeAtScreenPoint(
      [target],
      presentation.seaZones,
      port?.point ?? { x: 0, y: 0 },
      viewport.width,
      viewport.height,
    )?.region.id).toBe(target.id);
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
    const presentation = buildMapPresentation(sourceRegions(), [], [], [], [], []);
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

describe('political map tooltip reading contract', () => {
  it('lets concrete political evidence wrap onto multiple lines instead of clipping it', () => {
    const worldMapStyles = readFileSync(new URL('../styles/world-map.css', import.meta.url), 'utf8');
    const worldMapSource = readFileSync(new URL('./WorldMap.tsx', import.meta.url), 'utf8');
    expect(worldMapSource).toContain('world-map__tooltip--political');
    const detailRules = [...worldMapStyles.matchAll(/\.world-map__tooltip--political dd\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .join('\n');

    expect(detailRules).toContain('white-space: normal');
    expect(detailRules).toContain('overflow-wrap: anywhere');
    expect(detailRules).not.toContain('line-clamp');
    expect(detailRules).not.toContain('ellipsis');
    expect(detailRules).not.toContain('white-space: nowrap');
  });
});
