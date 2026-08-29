import type {
  MapDecorativeIsletDefinition,
  MapGeographyAreaDefinition,
  MapLandShapeDefinition,
  MapMacroLabelDefinition,
  MapPoint,
  MapRegionDisplaySiteDefinition,
  MapRiverGuideDefinition,
  MapTerritoryShapeDefinition,
} from '../types';
import { REGION_GROUPS } from './simulation';

export const MAP_PRESENTATION_WIDTH = 1000;
export const MAP_PRESENTATION_HEIGHT = 700;

/**
 * The contest atlas is deliberately unrelated to a real coastline. Its visual
 * grammar is a broad river continent, a detached southern rain-land, and a
 * crescent of island states enclosing two navigable inner seas.
 */
export const MAP_LAND_SHAPES = Object.freeze([
  {
    id: 'land_tianheng',
    label: '天衡大陆',
    role: 'mainland',
    expectedRegionCount: 42,
    polygon: [
      { x: 52, y: 205 }, { x: 55, y: 125 }, { x: 120, y: 82 },
      { x: 220, y: 65 }, { x: 320, y: 75 }, { x: 395, y: 45 },
      { x: 500, y: 70 }, { x: 575, y: 55 }, { x: 660, y: 90 },
      { x: 700, y: 135 }, { x: 670, y: 178 }, { x: 710, y: 220 },
      { x: 690, y: 255 }, { x: 640, y: 245 }, { x: 610, y: 225 },
      { x: 580, y: 240 }, { x: 565, y: 275 }, { x: 595, y: 305 },
      { x: 650, y: 310 }, { x: 635, y: 355 }, { x: 585, y: 390 },
      { x: 510, y: 405 }, { x: 430, y: 395 }, { x: 360, y: 430 },
      { x: 285, y: 420 }, { x: 230, y: 390 }, { x: 155, y: 410 },
      { x: 90, y: 365 }, { x: 65, y: 300 }, { x: 85, y: 250 },
    ],
  },
  {
    id: 'land_yulu',
    label: '烟萝雨陆',
    role: 'mainland',
    expectedRegionCount: 10,
    polygon: [
      { x: 105, y: 525 }, { x: 155, y: 500 }, { x: 240, y: 505 },
      { x: 320, y: 480 }, { x: 395, y: 495 }, { x: 455, y: 520 },
      { x: 500, y: 570 }, { x: 465, y: 615 }, { x: 385, y: 630 },
      { x: 300, y: 622 }, { x: 215, y: 640 }, { x: 135, y: 620 },
      { x: 92, y: 575 },
    ],
  },
  {
    id: 'island_liuhuo',
    label: '流火岛',
    role: 'island',
    expectedRegionCount: 3,
    polygon: [
      { x: 500, y: 635 }, { x: 520, y: 610 }, { x: 552, y: 600 },
      { x: 590, y: 615 }, { x: 610, y: 648 }, { x: 594, y: 678 },
      { x: 550, y: 690 }, { x: 515, y: 678 },
    ],
  },
  {
    id: 'island_chenwest',
    label: '西辰岛门',
    role: 'island',
    expectedRegionCount: 3,
    polygon: [
      { x: 642, y: 377 }, { x: 668, y: 354 }, { x: 701, y: 360 },
      { x: 721, y: 392 }, { x: 716, y: 430 }, { x: 695, y: 460 },
      { x: 663, y: 448 }, { x: 648, y: 420 },
    ],
  },
  {
    id: 'island_yue',
    label: '月岛长洲',
    role: 'island',
    expectedRegionCount: 4,
    polygon: [
      { x: 735, y: 332 }, { x: 755, y: 312 }, { x: 781, y: 320 },
      { x: 801, y: 357 }, { x: 806, y: 410 }, { x: 820, y: 465 },
      { x: 811, y: 525 }, { x: 790, y: 538 }, { x: 770, y: 500 },
      { x: 756, y: 445 }, { x: 744, y: 390 },
    ],
  },
  {
    id: 'island_canglong',
    label: '苍崖长岛',
    role: 'island',
    expectedRegionCount: 4,
    polygon: [
      { x: 824, y: 266 }, { x: 844, y: 244 }, { x: 870, y: 250 },
      { x: 894, y: 283 }, { x: 900, y: 333 }, { x: 890, y: 380 },
      { x: 906, y: 425 }, { x: 894, y: 482 }, { x: 870, y: 495 },
      { x: 850, y: 456 }, { x: 842, y: 410 }, { x: 850, y: 360 },
      { x: 834, y: 315 },
    ],
  },
  {
    id: 'island_shuanghuan',
    label: '霜环岛',
    role: 'island',
    expectedRegionCount: 2,
    polygon: [
      { x: 845, y: 105 }, { x: 862, y: 78 }, { x: 895, y: 70 },
      { x: 918, y: 86 }, { x: 952, y: 91 }, { x: 963, y: 120 },
      { x: 945, y: 154 }, { x: 910, y: 166 }, { x: 875, y: 155 },
      { x: 852, y: 135 },
    ],
  },
] as const satisfies readonly MapLandShapeDefinition[]);

