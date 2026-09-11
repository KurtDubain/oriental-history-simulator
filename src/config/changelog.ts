export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.13',
  date: '2026-09-11',
  title: '守望有据',
  items: [
    '驻防兼顾眼前威胁与友军覆盖；普通战败、负伤标作受挫，不误称失势。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
