import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld } from '../sim';
import {
  observerStorageKey,
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
    expect(session.focusedPoliticalFactionId).toBeNull();
    expect(session.navigation).toEqual({
      view: 'world',
      powerRosterSection: 'polities',
      layers: [],
    });
  });

  it('starts a recreated world with fresh observer defaults instead of stale broad pause rules', () => {
    const world = createWorld('session-restore-known');
    const stale = JSON.stringify({
      version: 3,
      watchlist: [{ kind: 'person', id: 'c_old', label: '旧关注', detail: '', alert: false }],
      pauseRules: {
        enabled: true,
        majorHistory: true,
        importanceThreshold: 2,
        wars: true,
        powerTransfers: true,
        outbreaks: true,
        watchlistHits: true,
        situationChanges: true,
      },
      guide: { completedSteps: ['world-opened'], dismissed: false },
    });
    const session = restoreWorldSession(
      world,
      'create',
      new MemoryReader(new Map([[observerStorageKey(world.seed, world.mapContentVersion), stale]])),
      true,
    );

    expect(session.navigation.layers).toEqual([]);
    expect(session.observerSettings.watchlist).toEqual([]);
    expect(session.observerSettings.pauseRules).toMatchObject({
      majorHistory: false,
      wars: false,
      powerTransfers: false,
      outbreaks: false,
    });
  });

  it('never carries a faction map focus across worlds with reused faction ids', () => {
    const first = createWorld('session-restore-faction-a', 'private-v03');
    const second = createWorld('session-restore-faction-b', 'contest-v01');
    expect(first.factions[0]?.id).toBe(second.factions[0]?.id);

    expect(restoreWorldSession(first, 'continue', new MemoryReader(), false).focusedPoliticalFactionId).toBeNull();
    expect(restoreWorldSession(second, 'collection', new MemoryReader(), false).focusedPoliticalFactionId).toBeNull();
  });

  it('retains the frozen 春战副将 T12 simulation identity across observer-only changes', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 12);

    expect({
      turn: world.turn,
      hash: world.hash,
      factDigest: world.factDigest,
      historyDigest: world.historyDigest,
      factCount: world.facts.length,
      historyCount: world.history.length,
    }).toEqual({
      turn: 12,
      hash: '84da697597babbaa',
      factDigest: 'ae99f4dc1f97805e',
      historyDigest: '24072eb10b66e793',
      factCount: 329,
      historyCount: 269,
    });
  });
});
