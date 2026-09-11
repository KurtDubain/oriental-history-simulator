import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.14',
  date: '2026-09-11',
  title: '转折入眼',
  items: [
    '本季重大变化不再被旧线索遮住；起兵建国与领土易手分明，集结人数与兵力分开表达。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
