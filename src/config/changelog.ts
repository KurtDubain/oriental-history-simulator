export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.33',
  date: '2026-09-14',
  title: '衡印图标',
  items: [
    '浏览器标签与手机收藏使用朱砂衡印，游戏与存档保持不变。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
