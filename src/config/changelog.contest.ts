import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.16',
  date: '2026-09-11',
  title: '阅毕归图',
  items: [
    '阅读后保留原地图，平板触控更稳妥；同职换营合为一次调任。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
