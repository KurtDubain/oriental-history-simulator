export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.7',
  date: '2026-09-09',
  title: '人物事业与战后余波',
  items: [
    '连缀起兵、拓土与结局，区分亲历和任内国事；守军回应前线，高龄恢复渐缓。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
