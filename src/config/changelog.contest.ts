import type { AppReleaseNote } from './changelog';

/** Public build notes contain only information shipped by the contest atlas. */
export const APP_RELEASES: readonly AppReleaseNote[] = [
  {
    version: '1.9.0',
    date: '2026-08-29',
    title: '指尖读图，远近各有层次',
    items: [
      '移动端点中州域、军团或水师后，先给出身份、辖属、眼下情形和细看去处；上划打开完整档案，下划或点地图空白处返回舆图。',
      '舆图新增概览、区域、近观三层信息密度；缩放时逐步补出重点城港、普通军旅、州名与流线，隐藏对象不再留下看不见的点击区。',
      '底部速览会为被遮住的选中对象留出位置，拖图时让出非必要浮层；移动触控、世界规则与 schema 4 存档保持不变。',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-29',
    title: '云海八荒，展开第一卷历史',
    items: [
      '新增“云海八荒”六十八州、十片海域与八方架空政权，可从种子开启一部完整的新历史。',
      '世界与地图修订精确绑定；自动续写、收藏盘与导入导出都会核对原地图并保护不兼容存档。',
      '人物、家族、经济、战争、海洋、局势与入世玩法已经接入同一条季度演化链。',
    ],
  },
] as const;

export const LATEST_APP_RELEASE = APP_RELEASES[0];
