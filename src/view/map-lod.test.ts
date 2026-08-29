import { describe, expect, it } from 'vitest';

import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapArmyView,
  MapFleetView,
  MapFlowView,
  MapMarkerView,
  MapPresentationView,
  MapRegionView,
  MapSeaZoneView,
} from './map-contract';
import {
  MAP_LOD_THRESHOLDS,
  buildMapLodScene,
  resolveMapLodLevel,
} from './map-lod';

const polygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

function region(
  id: string,
  polityId: string | undefined,
  options: Partial<MapRegionView> = {},
): MapRegionView {
  return {
    id,
    name: id,
    polygon,
    center: { x: 5, y: 5 },
    terrain: '平原',
    polityId,
    population: 100,
    foodRatio: 1,
    cityLevel: 2,
    strategicValue: 7,
    ...options,
  };
}

function fixture(): MapPresentationView {
  const regions = [
    region('r_a_capital', 'p_a', { capital: true, cityLevel: 4, strategicValue: 10 }),
    region('r_a_large', 'p_a', { cityLevel: 3, strategicValue: 8, population: 180 }),
    region('r_a_strategic', 'p_a', { cityLevel: 3, strategicValue: 9, population: 120, port: true }),
    region('r_b_capital', 'p_b', { capital: true, cityLevel: 4, strategicValue: 10 }),
    region('r_b_key', 'p_b', { cityLevel: 3, strategicValue: 9, population: 130, port: true }),
    region('r_unowned', undefined, { cityLevel: 1 }),
  ];
  const armies: MapArmyView[] = [
    { id: 'a_a_small', name: '甲偏师', polityId: 'p_a', regionId: 'r_a_large', strength: 800 },
    { id: 'a_a_large', name: '甲主力', polityId: 'p_a', regionId: 'r_a_capital', strength: 1_200 },
    { id: 'a_b_tie_z', name: '乙后军', polityId: 'p_b', regionId: 'r_b_key', strength: 900 },
    { id: 'a_b_tie_a', name: '乙前军', polityId: 'p_b', regionId: 'r_b_capital', strength: 900 },
    { id: 'a_unowned', name: '无属军', regionId: 'r_unowned', strength: 2_000 },
  ];
  const fleets: MapFleetView[] = [
    { id: 'f_a_small', name: '甲舟师', polityId: 'p_a', position: { x: 20, y: 20 }, strength: 20, readiness: 60, mission: '巡逻' },
    { id: 'f_a_large', name: '甲水师', polityId: 'p_a', position: { x: 30, y: 20 }, strength: 40, readiness: 60, mission: '巡逻' },
    { id: 'f_b', name: '乙水师', polityId: 'p_b', position: { x: 40, y: 20 }, strength: 30, readiness: 60, mission: '巡逻' },
  ];
  const flows: MapFlowView[] = [{
    id: 'flow_trade',
    kind: 'trade',
    from: { x: 5, y: 5 },
    to: { x: 25, y: 25 },
    magnitude: 20,
    label: '商路',
    selectedKind: 'tradeCorridor',
    selectedId: 'trade_1',
  }];
  const markers: MapMarkerView[] = [{
    id: 'outbreak_1',
    kind: 'outbreak',
    position: { x: 5, y: 5 },
    magnitude: 20,
    label: '疫病',
  }];
  const seaZones: MapSeaZoneView[] = [{
    id: 'sea_1',
    name: '近海',
    center: { x: 50, y: 50 },
    climate: '温带',
    contested: false,
    traffic: 0,
    stormRisk: 0,
    piracy: 0,
    powerShare: 0,
  }];

  return {
    profile: {} as MapPresentationDefinition,
    regions,
    routes: [],
    armies,
    seaZones,
    fleets,
    flows,
    markers,
  };
}

describe('map LOD hysteresis', () => {
  it('uses separate enter and exit thresholds without blocking direct reset jumps', () => {
    expect(MAP_LOD_THRESHOLDS).toEqual({
      overviewToRegional: 1.3,
      regionalToOverview: 1.2,
      regionalToLocal: 2,
      localToRegional: 1.85,
    });
    expect(resolveMapLodLevel(1)).toBe('overview');
    expect(resolveMapLodLevel(1.299)).toBe('overview');
    expect(resolveMapLodLevel(1.3)).toBe('regional');
    expect(resolveMapLodLevel(2)).toBe('local');

    expect(resolveMapLodLevel(1.25, 'overview')).toBe('overview');
    expect(resolveMapLodLevel(1.3, 'overview')).toBe('regional');
    expect(resolveMapLodLevel(1.2, 'regional')).toBe('regional');
    expect(resolveMapLodLevel(1.199, 'regional')).toBe('overview');
    expect(resolveMapLodLevel(1.9, 'local')).toBe('local');
    expect(resolveMapLodLevel(1.849, 'local')).toBe('regional');
    expect(resolveMapLodLevel(1, 'local')).toBe('overview');
    expect(resolveMapLodLevel(2.2, 'overview')).toBe('local');
    expect(resolveMapLodLevel(Number.NaN, 'local')).toBe('overview');
  });
});

