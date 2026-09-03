import { describe, expect, it } from 'vitest';

import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapArmyView,
  MapFleetView,
  MapMarkerView,
  MapPersonForceView,
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
    supplyNote: '供养尚稳',
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
  const markers: MapMarkerView[] = [];
  const seaZones: MapSeaZoneView[] = [{
    id: 'sea_1',
    name: '近海',
    center: { x: 50, y: 50 },
    climate: '温带',
    contested: false,
    powerShare: 0,
  }];

  return {
    profile: {} as MapPresentationDefinition,
    regions,
    routes: [],
    armies,
    persons: [],
    personClusters: [],
    seaZones,
    fleets,
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
  it('clusters people at overview, reveals points regionally, and labels everyone locally', () => {
    const source = fixture();
    const people: MapPersonForceView[] = [{
      id: 'person-leader', personName: '赵维谦', regionId: 'r_a_large', position: { x: 4, y: 5 },
      polityId: 'p_a', polityColor: '#963b30', soldiers: 1_800,
      status: '驻留', formationId: null, formationName: null, commanderName: null,
      factionShortName: '赵系', isCommander: false, isFactionLeader: true,
      warId: null, targetRegionId: null, commandDiverged: false,
    }, {
      id: 'person-member', personName: '谢德清', regionId: 'r_a_large', position: { x: 6, y: 5 },
      polityId: 'p_a', polityColor: '#963b30', soldiers: 900,
      status: '驻留', formationId: null, formationName: null, commanderName: null,
      factionShortName: '赵系', isCommander: false, isFactionLeader: false,
      warId: null, targetRegionId: null, commandDiverged: false,
    }, {
      id: 'person-marching', personName: '韩静川', regionId: 'r_b_key', position: { x: 5, y: 5 },
      polityId: 'p_b', polityColor: '#315b72', soldiers: 600,
      status: '出征', formationId: 'a_b_tie_z', formationName: '乙前营', commanderName: '韩静川',
      factionShortName: '韩系', isCommander: true, isFactionLeader: false,
      warId: 'war_1', targetRegionId: 'r_a_large', commandDiverged: false,
    }];
    source.persons = people;
    source.personClusters = [];

    const overview = buildMapLodScene(source, 'overview');
    expect(overview.persons).toEqual([]);
    expect(overview.personClusters.map((cluster) => ({ count: cluster.count, soldiers: cluster.soldiers })))
      .toEqual([{ count: 2, soldiers: 2_700 }, { count: 1, soldiers: 600 }]);

    const focused = buildMapLodScene(source, 'overview', { focusedArmyIds: ['a_b_tie_z'] });
    expect(focused.persons.map((person) => person.id)).toEqual(['person-marching']);
    expect(focused.personClusters).toHaveLength(1);

    const regional = buildMapLodScene(source, 'regional');
    expect(regional.persons).toHaveLength(3);
    expect(regional.persons.find((person) => person.id === 'person-leader')?.showLabel).toBe(true);
    expect(regional.persons.find((person) => person.id === 'person-member')?.showLabel).toBe(false);
    expect(regional.persons.find((person) => person.id === 'person-marching')?.showLabel).toBe(true);

    expect(buildMapLodScene(source, 'local').persons.every((person) => person.showLabel)).toBe(true);
    const selected = buildMapLodScene(source, 'overview', { selectedObject: { kind: 'person', id: 'person-member' } });
    expect(selected.persons.map((person) => person.id)).toEqual(['person-member']);
  });

  it('keeps only capitals and the strongest military objects at overview', () => {
    const source = fixture();
    const scene = buildMapLodScene(source, 'overview');

    expect([...scene.regionLabelIds]).toEqual(['r_a_capital', 'r_b_capital']);
    expect([...scene.cityRegionIds]).toEqual(['r_a_capital', 'r_b_capital']);
    expect([...scene.portRegionIds]).toEqual([]);
    expect([...scene.interactiveSeaZoneIds]).toEqual(['sea_1']);
    expect(scene.armies.map((item) => item.id)).toEqual(['a_a_large', 'a_b_tie_a']);
    expect(scene.fleets.map((item) => item.id)).toEqual(['f_a_large', 'f_b']);
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
    expect(scene.markers).toEqual(source.markers);
  });

  it('keeps authoritative political marks legible at every LOD', () => {
    const source = fixture();
    const capitalPulse: MapMarkerView = {
      id: 'capital-pulse', kind: 'capitalPulse', position: { x: 5, y: 5 }, magnitude: 60,
      label: '甲都朝局', targetKind: 'country', targetId: 'p_a', polityId: 'p_a',
    };
    const powerRoot: MapMarkerView = {
      id: 'power-root', kind: 'powerRoot', position: { x: 15, y: 5 }, magnitude: 12,
      label: '甲地军令', targetKind: 'army', targetId: 'a_a_large', polityId: 'p_a',
      factionId: 'faction-a', rootKind: 'army_command',
    };
    source.markers = [...source.markers, capitalPulse, powerRoot];

    expect(buildMapLodScene(source, 'overview').markers.map((marker) => marker.id))
      .toEqual(['capital-pulse', 'power-root']);
    expect(buildMapLodScene(source, 'regional').markers.map((marker) => marker.id))
      .toEqual(['capital-pulse', 'power-root']);
    expect(buildMapLodScene(source, 'local').markers.map((marker) => marker.id))
      .toEqual(['capital-pulse', 'power-root']);
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

    const selectedFleet = buildMapLodScene(source, 'overview', {
      selectedObject: { kind: 'fleet', id: 'f_a_small' },
    });
    expect(selectedFleet.fleets.map((item) => item.id)).toEqual(['f_a_small', 'f_a_large', 'f_b']);

    const selectedSea = buildMapLodScene(source, 'overview', {
      selectedObject: { kind: 'seaZone', id: 'sea_1' },
    });
    expect([...selectedSea.interactiveSeaZoneIds]).toEqual(['sea_1']);
  });

  it('keeps every focused-war army visible at overview without promoting unrelated forces', () => {
    const source = fixture();
    const focused = buildMapLodScene(source, 'overview', {
      focusedArmyIds: ['a_a_small', 'a_b_tie_z'],
    });

    expect(focused.armies.map((army) => army.id)).toEqual([
      'a_a_small',
      'a_a_large',
      'a_b_tie_z',
      'a_b_tie_a',
    ]);
    expect(focused.armies.some((army) => army.id === 'a_unowned')).toBe(false);
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
