import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.34',
  date: '2026-09-15',
  title: '入世存读与历史收口',
  items: [
    '修复入世后的存读档，厘清履约、战损与人生结局的证据。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
