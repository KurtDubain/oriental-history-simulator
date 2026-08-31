import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim';
import {
  MAP_PRIMER_STORAGE_KEY,
  restoreWorldSession,
  type WorldSessionStorageReader,
} from './world-session-restore';

class MemoryReader implements WorldSessionStorageReader {
  constructor(private readonly values = new Map<string, string>()) {}
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

describe('restoreWorldSession', () => {
  it('projects a new world into one normalized navigation state', () => {
    const world = createWorld('session-restore-new');
    const session = restoreWorldSession(world, 'create', new MemoryReader(), false);

    expect(session.seed).toBe(world.seed);
    expect(session.selection).toBeNull();
    expect(session.navigation).toEqual({
      view: 'world',
      powerRosterSection: 'polities',
      layers: [{ kind: 'primer' }],
    });
  });

  it('does not reopen completed first-run guidance', () => {
    const world = createWorld('session-restore-known');
    const session = restoreWorldSession(
      world,
      'create',
      new MemoryReader(new Map([[MAP_PRIMER_STORAGE_KEY, '1']])),
      true,
    );

    expect(session.navigation.layers).toEqual([]);
  });
});
