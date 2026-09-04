export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.25.0',
  date: '2026-09-04',
  title: '命途成章',
  items: [
    '人物会响应出征、负伤或战死，生平也会从真实史事中整理出起势与转折。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
