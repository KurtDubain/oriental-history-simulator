import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.21',
  date: '2026-09-12',
  title: '援军循路，改令有序',
  items: [
    '增援目标变化时，已生效军令可继续共同的安全路段；真正改道仍按新令执行。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
