import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapArmyView,
  MapLodScene,
  MapMarkerView,
  MapPersonForceClusterView,
  MapPersonForceView,
  MapRegionView,
  MapSeaZoneView,
} from './map-contract';
import { layoutMapMarkers } from './map-marker-layout';
import { drawWorldMap } from './map-renderer';
import {
  createMapViewportTransform,
  layoutMapPersonClusters,
  resolveMapSceneHit,
} from './map-scene-geometry';

class Path2DStub {
  moveTo() {}
  lineTo() {}
  closePath() {}
}

interface TextCall {
  text: string;
  x: number;
  y: number;
  font: string;
}

function textBox(call: TextCall) {
  const fontSize = Number(call.font.match(/(\d+)px/)?.[1] ?? 8);
  const width = Math.max(fontSize * 2, call.text.length * fontSize * 0.9 + 6);
  const height = fontSize + 4;
  return {
    left: call.x - width / 2,
    right: call.x + width / 2,
    top: call.y - height / 2,
    bottom: call.y + height / 2,
  };
}

function boxesOverlap(left: ReturnType<typeof textBox>, right: ReturnType<typeof textBox>) {
  return left.left < right.right && left.right > right.left
    && left.top < right.bottom && left.bottom > right.top;
}

function recordingContext() {
  const fillTexts: TextCall[] = [];
  const strokeTexts: TextCall[] = [];
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const ellipses: Array<{ x: number; y: number }> = [];
  const translations: Array<{ x: number; y: number }> = [];
  const gradient = { addColorStop() {} };
  const context = {
    fillTexts,
    strokeTexts,
    arcs,
    ellipses,
    translations,
    font: '',
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    shadowBlur: 0,
    shadowColor: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc(x: number, y: number, radius: number) { arcs.push({ x, y, radius }); },
    ellipse(x: number, y: number) { ellipses.push({ x, y }); },
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    rect() {},
    clip() {},
    translate(x: number, y: number) { translations.push({ x, y }); },
    rotate() {},
    setLineDash() {},
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    fillText(text: string, x: number, y: number) {
      fillTexts.push({ text, x, y, font: context.font });
    },
    strokeText(text: string, x: number, y: number) {
      strokeTexts.push({ text, x, y, font: context.font });
    },
  };
  return context as typeof context & CanvasRenderingContext2D;
}

const profile: MapPresentationDefinition = {
  width: 1180,
  height: 620,
  landShapes: [],
  territoryShapes: [],
  decorativeIslets: [],
  regionDisplaySites: {},
  seaZoneDisplayCenters: {},
  macroLabels: [],
  geographyAreas: [],
  riverGuides: [],
  hiddenRoutePairs: [],
};

function region(
  id: string,
  name: string,
  center: { x: number; y: number },
  options: Partial<MapRegionView> = {},
): MapRegionView {
  return {
    id,
    name,
    center,
    polygon: [
      { x: center.x - 24, y: center.y - 18 },
      { x: center.x + 24, y: center.y - 18 },
      { x: center.x + 24, y: center.y + 18 },
      { x: center.x - 24, y: center.y + 18 },
    ],
    terrain: '平原',
    population: 100,
    foodRatio: 1,
    supplyNote: '供养尚稳',
    ...options,
  };
}

function scene(options: {
  regions?: MapRegionView[];
  seaZones?: MapSeaZoneView[];
  markers?: MapMarkerView[];
  armies?: MapArmyView[];
  personClusters?: MapPersonForceClusterView[];
  interactiveSeaZoneIds?: ReadonlySet<string>;
} = {}): MapLodScene {
  const regions = options.regions ?? [];
  const seaZones = options.seaZones ?? [];
  return {
    profile,
    level: 'overview',
    regions,
    routes: [],
    armies: options.armies ?? [],
    persons: [],
    personClusters: options.personClusters ?? [],
    seaZones,
    fleets: [],
    markers: options.markers ?? [],
    regionLabelIds: new Set(regions.filter((item) => item.capital).map((item) => item.id)),
    cityRegionIds: new Set(regions.filter((item) => item.capital).map((item) => item.id)),
    portRegionIds: new Set(),
    interactiveSeaZoneIds: options.interactiveSeaZoneIds ?? new Set(),
  };
}

