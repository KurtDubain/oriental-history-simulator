import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.28.0',
  date: '2026-09-06',
  title: '让世界先自己走',
  items: [
    '新世界直达舆图并连续演变，只有关注的变化才自动停表。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
