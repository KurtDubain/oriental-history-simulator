import { describe, expect, it } from 'vitest';
import {
  buildTerritoryCells,
  type TerritoryCell,
  type TerritoryLandShape,
  type TerritoryPoint,
  type TerritorySite,
} from './map-territories';

const EPSILON = 1e-6;

function pointOnSegment(point: TerritoryPoint, start: TerritoryPoint, end: TerritoryPoint): boolean {
  const cross = (end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x);
  if (Math.abs(cross) > EPSILON) return false;
  const dot = (point.x - start.x) * (end.x - start.x)
    + (point.y - start.y) * (end.y - start.y);
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot >= -EPSILON && dot <= lengthSquared + EPSILON;
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

function polygonArea(polygon: readonly TerritoryPoint[]): number {
  return Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function expectCellInsideShape(cell: TerritoryCell, shape: TerritoryLandShape): void {
  expect(cell.polygon.length).toBeGreaterThanOrEqual(3);
  expect(containsPoint(cell.site, cell.polygon)).toBe(true);
  for (const vertex of cell.polygon) {
    expect(containsPoint(vertex, shape.polygon)).toBe(true);
  }
}

describe('continuous map territory cells', () => {
  it('partitions all visible land and keeps every site inside its cell', () => {
    const shape: TerritoryLandShape = {
      id: 'mainland',
      polygon: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 80 },
        { x: 0, y: 80 },
      ],
    };
    const sites: TerritorySite[] = [
      { id: 'north-west', shapeId: shape.id, x: 24, y: 20 },
      { id: 'north-east', shapeId: shape.id, x: 96, y: 20 },
      { id: 'south-west', shapeId: shape.id, x: 24, y: 60 },
      { id: 'south-east', shapeId: shape.id, x: 96, y: 60 },
    ];

    const cells = buildTerritoryCells([shape], sites);

    expect(cells.map((cell) => cell.siteId)).toEqual([
      'north-east', 'north-west', 'south-east', 'south-west',
    ]);
    cells.forEach((cell) => expectCellInsideShape(cell, shape));
    expect(cells.reduce((area, cell) => area + polygonArea(cell.polygon), 0))
      .toBeCloseTo(polygonArea(shape.polygon), 7);
  });

  it('creates a valid cell for every site across the supported 24–82 site range', () => {
    const shapes: TerritoryLandShape[] = [
      {
        id: 'continent',
        polygon: [
          { x: 0, y: 0 }, { x: 1000, y: 0 },
          { x: 1000, y: 600 }, { x: 0, y: 600 },
        ],
      },
      {
        id: 'island',
        polygon: [
          { x: 1050, y: 120 }, { x: 1250, y: 100 },
          { x: 1280, y: 360 }, { x: 1080, y: 390 },
        ],
      },
    ];
    const continentSites = Array.from({ length: 72 }, (_, index): TerritorySite => ({
      id: `continent-${String(index).padStart(2, '0')}`,
      shapeId: 'continent',
      x: 50 + (index % 12) * 82,
      y: 50 + Math.floor(index / 12) * 100,
    }));
    const islandSites = Array.from({ length: 10 }, (_, index): TerritorySite => ({
      id: `island-${String(index).padStart(2, '0')}`,
      shapeId: 'island',
      x: 1090 + (index % 2) * 100,
      y: 145 + Math.floor(index / 2) * 48,
    }));

    const cells = buildTerritoryCells(shapes, [...continentSites, ...islandSites]);

    expect(cells).toHaveLength(82);
    expect(new Set(cells.map((cell) => cell.siteId)).size).toBe(82);
    const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
    cells.forEach((cell) => expectCellInsideShape(cell, shapeById.get(cell.shapeId) as TerritoryLandShape));

    const firstTwentyFour = buildTerritoryCells(shapes, [
      ...continentSites.slice(0, 20),
      ...islandSites.slice(0, 4),
    ]);
    expect(firstTwentyFour).toHaveLength(24);
  });

  it('is deterministic even when shapes and sites arrive in a different order', () => {
    const shapes: TerritoryLandShape[] = [
      { id: 'b', polygon: [{ x: 100, y: 0 }, { x: 190, y: 0 }, { x: 190, y: 90 }, { x: 100, y: 90 }] },
      { id: 'a', polygon: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }] },
    ];
    const sites: TerritorySite[] = [
      { id: 'four', shapeId: 'b', x: 150, y: 50 },
      { id: 'two', shapeId: 'a', x: 70, y: 45 },
      { id: 'one', shapeId: 'a', x: 20, y: 45 },
      { id: 'three', shapeId: 'b', x: 120, y: 50 },
    ];

    expect(buildTerritoryCells(shapes, sites))
      .toEqual(buildTerritoryCells([...shapes].reverse(), [...sites].reverse()));
  });

  it('rejects invalid shape assignments rather than returning misleading cells', () => {
    const shape: TerritoryLandShape = {
      id: 'known',
      polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
    };
    expect(() => buildTerritoryCells([shape], [
      { id: 'missing-shape', shapeId: 'unknown', x: 4, y: 4 },
    ])).toThrow(/unknown shape/);
    expect(() => buildTerritoryCells([shape], [
      { id: 'outside', shapeId: 'known', x: 40, y: 40 },
    ])).toThrow(/outside shape/);
  });
});
