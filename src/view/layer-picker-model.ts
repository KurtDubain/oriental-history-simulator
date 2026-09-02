import type { MapOverlay } from './map-contract';

export const LAYER_PICKER_IDS = [
  'political',
  'war',
  'food',
  'none',
] as const satisfies readonly MapOverlay[];

export type LayerPickerId = (typeof LAYER_PICKER_IDS)[number];

export interface LayerPickerEntry {
  id: LayerPickerId;
}

export interface LayerPickerProjection {
  activeId: LayerPickerId;
  entries: readonly LayerPickerEntry[];
}

export function canonicalLayerPickerId(value: MapOverlay): LayerPickerId {
  return value;
}

/** A deterministic, observer-only projection; it never reads or writes world state. */
export function projectLayerPicker(value: MapOverlay): LayerPickerProjection {
  const activeId = canonicalLayerPickerId(value);
  const entries = LAYER_PICKER_IDS.map<LayerPickerEntry>((id) => ({ id }));
  return {
    activeId,
    entries,
  };
}
