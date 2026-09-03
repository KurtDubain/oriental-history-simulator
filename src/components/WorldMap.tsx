import { Minus, Plus, ScanLine } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import "../styles/world-map.css";
import { recordRuntimeMetric, runtimeNow } from "../performance/runtime-profiler";
import { getMapProfileForContentVersion } from "../maps";
import type { MapContentVersion } from "../maps/types";
import type {
  MapArmyView,
  MapCamera,
  MapFleetView,
  MapLodLevel,
  MapLodScene,
  MapMarkerView,
  MapObjectKind,
  MapOverlay,
  MapPersonForceView,
  MapPoint,
  MapSeason,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
} from "../view/map-contract";
import {
  cameraForPinch,
  createMultiPointerGesture,
  createSinglePointerGesture,
  mapDragThreshold,
  shouldCancelMapTap,
  type MapGestureState,
  type MapPointerContact,
} from "../view/map-gestures";
import { buildMapPresentation } from "../view/map-presentation";
import { mapHoverReading, type MapHoverState } from "../view/map-hover-reading";
import { buildMapLodScene, resolveMapLodLevel } from "../view/map-lod";
import { resolveMapFocusOffset, type MapFocusOcclusion } from "../view/map-focus-offset";
import { layoutMapMarkers, mapMarkerMatchesSelection, mapMarkerTarget } from "../view/map-marker-layout";
import {
  drawWorldMap,
  type MapCanvasSize,
} from "../view/map-renderer";
import { useQuarterHighlightPulse } from "./useQuarterHighlightPulse";
import {
  DEFAULT_MAP_CAMERA,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  clampMapCamera,
  createMapViewportTransform,
  layoutMapPersonForces,
  panMapCamera,
  reframeMapCamera,
  resolveMapSceneHit,
  worldToScreenPoint,
  zoomMapCameraAtPoint,
} from "../view/map-scene-geometry";

export type {
  MapArmyView,
  MapCamera,
  MapFleetView,
  MapLodLevel,
  MapMarkerView,
  MapObjectKind,
  MapOverlay,
  MapPoint,
  MapRegionView,
  MapRouteView,
  MapSeaZoneView,
  MapViewportTransform,
} from "../view/map-contract";
export { buildMapPresentation } from "../view/map-presentation";
export {
  DEFAULT_MAP_CAMERA,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  clampMapCamera,
  createMapViewportTransform,
  layoutMapPersonClusters,
  layoutMapPersonForces,
  layoutMapRegionNodes,
  panMapCamera,
  reframeMapCamera,
  zoomMapCameraAtPoint,
  regionAtScreenPoint,
  regionNodeAtScreenPoint,
  screenToWorldPoint,
} from "../view/map-scene-geometry";

export interface WorldMapProps {
  mapContentVersion: MapContentVersion;
  regions: readonly MapRegionView[];
  routes: readonly MapRouteView[];
  armies: readonly MapArmyView[];
  persons?: readonly MapPersonForceView[];
  seaZones?: readonly MapSeaZoneView[];
  fleets?: readonly MapFleetView[];
  markers?: readonly MapMarkerView[];
  highlightedRegionIds?: readonly string[];
  highlightEpoch?: string | number;
  selectedRegionId?: string | null;
  selectedObject?: { kind: string; id: string } | null;
  overlay: MapOverlay;
  onSelectRegion: (regionId: string) => void;
  onSelectObject?: (kind: MapObjectKind, id: string, marker?: MapMarkerView) => void;
  onSelectBlank?: () => void;
  onLodChange?: (level: MapLodLevel) => void;
  onGestureActivityChange?: (active: boolean) => void;
  mobileQuickLookOpen?: boolean;
  cameraKey?: string | number;
  onCameraChange?: (camera: MapCamera) => void;
  className?: string;
  season?: MapSeason;
  atmosphereEnabled?: boolean;
  motionReduced?: boolean;
  politicalFocusPolityId?: string | null;
  politicalFocusFactionId?: string | null;
  focusedWarId?: string | null;
  focusedWarArmyIds?: readonly string[];
}

interface TapFeedback {
  id: number;
  x: number;
  y: number;
}

const ZERO_FOCUS_OFFSET: Readonly<MapPoint> = Object.freeze({ x: 0, y: 0 });

