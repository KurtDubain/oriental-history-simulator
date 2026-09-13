import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.29',
  date: '2026-09-13',
  title: '发布校验收口',
  items: [
    '纯文档更新不再误拦截；生产更新继续核对完整变更范围和版本记录。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
