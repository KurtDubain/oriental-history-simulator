import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.26',
  date: '2026-09-13',
  title: '落墨有声',
  items: [
    '新增可关闭的书页山水、章首印纹与短提示音；默认静音，启用后按需播放，不补播旧史。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
