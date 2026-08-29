import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_PROFILE_ID, getMapProfile } from '../maps';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import { familyRoster, militaryRoster, polityRoster } from './adapters';
import { DEFAULT_MAP_CAMERA } from './map-scene-geometry';
import {
  deriveHistoryReadingLayer,
  makeTextSnapshot,
} from './game-text-snapshot';
import { createObserverInterfaceSettings } from './observer-interface-settings';
import type { SnapshotOptions } from './observer-shell-contract';
import { createAgencyShadowLedger } from './v1-agency-shadow';

function options(overrides: Partial<SnapshotOptions> = {}): SnapshotOptions {
  return {
    startOpen: false,
    selectedMapProfileId: DEFAULT_MAP_PROFILE_ID,
    running: false,
    speed: 1,
    view: 'world',
    powerRosterSection: 'polities',
    overlay: 'political',
    selection: null,
    selectedEventId: null,
    archiveOpen: false,
    mandateOpen: false,
    observerDeskOpen: false,
    settingsOpen: false,
    interfaceSettings: createObserverInterfaceSettings(),
    audioState: 'silent',
    fullscreen: false,
    historyWorkbenchOpen: false,
    situationWorkbenchOpen: false,
    selectedSituationId: null,
    observerLeadProjection: null,
    historicalTurn: null,
    watchedCount: 0,
    watchlist: [],
    guideCompleted: 0,
    pauseReason: null,
    pauseRule: null,
    pauseSituationId: null,
    pauseSituationTrigger: null,
    collectionOpen: false,
    worldSaveCount: 0,
    primerOpen: false,
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
      {
        selectedEventId: 'event-1',
        archiveOpen: true,
        situationWorkbenchOpen: true,
        historyWorkbenchOpen: true,
      },
    ],
    [
      'entity',
      {
        selectedEventId: null,
        archiveOpen: true,
        situationWorkbenchOpen: true,
        historyWorkbenchOpen: true,
      },
    ],
    [
      'situation',
      {
        selectedEventId: null,
        archiveOpen: false,
        situationWorkbenchOpen: true,
        historyWorkbenchOpen: true,
      },
    ],
    [
      'chronicle',
      {
        selectedEventId: null,
        archiveOpen: false,
        situationWorkbenchOpen: false,
        historyWorkbenchOpen: true,
      },
    ],
    [
      'quarter',
      {
        selectedEventId: null,
        archiveOpen: false,
        situationWorkbenchOpen: false,
        historyWorkbenchOpen: false,
      },
    ],
  ] as const)('derives the %s history-reading layer without adding observer state', (expected, inputs) => {
    const before = JSON.stringify(inputs);

    expect(deriveHistoryReadingLayer(inputs)).toBe(expected);
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it('publishes the active history-reading layer without mutating the world', () => {
    const world = createWorld('TRIM01-四层阅读', DEFAULT_MAP_PROFILE_ID);
    const before = serializeWorld(world);
    const snapshot = JSON.parse(makeTextSnapshot(world, options({
      archiveOpen: true,
      situationWorkbenchOpen: true,
      historyWorkbenchOpen: true,
    }))) as {
      interface: { historyReadingLayer: string };
    };

    expect(snapshot.interface.historyReadingLayer).toBe('entity');
    expect(serializeWorld(world)).toBe(before);
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
      view: 'powers',
      powerRosterSection,
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

  it('projects the start page from observer options without requiring a world', () => {
    const snapshot = JSON.parse(makeTextSnapshot(null, options({ startOpen: true }))) as {
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
    const behindRoster = JSON.parse(makeTextSnapshot(world, options({ view: 'powers' }))) as typeof visible;
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
});
