import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MapPresentationDefinition } from '../maps/types';
import type {
  MapLodScene,
  MapMarkerView,
  MapRegionView,
  MapSeaZoneView,
} from './map-contract';
import { layoutMapMarkers } from './map-marker-layout';
import { drawWorldMap } from './map-renderer';
import { createMapViewportTransform, resolveMapSceneHit } from './map-scene-geometry';

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

function recordingContext() {
  const fillTexts: TextCall[] = [];
  const strokeTexts: TextCall[] = [];
  const ellipses: Array<{ x: number; y: number }> = [];
  const translations: Array<{ x: number; y: number }> = [];
  const gradient = { addColorStop() {} };
  const context = {
    fillTexts,
    strokeTexts,
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
    arc() {},
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
    ...options,
  };
}

function scene(options: {
  regions?: MapRegionView[];
  seaZones?: MapSeaZoneView[];
  markers?: MapMarkerView[];
  interactiveSeaZoneIds?: ReadonlySet<string>;
} = {}): MapLodScene {
  const regions = options.regions ?? [];
  const seaZones = options.seaZones ?? [];
  return {
    profile,
    level: 'overview',
    regions,
    routes: [],
    armies: [],
    seaZones,
    fleets: [],
    flows: [],
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
  it('draws only interactive sea zones and therefore preserves the selected overview exception', () => {
    const seaZones: MapSeaZoneView[] = [
      {
        id: 'sea_selected',
        name: '所选近海',
        center: { x: 430, y: 210 },
        climate: '季风海',
        contested: false,
        traffic: 20,
        stormRisk: 10,
        piracy: 5,
        powerShare: 0.5,
      },
      {
        id: 'sea_hidden',
        name: '隐藏近海',
        center: { x: 610, y: 210 },
        climate: '季风海',
        contested: false,
        traffic: 15,
        stormRisk: 10,
        piracy: 5,
        powerShare: 0.4,
      },
    ];
    const context = recordingContext();

    drawWorldMap(
      context,
      { width: 390, height: 644, dpr: 1 },
      scene({ seaZones, interactiveSeaZoneIds: new Set(['sea_selected']) }),
      'naval',
      [],
      null,
      { kind: 'seaZone', id: 'sea_selected' },
      undefined,
      { zoom: 1, panX: 0, panY: 0 },
    );

    expect(context.ellipses).toHaveLength(1);
    expect(context.fillTexts.map((call) => call.text)).toContain('所选近海');
    expect(context.fillTexts.map((call) => call.text)).not.toContain('隐藏近海');
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
});
