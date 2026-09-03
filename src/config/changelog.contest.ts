import type { AppReleaseNote } from './changelog';

/** Public builds ship only the current note; older notes remain in progress.md. */
export const LATEST_APP_RELEASE: AppReleaseNote = {
  version: '1.24.0',
  date: '2026-09-04',
  title: '人物成军，部曲归身',
  items: [
    '每位成年军政人物现在拥有唯一、真实且守恒的个人军势；行营只是多人出征时的临时编队。',
    '舆图按缩放展示人物簇或具名人物点，可直接看见谁带多少部曲、跟随谁、正在往哪里走。',
    '战损按战前投入比例回到具体人物，战报封存当时兵力、伤亡、集团与主将关系；旧存档可确定性升级到 schema 5。',
  ],
};

export const APP_RELEASES: readonly AppReleaseNote[] = [LATEST_APP_RELEASE];
