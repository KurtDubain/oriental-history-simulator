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
import { DEFAULT_MAP_PROFILE_ID, getMapProfile } from "../maps";
import type { MapProfileId } from "../maps/types";
import type {
  MapArmyView,
  MapCamera,
  MapFleetView,
  MapFlowKind,
  MapFlowView,
  MapMarkerView,
  MapObjectKind,
  MapOverlay,
  MapPoint,
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
import {
  drawWorldMap,
  foodDescription,
  formatPopulation,
  terrainLabel,
  type MapCanvasSize,
} from "../view/map-renderer";
import {
  DEFAULT_MAP_CAMERA,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  clampMapCamera,
  panMapCamera,
  reframeMapCamera,
  resolveMapSceneHit,
  zoomMapCameraAtPoint,
} from "../view/map-scene-geometry";

export type {
  MapArmyView,
  MapCamera,
  MapFleetView,
  MapFlowKind,
  MapFlowView,
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
  layoutMapArmyIcons,
  layoutMapRegionNodes,
  panMapCamera,
  reframeMapCamera,
  zoomMapCameraAtPoint,
  armyAtScreenPoint,
  regionAtScreenPoint,
  regionNodeAtScreenPoint,
  screenToWorldPoint,
} from "../view/map-scene-geometry";

export interface WorldMapProps {
  mapProfileId?: MapProfileId;
  regions: readonly MapRegionView[];
  routes: readonly MapRouteView[];
  armies: readonly MapArmyView[];
  seaZones?: readonly MapSeaZoneView[];
  fleets?: readonly MapFleetView[];
  flows?: readonly MapFlowView[];
  markers?: readonly MapMarkerView[];
  highlightedRegionIds?: readonly string[];
  selectedRegionId?: string | null;
  selectedObject?: { kind: string; id: string } | null;
  overlay: MapOverlay;
  onSelectRegion: (regionId: string) => void;
  onSelectObject?: (kind: MapObjectKind, id: string) => void;
  cameraKey?: string | number;
  onCameraChange?: (camera: MapCamera) => void;
  className?: string;
}

type HoverState =
  | { kind: "region"; region: MapRegionView; x: number; y: number }
  | { kind: "regionNode"; nodeKind: "city" | "port"; region: MapRegionView; x: number; y: number }
  | { kind: "army"; army: MapArmyView; x: number; y: number }
  | { kind: "fleet"; fleet: MapFleetView; x: number; y: number }
  | { kind: "marker"; marker: MapMarkerView; x: number; y: number }
  | { kind: "flow"; flow: MapFlowView; x: number; y: number };

interface TapFeedback {
  id: number;
  x: number;
  y: number;
}

export function WorldMap({
  mapProfileId = DEFAULT_MAP_PROFILE_ID,
  regions,
  routes,
  armies,
  seaZones = [],
  fleets = [],
  flows = [],
  markers = [],
  highlightedRegionIds = [],
  selectedRegionId,
  selectedObject = null,
  overlay,
  onSelectRegion,
  onSelectObject,
  cameraKey,
  onCameraChange,
  className = "",
}: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<MapCanvasSize>({ width: 1, height: 1, dpr: 1 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [camera, setCameraState] = useState<MapCamera>(() => ({ ...DEFAULT_MAP_CAMERA }));
  const [dragging, setDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<TapFeedback | null>(null);
  const cameraRef = useRef<MapCamera>({ ...DEFAULT_MAP_CAMERA });
  const cameraKeyRef = useRef(cameraKey);
  const viewportSizeRef = useRef({ width: 1, height: 1 });
  const pointersRef = useRef(new Map<number, MapPointerContact>());
  const gestureRef = useRef<MapGestureState | null>(null);
  const tapSequenceRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const mapProfile = useMemo(() => getMapProfile(mapProfileId), [mapProfileId]);
  const presentation = useMemo(
    () => buildMapPresentation(
      regions,
      routes,
      armies,
      seaZones,
      fleets,
      flows,
      markers,
      mapProfile.presentation,
    ),
    [armies, fleets, flows, mapProfile, markers, regions, routes, seaZones],
  );
  const hoveredRegionId = hover?.kind === "region" || hover?.kind === "regionNode"
    ? hover.region.id
    : undefined;

  const applyCamera = useCallback((candidate: MapCamera) => {
    const next = clampMapCamera(candidate, size.width, size.height);
    const current = cameraRef.current;
    if (
      Math.abs(current.zoom - next.zoom) < 0.0001
      && Math.abs(current.panX - next.panX) < 0.05
      && Math.abs(current.panY - next.panY) < 0.05
    ) return current;
    cameraRef.current = next;
    setCameraState(next);
    return next;
  }, [size.height, size.width]);

  const commitCamera = useCallback((next = cameraRef.current) => {
    onCameraChange?.({ ...next });
  }, [onCameraChange]);

  useEffect(() => {
    if (cameraKeyRef.current === cameraKey) return;
    cameraKeyRef.current = cameraKey;
    cameraRef.current = { ...DEFAULT_MAP_CAMERA };
    setCameraState({ ...DEFAULT_MAP_CAMERA });
    setHasInteracted(false);
    commitCamera(DEFAULT_MAP_CAMERA);
  }, [cameraKey, commitCamera]);

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
      presentation.regions,
      presentation.routes,
      presentation.armies,
      presentation.seaZones,
      presentation.fleets,
      presentation.flows,
      presentation.markers,
      overlay,
      highlightedRegionIds,
      selectedRegionId,
      selectedObject,
      hoveredRegionId,
      camera,
      presentation.profile,
    );
    recordRuntimeMetric('canvas.draw', runtimeNow() - drawStartedAt);
  }, [camera, highlightedRegionIds, hoveredRegionId, overlay, presentation, selectedObject, selectedRegionId, size]);

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
      presentation,
      point,
      size.width,
      size.height,
      cameraRef.current,
      { coarsePointer: coarse, includeSeaZones: true, tolerateRegionEdge: true },
    );
    if (!hit) return;
    if (hit.kind === 'fleet' && onSelectObject) {
      onSelectObject('fleet', hit.fleet.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'army' && onSelectObject) {
      onSelectObject('army', hit.army.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'marker' && onSelectObject) {
      onSelectObject(hit.marker.kind, hit.marker.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'regionNode') {
      onSelectRegion(hit.node.region.id);
      showTapFeedback(point);
      return;
    }
    if (hit.kind === 'flow' && onSelectObject) {
      onSelectObject(hit.flow.selectedKind, hit.flow.selectedId);
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
  }, [onSelectObject, onSelectRegion, presentation, showTapFeedback, size.height, size.width]);

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
          if (!gesture.pinch) {
            gesture.pinch = createMultiPointerGesture(
              gesture.pointerType,
              point,
              active,
              cameraRef.current,
              gesture.startPoint,
            ).pinch;
          }
          if (gesture.pinch) applyCamera(cameraForPinch(gesture.pinch, active, size.width, size.height));
          gesture.moved = true;
          gesture.hadMultiple = true;
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
          if (cancelTap) setHover(null);
        }
        gesture.lastPoint = point;
        return;
      }
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      const hit = resolveMapSceneHit(
        presentation,
        point,
        size.width,
        size.height,
        cameraRef.current,
        { includeSeaZones: false, tolerateRegionEdge: false },
      );
      if (hit?.kind === 'fleet') setHover({ kind: 'fleet', fleet: hit.fleet, x: point.x, y: point.y });
      else if (hit?.kind === 'army') setHover({ kind: 'army', army: hit.army, x: point.x, y: point.y });
      else if (hit?.kind === 'marker') setHover({ kind: 'marker', marker: hit.marker, x: point.x, y: point.y });
      else if (hit?.kind === 'regionNode') setHover({
        kind: 'regionNode',
        nodeKind: hit.node.kind,
        region: hit.node.region,
        x: point.x,
        y: point.y,
      });
      else if (hit?.kind === 'flow') setHover({ kind: 'flow', flow: hit.flow, x: point.x, y: point.y });
      else if (hit?.kind === 'region') setHover({ kind: 'region', region: hit.region, x: point.x, y: point.y });
      else setHover(null);
    },
    [applyCamera, localPoint, presentation, size.height, size.width],
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
      } else {
        gestureRef.current = createMultiPointerGesture(
          event.pointerType,
          point,
          active,
          cameraRef.current,
          gestureRef.current?.startPoint ?? point,
        );
        setDragging(true);
        setHasInteracted(true);
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
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    const factor = Math.exp(-event.deltaY * unit * 0.00135);
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * factor,
      point,
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
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      nextZoom,
      { x: size.width / 2, y: size.height / 2 },
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
    const next = applyCamera(zoomMapCameraAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * 1.45,
      point,
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
      const contextualObjects = overlay === "naval"
        ? [...presentation.seaZones.map((item) => ({ kind: "seaZone" as const, id: item.id })), ...presentation.fleets.map((item) => ({ kind: "fleet" as const, id: item.id }))]
        : overlay === "war" || overlay === "conflict"
          ? presentation.armies.map((item) => ({ kind: "army" as const, id: item.id }))
        : [...presentation.markers.map((item) => ({ kind: item.kind, id: item.id })), ...presentation.flows.map((item) => ({ kind: item.selectedKind, id: item.selectedId }))];
      if (presentation.regions.length === 0 && contextualObjects.length === 0) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (hover?.kind === "army") {
          onSelectObject?.("army", hover.army.id);
          return;
        }
        if (hover?.kind === "fleet") {
          onSelectObject?.("fleet", hover.fleet.id);
          return;
        }
        if (hover?.kind === "marker") {
          onSelectObject?.(hover.marker.kind, hover.marker.id);
          return;
        }
        if (hover?.kind === "flow") {
          onSelectObject?.(hover.flow.selectedKind, hover.flow.selectedId);
          return;
        }
        const selectedContext = contextualObjects.find((item) => (
          item.id === selectedObject?.id && item.kind === selectedObject.kind
        ));
        if (selectedContext) {
          onSelectObject?.(selectedContext.kind, selectedContext.id);
          return;
        }
        const targetId = hover?.kind === "region" || hover?.kind === "regionNode"
          ? hover.region.id
          : selectedRegionId ?? presentation.regions[0]?.id;
        if (targetId) onSelectRegion(targetId);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      if (contextualObjects.length && overlay !== "political" && overlay !== "none" && overlay !== "food" && overlay !== "population") {
        const currentIndex = contextualObjects.findIndex((item) => item.id === selectedObject?.id);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = contextualObjects[(currentIndex + direction + contextualObjects.length) % contextualObjects.length];
        if (next) onSelectObject?.(next.kind, next.id);
        return;
      }
      const currentIndex = presentation.regions.findIndex((region) => region.id === selectedRegionId);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + presentation.regions.length) % presentation.regions.length;
      onSelectRegion(presentation.regions[nextIndex].id);
    },
    [hover, onSelectObject, onSelectRegion, overlay, presentation, resetCamera, selectedObject?.id, selectedRegionId, zoomAtCenter],
  );

  const tooltipStyle = useMemo(() => {
    if (!hover) return undefined;
    const tooltipWidth = 172;
    const left = Math.min(size.width - tooltipWidth - 10, Math.max(10, hover.x + 16));
    const top = Math.min(size.height - 116, Math.max(10, hover.y + 14));
    return { left, top };
  }, [hover, size.height, size.width]);

  const selectedName = regions.find((region) => region.id === selectedRegionId)?.name
    ?? seaZones.find((item) => selectedObject?.kind === "seaZone" && item.id === selectedObject.id)?.name
    ?? fleets.find((item) => selectedObject?.kind === "fleet" && item.id === selectedObject.id)?.name
    ?? armies.find((item) => selectedObject?.kind === "army" && item.id === selectedObject.id)?.name;

  const hoverTooltip = useMemo(() => {
    if (!hover) return null;
    if (hover.kind === "region") return {
      name: hover.region.name,
      type: hover.region.port ? `${terrainLabel(hover.region.terrain)} · 港区` : terrainLabel(hover.region.terrain),
      rows: [
        ["辖属", hover.region.polityName ?? (hover.region.polityId ? "地方政权" : "无主之地")],
        ["人口", formatPopulation(hover.region.population)],
        ["粮况", foodDescription(hover.region.foodRatio)],
      ],
    };
    if (hover.kind === "regionNode") return {
      name: hover.region.name,
      type: hover.nodeKind === "port" ? "港口 · 可点击" : hover.region.capital ? "都城 · 可点击" : "城邑 · 可点击",
      rows: [
        ["辖属", hover.region.polityName ?? (hover.region.polityId ? "地方政权" : "无主之地")],
        [hover.nodeKind === "port" ? "港级" : "城级", `${hover.nodeKind === "port" ? hover.region.portLevel ?? 1 : hover.region.cityLevel ?? 0}`],
        ["人口", formatPopulation(hover.region.population)],
      ],
    };
    if (hover.kind === "army") return {
      name: hover.army.name,
      type: "军团 · 可点击",
      rows: [["兵力", formatPopulation(hover.army.strength)], ["士气", `${Math.round(hover.army.morale ?? 0)}`], ["状态", hover.army.status ?? "驻军"]],
    };
    if (hover.kind === "fleet") return {
      name: hover.fleet.name,
      type: "水师 · 可点击",
      rows: [["舰力", formatPopulation(hover.fleet.strength)], ["战备", `${Math.round(hover.fleet.readiness)}`], ["任务", hover.fleet.mission]],
    };
    if (hover.kind === "marker") return {
      name: hover.marker.label,
      type: hover.marker.kind === "outbreak" ? "疫病 · 可点击" : "技艺 · 可点击",
      rows: [["强度", `${Math.round(hover.marker.magnitude)}`]],
    };
    const flowNames: Record<MapFlowKind, string> = { trade: "商路", migration: "迁徙", disease: "传播", knowledge: "知识", naval: "航路" };
    return {
      name: hover.flow.label,
      type: `${flowNames[hover.flow.kind]} · 可点击`,
      rows: [["规模", formatPopulation(hover.flow.magnitude)]],
    };
  }, [hover]);

  return (
    <div
      ref={hostRef}
      className={`world-map${className ? ` ${className}` : ""}`}
      data-overlay={overlay}
      data-map-layout="reference-topology-v3"
      data-major-landform-count="3"
      data-landmass-count="2"
      data-island-shape-count="6"
      data-highlighted-region-count={highlightedRegionIds.length}
      data-map-zoom={camera.zoom.toFixed(3)}
      data-map-pan-x={camera.panX.toFixed(1)}
      data-map-pan-y={camera.panY.toFixed(1)}
      data-pannable={camera.zoom > MAP_MIN_ZOOM + 0.0001 || undefined}
      data-dragging={dragging || undefined}
      data-hover-object={Boolean(hover) || undefined}
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
          <span className="world-map__gesture-hint-desktop">点州域、军团或水师查看 · 滚轮缩放</span>
          <span className="world-map__gesture-hint-touch">轻点州域、军团或水师速览 · 双指缩放</span>
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

      {hover && hoverTooltip && tooltipStyle ? (
        <div className="world-map__tooltip" style={tooltipStyle} aria-hidden="true">
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
