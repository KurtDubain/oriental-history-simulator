import type { TerritoryLandShape, TerritoryPoint, TerritorySite } from './map-territories';

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
  | 'land_korea'
  | 'island_hainan'
  | 'island_taiwan'
  | 'island_kyushu'
  | 'island_shikoku'
  | 'island_honshu';

/** Three separated continental silhouettes and five intentionally detached islands. */
export const MAP_LAND_SHAPES = [
  {
    id: 'land_northern',
    label: '中原北陆',
    role: 'mainland',
    expectedRegionCount: 51,
    polygon: [
      { x: 20, y: 230 }, { x: 24, y: 154 }, { x: 38, y: 96 },
      { x: 94, y: 48 }, { x: 178, y: 29 }, { x: 286, y: 22 },
      { x: 406, y: 25 }, { x: 528, y: 27 }, { x: 614, y: 43 },
      { x: 650, y: 82 }, { x: 653, y: 137 }, { x: 644, y: 190 },
      { x: 625, y: 241 }, { x: 597, y: 292 }, { x: 560, y: 347 },
      { x: 510, y: 390 }, { x: 435, y: 410 }, { x: 340, y: 416 },
      { x: 252, y: 410 }, { x: 164, y: 399 }, { x: 90, y: 375 },
      { x: 43, y: 334 }, { x: 25, y: 285 },
    ],
  },
  {
    id: 'land_lingnan',
    label: '岭南陆',
    role: 'mainland',
    expectedRegionCount: 12,
    polygon: [
      { x: 196, y: 514 }, { x: 207, y: 480 }, { x: 236, y: 455 },
      { x: 286, y: 440 }, { x: 359, y: 433 }, { x: 438, y: 435 },
      { x: 510, y: 441 }, { x: 572, y: 453 }, { x: 607, y: 475 },
      { x: 622, y: 507 }, { x: 617, y: 539 }, { x: 597, y: 569 },
      { x: 550, y: 590 }, { x: 483, y: 601 }, { x: 405, y: 604 },
      { x: 330, y: 601 }, { x: 267, y: 591 }, { x: 222, y: 573 },
      { x: 201, y: 548 },
    ],
  },
  {
    id: 'land_korea',
    label: '朝鲜半岛',
    role: 'mainland',
    expectedRegionCount: 6,
    polygon: [
      { x: 670, y: 190 }, { x: 680, y: 163 }, { x: 706, y: 149 },
      { x: 736, y: 153 }, { x: 758, y: 174 }, { x: 771, y: 209 },
      { x: 775, y: 251 }, { x: 789, y: 303 }, { x: 786, y: 347 },
      { x: 770, y: 376 }, { x: 749, y: 391 }, { x: 726, y: 382 },
      { x: 707, y: 350 }, { x: 696, y: 309 }, { x: 690, y: 268 },
      { x: 678, y: 229 },
    ],
  },
  {
    id: 'island_hainan',
    label: '海南岛',
    role: 'island',
    expectedRegionCount: 2,
    polygon: [
      { x: 325, y: 646 }, { x: 338, y: 626 }, { x: 367, y: 619 },
      { x: 405, y: 620 }, { x: 432, y: 631 }, { x: 440, y: 652 },
      { x: 425, y: 674 }, { x: 392, y: 686 }, { x: 354, y: 680 },
      { x: 332, y: 666 },
    ],
  },
  {
    id: 'island_taiwan',
    label: '台湾岛',
    role: 'island',
    expectedRegionCount: 3,
    polygon: [
      { x: 638, y: 491 }, { x: 648, y: 469 }, { x: 666, y: 477 },
      { x: 681, y: 507 }, { x: 689, y: 547 }, { x: 687, y: 586 },
      { x: 676, y: 623 }, { x: 659, y: 648 }, { x: 645, y: 632 },
      { x: 638, y: 599 }, { x: 637, y: 556 },
    ],
  },
  {
    id: 'island_kyushu',
    label: '九州岛',
    role: 'island',
    expectedRegionCount: 1,
    polygon: [
      { x: 771, y: 506 }, { x: 779, y: 486 }, { x: 800, y: 479 },
      { x: 822, y: 489 }, { x: 830, y: 512 }, { x: 820, y: 536 },
      { x: 796, y: 547 }, { x: 778, y: 533 },
    ],
  },
  {
    id: 'island_shikoku',
    label: '四国岛',
    role: 'island',
    expectedRegionCount: 1,
    polygon: [
      { x: 841, y: 492 }, { x: 851, y: 480 }, { x: 874, y: 478 },
      { x: 892, y: 489 }, { x: 886, y: 508 }, { x: 865, y: 519 },
      { x: 846, y: 511 },
    ],
  },
  {
    id: 'island_honshu',
    label: '本州岛',
    role: 'island',
    expectedRegionCount: 6,
    polygon: [
      { x: 791, y: 422 }, { x: 800, y: 395 }, { x: 824, y: 366 },
      { x: 853, y: 333 }, { x: 883, y: 292 }, { x: 910, y: 236 },
      { x: 934, y: 194 }, { x: 950, y: 188 }, { x: 964, y: 207 },
      { x: 968, y: 245 }, { x: 960, y: 283 }, { x: 945, y: 322 },
      { x: 929, y: 355 }, { x: 908, y: 391 }, { x: 884, y: 428 },
      { x: 862, y: 456 }, { x: 840, y: 469 }, { x: 815, y: 456 },
      { x: 798, y: 440 },
    ],
  },
] as const satisfies readonly MapLandShape[];

