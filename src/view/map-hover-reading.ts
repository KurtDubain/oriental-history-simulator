import type {
  MapFleetView,
  MapLodScene,
  MapMarkerView,
  MapOverlay,
  MapPersonForceView,
  MapRegionView,
} from './map-contract';
import { foodDescription, formatPopulation, terrainLabel } from './map-renderer';

export type MapHoverState =
  | { kind: 'region'; region: MapRegionView; x: number; y: number }
  | { kind: 'person'; person: MapPersonForceView; x: number; y: number }
  | { kind: 'personCluster'; cluster: MapLodScene['personClusters'][number]; x: number; y: number }
  | { kind: 'fleet'; fleet: MapFleetView; x: number; y: number }
  | { kind: 'marker'; marker: MapMarkerView; x: number; y: number };

export interface MapHoverReading {
  name: string;
  type: string;
  rows: Array<[string, string]>;
}

export function mapHoverReading(hover: MapHoverState | null, overlay: MapOverlay): MapHoverReading | null {
  if (!hover) return null;
  if (hover.kind === 'region') return {
    name: hover.region.name,
    type: hover.region.port ? `${terrainLabel(hover.region.terrain)} · 港区` : terrainLabel(hover.region.terrain),
    rows: [
      ['辖属', hover.region.polityName ?? (hover.region.polityId ? '地方政权' : '无主之地')],
      ['人口', formatPopulation(hover.region.population)],
      [overlay === 'food' ? '供养' : '粮况', overlay === 'food' ? hover.region.supplyNote : foodDescription(hover.region.foodRatio)],
    ],
  };
  if (hover.kind === 'person') return {
    name: hover.person.personName,
    type: `${hover.person.status} · 可点击`,
    rows: [
      ['部曲', formatPopulation(hover.person.soldiers)],
      ['归属', hover.person.formationName ?? '独立驻留'],
      ['节制', hover.person.isCommander ? '自领' : hover.person.commanderName ?? '无'],
    ],
  };
  if (hover.kind === 'personCluster') return {
    name: `${hover.cluster.leaderName}等${hover.cluster.count}人`,
    type: '人物簇 · 点击展开',
    rows: [['总兵力', formatPopulation(hover.cluster.soldiers)]],
  };
  if (hover.kind === 'fleet') return {
    name: hover.fleet.name,
    type: '水师 · 可点击',
    rows: [['舰力', formatPopulation(hover.fleet.strength)], ['战备', `${Math.round(hover.fleet.readiness)}`], ['任务', hover.fleet.mission]],
  };
  return {
    name: hover.marker.label,
    type: `${hover.marker.categoryLabel ?? '朝局'} · 可点击`,
    rows: [[hover.marker.kind === 'capitalPulse' ? '主导' : '派系', hover.marker.factionName ?? '尚未成形'], ['实据', hover.marker.detail ?? '当季权势记录']],
  };
}
