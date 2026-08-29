import type { MapOverlay } from './map-contract';

const LAYER_BOUND_SELECTIONS = Object.freeze({
  tradeCorridor: 'trade',
  migration: 'migration',
  outbreak: 'disease',
  practice: 'knowledge',
} satisfies Record<string, MapOverlay>);

/**
 * Layer-only objects cannot remain selected after their source layer is gone:
 * that would leave an open dossier without a visible map anchor or hit target.
 */
export function shouldCloseMapSelectionForOverlay(kind: string, overlay: MapOverlay) {
  const owningOverlay = LAYER_BOUND_SELECTIONS[
    kind as keyof typeof LAYER_BOUND_SELECTIONS
  ];
  return owningOverlay !== undefined && owningOverlay !== overlay;
}