/** Rectangular Voronoi generation bounds are clipped to the coast masks. */
export const MAP_TERRITORY_SHAPES: readonly MapTerritoryShapeDefinition[] = Object.freeze(
  MAP_LAND_SHAPES.map((shape) => {
    const xs = shape.polygon.map((point) => point.x);
    const ys = shape.polygon.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return Object.freeze({
      id: shape.id,
      polygon: Object.freeze([
        Object.freeze({ x: minX, y: minY }),
        Object.freeze({ x: maxX, y: minY }),
        Object.freeze({ x: maxX, y: maxY }),
        Object.freeze({ x: minX, y: maxY }),
      ]),
    });
  }),
);

export const MAP_DECORATIVE_ISLETS = Object.freeze([
  { id: 'islet_mirror_1', polygon: [{ x: 683, y: 276 }, { x: 690, y: 271 }, { x: 696, y: 278 }, { x: 690, y: 284 }] },
  { id: 'islet_mirror_2', polygon: [{ x: 715, y: 304 }, { x: 721, y: 299 }, { x: 727, y: 305 }, { x: 721, y: 311 }] },
  { id: 'islet_cloud_1', polygon: [{ x: 568, y: 500 }, { x: 575, y: 495 }, { x: 581, y: 502 }, { x: 574, y: 508 }] },
  { id: 'islet_chen_1', polygon: [{ x: 728, y: 485 }, { x: 735, y: 480 }, { x: 741, y: 487 }, { x: 734, y: 493 }] },
  { id: 'islet_chen_2', polygon: [{ x: 826, y: 212 }, { x: 833, y: 207 }, { x: 839, y: 214 }, { x: 832, y: 220 }] },
  { id: 'islet_south_1', polygon: [{ x: 666, y: 585 }, { x: 672, y: 580 }, { x: 678, y: 586 }, { x: 672, y: 592 }] },
  { id: 'islet_outer_1', polygon: [{ x: 928, y: 520 }, { x: 935, y: 516 }, { x: 941, y: 523 }, { x: 935, y: 529 }] },
] as const satisfies readonly MapDecorativeIsletDefinition[]);

type SiteSeed = readonly [id: string, shapeId: string, x: number, y: number];

