import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.36',
  date: '2026-09-15',
  title: '继承比较与军职资格',
  items: [
    '统一继承候选比较，补齐亡国君主的军职任用门槛。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
