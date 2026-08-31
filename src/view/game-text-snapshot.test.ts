import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_PROFILE_ID, getMapProfile } from '../maps';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import { compactWorldArchive } from '../sim/archive';
import { familyRoster, militaryRoster, polityRoster, projectRosterCollection } from './adapters';
import { DEFAULT_MAP_CAMERA } from './map-scene-geometry';
import {
  deriveHistoryReadingLayer,
  makeTextSnapshot,
} from './game-text-snapshot';
import { createObserverInterfaceSettings } from './observer-interface-settings';
import { createObserverNavigationState } from './observer-navigation';
import type { SnapshotOptions } from './observer-shell-contract';
import { createRosterDiscoveryStates, createRosterVisibleCounts, ROSTER_PAGE_SIZE } from './roster-discovery';
import { createAgencyShadowLedger } from './v1-agency-shadow';

function options(overrides: Partial<SnapshotOptions> = {}): SnapshotOptions {
  return {
    navigation: createObserverNavigationState({ layers: [] }),
    selectedMapProfileId: DEFAULT_MAP_PROFILE_ID,
    running: false,
    speed: 1,
    rosterDiscovery: createRosterDiscoveryStates(),
    rosterVisibleCounts: createRosterVisibleCounts(),
    overlay: 'political',
    selection: null,
    interfaceSettings: createObserverInterfaceSettings(),
    audioState: 'silent',
    fullscreen: false,
    observerLeadProjection: null,
    historicalTurn: null,
    watchedCount: 0,
    watchlist: [],
    guideCompleted: 0,
    pauseReason: null,
    pauseRule: null,
    pauseSituationId: null,
    pauseSituationTrigger: null,
    worldSaveCount: 0,
    primerStep: 'terrain',
    mapCamera: { ...DEFAULT_MAP_CAMERA },
    mapLod: 'overview',
    mobileInspectorExpanded: false,
    mapGestureActive: false,
    agencyShadowLedger: createAgencyShadowLedger(),
    agencyShadowBranchId: null,
    embodiedCharacterId: null,
    pendingEmbodiedAction: null,
    embodimentClosure: null,
    ...overrides,
  };
}

