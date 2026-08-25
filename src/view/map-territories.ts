/**
 * Pure geometry used by the Canvas map to turn region sites into a continuous
 * territorial layer. The result is an ordinary (unweighted) Voronoi diagram
 * clipped to each land shape with successive half-plane cuts.
 *
 * Land polygons must be simple rings whose vertices are listed in boundary
 * order. Clockwise and counter-clockwise rings are both accepted.
 */

export interface TerritoryPoint {
  readonly x: number;
  readonly y: number;
}

export interface TerritoryLandShape {
  readonly id: string;
  readonly polygon: readonly TerritoryPoint[];
}

export interface TerritorySite {
  readonly id: string;
  readonly shapeId: string;
  readonly x: number;
  readonly y: number;
}

export interface TerritoryCell {
  readonly siteId: string;
  readonly shapeId: string;
  readonly site: TerritoryPoint;
  readonly polygon: TerritoryPoint[];
}

export interface TerritoryCellOptions {
  /** Numeric tolerance used for boundary and half-plane comparisons. */
  readonly epsilon?: number;
}

const DEFAULT_EPSILON = 1e-7;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertFinitePoint(point: TerritoryPoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must have finite x and y coordinates.`);
  }
}

function squaredDistance(left: TerritoryPoint, right: TerritoryPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function pointsNear(left: TerritoryPoint, right: TerritoryPoint, epsilon: number): boolean {
  return squaredDistance(left, right) <= epsilon * epsilon;
}

function removeAdjacentDuplicates(
  polygon: readonly TerritoryPoint[],
  epsilon: number,
): TerritoryPoint[] {
  const result: TerritoryPoint[] = [];
  for (const point of polygon) {
    if (result.length === 0 || !pointsNear(result[result.length - 1], point, epsilon)) {
      result.push({ x: point.x, y: point.y });
    }
  }
  if (result.length > 1 && pointsNear(result[0], result[result.length - 1], epsilon)) {
    result.pop();
  }
  return result;
}

function removeCollinearVertices(
  polygon: readonly TerritoryPoint[],
  epsilon: number,
): TerritoryPoint[] {
  if (polygon.length < 3) return [...polygon];

  const result: TerritoryPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length];
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const firstX = current.x - previous.x;
    const firstY = current.y - previous.y;
    const secondX = next.x - current.x;
    const secondY = next.y - current.y;
    const cross = firstX * secondY - firstY * secondX;
    const scale = Math.max(1, Math.hypot(firstX, firstY) + Math.hypot(secondX, secondY));
    if (Math.abs(cross) > epsilon * scale) result.push({ x: current.x, y: current.y });
  }
  return result.length >= 3 ? result : [...polygon];
}

function rotateToStableStart(polygon: readonly TerritoryPoint[]): TerritoryPoint[] {
  if (polygon.length === 0) return [];
  let firstIndex = 0;
  for (let index = 1; index < polygon.length; index += 1) {
    const point = polygon[index];
    const first = polygon[firstIndex];
    if (point.x < first.x || (point.x === first.x && point.y < first.y)) firstIndex = index;
  }
  return polygon.map((_, offset) => {
    const point = polygon[(firstIndex + offset) % polygon.length];
    return { x: point.x, y: point.y };
  });
}

function normalizePolygon(
  polygon: readonly TerritoryPoint[],
  epsilon: number,
): TerritoryPoint[] {
  return rotateToStableStart(removeCollinearVertices(
    removeAdjacentDuplicates(polygon, epsilon),
    epsilon,
  ));
}

function pointOnSegment(
  point: TerritoryPoint,
  start: TerritoryPoint,
  end: TerritoryPoint,
  epsilon: number,
): boolean {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const pointX = point.x - start.x;
  const pointY = point.y - start.y;
  const cross = edgeX * pointY - edgeY * pointX;
  const scale = Math.max(1, Math.hypot(edgeX, edgeY));
  if (Math.abs(cross) > epsilon * scale) return false;

  const dot = pointX * edgeX + pointY * edgeY;
  return dot >= -epsilon && dot <= edgeX * edgeX + edgeY * edgeY + epsilon;
}

function pointInPolygon(
  point: TerritoryPoint,
  polygon: readonly TerritoryPoint[],
  epsilon: number,
): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1) {
    const start = polygon[previousIndex];
    const end = polygon[index];
    if (pointOnSegment(point, start, end, epsilon)) return true;

    const crossesRay = (end.y > point.y) !== (start.y > point.y);
    if (!crossesRay) continue;
    const crossingX = ((start.x - end.x) * (point.y - end.y)) / (start.y - end.y) + end.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

function clipToCloserHalfPlane(
  polygon: readonly TerritoryPoint[],
  site: TerritorySite,
  competitor: TerritorySite,
  epsilon: number,
): TerritoryPoint[] {
  if (polygon.length === 0) return [];

  const normalX = competitor.x - site.x;
  const normalY = competitor.y - site.y;
  const normalLengthSquared = normalX * normalX + normalY * normalY;

  // Coincident sites have no geometric bisector. Keeping the same cell for both
  // is deterministic and, more importantly, avoids deleting either region.
  if (normalLengthSquared <= epsilon * epsilon) return [...polygon];

  const offset = (
    competitor.x * competitor.x + competitor.y * competitor.y
    - site.x * site.x - site.y * site.y
  ) / 2;
  const evaluationScale = Math.max(1, Math.abs(offset), Math.sqrt(normalLengthSquared));
  const tolerance = epsilon * evaluationScale;
  const evaluate = (point: TerritoryPoint) => normalX * point.x + normalY * point.y - offset;

  const clipped: TerritoryPoint[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const startValue = evaluate(start);
    const endValue = evaluate(end);
    const startInside = startValue <= tolerance;
    const endInside = endValue <= tolerance;

    if (startInside && endInside) {
      clipped.push({ x: end.x, y: end.y });
      continue;
    }
    if (startInside === endInside) continue;

    const denominator = startValue - endValue;
    if (Math.abs(denominator) > Number.EPSILON) {
      const ratio = Math.max(0, Math.min(1, startValue / denominator));
      clipped.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      });
    }
    if (!startInside && endInside) clipped.push({ x: end.x, y: end.y });
  }

  return removeAdjacentDuplicates(clipped, epsilon);
}

function validateAndNormalizeShape(
  shape: TerritoryLandShape,
  epsilon: number,
): TerritoryLandShape {
  if (!shape.id) throw new TypeError('Every land shape must have a non-empty id.');
  shape.polygon.forEach((point, index) => assertFinitePoint(point, `Land shape "${shape.id}" point ${index}`));
  const polygon = normalizePolygon(shape.polygon, epsilon);
  if (polygon.length < 3) {
    throw new RangeError(`Land shape "${shape.id}" must contain at least three distinct vertices.`);
  }
  return { id: shape.id, polygon };
}

/**
 * Builds one clipped Voronoi-like polygon for every supplied site.
 *
 * Results are sorted by shape id and then site id, so permutations of otherwise
 * identical input produce byte-for-byte identical output. Inputs are never
 * mutated. Sites must lie on or inside their assigned land shape.
 */
export function buildTerritoryCells(
  shapes: readonly TerritoryLandShape[],
  sites: readonly TerritorySite[],
  options: TerritoryCellOptions = {},
): TerritoryCell[] {
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new RangeError('Territory-cell epsilon must be a finite positive number.');
  }

  const shapeById = new Map<string, TerritoryLandShape>();
  for (const inputShape of shapes) {
    const shape = validateAndNormalizeShape(inputShape, epsilon);
    if (shapeById.has(shape.id)) throw new RangeError(`Duplicate land shape id "${shape.id}".`);
    shapeById.set(shape.id, shape);
  }

  const siteIds = new Set<string>();
  const sortedSites = sites.map((site) => {
    if (!site.id) throw new TypeError('Every territory site must have a non-empty id.');
    if (siteIds.has(site.id)) throw new RangeError(`Duplicate territory site id "${site.id}".`);
    siteIds.add(site.id);
    assertFinitePoint(site, `Territory site "${site.id}"`);
    const shape = shapeById.get(site.shapeId);
    if (!shape) throw new RangeError(`Territory site "${site.id}" references unknown shape "${site.shapeId}".`);
    if (!pointInPolygon(site, shape.polygon, epsilon)) {
      throw new RangeError(`Territory site "${site.id}" lies outside shape "${site.shapeId}".`);
    }
    return site;
  }).sort((left, right) => (
    compareText(left.shapeId, right.shapeId)
    || compareText(left.id, right.id)
    || left.x - right.x
    || left.y - right.y
  ));

  const sitesByShape = new Map<string, TerritorySite[]>();
  for (const site of sortedSites) {
    const group = sitesByShape.get(site.shapeId) ?? [];
    group.push(site);
    sitesByShape.set(site.shapeId, group);
  }

  return sortedSites.map((site) => {
    const shape = shapeById.get(site.shapeId) as TerritoryLandShape;
    let polygon = shape.polygon.map((point) => ({ x: point.x, y: point.y }));
    for (const competitor of sitesByShape.get(site.shapeId) ?? []) {
      if (competitor.id === site.id) continue;
      polygon = clipToCloserHalfPlane(polygon, site, competitor, epsilon);
      if (polygon.length === 0) break;
    }
    polygon = normalizePolygon(polygon, epsilon);
    if (polygon.length < 3) {
      throw new RangeError(`Territory site "${site.id}" produced a degenerate cell.`);
    }
    return {
      siteId: site.id,
      shapeId: site.shapeId,
      site: { x: site.x, y: site.y },
      polygon,
    };
  });
}

