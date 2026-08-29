import type {
  Climate,
  PolityDefinition,
  PortLinkDefinition,
  RegionDefinition,
  RouteDefinition,
  RouteKind,
  SeaLaneDefinition,
  SeaZoneDefinition,
  Terrain,
} from '../types';

export const POLITY_DEFINITIONS: readonly PolityDefinition[] = Object.freeze([
  { id: 'p_shuofeng', name: '朔风廷', shortName: '朔', color: '#65758a', capitalRegionId: 'r_shuoyuan', governmentForm: '军府', maritimeOrientation: 14 },
  { id: 'p_yunxi', name: '云岫国', shortName: '云', color: '#9a6f45', capitalRegionId: 'r_yunxiu', governmentForm: '王朝', maritimeOrientation: 10 },
  { id: 'p_linyuan', name: '临渊朝', shortName: '临', color: '#8b443f', capitalRegionId: 'r_tianheng', governmentForm: '王朝', maritimeOrientation: 34 },
  { id: 'p_jianghan', name: '镜海府', shortName: '镜', color: '#3f716b', capitalRegionId: 'r_jiangdu', governmentForm: '军府', maritimeOrientation: 68 },
  { id: 'p_haichao', name: '海潮国', shortName: '潮', color: '#7a5f88', capitalRegionId: 'r_yulu', governmentForm: '王朝', maritimeOrientation: 74 },
  { id: 'p_liuhuo', name: '流火盟', shortName: '火', color: '#a25f4b', capitalRegionId: 'r_liuhuo', governmentForm: '盟约', maritimeOrientation: 88 },
  { id: 'p_yuedao', name: '月岛国', shortName: '月', color: '#547c8d', capitalRegionId: 'r_yuedao', governmentForm: '王朝', maritimeOrientation: 82 },
  { id: 'p_cangya', name: '苍崖国', shortName: '苍', color: '#716a4e', capitalRegionId: 'r_cangya', governmentForm: '王朝', maritimeOrientation: 76 },
]);

type RegionSeed = readonly [
  id: string,
  name: string,
  x: number,
  y: number,
  terrain: Terrain,
  climate: Climate,
  river: boolean,
  port: boolean,
  cityLevel: number,
  defense: number,
  strategicValue: number,
  fertility: number,
  populationBase: number,
  initialControllerId: string,
];

