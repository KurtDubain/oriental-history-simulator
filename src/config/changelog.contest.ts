import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.6',
  date: '2026-09-09',
  title: '历史表达维护',
  items: [
    '逐场讲清同季战况，连缀人物事业，校正君主随军身份。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
