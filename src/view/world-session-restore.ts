import { getMapProfileForContentVersion, type MapProfileId } from '../maps';
import type { WorldState } from '../sim';
import {
  createEmbodimentObserverState,
  embodimentObserverStorageKey,
  restoreEmbodimentObserverState,
  type EmbodimentObserverState,
} from './embodiment-observer';
import type { ObserverNavigationState } from './observer-navigation';
import type { Selection } from './observer-shell-contract';
import {
  OBSERVER_DESK_STORAGE_KEY,
  completeObserverGuideStep,
  createObserverDeskSettings,
  parseObserverDeskSettings,
  type ObserverDeskSettings,
} from './v1-observer';

export type OpenWorldSource = 'create' | 'continue' | 'import' | 'collection';

export const MAP_PRIMER_STORAGE_KEY = 'canghai-map-primer-complete-v1';

export interface WorldSessionStorageReader {
  getItem(key: string): string | null;
}

export interface RestoredWorldSession {
  observerSettings: ObserverDeskSettings;
  embodiment: EmbodimentObserverState;
  seed: string;
  mapProfileId: MapProfileId;
  selection: Selection;
  navigation: ObserverNavigationState;
}

export function observerStorageKey(seed: string, mapContentVersion?: string): string {
  const worldKey = mapContentVersion
    ? `${encodeURIComponent(mapContentVersion)}:${encodeURIComponent(seed)}`
    : encodeURIComponent(seed);
  return `${OBSERVER_DESK_STORAGE_KEY}:${worldKey}`;
}

function supportsLegacyObserverStorage(mapContentVersion: string): boolean {
  return getMapProfileForContentVersion(mapContentVersion)
    .compatibility.legacyPartialRegionVersions.length > 0;
}

function readObserverSettings(
  world: WorldState,
  storage: WorldSessionStorageReader,
): ObserverDeskSettings {
  try {
    const current = storage.getItem(observerStorageKey(world.seed, world.mapContentVersion));
    const legacy = supportsLegacyObserverStorage(world.mapContentVersion)
      ? storage.getItem(observerStorageKey(world.seed))
      : null;
    return completeObserverGuideStep(parseObserverDeskSettings(current ?? legacy), 'world-opened');
  } catch {
    return completeObserverGuideStep(createObserverDeskSettings(), 'world-opened');
  }
}

function readEmbodiment(
  world: WorldState,
  source: OpenWorldSource,
  storage: WorldSessionStorageReader,
): EmbodimentObserverState {
  if (source !== 'continue' && source !== 'collection') {
    return createEmbodimentObserverState(world);
  }
  try {
    const current = storage.getItem(embodimentObserverStorageKey(world.seed, world.mapContentVersion));
    const legacy = supportsLegacyObserverStorage(world.mapContentVersion)
      ? storage.getItem(embodimentObserverStorageKey(world.seed))
      : null;
    return restoreEmbodimentObserverState(world, current ?? legacy);
  } catch {
    return createEmbodimentObserverState(world);
  }
}

export function restoreWorldSession(
  world: WorldState,
  source: OpenWorldSource,
  storage: WorldSessionStorageReader,
  compactViewport: boolean,
): RestoredWorldSession {
  const observerSettings = readObserverSettings(world, storage);
  const embodiment = readEmbodiment(world, source, storage);
  const defaultRegionId = world.regions.find((region) => (
    world.polities.some((polity) => polity.alive && polity.capitalRegionId === region.id)
  ))?.id ?? world.regions[0]?.id;
  const restoredPersonId = embodiment.activeActor?.id
    ?? (embodiment.closure && world.characters.some((item) => item.id === embodiment.closure?.actorId)
      ? embodiment.closure.actorId
      : null);
  let primerCompleted = false;
  try {
    primerCompleted = storage.getItem(MAP_PRIMER_STORAGE_KEY) === '1';
  } catch {
    // Preference storage is optional; first-run guidance remains the safe default.
  }
  const showPrimer = source === 'create' && world.turn === 0 && !primerCompleted;
  const view = restoredPersonId ? 'people' as const : 'world' as const;
  return {
    observerSettings,
    embodiment,
    seed: world.seed,
    mapProfileId: getMapProfileForContentVersion(world.mapContentVersion).id,
    selection: restoredPersonId
      ? { kind: 'person', id: restoredPersonId }
      : source !== 'create' && !compactViewport && defaultRegionId
        ? { kind: 'region', id: defaultRegionId }
        : null,
    navigation: {
      view,
      powerRosterSection: 'polities',
      layers: showPrimer ? [{ kind: 'primer' }] : [],
    },
  };
}
