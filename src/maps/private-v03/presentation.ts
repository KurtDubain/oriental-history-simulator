import type { TerritoryLandShape, TerritoryPoint, TerritorySite } from '../../view/map-territories';
import { REGION_GROUPS } from './simulation';

/**
 * Presentation-only geography for the observer map.
 *
 * Simulation coordinates deliberately remain untouched. The canvas consumes
 * these stable sites and coast rings so trade routes, saves, and simulation
 * distance can evolve independently from the illustrated world silhouette.
 */
export const MAP_PRESENTATION_WIDTH = 1000;
export const MAP_PRESENTATION_HEIGHT = 700;

export type MapLandRole = 'mainland' | 'island';

export interface MapLandShape extends TerritoryLandShape {
  readonly label: string;
  readonly role: MapLandRole;
  readonly expectedRegionCount: number;
}

export type MapLandShapeId =
  | 'land_northern'
  | 'land_lingnan'
  | 'island_hainan'
  | 'island_taiwan'
  | 'island_kyushu'
  | 'island_shikoku'
  | 'island_honshu'
  | 'island_hokkaido';

/**
 * Physical coast masks for the illustrated atlas.
 *
 * The northern continent deliberately includes the Korean peninsula: this is
 * one continuous, deeply indented land body rather than the former collection
 * of smooth capsules. Region cells are generated against convex bounds and
 * clipped back to these masks by the canvas renderer.
 */
