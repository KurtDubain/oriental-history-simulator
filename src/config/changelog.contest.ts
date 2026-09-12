import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.22',
  date: '2026-09-12',
  title: '困军循路，有粮方休',
  items: [
    '低战备部队可沿安全粮路撤离休整，停战不再无条件中断撤离；进攻仍须具备战备。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
