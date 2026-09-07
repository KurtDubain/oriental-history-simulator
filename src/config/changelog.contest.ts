import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.0',
  date: '2026-09-07',
  title: '观看时舒展，细读时收拢',
  items: [
    '开局与演变中让舆图占据主位，手机阅读面互斥，史册筛选按需展开。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