export interface MapRegionDisplaySite extends TerritorySite {
  readonly shapeId: MapLandShapeId;
}

const REGION_DISPLAY_SITE_ENTRIES = [
  ['r_yanjing', 'land_northern', 319, 95],
  ['r_jinmen', 'land_northern', 370, 121],
  ['r_changshan', 'land_northern', 266, 159],
  ['r_yecheng', 'land_northern', 315, 215],
  ['r_jinyang', 'land_northern', 191, 161],
  ['r_shangdang', 'land_northern', 242, 219],
  ['r_qizhou', 'land_northern', 388, 222],
  ['r_qingzhou', 'land_northern', 449, 205],
  ['r_dengzhou', 'land_northern', 507, 166],
  ['r_langya', 'land_northern', 436, 285],
  ['r_kaifeng', 'land_northern', 334, 275],
  ['r_runan', 'land_northern', 345, 339],
  ['r_luoyang', 'land_northern', 265, 275],
  ['r_nanyang', 'land_northern', 269, 344],
  ['r_hedong', 'land_northern', 197, 245],
  ['r_changan', 'land_northern', 136, 284],
  ['r_yanan', 'land_northern', 107, 215],
  ['r_lingzhou', 'land_northern', 40, 192],
  ['r_liaoxi', 'land_northern', 422, 110],
  ['r_liaodong', 'land_northern', 481, 95],
  ['r_jilin', 'land_northern', 544, 74],
  ['r_changbai', 'land_northern', 581, 120],
  ['r_pyongyang', 'land_korea', 690, 180],
  ['r_hanjing', 'land_korea', 709, 266],
  ['r_quanzhou', 'land_lingnan', 545, 507],
  ['r_guangzhou', 'land_lingnan', 365, 529],
  ['r_hainan', 'island_hainan', 355, 650],
  ['r_taiwan', 'island_taiwan', 660, 550],
  ['r_tsukushi', 'island_kyushu', 797, 515],
  ['r_naniwa', 'island_honshu', 865, 405],
  ['r_datong', 'land_northern', 175, 104],
  ['r_hejian', 'land_northern', 354, 177],
  ['r_yuyang', 'land_northern', 381, 81],
  ['r_donglai', 'land_northern', 487, 229],
  ['r_pengcheng', 'land_northern', 402, 335],
  ['r_huaiyang', 'land_northern', 363, 383],
  ['r_beidi', 'land_northern', 71, 249],
  ['r_tianshui', 'land_northern', 64, 313],
  ['r_hanzhong', 'land_northern', 165, 364],
  ['r_shangluo', 'land_northern', 208, 321],
  ['r_shenyang', 'land_northern', 456, 133],
  ['r_songhua', 'land_northern', 546, 42],
  ['r_xianjing', 'land_korea', 737, 198],
  ['r_jeonju', 'land_korea', 742, 300],
  ['r_chaoshan', 'land_lingnan', 470, 525],
  ['r_jiaozhi', 'land_lingnan', 240, 566],
  ['r_yamato', 'island_honshu', 850, 455],
  ['r_kanto', 'island_honshu', 930, 325],
  ['r_zhending', 'land_northern', 289, 133],
  ['r_bohai', 'land_northern', 401, 150],
  ['r_daming', 'land_northern', 334, 198],
  ['r_henei', 'land_northern', 280, 246],
  ['r_xuchang', 'land_northern', 319, 311],
  ['r_chenliu', 'land_northern', 361, 256],
  ['r_fenyang', 'land_northern', 162, 198],
  ['r_yuncheng', 'land_northern', 165, 268],
  ['r_huazhou', 'land_northern', 175, 306],
  ['r_suide', 'land_northern', 96, 177],
  ['r_guyuan', 'land_northern', 40, 258],
  ['r_hongnong', 'land_northern', 224, 282],
  ['r_chengde', 'land_northern', 399, 64],
  ['r_jinzhou', 'land_northern', 438, 85],
  ['r_yingkou', 'land_northern', 498, 133],
  ['r_fushun', 'land_northern', 501, 59],
  ['r_mudan', 'land_northern', 607, 77],
  ['r_leizhou', 'land_lingnan', 315, 553],
  ['r_gaozhou', 'land_lingnan', 300, 522],
  ['r_nanxiong', 'land_lingnan', 400, 499],
  ['r_fuzhou', 'land_lingnan', 585, 483],
  ['r_zhangzhou', 'land_lingnan', 520, 533],
  ['r_tingzhou', 'land_lingnan', 485, 496],
  ['r_jianning', 'land_lingnan', 530, 465],
  ['r_putian', 'land_lingnan', 585, 512],
  ['r_qiongshan', 'island_hainan', 400, 660],
  ['r_tainan', 'island_taiwan', 655, 612],
  ['r_beigang', 'island_taiwan', 670, 493],
  ['r_kaesong', 'land_korea', 707, 224],
  ['r_gyeongju', 'land_korea', 759, 346],
  ['r_chugoku', 'island_honshu', 810, 425],
  ['r_shikoku', 'island_shikoku', 865, 500],
  ['r_tokai', 'island_honshu', 895, 365],
  ['r_ou', 'island_honshu', 935, 240],
] as const satisfies readonly (readonly [string, MapLandShapeId, number, number])[];