beforeAll(() => {
  vi.stubGlobal('Path2D', Path2DStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('map renderer LOD contract', () => {
  it('keeps overview person power visible without permanent names and force totals', () => {
    const capital = region('capital', '云京', { x: 440, y: 230 }, {
      polityId: 'polity_cloud', polityName: '云岚国', capital: true, cityLevel: 4,
    });
    const cluster: MapPersonForceClusterView = {
      id: 'person-cluster:polity_cloud',
      regionId: capital.id,
      position: capital.center,
      leaderName: '沈砚',
      personIds: ['person-1', 'person-2'],
      count: 24,
      soldiers: 24_000,
      polityId: 'polity_cloud',
      polityColor: '#52694d',
    };
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      scene({ regions: [capital], personClusters: [cluster] }),
      'political',
      [],
      null,
      null,
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    const labels = context.fillTexts.map((call) => call.text);
    expect(labels).toContain('24将');
    expect(labels).not.toContain('沈砚等24人 · 2.4万');
    const polityLabel = context.fillTexts.find((call) => call.text === '云岚国');
    const clusterLabel = context.fillTexts.find((call) => call.text === '24将');
    expect(polityLabel).toBeDefined();
    expect(clusterLabel).toBeDefined();
    expect(boxesOverlap(textBox(clusterLabel!), textBox(polityLabel!))).toBe(false);
  });

  it('omits an overview cluster label when polity and capital labels occupy every safe slot, without removing its hit target', () => {
    const capital = region('capital', '云京', { x: 440, y: 230 }, {
      polityId: 'polity-cloud', polityName: '云岚国', capital: true, cityLevel: 4,
    });
    const cluster: MapPersonForceClusterView = {
      id: 'person-cluster:polity-cloud', regionId: capital.id, position: capital.center,
      leaderName: '沈砚', personIds: ['person-1'], count: 24, soldiers: 24_000,
      polityId: 'polity-cloud', polityColor: '#52694d',
    };
    const viewport = { width: 390, height: 644 };
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const layout = layoutMapPersonClusters([cluster], transform)[0];
    const toWorld = (x: number, y: number) => ({
      x: (x - transform.offsetX) / transform.scale,
      y: (y - transform.offsetY) / (transform.scale * transform.yScale),
    });
    const blockers = [
      ['north', '北都', layout.point.x, layout.point.y - 20],
      ['east', '东都', layout.point.x + 32, layout.point.y],
      ['west', '西都', layout.point.x - 32, layout.point.y],
    ].map(([id, name, x, y]) => region(String(id), String(name), toWorld(Number(x), Number(y)), {
      polityId: `polity-${id}`, polityName: `${name}国`, capital: true, cityLevel: 4,
    }));
    const mapScene = scene({ regions: [capital, ...blockers], personClusters: [cluster] });
    const context = recordingContext();

    drawWorldMap(
      context,
      { ...viewport, dpr: 1 },
      mapScene,
      'political',
      [],
      null,
      null,
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    expect(context.fillTexts.map((call) => call.text)).not.toContain('24将');
    expect(context.arcs).toContainEqual(expect.objectContaining({
      x: expect.closeTo(layout.point.x, 5),
      y: expect.closeTo(layout.point.y, 5),
    }));
    expect(resolveMapSceneHit(
      mapScene,
      layout.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'personCluster', cluster: { id: cluster.id } });
  });

  it('places overview cluster labels deterministically for identical input', () => {
    const capital = region('capital', '云京', { x: 440, y: 230 }, {
      polityId: 'polity-cloud', polityName: '云岚国', capital: true, cityLevel: 4,
    });
    const cluster: MapPersonForceClusterView = {
      id: 'person-cluster:polity-cloud', regionId: capital.id, position: capital.center,
      leaderName: '沈砚', personIds: ['person-1'], count: 12, soldiers: 8_000,
      polityId: 'polity-cloud', polityColor: '#52694d',
    };
    const first = recordingContext();
    const second = recordingContext();
    const args = [
      { width: 390, height: 644, dpr: 1 }, scene({ regions: [capital], personClusters: [cluster] }),
      'political', [], null, null, undefined, { zoom: 1, panX: 0, panY: 0 },
    ] as const;

    drawWorldMap(first, ...args);
    drawWorldMap(second, ...args);

    expect(first.fillTexts).toEqual(second.fillTexts);
  });

  it('draws the full sea theatre inside the unified military overlay', () => {
    const seaZones: MapSeaZoneView[] = [
      {
        id: 'sea_selected',
        name: '所选近海',
        center: { x: 430, y: 210 },
        climate: '季风海',
        contested: false,
        powerShare: 0.5,
      },
      {
        id: 'sea_hidden',
        name: '隐藏近海',
        center: { x: 610, y: 210 },
        climate: '季风海',
        contested: false,
        powerShare: 0.4,
      },
    ];
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      scene({ seaZones, interactiveSeaZoneIds: new Set(['sea_selected']) }),
      'war',
      [],
      null,
      { kind: 'seaZone', id: 'sea_selected' },
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    expect(context.ellipses).toHaveLength(2);
    expect(context.fillTexts.map((call) => call.text)).toContain('所选近海');
    expect(context.fillTexts.map((call) => call.text)).toContain('隐藏近海');
  });

  it('labels only a verifiable expected contact in the military overlay', () => {
    const origin = region('origin', '西营', { x: 360, y: 260 }, { polityId: 'polity-west' });
    const destination = region('destination', '东丘', { x: 560, y: 260 }, { polityId: 'polity-east' });
    const attacker: MapArmyView = {
      id: 'army-west',
      name: '西营军',
      polityId: 'polity-west',
      regionId: origin.id,
      strength: 1_200,
      orderKind: 'advance',
      expectedContact: {
        armyId: 'army-east',
        armyName: '东丘军',
        regionId: destination.id,
        regionName: destination.name,
        steps: 1,
        commanderName: '顾守山',
        factionName: '东丘系',
      },
      lawfulCommanderName: '王行简',
      factionShortName: '西营系',
    };
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      scene({ regions: [origin, destination], armies: [attacker] }),
      'war',
      [],
      null,
      null,
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    expect(context.fillTexts.map((call) => call.text))
      .toContain('王行简 ↔ 顾守山 · 1步');
  });

  it('places narrow war labels around protected capital text and keeps unselected labels terse', () => {
    const capital = region('front', '广州', { x: 480, y: 290 }, {
      polityId: 'polity-south', polityName: '南国', capital: true, cityLevel: 5,
    });
    const armies: MapArmyView[] = ['林维明', '许维成', '陆维宣'].map((name, index) => ({
      id: `army-front-${index}`,
      name: `第${index + 1}行营`,
      regionId: capital.id,
      position: capital.center,
      polityId: 'polity-south',
      strength: 2_400 - index * 300,
      lawfulCommanderName: name,
      orderKind: 'advance',
    }));
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      { ...scene({ regions: [capital], armies }), level: 'regional' },
      'war',
      [],
      null,
      null,
      undefined,
      { zoom: 1.35, panX: 0, panY: 0 },
    );

    const capitalLabel = context.fillTexts.find((call) => call.text === '广州')!;
    const armyLabels = context.fillTexts.filter((call) => armies.some((army) => army.lawfulCommanderName === call.text));
    expect(armyLabels.length).toBeGreaterThan(0);
    expect(armyLabels.every((call) => !call.text.includes('千'))).toBe(true);
    expect(armyLabels.every((call) => !boxesOverlap(textBox(call), textBox(capitalLabel)))).toBe(true);
  });

  it('keeps compact overview polity and capital hierarchy without restoring ordinary region names', () => {
    const capital = region('capital', '云京', { x: 440, y: 230 }, {
      polityId: 'polity_cloud',
      polityName: '云岚国',
      capital: true,
      cityLevel: 4,
    });
    const ordinary = region('ordinary', '东丘', { x: 530, y: 230 }, {
      polityId: 'polity_cloud',
      polityName: '云岚国',
      cityLevel: 2,
    });
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      scene({ regions: [capital, ordinary] }),
      'political',
      [],
      null,
      null,
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    const labels = context.fillTexts.map((call) => call.text);
    expect(labels).toContain('云京');
    expect(labels).toContain('云岚国');
    expect(labels).not.toContain('东丘');
    expect(context.strokeTexts).toContainEqual(expect.objectContaining({
      text: '云岚国',
      font: expect.stringContaining('10px'),
    }));
  });

  it('paints a political marker at the exact shared layout point used by hit testing', () => {
    const marker: MapMarkerView = {
      id: 'capital-pulse-shared-anchor',
      kind: 'capitalPulse',
      position: { x: 480, y: 330 },
      magnitude: 68,
      label: '云京朝局',
      targetKind: 'country',
      targetId: 'polity-cloud',
      tone: 'watch',
    };
    const viewport = { width: 1210, height: 560 };
    const mapScene = scene({ markers: [marker] });
    const context = recordingContext();
    const transform = createMapViewportTransform(viewport.width, viewport.height);
    const expected = layoutMapMarkers([marker], transform)[0];

    drawWorldMap(
      context,
      { ...viewport, dpr: 1 },
      mapScene,
      'political',
      [],
      null,
      null,
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    expect(context.translations).toContainEqual(expect.objectContaining({
      x: expect.closeTo(expected.point.x, 5),
      y: expect.closeTo(expected.point.y, 5),
    }));
    expect(resolveMapSceneHit(
      mapScene,
      expected.point,
      viewport.width,
      viewport.height,
    )).toMatchObject({ kind: 'marker', marker: { id: marker.id } });
  });

  it('caps unfocused regional person labels on a narrow map without removing the person points', () => {
    const persons: MapPersonForceView[] = Array.from({ length: 12 }, (_, index) => ({
      id: `person-${index}`,
      personName: `将领${index}`,
      regionId: 'front',
      position: { x: 180 + index * 54, y: 280 + index % 2 * 50 },
      polityId: 'polity-front',
      polityColor: '#7f3028',
      soldiers: 2_000 - index,
      status: '出征',
      formationId: `army-${index}`,
      formationName: `第${index}行营`,
      commanderName: `将领${index}`,
      factionShortName: '前军',
      isCommander: true,
      isFactionLeader: false,
      warId: null,
      targetRegionId: null,
      commandDiverged: false,
      showLabel: true,
    }));
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      { ...scene(), level: 'regional', persons },
      'war',
      [],
      null,
      null,
      undefined,
      { zoom: 1.35, panX: 0, panY: 0 },
    );

    const personLabels = context.fillTexts.filter((call) => call.text.startsWith('将领'));
    expect(personLabels.length).toBeGreaterThan(0);
    expect(personLabels.length).toBeLessThanOrEqual(5);
    expect(personLabels[0]?.text).toMatch(/将领\d+ · \d\.\d千/);
    for (let index = 0; index < personLabels.length; index += 1) {
      for (let other = index + 1; other < personLabels.length; other += 1) {
        expect(boxesOverlap(textBox(personLabels[index]!), textBox(personLabels[other]!))).toBe(false);
      }
    }
  });
});
