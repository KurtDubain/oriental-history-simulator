import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.24',
  date: '2026-09-12',
  title: '国军战果，亲历有别',
  items: [
    '人物传区分任内国军战果与本人参战，保留全部史事依据。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
