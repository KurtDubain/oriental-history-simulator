export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

/** Only the current in-app note ships; the durable release history lives in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.29.2',
  date: '2026-09-08',
  title: '经历归时，战局减字',
  items: [
    '负伤与结局各归其时，点开即见对应史实；手机战局标注互相避让，技术凭证默认收进详细依据。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
