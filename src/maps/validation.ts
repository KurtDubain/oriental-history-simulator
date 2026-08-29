import type { MapPoint, MapProfile } from './types';

export interface MapProfileIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function pointOnSegment(point: MapPoint, start: MapPoint, end: MapPoint): boolean {
  const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot >= -1e-7 && dot <= lengthSquared + 1e-7;
}

function pointInPolygon(point: MapPoint, polygon: readonly MapPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    if ((end.y > point.y) === (start.y > point.y)) continue;
    const crossing = ((start.x - end.x) * (point.y - end.y)) / (start.y - end.y) + end.x;
    if (point.x < crossing) inside = !inside;
  }
  return inside;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function addUndirected(graph: Map<string, Set<string>>, left: string, right: string): void {
  const leftEdges = graph.get(left) ?? new Set<string>();
  const rightEdges = graph.get(right) ?? new Set<string>();
  leftEdges.add(right);
  rightEdges.add(left);
  graph.set(left, leftEdges);
  graph.set(right, rightEdges);
}

function reachable(graph: Map<string, Set<string>>, start: string): Set<string> {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.get(current) ?? []) if (!visited.has(next)) pending.push(next);
  }
  return visited;
}

export function validateMapProfile(profile: MapProfile): MapProfileIssue[] {
  const issues: MapProfileIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const { simulation, presentation } = profile;
  const regionIds = new Set(simulation.regions.map((item) => item.id));
  const polityIds = new Set(simulation.polities.map((item) => item.id));
  const seaZoneIds = new Set(simulation.seaZones.map((item) => item.id));
  const shapeIds = new Set(presentation.landShapes.map((item) => item.id));

  for (const [kind, ids] of [
    ['region', simulation.regions.map((item) => item.id)],
    ['polity', simulation.polities.map((item) => item.id)],
    ['route', simulation.routes.map((item, index) => item.id ?? `route_${String(index + 1).padStart(2, '0')}`)],
    ['sea-zone', simulation.seaZones.map((item) => item.id)],
    ['sea-lane', simulation.seaLanes.map((item) => item.id)],
    ['port-link', simulation.portLinks.map((item) => item.id)],
    ['land-shape', presentation.landShapes.map((item) => item.id)],
  ] as const) {
    for (const id of duplicates(ids)) add('id.duplicate', `${kind}.${id}`, `${kind} ID ${id} 重复`);
  }

  if (!profile.id || !profile.name || !Number.isSafeInteger(profile.revision) || profile.revision < 1) {
    add('profile.identity', 'profile', '地图身份、名称或修订号无效');
  }
  if (presentation.width <= 0 || presentation.height <= 0) {
    add('presentation.size', 'presentation', '地图展示尺寸必须为正数');
  } else if (presentation.width !== 1_000 || presentation.height !== 700) {
    add('presentation.contract', 'presentation', '当前舆图相机契约固定为 1000×700 世界坐标');
  }

  for (const polity of simulation.polities) {
    const capital = simulation.regions.find((item) => item.id === polity.capitalRegionId);
    if (!capital) add('polity.capital', `polities.${polity.id}`, `首都 ${polity.capitalRegionId} 不存在`);
    else if (capital.initialControllerId !== polity.id) add('polity.capital-owner', `polities.${polity.id}`, '首都初始控制权不属于该政权');
    if (polity.maritimeOrientation < 0 || polity.maritimeOrientation > 100) {
      add('polity.maritime', `polities.${polity.id}`, '海洋倾向必须在 0 到 100 之间');
    }
  }
  for (const region of simulation.regions) {
    if (!polityIds.has(region.initialControllerId)) add('region.controller', `regions.${region.id}`, `初始政权 ${region.initialControllerId} 不存在`);
  }
  for (const route of simulation.routes) {
    if (!regionIds.has(route.fromRegionId) || !regionIds.has(route.toRegionId) || route.fromRegionId === route.toRegionId) {
      add('route.endpoint', `routes.${route.id ?? `${route.fromRegionId}:${route.toRegionId}`}`, '路线端点不存在或指向自身');
    }
  }
  for (const lane of simulation.seaLanes) {
    if (!seaZoneIds.has(lane.fromSeaZoneId) || !seaZoneIds.has(lane.toSeaZoneId) || lane.fromSeaZoneId === lane.toSeaZoneId) {
      add('sea-lane.endpoint', `seaLanes.${lane.id}`, '航线端点不存在或指向自身');
    }
  }
  for (const link of simulation.portLinks) {
    const region = simulation.regions.find((item) => item.id === link.regionId);
    if (!region || !region.port || !seaZoneIds.has(link.seaZoneId)) {
      add('port-link.endpoint', `portLinks.${link.id}`, '港口连接没有闭合到有效港区与海域');
    }
  }
  for (const region of simulation.regions.filter((item) => item.port)) {
    if (!simulation.portLinks.some((item) => item.regionId === region.id)) {
      add('port.unlinked', `regions.${region.id}`, '港区没有连接任何海域');
    }
  }

  const siteIds = Object.keys(presentation.regionDisplaySites);
  for (const id of siteIds.filter((id) => !regionIds.has(id))) add('display.orphan', `regionDisplaySites.${id}`, '展示点没有对应模拟地区');
  for (const region of simulation.regions) {
    const site = presentation.regionDisplaySites[region.id];
    if (!site) {
      add('display.missing', `regions.${region.id}`, '模拟地区缺少唯一展示位置');
      continue;
    }
    const shape = presentation.landShapes.find((item) => item.id === site.shapeId);
    if (!shape) add('display.shape', `regionDisplaySites.${region.id}`, `展示陆形 ${site.shapeId} 不存在`);
    else if (!pointInPolygon(site, shape.polygon)) add('display.outside', `regionDisplaySites.${region.id}`, '展示点没有落在对应陆形内');
  }
  for (const shape of presentation.landShapes) {
    const count = Object.values(presentation.regionDisplaySites).filter((item) => item.shapeId === shape.id).length;
    if (count !== shape.expectedRegionCount) add('shape.region-count', `landShapes.${shape.id}`, `声明 ${shape.expectedRegionCount} 区，实际 ${count} 区`);
  }
  for (const shape of presentation.territoryShapes) {
    if (!shapeIds.has(shape.id)) add('territory.shape', `territoryShapes.${shape.id}`, '领地裁切框没有对应陆形');
  }
  for (const zone of simulation.seaZones) {
    const center = presentation.seaZoneDisplayCenters[zone.id];
    if (!center) add('sea.display', `seaZones.${zone.id}`, '海域缺少展示中心');
    else if (presentation.landShapes.some((shape) => pointInPolygon(center, shape.polygon))) {
      add('sea.display-on-land', `seaZones.${zone.id}`, '海域展示中心落在陆形内');
    }
  }

  const graph = new Map<string, Set<string>>();
  for (const id of [...regionIds, ...seaZoneIds]) graph.set(id, new Set());
  for (const route of simulation.routes.filter((item) => item.kind !== '海峡')) addUndirected(graph, route.fromRegionId, route.toRegionId);
  for (const lane of simulation.seaLanes) addUndirected(graph, lane.fromSeaZoneId, lane.toSeaZoneId);
  for (const link of simulation.portLinks) addUndirected(graph, link.regionId, link.seaZoneId);
  const firstRegion = simulation.regions[0]?.id;
  if (firstRegion) {
    const visited = reachable(graph, firstRegion);
    for (const id of [...regionIds, ...seaZoneIds]) if (!visited.has(id)) add('transport.disconnected', id, `${id} 不在完整海陆运输图中`);
  }
  return issues.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
}

export function assertValidMapProfile(profile: MapProfile): void {
  const issues = validateMapProfile(profile);
  if (issues.length === 0) return;
  throw new Error(`地图配置 ${profile.id}@${profile.revision} 无效：\n${issues.map((issue) => `- [${issue.code}] ${issue.path}: ${issue.message}`).join('\n')}`);
}
