export const FAMILY_NAMES = [
  '赵', '陆', '沈', '顾', '萧', '裴', '崔', '卢', '谢', '韩', '苏', '卫',
  '慕容', '拓跋', '独孤', '宇文', '高', '李', '王', '陈', '林', '郑', '宋', '许',
] as const;

export const GIVEN_NAMES = [
  '玄度', '景明', '怀瑾', '云昭', '承岳', '靖川', '文澜', '知微', '望舒', '令仪',
  '长宁', '青衡', '昭远', '伯言', '子敬', '元直', '含章', '静姝', '清和', '明夷',
  '若衡', '季安', '仲谋', '修远', '元礼', '延昭', '思齐', '怀朔', '云岫', '星河',
  '知白', '庭芳', '照野', '砚秋', '临渊', '守一', '如晦', '安仁', '行简', '令月',
] as const;

// 原名池依旧先轮转；全局出现过的“名”会让位给辈字+名字组合，
// 候选全部用尽后才允许跨姓复用，同姓候选用尽前仍不会重名。
const COMPOSED_GIVEN_NAME_HEADS = '德维嘉允弘崇敬彦绍叔孟启载端';
const COMPOSED_GIVEN_NAME_TAILS = '之甫谦恭慎成达晟穆宽亮钧珩璋翰策勉贞义信廉济哲宣宁远明安和直仁礼修清';

export const GIVEN_NAME_CANDIDATE_COUNT = GIVEN_NAMES.length
  + COMPOSED_GIVEN_NAME_HEADS.length * COMPOSED_GIVEN_NAME_TAILS.length;

export function selectAvailableGivenName(
  familyName: string,
  start: number,
  usedFullNames: ReadonlySet<string>,
  usedGivenNames: ReadonlySet<string>,
  preferredGivenName?: string,
): string {
  const baseStart = ((start % GIVEN_NAMES.length) + GIVEN_NAMES.length) % GIVEN_NAMES.length;
  const composedCount = COMPOSED_GIVEN_NAME_HEADS.length * COMPOSED_GIVEN_NAME_TAILS.length;
  const composedStart = ((start % composedCount) + composedCount) % composedCount;
  for (const requireUnusedGivenName of [true, false]) {
    const available = (candidate: string): boolean => (
      !usedFullNames.has(`${familyName}${candidate}`)
      && (!requireUnusedGivenName || !usedGivenNames.has(candidate))
    );
    if (preferredGivenName && available(preferredGivenName)) return preferredGivenName;
    for (let offset = 0; offset < GIVEN_NAMES.length; offset += 1) {
      const candidate = GIVEN_NAMES[(baseStart + offset) % GIVEN_NAMES.length] as string;
      if (available(candidate)) return candidate;
    }
    for (let offset = 0; offset < composedCount; offset += 1) {
      const index = (composedStart + offset) % composedCount;
      const head = COMPOSED_GIVEN_NAME_HEADS[Math.floor(index / COMPOSED_GIVEN_NAME_TAILS.length)] as string;
      const tail = COMPOSED_GIVEN_NAME_TAILS[index % COMPOSED_GIVEN_NAME_TAILS.length] as string;
      const candidate = `${head}${tail}`;
      if (available(candidate)) return candidate;
    }
  }
  // 同姓候选全部占用后才允许真正重名，不再使用“·序号”破坏姓名。
  return preferredGivenName ?? (GIVEN_NAMES[baseStart] as string);
}