export const MAP_LAND_SHAPES = [
  {
    id: 'land_northern',
    label: '北陆与海东半岛',
    role: 'mainland',
    expectedRegionCount: 57,
    polygon: [
      { x: 390, y: 205 }, { x: 346, y: 241 }, { x: 447, y: 272 },
      { x: 358, y: 329 }, { x: 319, y: 318 }, { x: 296, y: 390 },
      { x: 202, y: 354 }, { x: 172, y: 385 }, { x: 84, y: 364 },
      { x: 151, y: 289 }, { x: 110, y: 269 }, { x: 115, y: 299 },
      { x: 82, y: 299 }, { x: 60, y: 261 }, { x: 95, y: 222 },
      { x: 149, y: 255 }, { x: 262, y: 192 }, { x: 277, y: 152 },
      { x: 346, y: 141 }, { x: 377, y: 172 }, { x: 381, y: 146 },
      { x: 456, y: 136 }, { x: 426, y: 61 }, { x: 462, y: 49 },
      { x: 635, y: 121 }, { x: 553, y: 211 }, { x: 595, y: 268 },
      { x: 578, y: 323 }, { x: 517, y: 323 }, { x: 534, y: 270 },
      { x: 492, y: 247 }, { x: 505, y: 213 }, { x: 417, y: 232 },
      { x: 422, y: 182 },
    ],
  },
  {
    id: 'land_lingnan',
    label: '岭南海陆',
    role: 'mainland',
    expectedRegionCount: 12,
    polygon: [
      { x: 174, y: 584 }, { x: 197, y: 565 }, { x: 226, y: 516 },
      { x: 303, y: 526 }, { x: 339, y: 462 }, { x: 366, y: 453 },
      { x: 401, y: 475 }, { x: 389, y: 516 }, { x: 318, y: 560 },
      { x: 241, y: 586 }, { x: 194, y: 592 },
    ],
  },
  {
    id: 'island_hainan',
    label: '海南岛',
    role: 'island',
    expectedRegionCount: 2,
    polygon: [
      { x: 150, y: 631 }, { x: 162, y: 619 }, { x: 181, y: 617 },
      { x: 202, y: 623 }, { x: 189, y: 645 }, { x: 174, y: 651 },
      { x: 153, y: 646 },
    ],
  },
  {
    id: 'island_taiwan',
    label: '台湾岛',
    role: 'island',
    expectedRegionCount: 3,
    polygon: [
      { x: 394, y: 552 }, { x: 404, y: 534 }, { x: 412, y: 521 },
      { x: 429, y: 514 }, { x: 435, y: 523 }, { x: 430, y: 543 },
      { x: 420, y: 568 }, { x: 411, y: 581 }, { x: 401, y: 568 },
    ],
  },
  {
    id: 'island_kyushu',
    label: '九州岛',
    role: 'island',
    expectedRegionCount: 1,
    polygon: [
      { x: 593, y: 350 }, { x: 609, y: 341 }, { x: 628, y: 347 },
      { x: 642, y: 365 }, { x: 635, y: 392 }, { x: 616, y: 399 },
      { x: 604, y: 387 },
    ],
  },
  {
    id: 'island_shikoku',
    label: '四国岛',
    role: 'island',
    expectedRegionCount: 1,
    polygon: [
      { x: 650, y: 351 }, { x: 666, y: 338 }, { x: 687, y: 345 },
      { x: 707, y: 355 }, { x: 697, y: 371 }, { x: 676, y: 375 },
      { x: 658, y: 365 },
    ],
  },
  {
    id: 'island_honshu',
    label: '本州岛',
    role: 'island',
    expectedRegionCount: 5,
    polygon: [
      { x: 650, y: 340 }, { x: 669, y: 322 }, { x: 692, y: 318 },
      { x: 711, y: 301 }, { x: 733, y: 304 }, { x: 751, y: 261 },
      { x: 770, y: 263 }, { x: 789, y: 247 }, { x: 813, y: 229 },
      { x: 818, y: 186 }, { x: 838, y: 167 }, { x: 850, y: 172 },
      { x: 864, y: 214 }, { x: 850, y: 245 }, { x: 836, y: 276 },
      { x: 827, y: 312 }, { x: 804, y: 319 }, { x: 782, y: 311 },
      { x: 758, y: 300 }, { x: 731, y: 323 }, { x: 707, y: 332 },
      { x: 684, y: 339 },
    ],
  },
  {
    id: 'island_hokkaido',
    label: '北海岛',
    role: 'island',
    expectedRegionCount: 1,
    polygon: [
      { x: 828, y: 144 }, { x: 843, y: 162 }, { x: 819, y: 169 },
      { x: 812, y: 144 }, { x: 826, y: 123 }, { x: 848, y: 122 },
      { x: 856, y: 68 }, { x: 900, y: 103 }, { x: 932, y: 99 },
      { x: 937, y: 127 }, { x: 901, y: 136 }, { x: 887, y: 157 },
      { x: 859, y: 143 },
    ],
  },
] as const satisfies readonly MapLandShape[];

/** Convex generation bounds; the renderer clips their cells to MAP_LAND_SHAPES. */
export const MAP_TERRITORY_SHAPES: readonly TerritoryLandShape[] = MAP_LAND_SHAPES.map((shape) => {
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
});

export function getMapLandShape(shapeId: string): MapLandShape | undefined {
  return MAP_LAND_SHAPES.find((shape) => shape.id === shapeId);
}

export interface MapDecorativeIslet extends TerritoryLandShape {
  readonly label?: string;
}

/** Small unowned islets make the Japanese arc and straits legible at a glance. */
export const MAP_DECORATIVE_ISLETS = [
  { id: 'islet_jeju', polygon: [{ x: 524, y: 347 }, { x: 531, y: 344 }, { x: 538, y: 350 }, { x: 532, y: 355 }, { x: 525, y: 353 }] },
  { id: 'islet_tsushima', polygon: [{ x: 577, y: 351 }, { x: 583, y: 347 }, { x: 588, y: 354 }, { x: 584, y: 361 }, { x: 578, y: 358 }] },
  { id: 'islet_oki', polygon: [{ x: 779, y: 241 }, { x: 785, y: 238 }, { x: 790, y: 244 }, { x: 785, y: 249 }] },
  { id: 'islet_ryukyu_1', polygon: [{ x: 610, y: 407 }, { x: 615, y: 403 }, { x: 620, y: 408 }, { x: 615, y: 413 }] },
  { id: 'islet_ryukyu_2', polygon: [{ x: 587, y: 452 }, { x: 592, y: 448 }, { x: 597, y: 453 }, { x: 592, y: 459 }] },
  { id: 'islet_ryukyu_3', polygon: [{ x: 556, y: 489 }, { x: 561, y: 486 }, { x: 566, y: 491 }, { x: 561, y: 496 }] },
  { id: 'islet_ryukyu_4', polygon: [{ x: 478, y: 529 }, { x: 483, y: 526 }, { x: 488, y: 531 }, { x: 483, y: 536 }] },
] as const satisfies readonly MapDecorativeIslet[];