const REGION_SEEDS = [
  // 朔风廷：主陆北缘与高寒关塞（9）
  ['r_shuoyuan', '朔垣', 350, 105, '高原', '寒温带', true, false, 4, 43, 10, 76, 168_000, 'p_shuofeng'],
  ['r_hanlei', '寒砾', 270, 105, '高原', '寒温带', false, false, 2, 46, 8, 58, 86_000, 'p_shuofeng'],
  ['r_bailing', '白陵', 430, 110, '丘陵', '寒温带', true, false, 3, 39, 8, 73, 121_000, 'p_shuofeng'],
  ['r_hejing', '鹤陉', 510, 120, '山地', '寒温带', false, false, 2, 51, 8, 56, 78_000, 'p_shuofeng'],
  ['r_xuesai', '雪塞', 590, 125, '山地', '寒温带', true, false, 2, 53, 9, 54, 74_000, 'p_shuofeng'],
  ['r_yufeng', '驭风', 240, 160, '丘陵', '寒温带', true, false, 2, 38, 7, 72, 99_000, 'p_shuofeng'],
  ['r_cangting', '苍庭', 330, 160, '平原', '寒温带', true, false, 3, 34, 9, 87, 142_000, 'p_shuofeng'],
  ['r_linhuang', '临荒', 430, 165, '平原', '寒温带', false, false, 2, 35, 7, 79, 112_000, 'p_shuofeng'],
  ['r_xuanmo', '玄陌', 530, 170, '丘陵', '寒温带', true, false, 2, 41, 8, 71, 103_000, 'p_shuofeng'],

  // 云岫国：主陆西部山泽与关中盆地（10）
  ['r_yunxiu', '云岫', 145, 245, '山地', '暖温带', true, false, 4, 47, 10, 79, 158_000, 'p_yunxi'],
  ['r_danya', '丹崖', 95, 190, '山地', '干旱', false, false, 2, 52, 7, 49, 68_000, 'p_yunxi'],
  ['r_lizhai', '砺寨', 175, 190, '高原', '干旱', true, false, 2, 45, 8, 60, 84_000, 'p_yunxi'],
  ['r_chize', '赤泽', 100, 280, '高原', '干旱', false, false, 2, 39, 7, 57, 77_000, 'p_yunxi'],
  ['r_languan', '岚关', 180, 270, '山地', '暖温带', true, false, 3, 49, 9, 72, 112_000, 'p_yunxi'],
  ['r_yuyan', '玉砚', 110, 335, '丘陵', '暖温带', true, false, 2, 36, 7, 83, 101_000, 'p_yunxi'],
  ['r_xilan', '西澜', 200, 330, '平原', '暖温带', true, false, 3, 31, 8, 96, 145_000, 'p_yunxi'],
  ['r_zhuxia', '烛峡', 165, 385, '山地', '暖温带', true, false, 2, 50, 8, 69, 91_000, 'p_yunxi'],
  ['r_jingqiu', '镜丘', 250, 375, '丘陵', '暖温带', false, false, 2, 37, 7, 84, 108_000, 'p_yunxi'],
  ['r_zizhen', '紫畛', 255, 285, '平原', '暖温带', true, false, 3, 33, 9, 101, 154_000, 'p_yunxi'],

  // 临渊朝：主陆中央河谷与南岸（11）
  ['r_tianheng', '天衡', 350, 260, '平原', '暖温带', true, false, 4, 35, 10, 108, 205_000, 'p_linyuan'],
  ['r_pingwu', '平芜', 270, 210, '平原', '暖温带', true, false, 3, 29, 8, 104, 160_000, 'p_linyuan'],
  ['r_chengye', '澄野', 350, 205, '平原', '暖温带', true, false, 3, 28, 8, 109, 169_000, 'p_linyuan'],
  ['r_jiunian', '九廛', 430, 215, '平原', '暖温带', true, false, 3, 27, 9, 107, 171_000, 'p_linyuan'],
  ['r_huaijing', '槐京', 275, 270, '丘陵', '暖温带', false, false, 3, 36, 8, 92, 139_000, 'p_linyuan'],
  ['r_anzhi', '安禾', 430, 270, '平原', '暖温带', true, false, 3, 26, 8, 111, 177_000, 'p_linyuan'],
  ['r_helian', '鹤梁', 340, 320, '丘陵', '暖温带', true, false, 3, 38, 9, 95, 149_000, 'p_linyuan'],
  ['r_landing', '岚汀', 430, 325, '平原', '暖温带', true, false, 3, 29, 8, 108, 166_000, 'p_linyuan'],
  ['r_jinbu', '金埠', 285, 330, '平原', '暖温带', true, false, 2, 27, 7, 105, 142_000, 'p_linyuan'],
  ['r_wenchuan', '文川', 355, 375, '平原', '湿热', true, false, 3, 28, 8, 113, 174_000, 'p_linyuan'],
  ['r_xuanjin', '玄津', 470, 365, '海岸', '湿热', true, true, 3, 31, 9, 102, 152_000, 'p_linyuan'],

  // 镜海府：主陆东缘、月湾半岛和内海港区（12）
  ['r_jiangdu', '镜都', 525, 305, '平原', '暖温带', true, false, 4, 33, 10, 105, 198_000, 'p_jianghan'],
  ['r_xinggang', '星港', 520, 220, '海岸', '暖温带', true, true, 3, 31, 9, 96, 151_000, 'p_jianghan'],
  ['r_jingwan', '镜湾', 600, 195, '海岸', '暖温带', false, true, 3, 35, 9, 87, 133_000, 'p_jianghan'],
  ['r_chaoling', '潮陵', 620, 245, '海岸', '暖温带', true, true, 2, 38, 9, 82, 116_000, 'p_jianghan'],
  ['r_dongke', '东柯', 560, 260, '丘陵', '暖温带', true, false, 2, 39, 8, 88, 124_000, 'p_jianghan'],
  ['r_qingpu', '晴浦', 600, 315, '海岸', '暖温带', true, true, 3, 30, 8, 101, 148_000, 'p_jianghan'],
  ['r_cangzhu', '沧渚', 570, 355, '海岸', '湿热', false, true, 2, 33, 8, 94, 123_000, 'p_jianghan'],
  ['r_langao', '兰皋', 500, 330, '丘陵', '湿热', true, false, 2, 35, 7, 100, 132_000, 'p_jianghan'],
  ['r_jiaotai', '鲛台', 610, 350, '海岸', '湿热', false, true, 2, 37, 8, 89, 109_000, 'p_jianghan'],
  ['r_boyue', '泊月', 520, 390, '海岸', '湿热', true, true, 3, 29, 9, 104, 144_000, 'p_jianghan'],
  ['r_lankou', '澜口', 450, 390, '海岸', '湿热', true, true, 3, 30, 9, 109, 156_000, 'p_jianghan'],
  ['r_yueguan', '月关', 650, 145, '丘陵', '寒温带', false, true, 2, 44, 9, 68, 92_000, 'p_jianghan'],

  // 海潮国：南部雨陆（10）
  ['r_yulu', '雨麓', 300, 555, '丘陵', '湿热', true, false, 4, 36, 10, 112, 184_000, 'p_haichao'],
  ['r_yandu', '烟渡', 160, 540, '海岸', '湿热', true, true, 3, 31, 8, 108, 142_000, 'p_haichao'],
  ['r_luochuan', '萝川', 225, 535, '平原', '湿热', true, true, 3, 28, 8, 116, 161_000, 'p_haichao'],
  ['r_jiaoling', '椒岭', 365, 525, '山地', '湿热', true, false, 2, 47, 8, 91, 102_000, 'p_haichao'],
  ['r_qingyun', '青筠', 420, 540, '海岸', '湿热', true, true, 3, 32, 9, 105, 147_000, 'p_haichao'],
  ['r_nuanpu', '暖浦', 155, 595, '海岸', '湿热', false, true, 2, 29, 8, 106, 116_000, 'p_haichao'],
  ['r_haotian', '蒿田', 230, 600, '平原', '湿热', true, false, 2, 25, 7, 119, 151_000, 'p_haichao'],
  ['r_fenglin', '枫林', 310, 610, '丘陵', '湿热', true, false, 2, 34, 7, 104, 126_000, 'p_haichao'],
  ['r_wanbo', '晚泊', 390, 595, '海岸', '湿热', true, true, 3, 30, 8, 110, 139_000, 'p_haichao'],
  ['r_nanzhi', '南枝', 465, 580, '海岸', '湿热', false, true, 2, 32, 8, 101, 119_000, 'p_haichao'],

  // 流火盟：南曜大岛与西辰岛门（6）
  ['r_liuhuo', '流火', 550, 640, '岛屿', '湿热', true, true, 4, 38, 10, 108, 158_000, 'p_liuhuo'],
  ['r_chiyu', '赤屿', 520, 665, '岛屿', '湿热', false, true, 2, 40, 8, 96, 91_000, 'p_liuhuo'],
  ['r_nanxing', '南星', 585, 660, '岛屿', '湿热', true, true, 2, 39, 8, 102, 97_000, 'p_liuhuo'],
  ['r_chaoyin', '潮音', 690, 385, '岛屿', '暖温带', false, true, 3, 40, 9, 91, 121_000, 'p_liuhuo'],
  ['r_fanzhou', '帆州', 665, 420, '岛屿', '暖温带', true, true, 2, 36, 8, 98, 109_000, 'p_liuhuo'],
  ['r_yunjin', '云津', 705, 445, '岛屿', '湿热', false, true, 2, 37, 8, 94, 101_000, 'p_liuhuo'],

  // 月岛国：辰海中链与东链南段（6）
  ['r_yuedao', '月岛', 770, 405, '岛屿', '暖温带', true, true, 4, 39, 10, 102, 166_000, 'p_yuedao'],
  ['r_xiaguang', '霞光', 755, 350, '岛屿', '暖温带', false, true, 3, 37, 8, 95, 126_000, 'p_yuedao'],
  ['r_huazhu', '华渚', 780, 465, '岛屿', '湿热', true, true, 2, 35, 8, 104, 114_000, 'p_yuedao'],
  ['r_chengsha', '澄沙', 800, 510, '岛屿', '湿热', false, true, 2, 34, 8, 100, 103_000, 'p_yuedao'],
  ['r_luohui', '落晖', 860, 410, '岛屿', '暖温带', true, true, 3, 38, 9, 96, 129_000, 'p_yuedao'],
  ['r_dongning', '曜尾', 880, 465, '岛屿', '暖温带', false, true, 2, 40, 8, 88, 106_000, 'p_yuedao'],

  // 苍崖国：东链北段与霜环岛（4）
  ['r_cangya', '苍崖', 875, 340, '岛屿', '暖温带', true, true, 4, 45, 10, 91, 151_000, 'p_cangya'],
  ['r_qiming', '启明', 850, 280, '岛屿', '寒温带', false, true, 3, 43, 9, 82, 116_000, 'p_cangya'],
  ['r_beichen', '北辰', 890, 120, '岛屿', '寒温带', true, true, 3, 42, 9, 79, 112_000, 'p_cangya'],
  ['r_shuanghuan', '霜环', 930, 135, '岛屿', '寒温带', false, true, 2, 46, 8, 70, 91_000, 'p_cangya'],
] as const satisfies readonly RegionSeed[];

