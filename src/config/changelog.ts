export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.18',
  date: '2026-09-12',
  title: '舆图畅览',
  items: [
    '手机地区速览时，地图缩放控件不再被顶部统计条遮挡。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
