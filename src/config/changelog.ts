export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.1',
  date: '2026-09-07',
  title: '舆图避让，翻卷不断焦点',
  items: [
    '人物簇会避让国号与首府；无事之季保持克制，手机筛选后焦点回到可见入口。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
