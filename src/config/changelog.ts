export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.19',
  date: '2026-09-12',
  title: '权势有继，行军有序',
  items: [
    '同领袖重组延续实际权势；交班不再混入早年战役，有效撤退令不因微小波动重发。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
