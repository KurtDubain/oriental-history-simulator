import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.25',
  date: '2026-09-13',
  title: '长卷快读',
  items: [
    '长局案卷共享史实读取，打开更快，人物与战役依据完整保留。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
