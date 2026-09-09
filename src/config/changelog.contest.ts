import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.7',
  date: '2026-09-09',
  title: '人物事业与战后余波',
  items: [
    '连缀起兵、拓土与结局，区分亲历和任内国事；守军回应前线，高龄恢复渐缓。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
