import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.32',
  date: '2026-09-14',
  title: '首页备案信息',
  items: [
    '腾讯云构建的世界书页显示备案链接，其他构建保持不显示。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