export const REGION_DEFINITIONS: readonly RegionDefinition[] = Object.freeze(REGION_SEEDS.map(([
  id, name, x, y, terrain, climate, river, port, cityLevel, defense,
  strategicValue, fertility, populationBase, initialControllerId,
]) => Object.freeze({
  id, name, x, y, terrain, climate, river, port, cityLevel, defense,
  strategicValue, fertility, populationBase, initialControllerId,
})));

const route = (
  fromRegionId: string,
  toRegionId: string,
  kind: RouteKind = '道路',
  supplyCapacity = 9_000,
): RouteDefinition => Object.freeze({
  id: `route_${fromRegionId.slice(2)}_${toRegionId.slice(2)}`,
  fromRegionId,
  toRegionId,
  kind,
  supplyCapacity,
});

export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = Object.freeze([
  // 北境骨架
  route('r_hanlei', 'r_shuoyuan', '道路', 8_000),
  route('r_shuoyuan', 'r_bailing', '道路', 10_500),
  route('r_bailing', 'r_hejing', '山道', 7_000),
  route('r_hejing', 'r_xuesai', '山道', 6_500),
  route('r_hanlei', 'r_yufeng', '山道', 6_800),
  route('r_yufeng', 'r_cangting', '道路', 9_000),
  route('r_cangting', 'r_linhuang', '道路', 10_000),
  route('r_linhuang', 'r_xuanmo', '道路', 8_500),
  route('r_xuesai', 'r_xuanmo', '山道', 6_500),
  route('r_shuoyuan', 'r_cangting', '河道', 11_000),

  // 西陆山泽
  route('r_danya', 'r_lizhai', '山道', 6_000),
  route('r_lizhai', 'r_yunxiu', '山道', 7_500),
  route('r_danya', 'r_chize', '山道', 5_500),
  route('r_chize', 'r_yunxiu', '道路', 7_500),
  route('r_yunxiu', 'r_languan', '山道', 8_000),
  route('r_chize', 'r_yuyan', '道路', 7_000),
  route('r_yuyan', 'r_xilan', '河道', 9_500),
  route('r_xilan', 'r_languan', '道路', 9_500),
  route('r_yuyan', 'r_zhuxia', '山道', 6_500),
  route('r_zhuxia', 'r_jingqiu', '山道', 6_800),
  route('r_jingqiu', 'r_xilan', '道路', 8_500),
  route('r_languan', 'r_zizhen', '道路', 9_000),
  route('r_zizhen', 'r_jingqiu', '道路', 8_500),

  // 中央河网
  route('r_pingwu', 'r_chengye', '河道', 12_000),
  route('r_chengye', 'r_jiunian', '河道', 12_500),
  route('r_pingwu', 'r_huaijing', '道路', 10_000),
  route('r_huaijing', 'r_tianheng', '道路', 12_500),
  route('r_tianheng', 'r_anzhi', '河道', 13_000),
  route('r_tianheng', 'r_helian', '道路', 11_500),
  route('r_huaijing', 'r_jinbu', '道路', 9_500),
  route('r_jinbu', 'r_helian', '河道', 10_000),
  route('r_helian', 'r_landing', '道路', 11_000),
  route('r_landing', 'r_anzhi', '道路', 10_500),
  route('r_helian', 'r_wenchuan', '河道', 10_000),
  route('r_wenchuan', 'r_xuanjin', '道路', 11_000),
  route('r_landing', 'r_xuanjin', '河道', 10_500),
  route('r_jiunian', 'r_anzhi', '道路', 10_500),

  // 镜海沿岸与半岛
  route('r_yueguan', 'r_jingwan', '山道', 7_000),
  route('r_jingwan', 'r_xinggang', '道路', 9_000),
  route('r_jingwan', 'r_chaoling', '道路', 8_500),
  route('r_xinggang', 'r_dongke', '道路', 9_500),
  route('r_dongke', 'r_chaoling', '道路', 8_000),
  route('r_dongke', 'r_jiangdu', '河道', 11_500),
  route('r_jiangdu', 'r_qingpu', '道路', 11_000),
  route('r_jiangdu', 'r_langao', '道路', 10_500),
  route('r_qingpu', 'r_cangzhu', '道路', 9_500),
  route('r_cangzhu', 'r_jiaotai', '道路', 8_500),
  route('r_langao', 'r_cangzhu', '道路', 9_000),
  route('r_langao', 'r_boyue', '河道', 10_000),
  route('r_boyue', 'r_jiaotai', '道路', 8_500),
  route('r_boyue', 'r_lankou', '道路', 10_500),

  // 主陆跨境通道
  route('r_yufeng', 'r_lizhai', '山道', 6_000),
  route('r_cangting', 'r_pingwu', '道路', 9_500),
  route('r_linhuang', 'r_chengye', '道路', 10_000),
  route('r_xuanmo', 'r_jiunian', '道路', 8_500),
  route('r_xuesai', 'r_yueguan', '山道', 6_000),
  route('r_languan', 'r_pingwu', '山道', 7_500),
  route('r_zizhen', 'r_huaijing', '道路', 10_000),
  route('r_jingqiu', 'r_jinbu', '道路', 8_500),
  route('r_jiunian', 'r_xinggang', '道路', 10_000),
  route('r_anzhi', 'r_dongke', '道路', 10_500),
  route('r_landing', 'r_jiangdu', '道路', 11_000),
  route('r_xuanjin', 'r_lankou', '道路', 10_000),

  // 南部雨陆
  route('r_yandu', 'r_luochuan', '河道', 10_000),
  route('r_luochuan', 'r_yulu', '道路', 11_500),
  route('r_yulu', 'r_jiaoling', '山道', 8_000),
  route('r_jiaoling', 'r_qingyun', '山道', 7_500),
  route('r_yandu', 'r_nuanpu', '道路', 8_500),
  route('r_nuanpu', 'r_haotian', '道路', 9_000),
  route('r_haotian', 'r_fenglin', '河道', 10_000),
  route('r_fenglin', 'r_wanbo', '道路', 9_500),
  route('r_wanbo', 'r_nanzhi', '道路', 9_000),
  route('r_luochuan', 'r_haotian', '道路', 9_500),
  route('r_yulu', 'r_fenglin', '河道', 10_500),
  route('r_qingyun', 'r_nanzhi', '道路', 9_500),

  // 岛内道路；岛间只通过权威海路相连
  route('r_liuhuo', 'r_chiyu', '道路', 7_000),
  route('r_liuhuo', 'r_nanxing', '道路', 7_500),
  route('r_chaoyin', 'r_fanzhou', '道路', 7_500),
  route('r_fanzhou', 'r_yunjin', '道路', 7_000),
  route('r_xiaguang', 'r_yuedao', '道路', 8_000),
  route('r_yuedao', 'r_huazhu', '道路', 8_500),
  route('r_huazhu', 'r_chengsha', '道路', 7_500),
  route('r_qiming', 'r_cangya', '道路', 8_000),
  route('r_cangya', 'r_luohui', '道路', 8_500),
  route('r_luohui', 'r_dongning', '道路', 8_000),
  route('r_beichen', 'r_shuanghuan', '道路', 7_000),
]);