describe('map LOD scene', () => {
  it('keeps only capitals, polity leaders and no local flows at overview', () => {
    const source = fixture();
    const scene = buildMapLodScene(source, 'overview');

    expect([...scene.regionLabelIds]).toEqual(['r_a_capital', 'r_b_capital']);
    expect([...scene.cityRegionIds]).toEqual(['r_a_capital', 'r_b_capital']);
    expect([...scene.portRegionIds]).toEqual([]);
    expect([...scene.interactiveSeaZoneIds]).toEqual([]);
    expect(scene.armies.map((item) => item.id)).toEqual(['a_a_large', 'a_b_tie_a']);
    expect(scene.fleets.map((item) => item.id)).toEqual(['f_a_large', 'f_b']);
    expect(scene.flows).toEqual([]);
    expect(scene.markers).toEqual([]);
  });

  it('adds one deterministic key city per polity and all military objects at regional level', () => {
    const source = fixture();
    const scene = buildMapLodScene(source, 'regional');

    expect([...scene.regionLabelIds]).toEqual([
      'r_a_capital',
      'r_b_capital',
      'r_a_strategic',
      'r_b_key',
    ]);
    expect([...scene.cityRegionIds]).toEqual([...scene.regionLabelIds]);
    expect([...scene.portRegionIds]).toEqual(['r_a_strategic', 'r_b_key']);
    expect([...scene.interactiveSeaZoneIds]).toEqual(['sea_1']);
    expect(scene.armies).toEqual(source.armies);
    expect(scene.armies).not.toBe(source.armies);
    expect(scene.fleets).toEqual(source.fleets);
    expect(scene.flows).toEqual([]);
    expect(scene.markers).toEqual([]);
  });

  it('exposes all labels, nodes and contextual objects at local level', () => {
    const source = fixture();
    const scene = buildMapLodScene(source, 'local');

    expect([...scene.regionLabelIds]).toEqual(source.regions.map((item) => item.id));
    expect([...scene.cityRegionIds]).toEqual(source.regions.map((item) => item.id));
    expect([...scene.portRegionIds]).toEqual(['r_a_strategic', 'r_b_key']);
    expect(scene.armies).toEqual(source.armies);
    expect(scene.fleets).toEqual(source.fleets);
    expect(scene.flows).toEqual(source.flows);
    expect(scene.markers).toEqual(source.markers);
  });

  it('promotes the exact selected object while keeping other hidden peers absent', () => {
    const source = fixture();
    const selectedArmy = buildMapLodScene(source, 'overview', {
      selectedRegionId: 'r_a_large',
      selectedObject: { kind: 'army', id: 'a_a_small' },
    });
    expect([...selectedArmy.regionLabelIds]).toEqual([
      'r_a_capital',
      'r_b_capital',
      'r_a_large',
    ]);
    expect(selectedArmy.armies.map((item) => item.id)).toEqual([
      'a_a_small',
      'a_a_large',
      'a_b_tie_a',
    ]);

    const selectedFlow = buildMapLodScene(source, 'regional', {
      selectedObject: { kind: 'tradeCorridor', id: 'trade_1' },
    });
    expect(selectedFlow.flows.map((item) => item.id)).toEqual(['flow_trade']);
    expect(selectedFlow.markers).toEqual([]);

    const selectedMarker = buildMapLodScene(source, 'overview', {
      selectedObject: { kind: 'outbreak', id: 'outbreak_1' },
    });
    expect(selectedMarker.markers.map((item) => item.id)).toEqual(['outbreak_1']);

    const selectedSea = buildMapLodScene(source, 'overview', {
      selectedObject: { kind: 'seaZone', id: 'sea_1' },
    });
    expect([...selectedSea.interactiveSeaZoneIds]).toEqual(['sea_1']);
  });

  it('does not mutate the presentation projection or its arrays', () => {
    const source = fixture();
    const before = JSON.stringify(source);

    buildMapLodScene(source, 'overview', {
      selectedRegionId: 'r_a_large',
      selectedObject: { kind: 'army', id: 'a_a_small' },
    });

    expect(JSON.stringify(source)).toBe(before);
  });
});
