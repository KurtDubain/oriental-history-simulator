import { describe, expect, it } from 'vitest';

import { computeWorldHash, createWorld, serializeWorld } from '../sim';
import { toCausalFact } from './history-causal-adapter';

describe('history causal Fact boundary', () => {
  it('opens an unarchived Fact as read-only evidence instead of disabling the story link', () => {
    const world = createWorld('事实因果入口');
    const fact = world.facts.find((item) => item.causes.length > 0) ?? world.facts[0]!;
    const before = serializeWorld(world);
    const hash = computeWorldHash(world);

    const causal = toCausalFact(world, fact);

    expect(causal.id).toBe(fact.id);
    expect(causal.title.length).toBeGreaterThan(0);
    expect(causal.factors.at(-1)?.role).toBe('outcome');
    expect(serializeWorld(world)).toBe(before);
    expect(computeWorldHash(world)).toBe(hash);
  });
});