export const REGION_GROUPS = Object.freeze({
  霜原北境: Object.freeze(['r_shuoyuan', 'r_hanlei', 'r_bailing', 'r_hejing', 'r_xuesai', 'r_yufeng', 'r_cangting', 'r_linhuang', 'r_xuanmo']),
  云西山泽: Object.freeze(['r_yunxiu', 'r_danya', 'r_lizhai', 'r_chize', 'r_languan', 'r_yuyan', 'r_xilan', 'r_zhuxia', 'r_jingqiu', 'r_zizhen']),
  天衡河谷: Object.freeze(['r_tianheng', 'r_pingwu', 'r_chengye', 'r_jiunian', 'r_huaijing', 'r_anzhi', 'r_helian', 'r_landing', 'r_jinbu', 'r_wenchuan', 'r_xuanjin']),
  镜海沿岸: Object.freeze(['r_jiangdu', 'r_xinggang', 'r_jingwan', 'r_chaoling', 'r_dongke', 'r_qingpu', 'r_cangzhu', 'r_langao', 'r_jiaotai', 'r_boyue', 'r_lankou', 'r_yueguan']),
  烟萝雨陆: Object.freeze(['r_yulu', 'r_yandu', 'r_luochuan', 'r_jiaoling', 'r_qingyun', 'r_nuanpu', 'r_haotian', 'r_fenglin', 'r_wanbo', 'r_nanzhi']),
  南曜群岛: Object.freeze(['r_liuhuo', 'r_chiyu', 'r_nanxing', 'r_chaoyin', 'r_fanzhou', 'r_yunjin']),
  辰海列岛: Object.freeze(['r_yuedao', 'r_xiaguang', 'r_huazhu', 'r_chengsha', 'r_luohui', 'r_dongning', 'r_cangya', 'r_qiming', 'r_beichen', 'r_shuanghuan']),
});