const REGION_DISPLAY_SITE_ENTRIES = [
  ['r_shuoyuan', 'land_tianheng', 350, 105],
  ['r_hanlei', 'land_tianheng', 270, 105],
  ['r_bailing', 'land_tianheng', 430, 110],
  ['r_hejing', 'land_tianheng', 510, 120],
  ['r_xuesai', 'land_tianheng', 590, 125],
  ['r_yufeng', 'land_tianheng', 240, 160],
  ['r_cangting', 'land_tianheng', 330, 160],
  ['r_linhuang', 'land_tianheng', 430, 165],
  ['r_xuanmo', 'land_tianheng', 530, 170],

  ['r_yunxiu', 'land_tianheng', 145, 245],
  ['r_danya', 'land_tianheng', 95, 190],
  ['r_lizhai', 'land_tianheng', 175, 190],
  ['r_chize', 'land_tianheng', 100, 280],
  ['r_languan', 'land_tianheng', 180, 270],
  ['r_yuyan', 'land_tianheng', 110, 335],
  ['r_xilan', 'land_tianheng', 200, 330],
  ['r_zhuxia', 'land_tianheng', 165, 385],
  ['r_jingqiu', 'land_tianheng', 250, 375],
  ['r_zizhen', 'land_tianheng', 255, 285],

  ['r_tianheng', 'land_tianheng', 350, 260],
  ['r_pingwu', 'land_tianheng', 270, 210],
  ['r_chengye', 'land_tianheng', 350, 205],
  ['r_jiunian', 'land_tianheng', 430, 215],
  ['r_huaijing', 'land_tianheng', 275, 270],
  ['r_anzhi', 'land_tianheng', 430, 270],
  ['r_helian', 'land_tianheng', 340, 320],
  ['r_landing', 'land_tianheng', 430, 325],
  ['r_jinbu', 'land_tianheng', 285, 330],
  ['r_wenchuan', 'land_tianheng', 355, 375],
  ['r_xuanjin', 'land_tianheng', 470, 365],

  ['r_jiangdu', 'land_tianheng', 525, 305],
  ['r_xinggang', 'land_tianheng', 520, 220],
  ['r_jingwan', 'land_tianheng', 600, 195],
  ['r_chaoling', 'land_tianheng', 575, 235],
  ['r_dongke', 'land_tianheng', 560, 260],
  ['r_qingpu', 'land_tianheng', 600, 315],
  ['r_cangzhu', 'land_tianheng', 570, 355],
  ['r_langao', 'land_tianheng', 500, 330],
  ['r_jiaotai', 'land_tianheng', 610, 350],
  ['r_boyue', 'land_tianheng', 520, 390],
  ['r_lankou', 'land_tianheng', 450, 390],
  ['r_yueguan', 'land_tianheng', 650, 145],

  ['r_yulu', 'land_yulu', 300, 555],
  ['r_yandu', 'land_yulu', 160, 540],
  ['r_luochuan', 'land_yulu', 225, 535],
  ['r_jiaoling', 'land_yulu', 365, 525],
  ['r_qingyun', 'land_yulu', 420, 540],
  ['r_nuanpu', 'land_yulu', 155, 595],
  ['r_haotian', 'land_yulu', 230, 600],
  ['r_fenglin', 'land_yulu', 310, 610],
  ['r_wanbo', 'land_yulu', 390, 595],
  ['r_nanzhi', 'land_yulu', 465, 580],

  ['r_liuhuo', 'island_liuhuo', 550, 640],
  ['r_chiyu', 'island_liuhuo', 520, 665],
  ['r_nanxing', 'island_liuhuo', 585, 660],

  ['r_chaoyin', 'island_chenwest', 690, 385],
  ['r_fanzhou', 'island_chenwest', 665, 420],
  ['r_yunjin', 'island_chenwest', 705, 445],

  ['r_yuedao', 'island_yue', 770, 405],
  ['r_xiaguang', 'island_yue', 755, 350],
  ['r_huazhu', 'island_yue', 780, 465],
  ['r_chengsha', 'island_yue', 800, 510],

  ['r_cangya', 'island_canglong', 875, 340],
  ['r_qiming', 'island_canglong', 850, 280],
  ['r_luohui', 'island_canglong', 860, 410],
  ['r_dongning', 'island_canglong', 880, 465],

  ['r_beichen', 'island_shuanghuan', 890, 120],
  ['r_shuanghuan', 'island_shuanghuan', 930, 135],
] as const satisfies readonly SiteSeed[];

export const REGION_DISPLAY_SITES: Readonly<Record<string, MapRegionDisplaySiteDefinition>> = Object.freeze(
  Object.fromEntries(REGION_DISPLAY_SITE_ENTRIES.map(([id, shapeId, x, y]) => [
    id,
    Object.freeze({ id, shapeId, x, y }),
  ])),
);

