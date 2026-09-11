export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.12',
  date: '2026-09-11',
  title: '旧卷续写',
  items: [
    '精简可还原的存档副本，说明保存失败与上次保存点；校正经历日期和叙述顺序。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
