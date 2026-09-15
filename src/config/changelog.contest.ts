import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.35',
  date: '2026-09-15',
  title: '灭国经历与履约校验',
  items: [
    '校正参战灭国经历，收紧同季履约与死亡的记忆校验。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
