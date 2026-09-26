import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.47',
  date: '2026-09-26',
  title: '舰队与存档',
  items: [
    '修复末船损失后的撤编，阻止非法舰队覆盖自动存档。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