export interface MapRegionDisplaySite extends TerritorySite {
  readonly shapeId: MapLandShapeId;
}

const REGION_DISPLAY_SITE_ENTRIES = [
  ['r_yanjing', 'land_northern', 367, 188],
  ['r_jinmen', 'land_northern', 389, 200],
  ['r_changshan', 'land_northern', 323, 184],
  ['r_yecheng', 'land_northern', 333, 235],
  ['r_jinyang', 'land_northern', 244, 217],
  ['r_shangdang', 'land_northern', 278, 249],
  ['r_qizhou', 'land_northern', 368, 250],
  ['r_qingzhou', 'land_northern', 396, 258],
  ['r_dengzhou', 'land_northern', 430, 270],
  ['r_langya', 'land_northern', 385, 285],
  ['r_kaifeng', 'land_northern', 325, 296],
  ['r_runan', 'land_northern', 310, 345],
  ['r_luoyang', 'land_northern', 282, 292],
  ['r_nanyang', 'land_northern', 279, 344],
  ['r_hedong', 'land_northern', 263, 270],
  ['r_changan', 'land_northern', 196, 300],
  ['r_yanan', 'land_northern', 164, 258],
  ['r_lingzhou', 'land_northern', 93, 258],
  ['r_liaoxi', 'land_northern', 404, 166],
  ['r_liaodong', 'land_northern', 470, 194],
  ['r_jilin', 'land_northern', 520, 92],
  ['r_changbai', 'land_northern', 559, 160],
  ['r_pyongyang', 'land_northern', 541, 252],
  ['r_hanjing', 'land_northern', 560, 289],
  ['r_quanzhou', 'land_lingnan', 374, 504],
  ['r_guangzhou', 'land_lingnan', 280, 548],
  ['r_hainan', 'island_hainan', 163, 637],
  ['r_taiwan', 'island_taiwan', 416, 547],
  ['r_tsukushi', 'island_kyushu', 618, 368],
  ['r_naniwa', 'island_honshu', 701, 319],
  ['r_datong', 'land_northern', 285, 165],
  ['r_hejian', 'land_northern', 360, 210],
  ['r_yuyang', 'land_northern', 407, 159],
  ['r_donglai', 'land_northern', 423, 274],
  ['r_pengcheng', 'land_northern', 350, 319],
  ['r_huaiyang', 'land_northern', 302, 362],
  ['r_beidi', 'land_northern', 138, 310],
  ['r_tianshui', 'land_northern', 145, 345],
  ['r_hanzhong', 'land_northern', 191, 351],
  ['r_shangluo', 'land_northern', 238, 341],
  ['r_shenyang', 'land_northern', 456, 158],
  ['r_songhua', 'land_northern', 469, 68],
  ['r_xianjing', 'land_northern', 525, 226],
  ['r_jeonju', 'land_northern', 541, 303],
  ['r_chaoshan', 'land_lingnan', 344, 522],
  ['r_jiaozhi', 'land_lingnan', 200, 570],
  ['r_yamato', 'island_honshu', 732, 310],
  ['r_kanto', 'island_honshu', 815, 230],
  ['r_zhending', 'land_northern', 340, 171],
  ['r_bohai', 'land_northern', 390, 195],
  ['r_daming', 'land_northern', 345, 222],
  ['r_henei', 'land_northern', 298, 262],
  ['r_xuchang', 'land_northern', 342, 310],
  ['r_chenliu', 'land_northern', 357, 278],
  ['r_fenyang', 'land_northern', 229, 244],
  ['r_yuncheng', 'land_northern', 245, 295],
  ['r_huazhou', 'land_northern', 222, 321],
  ['r_suide', 'land_northern', 137, 255],
  ['r_guyuan', 'land_northern', 115, 340],
  ['r_hongnong', 'land_northern', 260, 314],
  ['r_chengde', 'land_northern', 425, 150],
  ['r_jinzhou', 'land_northern', 438, 175],
  ['r_yingkou', 'land_northern', 447, 207],
  ['r_fushun', 'land_northern', 493, 125],
  ['r_mudan', 'land_northern', 591, 118],
  ['r_leizhou', 'land_lingnan', 230, 568],
  ['r_gaozhou', 'land_lingnan', 246, 548],
  ['r_nanxiong', 'land_lingnan', 298, 530],
  ['r_fuzhou', 'land_lingnan', 383, 482],
  ['r_zhangzhou', 'land_lingnan', 355, 528],
  ['r_tingzhou', 'land_lingnan', 329, 500],
  ['r_jianning', 'land_lingnan', 358, 472],
  ['r_putian', 'land_lingnan', 384, 496],
  ['r_qiongshan', 'island_hainan', 185, 636],
  ['r_tainan', 'island_taiwan', 408, 565],
  ['r_beigang', 'island_taiwan', 424, 526],
  ['r_kaesong', 'land_northern', 548, 273],
  ['r_gyeongju', 'land_northern', 567, 307],
  ['r_chugoku', 'island_honshu', 672, 329],
  ['r_shikoku', 'island_shikoku', 677, 356],
  ['r_tokai', 'island_honshu', 773, 273],
  ['r_ou', 'island_hokkaido', 878, 123],
] as const satisfies readonly (readonly [string, MapLandShapeId, number, number])[];

