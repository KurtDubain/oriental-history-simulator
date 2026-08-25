import { describe, expect, it } from 'vitest';
import { REGION_DEFINITIONS } from '../sim/data';
import {
  MAP_LAND_SHAPES,
  MAP_MACRO_LABELS,
  MAP_PRESENTATION_HEIGHT,
  MAP_PRESENTATION_WIDTH,
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

  it('defines three mainlands plus five detached island shapes', () => {
    expect(MAP_LAND_SHAPES).toHaveLength(8);
    expect(MAP_LAND_SHAPES.filter((shape) => shape.role === 'mainland').map((shape) => shape.id))
      .toEqual(['land_northern', 'land_lingnan', 'land_korea']);
    expect(MAP_LAND_SHAPES.filter((shape) => shape.role === 'island').map((shape) => shape.id))
      .toEqual([
        'island_hainan', 'island_taiwan', 'island_kyushu', 'island_shikoku', 'island_honshu',
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

    const cells = buildTerritoryCells(MAP_LAND_SHAPES, sites);
    expect(cells).toHaveLength(82);
    expect(cells.every((cell) => cell.polygon.length >= 3)).toBe(true);
  });

  it('preserves visible ocean seams and splits the Japanese islands', () => {
    const shapeById = new Map(MAP_LAND_SHAPES.map((shape) => [shape.id, shape]));
    const northern = bounds(shapeById.get('land_northern') as MapLandShape);
    const lingnan = bounds(shapeById.get('land_lingnan') as MapLandShape);
    const korea = bounds(shapeById.get('land_korea') as MapLandShape);
    const hainan = bounds(shapeById.get('island_hainan') as MapLandShape);
    const taiwan = bounds(shapeById.get('island_taiwan') as MapLandShape);

    expect(lingnan.minY - northern.maxY).toBeGreaterThanOrEqual(16);
    expect(korea.minX - northern.maxX).toBeGreaterThanOrEqual(16);
    expect(hainan.minY - lingnan.maxY).toBeGreaterThanOrEqual(12);
    expect(taiwan.minX - lingnan.maxX).toBeGreaterThanOrEqual(12);

    expect(getRegionDisplaySite('r_tsukushi')?.shapeId).toBe('island_kyushu');
    expect(getRegionDisplaySite('r_shikoku')?.shapeId).toBe('island_shikoku');
    for (const regionId of ['r_chugoku', 'r_naniwa', 'r_yamato', 'r_tokai', 'r_kanto', 'r_ou']) {
      expect(getRegionDisplaySite(regionId)?.shapeId).toBe('island_honshu');
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
