import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.28',
  date: '2026-09-13',
  title: '双版交付准备',
  items: [
    '明确构建版别、更新识别与地图范围；保留同一套演变规则和完整史册读写。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
