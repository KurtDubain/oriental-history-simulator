import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.3',
  date: '2026-09-08',
  title: '人物纪年与关注回执',
  items: [
    '首次参战查全史，重复盟约只记一次；关注变化停表可直达案卷，手机地图按层减字。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
