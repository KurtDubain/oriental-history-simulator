import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_PROFILE_ID, getMapProfile } from '../maps';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import { DEFAULT_MAP_CAMERA } from './map-scene-geometry';
import { makeTextSnapshot } from './game-text-snapshot';
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
