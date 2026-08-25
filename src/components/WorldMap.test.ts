import { describe, expect, it } from 'vitest';

import { REGION_DEFINITIONS } from '../sim/data';
import { getRegionDisplaySite } from '../view/map-geography';
import {
  buildMapPresentation,
  createMapViewportTransform,
  regionAtScreenPoint,
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
});
