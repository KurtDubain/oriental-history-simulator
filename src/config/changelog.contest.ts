import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.43',
  date: '2026-09-25',
  title: '战阵得失',
  items: [
    '补齐登陆守军战损，提高惨败致命风险，点明战役死者与依据。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
