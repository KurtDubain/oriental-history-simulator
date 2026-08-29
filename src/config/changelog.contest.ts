import type { AppReleaseNote } from './changelog';

/** Public build notes contain only information shipped by the contest atlas. */
export const APP_RELEASES: readonly AppReleaseNote[] = [
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
