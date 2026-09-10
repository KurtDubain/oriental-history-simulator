export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.11',
  date: '2026-09-10',
  title: '同种同史',
  items: [
    '修正新世界重放与经历证据，保留攻守和挫折；战死风险小幅上调。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