describe('render_game_to_text projection boundary', () => {
  it.each([
    [
      'evidence',
      createObserverNavigationState({ layers: [{ kind: 'event', eventId: 'event-1' }] }),
    ],
    [
      'entity',
      createObserverNavigationState({
        layers: [{ kind: 'archive', subject: { kind: 'person', id: 'person-1' } }],
      }),
    ],
    [
      'situation',
      createObserverNavigationState({
        layers: [{ kind: 'situations', situationId: 'situation-1' }],
      }),
    ],
    [
      'chronicle',
      createObserverNavigationState({ view: 'chronicle', layers: [] }),
    ],
    [
      'quarter',
      createObserverNavigationState({ layers: [] }),
    ],
  ] as const)('derives the %s history-reading layer without adding observer state', (expected, navigation) => {
    const before = JSON.stringify(navigation);

    expect(deriveHistoryReadingLayer(navigation)).toBe(expected);
    expect(JSON.stringify(navigation)).toBe(before);
  });

  it('publishes the active history-reading layer without mutating the world', () => {
    const world = createWorld('TRIM01-四层阅读', DEFAULT_MAP_PROFILE_ID);
    const before = serializeWorld(world);
    const snapshot = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({
        layers: [{ kind: 'archive', subject: { kind: 'person', id: world.characters[0].id } }],
      }),
    }))) as {
      interface: { historyReadingLayer: string };
    };

    expect(snapshot.interface.historyReadingLayer).toBe('entity');
    expect(serializeWorld(world)).toBe(before);
  });

  it('publishes the bounded return journey behind an evidence page', () => {
    const world = createWorld('TRIM01-因果返回链', DEFAULT_MAP_PROFILE_ID);
    const personId = world.characters[0].id;
    const eventId = world.history[0].id;
    const archiveSnapshot = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({
        layers: [
          { kind: 'archive', subject: { kind: 'person', id: personId } },
          { kind: 'event', eventId },
        ],
      }),
    }))) as { interface: { navigationJourney: object[] } };
    const situationSnapshot = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({
        layers: [
          { kind: 'situations', situationId: 'situation-1' },
          { kind: 'event', eventId },
        ],
      }),
    }))) as { interface: { navigationJourney: object[] } };

    expect(archiveSnapshot.interface.navigationJourney).toEqual([
      { kind: 'archive', subject: { kind: 'person', id: personId } },
      { kind: 'event', eventId },
    ]);
    expect(situationSnapshot.interface.navigationJourney).toEqual([
      { kind: 'situations', situationId: 'situation-1' },
      { kind: 'event', eventId },
    ]);
  });

  it.each([
    ['polities', polityRoster],
    ['families', familyRoster],
    ['military', militaryRoster],
  ] as const)('projects the powers/%s roster without touching the world', (powerRosterSection, projectRoster) => {
    const world = createWorld(`架构-势力名录-${powerRosterSection}`, DEFAULT_MAP_PROFILE_ID);
    const before = serializeWorld(world);
    const expected = projectRoster(world);
    const snapshot = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({
        view: 'powers',
        powerRosterSection,
        layers: [],
      }),
    }))) as {
      deterministicWorldHash: string;
      interface: {
        view: string;
        powerRosterSection: string;
        rosterTotal: number;
        visibleRoster: Array<{ id: string }>;
      };
    };

    expect(snapshot.interface).toMatchObject({
      view: 'powers',
      powerRosterSection,
      rosterTotal: expected.length,
    });
    expect(snapshot.interface.visibleRoster[0]?.id).toBe(expected[0]?.id);
    expect(snapshot.deterministicWorldHash).toBe(world.hash);
    expect(serializeWorld(world)).toBe(before);
  });

  it('publishes the exact observer-only roster query, filters and ordering shown on screen', () => {
    const world = createWorld('架构-人物名簿条件', DEFAULT_MAP_PROFILE_ID);
    const before = serializeWorld(world);
    const baseStates = createRosterDiscoveryStates();
    const target = projectRosterCollection(world, 'people').items[0];
    const state = {
      ...baseStates.people,
      query: target.title,
      filters: {
        polity: target.discovery?.filters.polity ?? 'all',
        identity: target.discovery?.filters.identity ?? 'all',
      },
      sort: 'influence',
    };
    const expected = projectRosterCollection(world, 'people', state);
    const snapshot = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({ view: 'people', layers: [] }),
      rosterDiscovery: { ...baseStates, people: state },
    }))) as {
      deterministicWorldHash: string;
      interface: {
        visibleRoster: Array<{ id: string }>;
        rosterTotal: number;
        rosterMatched: number;
        rosterDiscovery: {
          scope: string;
          query: string;
          filters: Record<string, string>;
          sort: string;
          conditionSummary: string;
        };
      };
    };

    expect(snapshot.interface.visibleRoster.map((item) => item.id)).toEqual(
      expected.items.slice(0, ROSTER_PAGE_SIZE).map((item) => item.id),
    );
    expect(snapshot.interface).toMatchObject({
      rosterTotal: expected.totalCount,
      rosterMatched: expected.matchedCount,
      rosterDiscovery: {
        scope: 'people',
        query: target.title,
        filters: state.filters,
        sort: 'influence',
        conditionSummary: expected.conditionSummary,
      },
    });
    expect(snapshot.deterministicWorldHash).toBe(world.hash);
    expect(serializeWorld(world)).toBe(before);
  });

  it('projects the start page from observer options without requiring a world', () => {
    const snapshot = JSON.parse(makeTextSnapshot(null, options({
      navigation: createObserverNavigationState(),
    }))) as {
      mode: string;
      mapProfile: { id: string; revision: number };
      settings: { soundEnabled: boolean; audioState: string };
    };

    expect(snapshot.mode).toBe('start');
    expect(snapshot.mapProfile).toMatchObject({
      id: DEFAULT_MAP_PROFILE_ID,
      revision: getMapProfile(DEFAULT_MAP_PROFILE_ID).revision,
    });
    expect(snapshot.settings).toMatchObject({ soundEnabled: false, audioState: 'silent' });
  });

  it('reports only the visible collection layer while the start page waits underneath', () => {
    const navigation = createObserverNavigationState({
      layers: [{ kind: 'start' }, { kind: 'collection' }],
    });
    const startSnapshot = JSON.parse(makeTextSnapshot(null, options({ navigation }))) as {
      seedInputVisible: boolean;
      collectionOpen: boolean;
      navigationJourney: object[];
    };
    const world = createWorld('架构-收藏返回链', DEFAULT_MAP_PROFILE_ID);
    const worldSnapshot = JSON.parse(makeTextSnapshot(world, options({ navigation }))) as {
      mode: string;
      worldCreation: object | null;
      observer: { collectionOpen: boolean };
    };

    expect(startSnapshot).toMatchObject({
      seedInputVisible: false,
      collectionOpen: true,
      navigationJourney: [{ kind: 'start' }, { kind: 'collection' }],
    });
    expect(worldSnapshot).toMatchObject({
      mode: 'observing',
      worldCreation: null,
      observer: { collectionOpen: true },
    });
  });

  it('projects a selected object without mutating or re-hashing the authoritative world', () => {
    const world = createWorld('架构-全文快照', DEFAULT_MAP_PROFILE_ID);
    const before = serializeWorld(world);
    const selectedRegion = world.regions[0];
    const snapshot = JSON.parse(makeTextSnapshot(world, options({
      selection: { kind: 'region', id: selectedRegion.id },
    }))) as {
      deterministicWorldHash: string;
      interface: {
        selected: { kind: string; id: string; label: string };
        selectedDetail: { kind: string; id: string; name: string };
      };
      totals: { regions: number; seaZones: number };
    };

    expect(snapshot.deterministicWorldHash).toBe(world.hash);
    expect(snapshot.interface.selected).toEqual({
      kind: 'region',
      id: selectedRegion.id,
      label: selectedRegion.name,
    });
    expect(snapshot.interface.selectedDetail).toMatchObject({
      kind: 'region',
      id: selectedRegion.id,
      name: selectedRegion.name,
    });
    expect(snapshot.totals).toMatchObject({
      regions: world.regions.length,
      seaZones: world.seaZones.length,
    });
    expect(serializeWorld(world)).toBe(before);
  });

  it('keeps the sound invitation aligned with the unobstructed world surface', () => {
    const world = advanceWorld(createWorld('架构-声音邀请', DEFAULT_MAP_PROFILE_ID));
    const visible = JSON.parse(makeTextSnapshot(world, options())) as {
      interface: { settings: { soundPromptVisible: boolean } };
    };
    const behindRoster = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({ view: 'powers', layers: [] }),
    }))) as typeof visible;
    const behindInspector = JSON.parse(makeTextSnapshot(world, options({
      selection: { kind: 'region', id: world.regions[0].id },
    }))) as typeof visible;
    const behindHistoricalMap = JSON.parse(makeTextSnapshot(world, options({
      historicalTurn: 0,
    }))) as typeof visible;

    expect(visible.interface.settings.soundPromptVisible).toBe(true);
    expect(behindRoster.interface.settings.soundPromptVisible).toBe(false);
    expect(behindInspector.interface.settings.soundPromptVisible).toBe(false);
    expect(behindHistoricalMap.interface.settings.soundPromptVisible).toBe(false);
  });

  it('publishes the same bounded quarterly story projection without changing the world', () => {
    const world = advanceWorld(createWorld('TRIM01-全文季报', DEFAULT_MAP_PROFILE_ID));
    const before = serializeWorld(world);
    const snapshot = JSON.parse(makeTextSnapshot(world, options())) as {
      interface: {
        quarterPulse: {
          turn: number;
          storyCount: number;
          stories: Array<{ id: string; kind: string; title: string }>;
          highlightedRegionIds: string[];
        };
      };
    };

    expect(snapshot.interface.quarterPulse.turn).toBe(world.lastTurn?.turn);
    expect(snapshot.interface.quarterPulse.storyCount).toBe(snapshot.interface.quarterPulse.stories.length);
    expect(snapshot.interface.quarterPulse.storyCount).toBeLessThanOrEqual(3);
    expect(new Set(snapshot.interface.quarterPulse.stories.map((story) => story.id)).size)
      .toBe(snapshot.interface.quarterPulse.storyCount);
    expect(serializeWorld(world)).toBe(before);
  });

  it('resolves a selected cold event without copying cold history into the text snapshot', () => {
    const world = createWorld('TRIM01-冷卷文本');
    const coldEvent = {
      ...world.history[0],
      id: 'event_z_cold_selected',
      turn: 2,
      year: 1,
      season: '秋' as const,
      category: '政治' as const,
      kind: 'cold_selected_event',
      title: '旧年朝议封存',
      summary: '这条记录已经进入冷卷。',
    };
    world.history.push(coldEvent);
    world.turn = 80;
    world.year = 21;
    world.season = '春';
    compactWorldArchive(world);
    expect(world.history.some((event) => event.id === coldEvent.id)).toBe(false);

    const snapshot = JSON.parse(makeTextSnapshot(world, options({
      navigation: createObserverNavigationState({
        layers: [{ kind: 'event', eventId: coldEvent.id }],
      }),
    }))) as {
      archive: {
        coldThroughTurn: number | null;
        blockCount: number;
        activeFactCount: number;
        activeEventCount: number;
      };
      interface: { selectedEvent: { id: string; title: string } | null };
      recentHistory: Array<{ id: string }>;
    };

    expect(snapshot.interface.selectedEvent).toMatchObject({ id: coldEvent.id, title: coldEvent.title });
    expect(snapshot.archive).toMatchObject({
      coldThroughTurn: 15,
      blockCount: 1,
      activeFactCount: world.facts.length,
      activeEventCount: world.history.length,
    });
    expect(snapshot.recentHistory.some((event) => event.id === coldEvent.id)).toBe(false);
    expect(JSON.stringify(snapshot).match(/这条记录已经进入冷卷。/gu)).toHaveLength(1);
  });
});
