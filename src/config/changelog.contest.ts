import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.8',
  date: '2026-09-10',
  title: '君位迁驻与人生脉络',
  items: [
    '迁驻不再误作退位；合并同源经历，保留晚期转折；百年存档减负，史实完整保留。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