export const REGION_DISPLAY_SITES: Readonly<Record<string, MapRegionDisplaySite>> =
  Object.freeze(Object.fromEntries(REGION_DISPLAY_SITE_ENTRIES.map(([id, shapeId, x, y]) => [
    id,
    Object.freeze({ id, shapeId, x, y }),
  ])));

export function getRegionDisplaySite(regionId: string): MapRegionDisplaySite | undefined {
  return REGION_DISPLAY_SITES[regionId];
}

export const SEA_ZONE_DISPLAY_CENTERS: Readonly<Record<string, TerritoryPoint>> = Object.freeze({
  sea_bohai: Object.freeze({ x: 455, y: 240 }),
  sea_shandong: Object.freeze({ x: 472, y: 300 }),
  sea_north_strait: Object.freeze({ x: 650, y: 225 }),
  sea_fujian: Object.freeze({ x: 430, y: 490 }),
  sea_taiwan: Object.freeze({ x: 470, y: 550 }),
  sea_guangdong: Object.freeze({ x: 290, y: 610 }),
  sea_qiongzhou: Object.freeze({ x: 182, y: 605 }),
  sea_korea: Object.freeze({ x: 585, y: 338 }),
  sea_japan_inland: Object.freeze({ x: 675, y: 382 }),
  sea_east_ocean: Object.freeze({ x: 900, y: 430 }),
});

export function getSeaZoneDisplayCenter(seaZoneId: string): TerritoryPoint | undefined {
  return SEA_ZONE_DISPLAY_CENTERS[seaZoneId];
}

export type MapMacroLabelKind = 'province' | 'peninsula' | 'archipelago' | 'island';

export interface MapMacroLabel {
  readonly id: string;
  readonly label: string;
  readonly center: TerritoryPoint;
  readonly kind: MapMacroLabelKind;
  readonly priority: number;
}

