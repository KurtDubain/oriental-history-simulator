import type { MapOverlay } from './map-contract';

export const PRIMARY_LAYER_IDS = [
  'political',
  'war',
  'food',
  'none',
] as const satisfies readonly MapOverlay[];

export const SECONDARY_LAYER_IDS = [
  'population',
  'trade',
  'migration',
  'naval',
  'disease',
  'knowledge',
] as const satisfies readonly MapOverlay[];

export const LAYER_PICKER_IDS = [
  ...PRIMARY_LAYER_IDS,
  ...SECONDARY_LAYER_IDS,
] as const;

export type LayerPickerId = (typeof LAYER_PICKER_IDS)[number];
export type LayerPickerTier = 'primary' | 'current' | 'more';

export interface LayerPickerEntry {
  id: LayerPickerId;
  tier: LayerPickerTier;
}

export interface LayerPickerProjection {
  activeId: LayerPickerId;
  entries: readonly LayerPickerEntry[];
  currentEntry: LayerPickerEntry | null;
  moreEntries: readonly LayerPickerEntry[];
}

const PRIMARY_IDS = new Set<MapOverlay>(PRIMARY_LAYER_IDS);

export function canonicalLayerPickerId(value: MapOverlay): LayerPickerId {
  return value;
}

/** A deterministic, observer-only projection; it never reads or writes world state. */
export function projectLayerPicker(value: MapOverlay): LayerPickerProjection {
  const activeId = canonicalLayerPickerId(value);
  const entries = LAYER_PICKER_IDS.map<LayerPickerEntry>((id) => ({
    id,
    tier: PRIMARY_IDS.has(id) ? 'primary' : id === activeId ? 'current' : 'more',
  }));
  return {
    activeId,
    entries,
    currentEntry: entries.find((entry) => entry.tier === 'current') ?? null,
    moreEntries: entries.filter((entry) => entry.tier === 'more'),
  };
}
