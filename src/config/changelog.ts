export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.24',
  date: '2026-09-12',
  title: '国军战果，亲历有别',
  items: [
    '人物传区分任内国军战果与本人参战，保留全部史事依据。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