/** Low-frequency geographic labels; city and polity labels remain data-driven. */
export const MAP_MACRO_LABELS = [
  { id: 'macro_ningxia', label: '宁夏', center: { x: 105, y: 290 }, kind: 'province', priority: 2 },
  { id: 'macro_shaanxi', label: '陕西', center: { x: 190, y: 306 }, kind: 'province', priority: 2 },
  { id: 'macro_shanxi', label: '山西', center: { x: 266, y: 235 }, kind: 'province', priority: 2 },
  { id: 'macro_henan', label: '河南', center: { x: 320, y: 323 }, kind: 'province', priority: 2 },
  { id: 'macro_hebei', label: '河北', center: { x: 346, y: 210 }, kind: 'province', priority: 2 },
  { id: 'macro_beijing', label: '北京', center: { x: 368, y: 176 }, kind: 'province', priority: 3 },
  { id: 'macro_tianjin', label: '天津', center: { x: 394, y: 201 }, kind: 'province', priority: 3 },
  { id: 'macro_shandong', label: '山东', center: { x: 401, y: 274 }, kind: 'province', priority: 2 },
  { id: 'macro_liaoning', label: '辽宁', center: { x: 458, y: 176 }, kind: 'province', priority: 2 },
  { id: 'macro_jilin', label: '吉林', center: { x: 533, y: 107 }, kind: 'province', priority: 2 },
  { id: 'macro_guangdong', label: '广东', center: { x: 268, y: 552 }, kind: 'province', priority: 2 },
  { id: 'macro_fujian', label: '福建', center: { x: 357, y: 497 }, kind: 'province', priority: 2 },
  { id: 'macro_hainan', label: '海南', center: { x: 176, y: 637 }, kind: 'island', priority: 2 },
  { id: 'macro_taiwan', label: '台湾', center: { x: 415, y: 550 }, kind: 'island', priority: 2 },
  { id: 'macro_korea', label: '朝鲜半岛', center: { x: 554, y: 277 }, kind: 'peninsula', priority: 2 },
  { id: 'macro_japan', label: '日本列岛', center: { x: 754, y: 284 }, kind: 'archipelago', priority: 2 },
] as const satisfies readonly MapMacroLabel[];

export const MAP_GEOGRAPHY_AREAS = [
  {
    id: 'heartland',
    label: '中原山河',
    tint: '#d8d0b2',
    regionIds: REGION_GROUPS.中原大陆,
  },
  {
    id: 'northeast',
    label: '东北边原',
    tint: '#c7ccba',
    regionIds: REGION_GROUPS.东北边疆,
  },
  {
    id: 'lingnan',
    label: '岭南海甸',
    tint: '#ced0aa',
    regionIds: REGION_GROUPS.南方海洋,
  },
  {
    id: 'korea',
    label: '海东半岛',
    tint: '#d0c9ad',
    regionIds: REGION_GROUPS.朝鲜半岛,
  },
  {
    id: 'japan',
    label: '东瀛列岛',
    tint: '#cbc3aa',
    regionIds: REGION_GROUPS.日本列岛,
  },
] as const;

export const MAP_RIVER_GUIDES = [
  {
    id: 'river_cang',
    label: '苍河',
    waypoints: [
      { x: 105, y: 245 }, { x: 190, y: 250 }, { x: 285, y: 318 },
      { x: 365, y: 308 }, { x: 445, y: 300 }, { x: 530, y: 245 },
      { x: 615, y: 210 }, { x: 700, y: 225 },
    ],
  },
  {
    id: 'river_lan',
    label: '澜江',
    waypoints: [
      { x: 255, y: 455 }, { x: 345, y: 430 }, { x: 435, y: 438 },
      { x: 520, y: 452 }, { x: 600, y: 445 }, { x: 665, y: 470 },
      { x: 720, y: 510 },
    ],
  },
] as const;

export const MAP_HIDDEN_ROUTE_PAIRS = [
  ['r_nanyang', 'r_guangzhou'],
  ['r_runan', 'r_quanzhou'],
] as const;
