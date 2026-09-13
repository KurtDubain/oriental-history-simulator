import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.30',
  date: '2026-09-13',
  title: '托管构建校验',
  items: [
    '区分托管配置转换与开发修改，保留两版发布和版本校验。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
