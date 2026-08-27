export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

export const APP_RELEASES: readonly AppReleaseNote[] = [
  {
    version: '1.0.1',
    date: '2026-08-27',
    title: '版本与更新闭环',
    items: [
      '观察台内可以查看当前版本并手动检查更新。',
      '新部署会同时核对版本号与构建标识，减少缓存造成的版本误判。',
      '更新重载前先暂停推演并保存当前世界。',
    ],
  },
] as const;

export const LATEST_APP_RELEASE = APP_RELEASES[0];
