import { describe, expect, it } from 'vitest';

import { advanceWorldBy, createWorld } from './index';
import {
  GIVEN_NAME_CANDIDATE_COUNT,
  GIVEN_NAMES,
  selectAvailableGivenName,
} from './names';
import { promoteBackgroundPerson } from './v02';

function duplicateNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

describe('deterministic character names', () => {
  it('keeps the established pool order, then exhausts every classical combination before repeating', () => {
    const familyName = '顾';
    const start = 7;
    const used = new Set<string>();
    const usedGivenNames = new Set<string>();

    expect(selectAvailableGivenName(familyName, start, used, usedGivenNames)).toBe(GIVEN_NAMES[start]);
    for (let index = 0; index < GIVEN_NAME_CANDIDATE_COUNT; index += 1) {
      const givenName = selectAvailableGivenName(familyName, start, used, usedGivenNames);
      const fullName = `${familyName}${givenName}`;
      expect(used.has(fullName)).toBe(false);
      expect(givenName).toMatch(/^\p{Script=Han}{2}$/u);
      expect(fullName).not.toMatch(/[0-9·]/u);
      used.add(fullName);
      usedGivenNames.add(givenName);
    }

    expect(used.size).toBe(GIVEN_NAME_CANDIDATE_COUNT);
    expect(used.has(`${familyName}${selectAvailableGivenName(familyName, start, used, usedGivenNames)}`)).toBe(true);
  });

  it('creates each new world with unique core full names', () => {
    for (const seed of ['名册甲', '名册乙', '名册丙', '名册丁']) {
      const world = createWorld(seed);
      const coreNames = world.characters
        .filter((character) => character.tier === '核心')
        .map((character) => character.name);
      expect(coreNames.length).toBeGreaterThan(0);
      expect(duplicateNames(coreNames)).toEqual([]);
      expect(duplicateNames(world.characters.map((character) => character.givenName))).toEqual([]);
    }
  });

  it('keeps promoted background people and later descendants unique in the same world', () => {
    const initial = createWorld('同局重名审计');
    const polity = initial.polities.find((candidate) => candidate.alive);
    expect(polity).toBeDefined();
    const promotedIds = new Set<string>();
    for (let index = 0; index < GIVEN_NAMES.length + 8; index += 1) {
      const promoted = promoteBackgroundPerson(initial, polity!, `name-audit-${index}`, '顾');
      expect(promoted).not.toBeNull();
      if (promoted) promotedIds.add(promoted.id);
    }
    expect(promotedIds.size).toBe(GIVEN_NAMES.length + 8);
    expect(duplicateNames(initial.characters.map((character) => character.name))).toEqual([]);
    expect(duplicateNames(initial.characters.map((character) => character.givenName))).toEqual([]);
    expect(initial.characters.every((character) => !/[0-9·]/u.test(character.name))).toBe(true);

    const later = advanceWorldBy(createWorld('后代名册审计'), 64);
    expect(later.characters.some((character) => character.birthTurn > 0)).toBe(true);
    expect(duplicateNames(later.characters.map((character) => character.name))).toEqual([]);
    expect(duplicateNames(later.characters.map((character) => character.givenName))).toEqual([]);
    expect(later.characters.every((character) => !/[0-9·]/u.test(character.name))).toBe(true);
  }, 30_000);
});