function selectedSceneAnchor(
  scene: MapLodScene,
  selectedRegionId: string | null | undefined,
  selectedObject: { kind: string; id: string } | null,
  width: number,
  height: number,
  camera: MapCamera,
): MapPoint | null {
  const transform = createMapViewportTransform(width, height, undefined, camera);
  if (selectedRegionId) {
    const selectedRegion = scene.regions.find((region) => region.id === selectedRegionId);
    return selectedRegion ? worldToScreenPoint(selectedRegion.center, transform) : null;
  }
  if (!selectedObject) return null;
  if (selectedObject.kind === "person") {
    return layoutMapPersonForces(scene.persons, transform)
      .find((layout) => layout.person.id === selectedObject.id)?.point ?? null;
  }
  if (selectedObject.kind === "fleet") {
    const fleet = scene.fleets.find((item) => item.id === selectedObject.id);
    return fleet ? worldToScreenPoint(fleet.position, transform) : null;
  }
  if (selectedObject.kind === "seaZone") {
    const seaZone = scene.seaZones.find((item) => item.id === selectedObject.id);
    return seaZone ? worldToScreenPoint(seaZone.center, transform) : null;
  }
  const marker = layoutMapMarkers(scene.markers, transform)
    .find((layout) => mapMarkerMatchesSelection(layout.marker, selectedObject));
  return marker?.point ?? null;
}

function sameOcclusion(
  current: MapFocusOcclusion | null,
  next: MapFocusOcclusion | null,
) {
  if (!current || !next) return current === next;
  return Math.abs(current.x - next.x) < 0.5
    && Math.abs(current.y - next.y) < 0.5
    && Math.abs(current.width - next.width) < 0.5
    && Math.abs(current.height - next.height) < 0.5;
}