export const SEA_ZONE_DEFINITIONS: readonly SeaZoneDefinition[] = Object.freeze([
  { id: 'sea_mirror_inner', name: '镜月内海', x: 690, y: 300, climate: '内海', stormRisk: 12, piracy: 17 },
  { id: 'sea_cloud_gate', name: '云门海峡', x: 470, y: 470, climate: '内海', stormRisk: 18, piracy: 21 },
  { id: 'sea_rain', name: '烟雨海', x: 555, y: 555, climate: '季风海', stormRisk: 29, piracy: 25 },
  { id: 'sea_west_channel', name: '西辰水道', x: 635, y: 485, climate: '季风海', stormRisk: 25, piracy: 29 },
  { id: 'sea_star_strait', name: '星落海峡', x: 740, y: 255, climate: '北方海', stormRisk: 23, piracy: 18 },
  { id: 'sea_chen_south', name: '辰南海', x: 720, y: 590, climate: '季风海', stormRisk: 33, piracy: 27 },
  { id: 'sea_chain_inner', name: '列岛内海', x: 825, y: 545, climate: '内海', stormRisk: 17, piracy: 30 },
  { id: 'sea_frost_strait', name: '霜潮海峡', x: 790, y: 140, climate: '北方海', stormRisk: 28, piracy: 15 },
  { id: 'sea_cang_outer', name: '苍溟外洋', x: 960, y: 330, climate: '外洋', stormRisk: 43, piracy: 18 },
  { id: 'sea_south_outer', name: '南曜外洋', x: 875, y: 630, climate: '外洋', stormRisk: 39, piracy: 22 },
]);

