export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.21',
  date: '2026-09-12',
  title: '援军循路，改令有序',
  items: [
    '增援目标变化时，已生效军令可继续共同的安全路段；真正改道仍按新令执行。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
