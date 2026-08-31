import { useCallback, useMemo, useReducer } from 'react';
import type { ObserverView } from '../components/NavigationRail';
import type { PowerRosterSection } from './observer-shell-contract';
import {
  createObserverNavigationState,
  observerLayerIsInJourney,
  observerLayerIsOpen,
  observerNavigationIsBlocking,
  observerPageIsVisible,
  reduceObserverNavigation,
  selectedObserverEventId,
  topObserverLayer,
  type ObserverLayer,
  type ObserverLayerKind,
  type ObserverNavigationState,
} from './observer-navigation';

export interface ObserverNavigationController {
  state: ObserverNavigationState;
  activeView: ObserverView;
  powerRosterSection: PowerRosterSection;
  topLayer: ObserverLayer | null;
  selectedEventId: string | null;
  blocking: boolean;
  goToView: (view: ObserverView, section?: PowerRosterSection) => void;
  setPowerRosterSection: (section: PowerRosterSection) => void;
  openLayer: (layer: ObserverLayer, preserveCurrent?: boolean) => void;
  replaceTopLayer: (layer: ObserverLayer) => void;
  openEvent: (eventId: string, preserveCurrent?: boolean) => void;
  closeTopLayer: () => void;
  closeAllLayers: () => void;
  reset: (state: ObserverNavigationState) => void;
  isLayerOpen: (kind: ObserverLayer['kind']) => boolean;
  isLayerInJourney: (kind: ObserverLayer['kind']) => boolean;
  isPageVisible: (view: ObserverView) => boolean;
}

export function useObserverNavigation(): ObserverNavigationController {
  const [state, dispatch] = useReducer(
    reduceObserverNavigation,
    undefined,
    () => createObserverNavigationState(),
  );
  const goToView = useCallback((view: ObserverView, section?: PowerRosterSection) => {
    dispatch({ type: 'go-to-view', view, section });
  }, []);
  const setPowerRosterSection = useCallback((section: PowerRosterSection) => {
    dispatch({ type: 'set-power-section', section });
  }, []);
  const openLayer = useCallback((layer: ObserverLayer, preserveCurrent = false) => {
    dispatch({ type: 'open-layer', layer, preserveCurrent });
  }, []);
  const openEvent = useCallback((eventId: string, preserveCurrent = false) => {
    dispatch({ type: 'open-layer', layer: { kind: 'event', eventId }, preserveCurrent });
  }, []);
  const replaceTopLayer = useCallback((layer: ObserverLayer) => {
    dispatch({ type: 'replace-top-layer', layer });
  }, []);
  const closeTopLayer = useCallback(() => dispatch({ type: 'close-top-layer' }), []);
  const closeAllLayers = useCallback(() => dispatch({ type: 'close-all-layers' }), []);
  const reset = useCallback((next: ObserverNavigationState) => {
    dispatch({ type: 'reset', state: next });
  }, []);
  const topLayer = topObserverLayer(state);
  const eventId = selectedObserverEventId(state);
  return useMemo(() => ({
    state,
    activeView: state.view,
    powerRosterSection: state.powerRosterSection,
    topLayer,
    selectedEventId: eventId,
    blocking: observerNavigationIsBlocking(state),
    goToView,
    setPowerRosterSection,
    openLayer,
    replaceTopLayer,
    openEvent,
    closeTopLayer,
    closeAllLayers,
    reset,
    isLayerOpen: (kind: ObserverLayerKind | 'event') => observerLayerIsOpen(state, kind),
    isLayerInJourney: (kind: ObserverLayerKind | 'event') => observerLayerIsInJourney(state, kind),
    isPageVisible: (view: ObserverView) => observerPageIsVisible(state, view),
  }), [
    closeAllLayers,
    closeTopLayer,
    eventId,
    goToView,
    openEvent,
    openLayer,
    replaceTopLayer,
    reset,
    setPowerRosterSection,
    state,
    topLayer,
  ]);
}