export const SEA_LANE_DEFINITIONS: readonly SeaLaneDefinition[] = Object.freeze([
  { id: 'lane_mirror_cloud', fromSeaZoneId: 'sea_mirror_inner', toSeaZoneId: 'sea_cloud_gate', distance: 5, capacity: 34_000, baseRisk: 11, strait: false },
  { id: 'lane_mirror_west', fromSeaZoneId: 'sea_mirror_inner', toSeaZoneId: 'sea_west_channel', distance: 3, capacity: 38_000, baseRisk: 10, strait: true },
  { id: 'lane_mirror_star', fromSeaZoneId: 'sea_mirror_inner', toSeaZoneId: 'sea_star_strait', distance: 3, capacity: 36_000, baseRisk: 10, strait: true },
  { id: 'lane_cloud_rain', fromSeaZoneId: 'sea_cloud_gate', toSeaZoneId: 'sea_rain', distance: 3, capacity: 32_000, baseRisk: 12, strait: true },
  { id: 'lane_cloud_west', fromSeaZoneId: 'sea_cloud_gate', toSeaZoneId: 'sea_west_channel', distance: 4, capacity: 29_000, baseRisk: 15, strait: false },
  { id: 'lane_rain_west', fromSeaZoneId: 'sea_rain', toSeaZoneId: 'sea_west_channel', distance: 3, capacity: 31_000, baseRisk: 14, strait: false },
  { id: 'lane_rain_chen', fromSeaZoneId: 'sea_rain', toSeaZoneId: 'sea_chen_south', distance: 5, capacity: 29_000, baseRisk: 18, strait: false },
  { id: 'lane_rain_south', fromSeaZoneId: 'sea_rain', toSeaZoneId: 'sea_south_outer', distance: 7, capacity: 25_000, baseRisk: 23, strait: false },
  { id: 'lane_west_star', fromSeaZoneId: 'sea_west_channel', toSeaZoneId: 'sea_star_strait', distance: 4, capacity: 33_000, baseRisk: 14, strait: true },
  { id: 'lane_west_chain', fromSeaZoneId: 'sea_west_channel', toSeaZoneId: 'sea_chain_inner', distance: 5, capacity: 30_000, baseRisk: 17, strait: false },
  { id: 'lane_star_frost', fromSeaZoneId: 'sea_star_strait', toSeaZoneId: 'sea_frost_strait', distance: 4, capacity: 28_000, baseRisk: 16, strait: true },
  { id: 'lane_star_chain', fromSeaZoneId: 'sea_star_strait', toSeaZoneId: 'sea_chain_inner', distance: 5, capacity: 31_000, baseRisk: 17, strait: false },
  { id: 'lane_chen_chain', fromSeaZoneId: 'sea_chen_south', toSeaZoneId: 'sea_chain_inner', distance: 3, capacity: 35_000, baseRisk: 14, strait: true },
  { id: 'lane_chen_south', fromSeaZoneId: 'sea_chen_south', toSeaZoneId: 'sea_south_outer', distance: 4, capacity: 28_000, baseRisk: 20, strait: false },
  { id: 'lane_frost_outer', fromSeaZoneId: 'sea_frost_strait', toSeaZoneId: 'sea_cang_outer', distance: 6, capacity: 27_000, baseRisk: 22, strait: false },
  { id: 'lane_chain_outer', fromSeaZoneId: 'sea_chain_inner', toSeaZoneId: 'sea_cang_outer', distance: 5, capacity: 31_000, baseRisk: 20, strait: false },
  { id: 'lane_chain_south', fromSeaZoneId: 'sea_chain_inner', toSeaZoneId: 'sea_south_outer', distance: 5, capacity: 29_000, baseRisk: 20, strait: false },
  { id: 'lane_outer_south', fromSeaZoneId: 'sea_cang_outer', toSeaZoneId: 'sea_south_outer', distance: 8, capacity: 24_000, baseRisk: 27, strait: false },
]);