export const REGION_DISPLAY_SITES: Readonly<Record<string, MapRegionDisplaySite>> =
  Object.freeze(Object.fromEntries(REGION_DISPLAY_SITE_ENTRIES.map(([id, shapeId, x, y]) => [
    id,
    Object.freeze({ id, shapeId, x, y }),
  ])));

export function getRegionDisplaySite(regionId: string): MapRegionDisplaySite | undefined {
  return REGION_DISPLAY_SITES[regionId];
}

const SEA_ZONE_DISPLAY_CENTERS: Readonly<Record<string, TerritoryPoint>> = Object.freeze({
  sea_bohai: Object.freeze({ x: 661, y: 180 }),
  sea_shandong: Object.freeze({ x: 617, y: 337 }),
  sea_north_strait: Object.freeze({ x: 670, y: 119 }),
  sea_fujian: Object.freeze({ x: 629, y: 513 }),
  sea_taiwan: Object.freeze({ x: 718, y: 556 }),
  sea_guangdong: Object.freeze({ x: 504, y: 632 }),
  sea_qiongzhou: Object.freeze({ x: 377, y: 612 }),
  sea_korea: Object.freeze({ x: 794, y: 390 }),
  sea_japan_inland: Object.freeze({ x: 834, y: 483 }),
  sea_east_ocean: Object.freeze({ x: 958, y: 530 }),
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
  { id: 'macro_ningxia', label: '宁夏', center: { x: 66, y: 218 }, kind: 'province', priority: 2 },
  { id: 'macro_shaanxi', label: '陕西', center: { x: 150, y: 286 }, kind: 'province', priority: 2 },
  { id: 'macro_shanxi', label: '山西', center: { x: 208, y: 200 }, kind: 'province', priority: 2 },
  { id: 'macro_henan', label: '河南', center: { x: 303, y: 302 }, kind: 'province', priority: 2 },
  { id: 'macro_hebei', label: '河北', center: { x: 320, y: 165 }, kind: 'province', priority: 2 },
  { id: 'macro_beijing', label: '北京', center: { x: 316, y: 72 }, kind: 'province', priority: 3 },
  { id: 'macro_tianjin', label: '天津', center: { x: 377, y: 112 }, kind: 'province', priority: 3 },
  { id: 'macro_shandong', label: '山东', center: { x: 440, y: 245 }, kind: 'province', priority: 2 },
  { id: 'macro_liaoning', label: '辽宁', center: { x: 470, y: 121 }, kind: 'province', priority: 2 },
  { id: 'macro_jilin', label: '吉林', center: { x: 558, y: 66 }, kind: 'province', priority: 2 },
  { id: 'macro_guangdong', label: '广东', center: { x: 360, y: 543 }, kind: 'province', priority: 2 },
  { id: 'macro_fujian', label: '福建', center: { x: 540, y: 497 }, kind: 'province', priority: 2 },
  { id: 'macro_hainan', label: '海南', center: { x: 383, y: 651 }, kind: 'island', priority: 2 },
  { id: 'macro_taiwan', label: '台湾', center: { x: 660, y: 556 }, kind: 'island', priority: 2 },
  { id: 'macro_korea', label: '朝鲜半岛', center: { x: 730, y: 278 }, kind: 'peninsula', priority: 2 },
  { id: 'macro_japan', label: '日本列岛', center: { x: 881, y: 338 }, kind: 'archipelago', priority: 2 },
] as const satisfies readonly MapMacroLabel[];