export function WorldMap({
  mapContentVersion,
  regions,
  routes,
  armies,
  persons = [],
  seaZones = [],
  fleets = [],
  markers = [],
  highlightedRegionIds = [],
  highlightEpoch = 'initial',
  selectedRegionId,
  selectedObject = null,
  overlay,
  onSelectRegion,
  onSelectObject,
  onSelectBlank,
  onLodChange,
  onGestureActivityChange,
  mobileQuickLookOpen = false,
  cameraKey,
  onCameraChange,
  className = "",
  season = '春',
  atmosphereEnabled = true,
  motionReduced = false,
  politicalFocusPolityId = null,
  politicalFocusFactionId = null,
  focusedWarId = null,
  focusedWarArmyIds = [],
}: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<MapCanvasSize>({ width: 1, height: 1, dpr: 1 });
  const [hover, setHover] = useState<MapHoverState | null>(null);
  const [camera, setCameraState] = useState<MapCamera>(() => ({ ...DEFAULT_MAP_CAMERA }));
  const [lodLevel, setLodLevel] = useState<MapLodLevel>("overview");
  const [dragging, setDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<TapFeedback | null>(null);
  const [pressedFeedback, setPressedFeedback] = useState<TapFeedback | null>(null);
  const [movementProgress, setMovementProgress] = useState(1);
  const [quickLookOcclusion, setQuickLookOcclusion] = useState<MapFocusOcclusion | null>(null);
  const cameraRef = useRef<MapCamera>({ ...DEFAULT_MAP_CAMERA });
  const lodLevelRef = useRef<MapLodLevel>("overview");
  const cameraKeyRef = useRef(cameraKey);
  const viewportSizeRef = useRef({ width: 1, height: 1 });
  const pointersRef = useRef(new Map<number, MapPointerContact>());
  const gestureRef = useRef<MapGestureState | null>(null);
  const tapSequenceRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const focusOffsetRef = useRef<MapPoint>({ ...ZERO_FOCUS_OFFSET });
  const mapProfile = useMemo(
    () => getMapProfileForContentVersion(mapContentVersion),
    [mapContentVersion],
  );
  const presentation = useMemo(
    () => buildMapPresentation(
      regions,
      routes,
      armies,
      seaZones,
      fleets,
      markers,
      mapProfile.presentation,
      persons,
    ),
    [armies, fleets, mapProfile, markers, persons, regions, routes, seaZones],
  );
  const hoveredRegionId = hover?.kind === "region" ? hover.region.id : undefined;
  const scene = useMemo(
    () => buildMapLodScene(presentation, lodLevel, { selectedRegionId, selectedObject, focusedArmyIds: focusedWarArmyIds }),
    [focusedWarArmyIds, lodLevel, presentation, selectedObject, selectedRegionId],
  );
  const movementKey = armies.map((army) => army.recentMovement?.current
    ? `${army.id}:${army.recentMovement.fromRegionId}:${army.recentMovement.toRegionId}:${army.recentMovement.turn}` : '').join('|');
  useEffect(() => {
    if (motionReduced || !movementKey.replaceAll('|', '')) { setMovementProgress(1); return undefined; }
    let frame = 0;
    const started = performance.now();
    const animate = (now: number) => {
      setMovementProgress(Math.min(1, (now - started) / 560));
      if (now - started < 560) frame = requestAnimationFrame(animate);
    };
    setMovementProgress(0); frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [motionReduced, movementKey]);
  const selectedAnchor = useMemo(
    () => selectedSceneAnchor(
      scene,
      selectedRegionId,
      selectedObject,
      size.width,
      size.height,
      camera,
    ),
    [camera, scene, selectedObject, selectedRegionId, size.height, size.width],
  );
  const focusOffset = useMemo(() => (
    selectedAnchor && quickLookOcclusion
      ? resolveMapFocusOffset({
        anchor: selectedAnchor,
        viewport: { width: size.width, height: size.height },
        occlusion: quickLookOcclusion,
      })
      : { ...ZERO_FOCUS_OFFSET }
  ), [quickLookOcclusion, selectedAnchor, size.height, size.width]);
  const highlightStrength = useQuarterHighlightPulse({
    epoch: highlightEpoch,
    regionIds: highlightedRegionIds,
    motionReduced,
  });
  focusOffsetRef.current = focusOffset;

  const updateLodLevel = useCallback((zoom: number) => {
    const next = resolveMapLodLevel(zoom, lodLevelRef.current);
    if (next === lodLevelRef.current) return;
    lodLevelRef.current = next;
    setLodLevel(next);
    onLodChange?.(next);
  }, [onLodChange]);

  const applyCamera = useCallback((candidate: MapCamera) => {
    const next = clampMapCamera(candidate, size.width, size.height);
    updateLodLevel(next.zoom);
    const current = cameraRef.current;
    if (
      Math.abs(current.zoom - next.zoom) < 0.0001
      && Math.abs(current.panX - next.panX) < 0.05
      && Math.abs(current.panY - next.panY) < 0.05
    ) return current;
    cameraRef.current = next;
    setCameraState(next);
    return next;
  }, [size.height, size.width, updateLodLevel]);

  const commitCamera = useCallback((next = cameraRef.current) => {
    onCameraChange?.({ ...next });
  }, [onCameraChange]);

  useEffect(() => {
    if (!focusedWarId || size.width <= 1 || size.height <= 1) return;
    const ids = new Set(focusedWarArmyIds);
    const regionIds = new Set(presentation.armies.filter((army) => ids.has(army.id)).flatMap((army) => [army.regionId, army.nextRegionId].filter((id): id is string => Boolean(id))));
    const points = presentation.regions.filter((region) => regionIds.has(region.id)).map((region) => region.center);
    if (!points.length) return;
    const minX = Math.min(...points.map((point) => point.x)); const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y)); const maxY = Math.max(...points.map((point) => point.y));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const zoom = Math.hypot(maxX - minX, maxY - minY) > 520 ? 1.15 : Math.hypot(maxX - minX, maxY - minY) > 250 ? 1.35 : 1.65;
    const base = createMapViewportTransform(size.width, size.height, undefined, DEFAULT_MAP_CAMERA);
    const next = applyCamera({
      zoom,
      panX: size.width / 2 - base.offsetX - center.x * base.scale * zoom,
      panY: size.height / 2 - base.offsetY - center.y * base.scale * base.yScale * zoom,
    });
    commitCamera(next);
  }, [applyCamera, commitCamera, focusedWarArmyIds, focusedWarId, presentation.armies, presentation.regions, size.height, size.width]);

  useEffect(() => {
    if (cameraKeyRef.current === cameraKey) return;
    cameraKeyRef.current = cameraKey;
    pointersRef.current.clear();
    gestureRef.current = null;
    focusOffsetRef.current = { ...ZERO_FOCUS_OFFSET };
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    cameraRef.current = { ...DEFAULT_MAP_CAMERA };
    lodLevelRef.current = "overview";
    setLodLevel("overview");
    onLodChange?.("overview");
    setCameraState({ ...DEFAULT_MAP_CAMERA });
    setHover(null);
    setTapFeedback(null);
    setPressedFeedback(null);
    setDragging(false);
    setHasInteracted(false);
    commitCamera(DEFAULT_MAP_CAMERA);
  }, [cameraKey, commitCamera, onLodChange]);

  useEffect(() => {
    onGestureActivityChange?.(dragging);
    return () => {
      if (dragging) onGestureActivityChange?.(false);
    };
  }, [dragging, onGestureActivityChange]);

  useEffect(() => {
    const previous = viewportSizeRef.current;
    const next = reframeMapCamera(
      cameraRef.current,
      previous.width,
      previous.height,
      size.width,
      size.height,
    );
    viewportSizeRef.current = { width: size.width, height: size.height };
    const current = cameraRef.current;
    if (
      Math.abs(current.zoom - next.zoom) < 0.0001
      && Math.abs(current.panX - next.panX) < 0.05
      && Math.abs(current.panY - next.panY) < 0.05
    ) return;
    cameraRef.current = next;
    setCameraState(next);
    commitCamera(next);
  }, [commitCamera, size.height, size.width]);

  useEffect(() => () => {
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const updateSize = (width: number, height: number) => {
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(height));
      const nextDpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight && current.dpr === nextDpr
          ? current
          : { width: nextWidth, height: nextHeight, dpr: nextDpr },
      );
    };

    const rect = host.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !mobileQuickLookOpen) {
      setQuickLookOcclusion((current) => sameOcclusion(current, null) ? current : null);
      return undefined;
    }
    const mobileLike = window.matchMedia('(max-width: 760px), (pointer: coarse)');
    if (!mobileLike.matches) {
      setQuickLookOcclusion((current) => sameOcclusion(current, null) ? current : null);
      return undefined;
    }
    const inspector = host.closest('.observer-app')
      ?.querySelector<HTMLElement>('.observer-inspector[data-mobile-mode="quick"]');
    if (!inspector) return undefined;

    const updateOcclusion = () => {
      const hostRect = host.getBoundingClientRect();
      const inspectorRect = inspector.getBoundingClientRect();
      const left = Math.max(0, inspectorRect.left - hostRect.left);
      const top = Math.max(0, inspectorRect.top - hostRect.top);
      const right = Math.min(hostRect.width, inspectorRect.right - hostRect.left);
      const bottom = Math.min(hostRect.height, inspectorRect.bottom - hostRect.top);
      const next = right > left && bottom > top
        ? { x: left, y: top, width: right - left, height: bottom - top }
        : null;
      setQuickLookOcclusion((current) => sameOcclusion(current, next) ? current : next);
    };
    updateOcclusion();
    let settleFrame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(updateOcclusion);
    });
    const observer = new ResizeObserver(updateOcclusion);
    observer.observe(host);
    observer.observe(inspector);
    window.addEventListener('resize', updateOcclusion);
    inspector.addEventListener('animationend', updateOcclusion);
    inspector.addEventListener('animationcancel', updateOcclusion);
    inspector.addEventListener('transitionend', updateOcclusion);
    inspector.addEventListener('transitioncancel', updateOcclusion);
    return () => {
      window.cancelAnimationFrame(settleFrame);
      observer.disconnect();
      window.removeEventListener('resize', updateOcclusion);
      inspector.removeEventListener('animationend', updateOcclusion);
      inspector.removeEventListener('animationcancel', updateOcclusion);
      inspector.removeEventListener('transitionend', updateOcclusion);
      inspector.removeEventListener('transitioncancel', updateOcclusion);
    };
  }, [mobileQuickLookOpen, size.height, size.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(size.width * size.dpr));
    canvas.height = Math.max(1, Math.round(size.height * size.dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    const drawStartedAt = runtimeNow();
    drawWorldMap(
      context,
      size,
      scene,
      overlay,
      highlightedRegionIds,
      selectedRegionId,
      selectedObject,
      hoveredRegionId,
      camera,
      focusOffset,
      { season, atmosphere: atmosphereEnabled, highlightStrength },
      focusedWarId,
      movementProgress,
    );
    recordRuntimeMetric('canvas.draw', runtimeNow() - drawStartedAt);
  }, [atmosphereEnabled, camera, focusOffset, focusedWarId, highlightStrength, highlightedRegionIds, hoveredRegionId, movementProgress, overlay, scene, season, selectedObject, selectedRegionId, size]);

  const localPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (size.width / Math.max(1, rect.width)),
      y: (event.clientY - rect.top) * (size.height / Math.max(1, rect.height)),
    };
  }, [size.height, size.width]);

  const localClientPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: size.width / 2, y: size.height / 2 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (size.width / Math.max(1, rect.width)),
      y: (clientY - rect.top) * (size.height / Math.max(1, rect.height)),
    };
  }, [size.height, size.width]);

  const showTapFeedback = useCallback((point: MapPoint) => {
    tapSequenceRef.current += 1;
    setTapFeedback({ id: tapSequenceRef.current, x: point.x, y: point.y });
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => setTapFeedback(null), 420);
  }, []);

  const selectAtPoint = useCallback((point: MapPoint, pointerType: string) => {
    const coarse = pointerType === "touch" || pointerType === "pen";
    const hit = resolveMapSceneHit(
      scene,
      point,
      size.width,
      size.height,
      cameraRef.current,
      {
        coarsePointer: coarse,
        includeSeaZones: overlay === "war",
        tolerateRegionEdge: true,
        focusOffset: focusOffsetRef.current,
      },
    );
    if (!hit) {
      onSelectBlank?.();
      return;
    }
    if (hit.kind === 'fleet' && onSelectObject) {
      onSelectObject('fleet', hit.fleet.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'person' && onSelectObject) {
      onSelectObject('person', hit.person.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'personCluster') {
      onSelectRegion(hit.cluster.regionId);
      const next = applyCamera(zoomMapCameraAtPoint(
        cameraRef.current,
        Math.max(1.55, cameraRef.current.zoom),
        point,
        size.width,
        size.height,
      ));
      commitCamera(next);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'marker') {
      const target = mapMarkerTarget(hit.marker);
      if (target.kind === 'region') onSelectRegion(target.id);
      else onSelectObject?.(target.kind, target.id, hit.marker);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'regionNode') {
      onSelectRegion(hit.node.region.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'region') {
      onSelectRegion(hit.region.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'seaZone' && onSelectObject) {
      onSelectObject('seaZone', hit.seaZone.id);
      showTapFeedback(point);
    }
  }, [applyCamera, commitCamera, onSelectBlank, onSelectObject, onSelectRegion, overlay, scene, showTapFeedback, size.height, size.width]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = localPoint(event);
      const contact = pointersRef.current.get(event.pointerId);
      if (contact) {
        event.preventDefault();
        contact.current = point;
        const gesture = gestureRef.current;
        if (!gesture) return;
        const active = [...pointersRef.current.values()];
        if (active.length >= 2) {
          const focus = focusOffsetRef.current;
          const focusedPoint = { x: point.x - focus.x, y: point.y - focus.y };
          const focusedContacts = active.map((entry) => ({
            ...entry,
            current: {
              x: entry.current.x - focus.x,
              y: entry.current.y - focus.y,
            },
          }));
          if (!gesture.pinch) {
            gesture.pinch = createMultiPointerGesture(
              gesture.pointerType,
              focusedPoint,
              focusedContacts,
              cameraRef.current,
              gesture.startPoint,
            ).pinch;
          }
          if (gesture.pinch) applyCamera(cameraForPinch(gesture.pinch, focusedContacts, size.width, size.height));
          gesture.moved = true;
          gesture.hadMultiple = true;
          setPressedFeedback(null);
          setDragging(true);
          setHasInteracted(true);
          setHover(null);
          return;
        }
        const threshold = mapDragThreshold(gesture.pointerType, cameraRef.current);
        const totalDistance = Math.hypot(point.x - gesture.startPoint.x, point.y - gesture.startPoint.y);
        if (gesture.moved || totalDistance >= threshold) {
          const before = cameraRef.current;
          const next = applyCamera(panMapCamera(
            cameraRef.current,
            point.x - gesture.lastPoint.x,
            point.y - gesture.lastPoint.y,
            size.width,
            size.height,
          ));
          const { cameraMoved, cancelTap } = shouldCancelMapTap(gesture, before, next, totalDistance);
          gesture.moved = cancelTap;
          if (cameraMoved) {
            setDragging(true);
            setHasInteracted(true);
          }
          if (cancelTap) setDragging(true);
          if (cancelTap) setHover(null);
          if (cancelTap) setPressedFeedback(null);
        }
        gesture.lastPoint = point;
        return;
      }
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      const hit = resolveMapSceneHit(
        scene,
        point,
        size.width,
        size.height,
        cameraRef.current,
        {
          includeSeaZones: false,
          tolerateRegionEdge: false,
          focusOffset: focusOffsetRef.current,
        },
      );
      if (hit?.kind === 'fleet') setHover({ kind: 'fleet', fleet: hit.fleet, x: point.x, y: point.y });
      else if (hit?.kind === 'person') setHover({ kind: 'person', person: hit.person, x: point.x, y: point.y });
      else if (hit?.kind === 'personCluster') setHover({ kind: 'personCluster', cluster: hit.cluster, x: point.x, y: point.y });
      else if (hit?.kind === 'marker') setHover({ kind: 'marker', marker: hit.marker, x: point.x, y: point.y });
      else if (hit?.kind === 'regionNode') setHover({ kind: 'region', region: hit.node.region, x: point.x, y: point.y });
      else if (hit?.kind === 'region') setHover({ kind: 'region', region: hit.region, x: point.x, y: point.y });
      else setHover(null);
    },
    [applyCamera, localPoint, scene, size.height, size.width],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const point = localPoint(event);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail when a browser cancels a touch during handoff.
      }
      pointersRef.current.set(event.pointerId, {
        pointerType: event.pointerType,
        current: point,
      });
      const active = [...pointersRef.current.values()];
      if (active.length === 1) {
        gestureRef.current = createSinglePointerGesture(event.pointerType, point);
        tapSequenceRef.current += 1;
        setPressedFeedback({ id: tapSequenceRef.current, x: point.x, y: point.y });
      } else {
        const focus = focusOffsetRef.current;
        const focusedContacts = active.map((entry) => ({
          ...entry,
          current: {
            x: entry.current.x - focus.x,
            y: entry.current.y - focus.y,
          },
        }));
        gestureRef.current = createMultiPointerGesture(
          event.pointerType,
          { x: point.x - focus.x, y: point.y - focus.y },
          focusedContacts,
          cameraRef.current,
          gestureRef.current?.startPoint ?? point,
        );
        setDragging(true);
        setHasInteracted(true);
        setPressedFeedback(null);
      }
      setHover(null);
    },
    [localPoint],
  );

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const contact = pointersRef.current.get(event.pointerId);
    if (!contact) return;
    const point = localPoint(event);
    contact.current = point;
    const gesture = gestureRef.current;
    const shouldSelect = !cancelled
      && pointersRef.current.size === 1
      && !gesture?.moved
      && !gesture?.hadMultiple;
    const selectionPoint = shouldSelect && gesture ? gesture.startPoint : point;
    setPressedFeedback(null);
    pointersRef.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released capture after a touch cancellation.
    }
    const remaining = [...pointersRef.current.values()];
    if (remaining.length > 0) {
      const next = remaining[0].current;
      gestureRef.current = {
        ...createSinglePointerGesture(remaining[0].pointerType, next),
        moved: true,
        hadMultiple: true,
      };
      setDragging(cameraRef.current.zoom > MAP_MIN_ZOOM + 0.0001);
      return;
    }
    gestureRef.current = null;
    setDragging(false);
    if (shouldSelect) selectAtPoint(selectionPoint, contact.pointerType);
    commitCamera();
  }, [commitCamera, localPoint, selectAtPoint]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const point = localClientPoint(event.clientX, event.clientY);
    const focus = focusOffsetRef.current;
    const cameraPoint = { x: point.x - focus.x, y: point.y - focus.y };
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    const factor = Math.exp(-event.deltaY * unit * 0.00135);
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * factor,
      cameraPoint,
      size.width,
      size.height,
    ));
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera, localClientPoint, size.height, size.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const listener = (event: WheelEvent) => handleWheel(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, [handleWheel]);

  const zoomAtCenter = useCallback((nextZoom: number) => {
    const focus = focusOffsetRef.current;
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      nextZoom,
      { x: size.width / 2 - focus.x, y: size.height / 2 - focus.y },
      size.width,
      size.height,
    ));
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera, size.height, size.width]);

  const resetCamera = useCallback(() => {
    const next = applyCamera(DEFAULT_MAP_CAMERA);
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera]);

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = localClientPoint(event.clientX, event.clientY);
    const focus = focusOffsetRef.current;
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * 1.45,
      { x: point.x - focus.x, y: point.y - focus.y },
      size.width,
      size.height,
    ));
    setHasInteracted(true);
    setHover(null);
    commitCamera(next);
  }, [applyCamera, commitCamera, localClientPoint, size.height, size.width]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAtCenter(cameraRef.current.zoom * 1.35);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAtCenter(cameraRef.current.zoom / 1.35);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetCamera();
        return;
      }
      const visibleSeaZones = scene.seaZones.map((item) => ({ kind: "seaZone" as const, id: item.id }));
      const contextualObjects: Array<{ kind: MapObjectKind | 'region'; id: string; marker?: MapMarkerView }> = overlay === "war"
        ? [
          ...scene.persons.map((item) => ({ kind: "person" as const, id: item.id })),
          ...scene.fleets.map((item) => ({ kind: "fleet" as const, id: item.id })),
          ...visibleSeaZones,
        ]
        : [];
      if (scene.regions.length === 0 && contextualObjects.length === 0) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (hover?.kind === "person") {
          onSelectObject?.("person", hover.person.id);
          return;
        }
        if (hover?.kind === "fleet") {
          onSelectObject?.("fleet", hover.fleet.id);
          return;
        }
        if (hover?.kind === "marker") {
          const target = mapMarkerTarget(hover.marker);
          if (target.kind === 'region') onSelectRegion(target.id);
          else onSelectObject?.(target.kind, target.id, hover.marker);
          return;
        }
        const selectedContext = contextualObjects.find((item) => (
          item.id === selectedObject?.id && item.kind === selectedObject.kind
        ));
        if (selectedContext) {
          if (selectedContext.kind === 'region') onSelectRegion(selectedContext.id);
          else onSelectObject?.(selectedContext.kind, selectedContext.id, selectedContext.marker);
          return;
        }
        const targetId = hover?.kind === "region" ? hover.region.id : selectedRegionId ?? scene.regions[0]?.id;
        if (targetId) onSelectRegion(targetId);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (contextualObjects.length) {
        const currentIndex = contextualObjects.findIndex((item) => item.id === selectedObject?.id);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = contextualObjects[(currentIndex + direction + contextualObjects.length) % contextualObjects.length];
        if (next?.kind === 'region') onSelectRegion(next.id);
        else if (next) onSelectObject?.(next.kind, next.id, next.marker);
        return;
      }
      const currentIndex = scene.regions.findIndex((region) => region.id === selectedRegionId);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + scene.regions.length) % scene.regions.length;
      onSelectRegion(scene.regions[nextIndex].id);
    },
    [hover, onSelectObject, onSelectRegion, overlay, resetCamera, scene, selectedObject?.id, selectedObject?.kind, selectedRegionId, zoomAtCenter],
  );

  const tooltipStyle = useMemo(() => {
    if (!hover) return undefined;
    const political = hover.kind === 'marker' && (hover.marker.kind === 'capitalPulse' || hover.marker.kind === 'powerRoot');
    const tooltipWidth = Math.min(political ? 244 : 172, size.width - 20);
    const left = Math.min(size.width - tooltipWidth - 10, Math.max(10, hover.x + 16));
    const top = Math.min(size.height - (political ? 164 : 116), Math.max(10, hover.y + 14));
    return { left, top };
  }, [hover, size.height, size.width]);

  const selectedName = regions.find((region) => region.id === selectedRegionId)?.name
    ?? seaZones.find((item) => selectedObject?.kind === "seaZone" && item.id === selectedObject.id)?.name
    ?? fleets.find((item) => selectedObject?.kind === "fleet" && item.id === selectedObject.id)?.name
    ?? armies.find((item) => selectedObject?.kind === "army" && item.id === selectedObject.id)?.name
    ?? persons.find((item) => selectedObject?.kind === "person" && item.id === selectedObject.id)?.personName
    ?? markers.find((item) => mapMarkerMatchesSelection(item, selectedObject))?.label;

  const hoverTooltip = useMemo(() => mapHoverReading(hover, overlay), [hover, overlay]);

  return (
    <div
      ref={hostRef}
      className={`world-map${className ? ` ${className}` : ""}`}
      data-overlay={overlay}
      data-map-layout={`${mapProfile.id}-r${mapProfile.revision}`}
      data-map-profile-id={mapProfile.id}
      data-map-content-version={mapProfile.contentVersion}
      data-major-landform-count={mapProfile.presentation.landShapes.length}
      data-landmass-count={mapProfile.presentation.landShapes.filter((shape) => shape.role === "mainland").length}
      data-island-shape-count={mapProfile.presentation.landShapes.filter((shape) => shape.role === "island").length}
      data-highlighted-region-count={highlightedRegionIds.length}
      data-highlighted-region-ids={highlightedRegionIds.join(',') || undefined}
      data-highlight-epoch={String(highlightEpoch)}
      data-highlight-active={highlightStrength > 0.015 || undefined}
      data-highlight-strength={highlightStrength.toFixed(3)}
      data-quarter-highlight-epoch={String(highlightEpoch)}
      data-quarter-highlight-active={highlightStrength > 0.015 || undefined}
      data-map-zoom={camera.zoom.toFixed(3)}
      data-map-pan-x={camera.panX.toFixed(1)}
      data-map-pan-y={camera.panY.toFixed(1)}
      data-map-lod={lodLevel}
      data-visible-army-count={scene.armies.length}
      data-visible-fleet-count={scene.fleets.length}
      data-visible-marker-count={scene.markers.length}
      data-political-pulse-ids={scene.markers.filter((item) => item.kind === 'capitalPulse').map((item) => item.id).join(',') || undefined}
      data-political-root-ids={scene.markers.filter((item) => item.kind === 'powerRoot').map((item) => item.id).join(',') || undefined}
      data-political-focus-polity-id={politicalFocusPolityId ?? undefined}
      data-political-focus-faction-id={politicalFocusFactionId ?? undefined}
      data-focused-war-id={focusedWarId ?? undefined}
      data-visible-army-ids={scene.armies.map((item) => item.id).join(",")}
      data-visible-fleet-ids={scene.fleets.map((item) => item.id).join(",")}
      data-mobile-quick-look-open={mobileQuickLookOpen || undefined}
      data-selection-avoided={(Math.abs(focusOffset.x) > 0.1 || Math.abs(focusOffset.y) > 0.1) || undefined}
      data-selected-screen-x={selectedAnchor ? (selectedAnchor.x + focusOffset.x).toFixed(1) : undefined}
      data-selected-screen-y={selectedAnchor ? (selectedAnchor.y + focusOffset.y).toFixed(1) : undefined}
      data-focus-offset-x={focusOffset.x.toFixed(1)}
      data-focus-offset-y={focusOffset.y.toFixed(1)}
      data-pannable={camera.zoom > MAP_MIN_ZOOM + 0.0001 || undefined}
      data-dragging={dragging || undefined}
      data-hover-object={Boolean(hover) || undefined}
      data-season={season}
      data-atmosphere={atmosphereEnabled || undefined}
    >
      <canvas
        ref={canvasRef}
        className="world-map__canvas"
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        role="application"
        tabIndex={0}
        aria-label={`天下舆图。${selectedName ? `当前选择：${selectedName}。` : "尚未选择区域。"}点按选择，拖动浏览，滚轮或双指缩放。左右方向键切换区域，加减号缩放，数字零归位，回车确认。`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) setHover(null);
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />

      <div className="world-map__viewport-controls" role="group" aria-label="舆图缩放">
        <button
          type="button"
          data-map-zoom-out="true"
          onClick={() => zoomAtCenter(camera.zoom / 1.35)}
          disabled={camera.zoom <= MAP_MIN_ZOOM + 0.001}
          aria-label={`缩小舆图，当前${Math.round(camera.zoom * 100)}%`}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <output aria-label={`当前舆图缩放${Math.round(camera.zoom * 100)}%`}>
          {Math.round(camera.zoom * 100)}%
        </output>
        <button
          type="button"
          data-map-zoom-in="true"
          onClick={() => zoomAtCenter(camera.zoom * 1.35)}
          disabled={camera.zoom >= MAP_MAX_ZOOM - 0.001}
          aria-label={`放大舆图，当前${Math.round(camera.zoom * 100)}%`}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-map-reset="true"
          onClick={resetCamera}
          disabled={camera.zoom <= MAP_MIN_ZOOM + 0.001 && Math.abs(camera.panX) < 0.1 && Math.abs(camera.panY) < 0.1}
          aria-label="归位舆图"
          title="归位舆图（0）"
        >
          <ScanLine size={16} aria-hidden="true" />
        </button>
      </div>

      {!hasInteracted && regions.length > 0 ? (
        <p className="world-map__gesture-hint" aria-hidden="true">
          <span className="world-map__gesture-hint-desktop">点州域、人物或都城印记查看 · 滚轮缩放</span>
          <span className="world-map__gesture-hint-touch">轻点州域、人物或都城印记速览 · 双指缩放</span>
        </p>
      ) : null}

      {tapFeedback ? (
        <span
          key={tapFeedback.id}
          className="world-map__tap-feedback"
          style={{ left: tapFeedback.x, top: tapFeedback.y }}
          aria-hidden="true"
        />
      ) : null}
      {pressedFeedback ? (
        <span
          key={pressedFeedback.id}
          className="world-map__press-feedback"
          style={{ left: pressedFeedback.x, top: pressedFeedback.y }}
          aria-hidden="true"
        />
      ) : null}

      {hover && hoverTooltip && tooltipStyle ? (
        <div className={`world-map__tooltip${hover.kind === 'marker' && (hover.marker.kind === 'capitalPulse' || hover.marker.kind === 'powerRoot') ? ' world-map__tooltip--political' : ''}`} style={tooltipStyle} aria-hidden="true">
          <div className="world-map__tooltip-heading">
            <strong>{hoverTooltip.name}</strong>
            <span>{hoverTooltip.type}</span>
          </div>
          <div className="world-map__tooltip-rule" />
          <dl>
            {hoverTooltip.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </div>
      ) : null}

      {regions.length === 0 ? (
        <div className="world-map__empty" role="status">
          <span>舆图待绘</span>
          <small>世界生成后，山河与疆界将在此显现</small>
        </div>
      ) : null}
    </div>
  );
}

export default WorldMap;
