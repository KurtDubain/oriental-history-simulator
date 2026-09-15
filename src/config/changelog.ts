export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.37',
  date: '2026-09-15',
  title: '谱系与水师交接',
  items: [
    '修正近亲婚育、承统判定和水师交接。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
