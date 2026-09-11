import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.15',
  date: '2026-09-11',
  title: '证据归本',
  items: [
    '史事卡片先打开所述事件，继承与伤亡等关联后果仍可追查。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
