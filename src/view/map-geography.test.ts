import { describe, expect, it } from 'vitest';
import { REGION_DEFINITIONS } from '../sim/data';
import {
  MAP_LAND_SHAPES,
  MAP_MACRO_LABELS,
  MAP_PRESENTATION_HEIGHT,
  MAP_PRESENTATION_WIDTH,
  MAP_TERRITORY_SHAPES,
  REGION_DISPLAY_SITES,
  getRegionDisplaySite,
  getSeaZoneDisplayCenter,
  type MapLandShape,
} from './map-geography';
import { buildTerritoryCells, type TerritoryPoint } from './map-territories';

const SEA_ZONE_IDS = [
  'sea_bohai', 'sea_shandong', 'sea_north_strait', 'sea_fujian', 'sea_taiwan',
  'sea_guangdong', 'sea_qiongzhou', 'sea_korea', 'sea_japan_inland', 'sea_east_ocean',
] as const;

function pointOnSegment(point: TerritoryPoint, start: TerritoryPoint, end: TerritoryPoint): boolean {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const pointX = point.x - start.x;
  const pointY = point.y - start.y;
  const cross = edgeX * pointY - edgeY * pointX;
  if (Math.abs(cross) > 1e-7) return false;
  const dot = pointX * edgeX + pointY * edgeY;
  return dot >= -1e-7 && dot <= edgeX * edgeX + edgeY * edgeY + 1e-7;
}

function containsPoint(point: TerritoryPoint, polygon: readonly TerritoryPoint[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1) {
    const start = polygon[previousIndex];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    if ((end.y > point.y) !== (start.y > point.y)) {
      const crossingX = ((start.x - end.x) * (point.y - end.y)) / (start.y - end.y) + end.x;
      if (point.x < crossingX) inside = !inside;
    }
  }
  return inside;
}

function bounds(shape: MapLandShape) {
  return shape.polygon.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x),
    maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y),
    maxY: Math.max(result.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
}

function polygonArea(polygon: readonly TerritoryPoint[]): number {
  return Math.abs(polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

describe('presentation-only map geography', () => {
  it('covers the fixed 82-region contract exactly once', () => {
    const expectedIds = REGION_DEFINITIONS.map((region) => region.id).sort();
    const displayIds = Object.keys(REGION_DISPLAY_SITES).sort();

    expect(expectedIds).toHaveLength(82);
    expect(displayIds).toEqual(expectedIds);
    expect(new Set(displayIds).size).toBe(82);
    expect(getRegionDisplaySite('r_yanjing')).toMatchObject({ shapeId: 'land_northern' });
    expect(getRegionDisplaySite('unknown')).toBeUndefined();
  });

  it('defines a connected northern peninsula system, a southern land and six islands', () => {
    expect(MAP_LAND_SHAPES).toHaveLength(8);
    expect(MAP_LAND_SHAPES.filter((shape) => shape.role === 'mainland').map((shape) => shape.id))
      .toEqual(['land_northern', 'land_lingnan']);
    expect(MAP_LAND_SHAPES.filter((shape) => shape.role === 'island').map((shape) => shape.id))
      .toEqual([
        'island_hainan', 'island_taiwan', 'island_kyushu', 'island_shikoku',
        'island_honshu', 'island_hokkaido',
      ]);

    for (const shape of MAP_LAND_SHAPES) {
      const assignedCount = Object.values(REGION_DISPLAY_SITES)
        .filter((site) => site.shapeId === shape.id).length;
      expect(assignedCount, shape.id).toBe(shape.expectedRegionCount);
    }
  });

  it('keeps every site inside its coast and produces 82 clickable territory cells', () => {
    const shapeById = new Map(MAP_LAND_SHAPES.map((shape) => [shape.id, shape]));
    const sites = Object.values(REGION_DISPLAY_SITES);

    for (const site of sites) {
      const shape = shapeById.get(site.shapeId);
      expect(shape, site.id).toBeDefined();
      expect(containsPoint(site, shape?.polygon ?? []), site.id).toBe(true);
    }

    const cells = buildTerritoryCells(MAP_TERRITORY_SHAPES, sites);
    expect(cells).toHaveLength(82);
    expect(cells.every((cell) => cell.polygon.length >= 3)).toBe(true);
  });

  it('preserves the reference ocean ratio, deep bay, sea gaps and Japanese arc', () => {
    const shapeById = new Map(MAP_LAND_SHAPES.map((shape) => [shape.id, shape]));
    const northern = bounds(shapeById.get('land_northern') as MapLandShape);
    const lingnan = bounds(shapeById.get('land_lingnan') as MapLandShape);
    const hainan = bounds(shapeById.get('island_hainan') as MapLandShape);

    expect(lingnan.minY - northern.maxY).toBeGreaterThanOrEqual(55);
    expect(hainan.minY - lingnan.maxY).toBeGreaterThanOrEqual(12);
    expect(containsPoint({ x: 455, y: 240 }, shapeById.get('land_northern')?.polygon ?? []))
      .toBe(false);

    const landShare = MAP_LAND_SHAPES.reduce((sum, shape) => sum + polygonArea(shape.polygon), 0)
      / (MAP_PRESENTATION_WIDTH * MAP_PRESENTATION_HEIGHT);
    expect(landShare).toBeGreaterThan(0.15);
    expect(landShare).toBeLessThan(0.19);

    expect(getRegionDisplaySite('r_tsukushi')?.shapeId).toBe('island_kyushu');
    expect(getRegionDisplaySite('r_shikoku')?.shapeId).toBe('island_shikoku');
    for (const regionId of ['r_chugoku', 'r_naniwa', 'r_yamato', 'r_tokai', 'r_kanto']) {
      expect(getRegionDisplaySite(regionId)?.shapeId).toBe('island_honshu');
    }
    expect(getRegionDisplaySite('r_ou')?.shapeId).toBe('island_hokkaido');
    for (const regionId of ['r_xianjing', 'r_pyongyang', 'r_kaesong', 'r_hanjing', 'r_jeonju', 'r_gyeongju']) {
      expect(getRegionDisplaySite(regionId)?.shapeId).toBe('land_northern');
    }
  });

  it('places all sea anchors in ocean and all labels inside the presentation world', () => {
    for (const seaZoneId of SEA_ZONE_IDS) {
      const center = getSeaZoneDisplayCenter(seaZoneId);
      expect(center, seaZoneId).toBeDefined();
      expect(center?.x).toBeGreaterThanOrEqual(0);
      expect(center?.x).toBeLessThanOrEqual(MAP_PRESENTATION_WIDTH);
      expect(center?.y).toBeGreaterThanOrEqual(0);
      expect(center?.y).toBeLessThanOrEqual(MAP_PRESENTATION_HEIGHT);
      expect(MAP_LAND_SHAPES.some((shape) => containsPoint(center as TerritoryPoint, shape.polygon)), seaZoneId)
        .toBe(false);
    }

    for (const label of MAP_MACRO_LABELS) {
      expect(label.center.x).toBeGreaterThanOrEqual(0);
      expect(label.center.x).toBeLessThanOrEqual(MAP_PRESENTATION_WIDTH);
      expect(label.center.y).toBeGreaterThanOrEqual(0);
      expect(label.center.y).toBeLessThanOrEqual(MAP_PRESENTATION_HEIGHT);
    }
  });
});
