import { describe, expect, it } from 'vitest';

import { advanceWorldBy, createWorld, serializeWorld } from '../index';
import type { CharacterState } from '../types';
import {
  ROOT_DESIRES,
  projectCharacterDesires,
} from './projection';

describe('人物欲望投影', () => {
  it('从五类可核对来源推导八项有界欲望，且不改动世界', () => {
    const world = createWorld('agency-desire-purity');
    const person = world.characters[17] as CharacterState;
    const serialized = serializeWorld(world);
    const hash = world.hash;

    const first = projectCharacterDesires(world, person.id);
    const repeated = projectCharacterDesires(world, person.id);

    expect(repeated).toEqual(first);
    expect(first.authority).toBe('projection');
    expect(first.axes).toHaveLength(ROOT_DESIRES.length);
    expect(new Set(first.axes.map((axis) => axis.kind))).toEqual(new Set(ROOT_DESIRES));
    expect(first.axes.filter((axis) => axis.core)).toHaveLength(2);
    expect(first.coreDesireKinds).toHaveLength(2);
    expect(first.pressures.length).toBeLessThanOrEqual(4);
    for (const axis of first.axes) {
      expect(axis.weight).toBeGreaterThanOrEqual(0);
      expect(axis.weight).toBeLessThanOrEqual(100);
      expect(axis.sources.map((source) => source.kind)).toEqual([
        'origin',
        'personality',
        'family',
        'experience',
        'seed',
      ]);
    }
    expect(world.hash).toBe(hash);
    expect(serializeWorld(world)).toBe(serialized);
  });

  it('不把纪年与传记文案当作人物欲望输入', () => {
    const world = createWorld('agency-prose-isolation');
    const person = world.characters[17] as CharacterState;
    const before = projectCharacterDesires(world, person.id);

    world.history = world.history.map((event) => ({
      ...event,
      title: `改写标题：${event.title}`,
      summary: `改写正文：${event.summary}`,
    }));
    person.biography = person.biography.map((entry) => ({
      ...entry,
      summary: `改写传记：${entry.summary}`,
    }));

    expect(projectCharacterDesires(world, person.id)).toEqual(before);
  });

  it('同一固定种子的季度结果产生相同欲望投影', () => {
    const first = advanceWorldBy(createWorld('agency-desire-quarter'), 12);
    const second = advanceWorldBy(createWorld('agency-desire-quarter'), 12);
    const personId = first.characters[17]?.id;
    if (!personId) throw new Error('测试世界缺少人物');

    expect(serializeWorld(second)).toBe(serializeWorld(first));
    expect(projectCharacterDesires(second, personId)).toEqual(projectCharacterDesires(first, personId));
  });
});
