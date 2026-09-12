import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.23',
  date: '2026-09-12',
  title: '功业分章，转折有据',
  items: [
    '人物传优先保留本人转折，战役按战争与行动边界分章，同源继位不再重复列出。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
