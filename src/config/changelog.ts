export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  items: readonly string[];
}

export const APP_RELEASES: readonly AppReleaseNote[] = [
  {
    version: '1.1.0',
    date: '2026-08-27',
    title: '人物开始主动争取军权',
    items: [
      '副将会先联络将校或向主帅、主君、家主请求背书，不再只等数值自然成熟。',
      '请令未准后，朝廷可能另作安抚，也可能撤下副将军权；结果会改变关系、权势与后续局势。',
      '人物所图、关系记忆和经历会写明谁向谁开口、对方如何回应，以及军职实际发生了什么。',
    ],
  },
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
