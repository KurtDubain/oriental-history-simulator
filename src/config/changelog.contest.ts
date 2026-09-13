import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.27',
  date: '2026-09-13',
  title: '音画复验',
  items: [
    '音画验收改用正式历史夹具并接入发布检查；既有声音、图片与默认静音保持不变。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
