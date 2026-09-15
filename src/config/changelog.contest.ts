import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.37',
  date: '2026-09-15',
  title: '谱系与水师交接',
  items: [
    '修正近亲婚育、承统判定和水师交接。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
