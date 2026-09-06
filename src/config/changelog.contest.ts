import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.27.1',
  date: '2026-09-06',
  title: '战局一目了然',
  items: [
    '眼下大事改讲人物正在做什么，战局只在点开编队后展开部曲。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
