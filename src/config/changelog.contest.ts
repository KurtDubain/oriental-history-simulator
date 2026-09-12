import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.18',
  date: '2026-09-12',
  title: '舆图畅览',
  items: [
    '手机地区速览时，地图缩放控件不再被顶部统计条遮挡。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
