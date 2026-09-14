import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.31',
  date: '2026-09-14',
  title: '史事与故人发现',
  items: [
    '区分亡国终战与议和，让有真实前史的人物结局更易被发现。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
