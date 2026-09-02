import type {
  MapMarkerTargetKind,
  MapMarkerView,
  MapPoint,
  MapSelectedObject,
  MapViewportTransform,
} from './map-contract';

export interface MapMarkerLayout {
  marker: MapMarkerView;
  point: MapPoint;
  radius: number;
}

const ROOT_OFFSETS: readonly MapPoint[] = [
  { x: 15, y: 13 },
  { x: -15, y: 13 },
  { x: 20, y: -7 },
  { x: -21, y: -6 },
  { x: 1, y: 20 },
  { x: 4, y: -23 },
];

export function mapMarkerTarget(marker: MapMarkerView): { kind: MapMarkerTargetKind; id: string } {
  return {
    kind: marker.targetKind
      ?? (marker.kind === 'capitalPulse' ? 'country' : 'region'),
    id: marker.targetId ?? marker.id,
  };
}

export function mapMarkerMatchesSelection(
  marker: MapMarkerView,
  selectedObject: MapSelectedObject,
): boolean {
  const target = mapMarkerTarget(marker);
  return target.kind === selectedObject?.kind && target.id === selectedObject.id;
}

/** Shared screen-space marker positions keep drawing, focus and coarse hit tests aligned. */
export function layoutMapMarkers(
  markers: readonly MapMarkerView[],
  transform: MapViewportTransform,
): MapMarkerLayout[] {
  const compact = transform.scale < 0.42;
  const rootSlots = new Map<string, number>();
  return markers.map((marker) => {
    const base = {
      x: transform.offsetX + marker.position.x * transform.scale,
      y: transform.offsetY + marker.position.y * transform.scale * transform.yScale,
    };
    if (marker.kind === 'capitalPulse') {
      return {
        marker,
        point: { x: base.x - (compact ? 13 : 20), y: base.y - (compact ? 12 : 18) },
        radius: compact ? 5.5 : 7,
      };
    }
    if (marker.kind === 'powerRoot') {
      const key = `${marker.position.x.toFixed(3)}:${marker.position.y.toFixed(3)}`;
      const slot = rootSlots.get(key) ?? 0;
      rootSlots.set(key, slot + 1);
      const ring = Math.floor(slot / ROOT_OFFSETS.length) + 1;
      const offset = ROOT_OFFSETS[slot % ROOT_OFFSETS.length];
      const scale = (compact ? 0.72 : 1) * ring;
      return {
        marker,
        point: { x: base.x + offset.x * scale, y: base.y + offset.y * scale },
        radius: compact ? 4.8 : 6,
      };
    }
    return { marker, point: base, radius: compact ? 4.8 : 6 };
  });
}
