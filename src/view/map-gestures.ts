import type { MapCamera, MapPoint } from './map-contract';
import {
  MAP_MIN_ZOOM,
  panMapCamera,
  zoomMapCameraAtPoint,
} from './map-scene-geometry';

export interface MapPointerContact {
  pointerType: string;
  current: MapPoint;
}

export interface MapPinchSnapshot {
  camera: MapCamera;
  distance: number;
  midpoint: MapPoint;
}

export interface MapGestureState {
  pointerType: string;
  startPoint: MapPoint;
  lastPoint: MapPoint;
  moved: boolean;
  hadMultiple: boolean;
  pinch?: MapPinchSnapshot;
}

export function createSinglePointerGesture(
  pointerType: string,
  point: MapPoint,
): MapGestureState {
  return {
    pointerType,
    startPoint: point,
    lastPoint: point,
    moved: false,
    hadMultiple: false,
  };
}

export function createMultiPointerGesture(
  pointerType: string,
  point: MapPoint,
  contacts: readonly MapPointerContact[],
  camera: MapCamera,
  previousStartPoint = point,
): MapGestureState {
  const first = contacts[0]?.current ?? point;
  const second = contacts[1]?.current ?? point;
  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  return {
    pointerType,
    startPoint: previousStartPoint,
    lastPoint: point,
    moved: true,
    hadMultiple: true,
    pinch: {
      camera: { ...camera },
      distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
      midpoint,
    },
  };
}

export function mapDragThreshold(pointerType: string, camera: MapCamera) {
  const canPan = camera.zoom > MAP_MIN_ZOOM + 0.0001;
  return pointerType === 'touch' ? (canPan ? 10 : 14) : 5;
}

export function shouldCancelMapTap(
  gesture: MapGestureState,
  cameraBefore: MapCamera,
  cameraAfter: MapCamera,
  totalDistance: number,
) {
  const cameraMoved = Math.abs(cameraAfter.panX - cameraBefore.panX) > 0.05
    || Math.abs(cameraAfter.panY - cameraBefore.panY) > 0.05;
  const canPan = cameraBefore.zoom > MAP_MIN_ZOOM + 0.0001;
  return {
    cameraMoved,
    cancelTap: gesture.moved
      || cameraMoved
      || canPan
      || gesture.pointerType !== 'touch'
      || totalDistance >= 28,
  };
}

export function cameraForPinch(
  pinch: MapPinchSnapshot,
  contacts: readonly MapPointerContact[],
  width: number,
  height: number,
) {
  const first = contacts[0]?.current ?? pinch.midpoint;
  const second = contacts[1]?.current ?? pinch.midpoint;
  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
  const zoomed = zoomMapCameraAtPoint(
    pinch.camera,
    pinch.camera.zoom * (distance / Math.max(1, pinch.distance)),
    pinch.midpoint,
    width,
    height,
  );
  return panMapCamera(
    zoomed,
    midpoint.x - pinch.midpoint.x,
    midpoint.y - pinch.midpoint.y,
    width,
    height,
  );
}