export const SEA_ZONE_DISPLAY_CENTERS: Readonly<Record<string, MapPoint>> = Object.freeze({
  sea_mirror_inner: Object.freeze({ x: 690, y: 300 }),
  sea_cloud_gate: Object.freeze({ x: 470, y: 470 }),
  sea_rain: Object.freeze({ x: 555, y: 555 }),
  sea_west_channel: Object.freeze({ x: 635, y: 485 }),
  sea_star_strait: Object.freeze({ x: 740, y: 255 }),
  sea_chen_south: Object.freeze({ x: 720, y: 590 }),
  sea_chain_inner: Object.freeze({ x: 825, y: 545 }),
  sea_frost_strait: Object.freeze({ x: 790, y: 140 }),
  sea_cang_outer: Object.freeze({ x: 960, y: 330 }),
  sea_south_outer: Object.freeze({ x: 875, y: 630 }),
});

export const MAP_MACRO_LABELS = Object.freeze([
  { id: 'macro_frost', label: '霜原北境', center: { x: 420, y: 135 }, kind: 'province', priority: 2 },
  { id: 'macro_cloudwest', label: '云西山泽', center: { x: 170, y: 285 }, kind: 'province', priority: 2 },
  { id: 'macro_tianheng', label: '天衡河谷', center: { x: 355, y: 280 }, kind: 'province', priority: 3 },
  { id: 'macro_mirror', label: '镜海月湾', center: { x: 555, y: 285 }, kind: 'peninsula', priority: 2 },
  { id: 'macro_rainland', label: '烟萝雨陆', center: { x: 295, y: 565 }, kind: 'province', priority: 2 },
  { id: 'macro_liuhuo', label: '流火岛', center: { x: 552, y: 647 }, kind: 'island', priority: 2 },
  { id: 'macro_chen', label: '辰海列岛', center: { x: 815, y: 380 }, kind: 'archipelago', priority: 3 },
  { id: 'macro_frostisle', label: '霜环岛', center: { x: 905, y: 120 }, kind: 'island', priority: 2 },
] as const satisfies readonly MapMacroLabelDefinition[]);

export const MAP_GEOGRAPHY_AREAS = Object.freeze([
  { id: 'frost-border', label: '霜原北境', tint: '#c8c9bc', regionIds: REGION_GROUPS.霜原北境 },
  { id: 'cloud-west', label: '云西山泽', tint: '#d2c5a5', regionIds: REGION_GROUPS.云西山泽 },
  { id: 'central-valley', label: '天衡河谷', tint: '#d8d0b0', regionIds: REGION_GROUPS.天衡河谷 },
  { id: 'mirror-coast', label: '镜海沿岸', tint: '#bdd0c4', regionIds: REGION_GROUPS.镜海沿岸 },
  { id: 'rain-land', label: '烟萝雨陆', tint: '#c5cba6', regionIds: REGION_GROUPS.烟萝雨陆 },
  { id: 'south-isles', label: '南曜群岛', tint: '#d0b7a2', regionIds: REGION_GROUPS.南曜群岛 },
  { id: 'chen-archipelago', label: '辰海列岛', tint: '#bdc9cc', regionIds: REGION_GROUPS.辰海列岛 },
] as const satisfies readonly MapGeographyAreaDefinition[]);

export const MAP_RIVER_GUIDES = Object.freeze([
  {
    id: 'river_bailiu',
    label: '白流',
    waypoints: [
      { x: 175, y: 145 }, { x: 250, y: 170 }, { x: 330, y: 205 },
      { x: 410, y: 225 }, { x: 490, y: 245 }, { x: 565, y: 275 },
      { x: 625, y: 292 },
    ],
  },
  {
    id: 'river_hengshui',
    label: '衡水',
    waypoints: [
      { x: 105, y: 310 }, { x: 190, y: 300 }, { x: 275, y: 315 },
      { x: 355, y: 335 }, { x: 440, y: 355 }, { x: 525, y: 375 },
    ],
  },
  {
    id: 'river_luojiang',
    label: '萝江',
    waypoints: [
      { x: 145, y: 535 }, { x: 220, y: 550 }, { x: 300, y: 565 },
      { x: 380, y: 575 }, { x: 450, y: 585 },
    ],
  },
] as const satisfies readonly MapRiverGuideDefinition[]);

export const MAP_HIDDEN_ROUTE_PAIRS = Object.freeze([]) as readonly (readonly [string, string])[];
