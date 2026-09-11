import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.17',
  date: '2026-09-11',
  title: '展卷如常',
  items: [
    '平板史卷展开完整正文；战争关注验证不再依赖首页固定排序。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
