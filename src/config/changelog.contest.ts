import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.20',
  date: '2026-09-12',
  title: '军府再整，退路有继',
  items: [
    '陆军空缺时按实有人力钱粮恢复编队；撤退改向计入重发军令的等待与折返代价。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