const portLink = (
  regionId: string,
  seaZoneId: string,
  capacity: number,
  distance = 1,
): PortLinkDefinition => Object.freeze({
  id: `portlink_${regionId.slice(2)}_${seaZoneId.slice(4)}`,
  regionId,
  seaZoneId,
  capacity,
  distance,
});

export const PORT_LINK_DEFINITIONS: readonly PortLinkDefinition[] = Object.freeze([
  portLink('r_xinggang', 'sea_mirror_inner', 22_000),
  portLink('r_jingwan', 'sea_mirror_inner', 20_000),
  portLink('r_chaoling', 'sea_star_strait', 17_000),
  portLink('r_qingpu', 'sea_mirror_inner', 19_000),
  portLink('r_cangzhu', 'sea_west_channel', 16_000),
  portLink('r_jiaotai', 'sea_west_channel', 15_000),
  portLink('r_boyue', 'sea_cloud_gate', 20_000),
  portLink('r_lankou', 'sea_cloud_gate', 21_000),
  portLink('r_yueguan', 'sea_frost_strait', 14_000, 2),
  portLink('r_xuanjin', 'sea_cloud_gate', 18_000),

  portLink('r_yandu', 'sea_cloud_gate', 18_000),
  portLink('r_luochuan', 'sea_cloud_gate', 20_000),
  portLink('r_qingyun', 'sea_rain', 20_000),
  portLink('r_nuanpu', 'sea_rain', 16_000),
  portLink('r_wanbo', 'sea_rain', 19_000),
  portLink('r_nanzhi', 'sea_rain', 17_000),

  portLink('r_liuhuo', 'sea_rain', 23_000),
  portLink('r_liuhuo', 'sea_chen_south', 18_000, 2),
  portLink('r_chiyu', 'sea_south_outer', 14_000),
  portLink('r_nanxing', 'sea_chen_south', 16_000),
  portLink('r_chaoyin', 'sea_mirror_inner', 18_000),
  portLink('r_fanzhou', 'sea_west_channel', 17_000),
  portLink('r_yunjin', 'sea_west_channel', 16_000),

  portLink('r_xiaguang', 'sea_star_strait', 18_000),
  portLink('r_yuedao', 'sea_west_channel', 22_000),
  portLink('r_huazhu', 'sea_chen_south', 17_000),
  portLink('r_chengsha', 'sea_chain_inner', 15_000),
  portLink('r_luohui', 'sea_chain_inner', 19_000),
  portLink('r_dongning', 'sea_chain_inner', 16_000),
  portLink('r_dongning', 'sea_south_outer', 14_000, 2),

  portLink('r_qiming', 'sea_star_strait', 17_000),
  portLink('r_cangya', 'sea_cang_outer', 21_000),
  portLink('r_beichen', 'sea_frost_strait', 18_000),
  portLink('r_shuanghuan', 'sea_cang_outer', 15_000),
]);
