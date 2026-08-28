import { describe, expect, it } from 'vitest';
import { mergeEmbodiedQueueCandidate } from './embodied-military';

describe('embodied military queue boundary', () => {
  it('replaces an actor autonomous proposal without granting queue priority', () => {
    const autonomous = [
      { actorId: 'b', source: 'autonomous' },
      { actorId: 'a', source: 'autonomous' },
      { actorId: 'c', source: 'autonomous' },
    ];
    const player = { actorId: 'b', source: 'player' };
    const queue = mergeEmbodiedQueueCandidate(
      autonomous,
      player,
      2,
      (left, right) => left.actorId.localeCompare(right.actorId),
    );

    expect(queue.items).toEqual([
      { actorId: 'a', source: 'autonomous' },
      { actorId: 'b', source: 'player' },
    ]);
    expect(queue.playerAccepted).toBe(true);
  });

  it('reports normal capacity rejection instead of forcing a player action in', () => {
    const player = { actorId: 'z', claim: 1 };
    const queue = mergeEmbodiedQueueCandidate(
      [{ actorId: 'a', claim: 3 }, { actorId: 'b', claim: 2 }],
      player,
      2,
      (left, right) => right.claim - left.claim || left.actorId.localeCompare(right.actorId),
    );

    expect(queue.items.map((item) => item.actorId)).toEqual(['a', 'b']);
    expect(queue.playerAccepted).toBe(false);
  });
});
