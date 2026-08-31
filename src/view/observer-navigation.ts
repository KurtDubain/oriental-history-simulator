import type { ObserverView } from '../components/NavigationRail';

export type PowerRosterSection = 'polities' | 'families' | 'military';

/** A selection is observer-only navigation state and never enters WorldState. */
export type Selection =
  | { kind: 'region'; id: string }
  | { kind: 'country'; id: string; initialTab?: 'court'; tabRequestKey?: number }
  | { kind: 'family'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'seaZone'; id: string }
  | { kind: 'army'; id: string }
  | { kind: 'fleet'; id: string }
  | { kind: 'tradeCorridor'; id: string }
  | { kind: 'practice'; id: string }
  | { kind: 'outbreak'; id: string }
  | { kind: 'migration'; id: string }
  | null;

export type ObserverLayerKind =
  | 'start'
  | 'primer'
  | 'archive'
  | 'mandate'
  | 'observer-desk'
  | 'situations'
  | 'settings'
  | 'collection';

export type ObserverLayer =
  | { kind: Exclude<ObserverLayerKind, 'archive' | 'situations'> }
  | { kind: 'archive'; subject: Extract<NonNullable<Selection>, { kind: 'country' | 'family' | 'person' }> }
  | { kind: 'situations'; situationId: string }
  | { kind: 'event'; eventId: string };

export interface ObserverNavigationState {
  view: ObserverView;
  powerRosterSection: PowerRosterSection;
  layers: ObserverLayer[];
}

export type ObserverNavigationAction =
  | { type: 'go-to-view'; view: ObserverView; section?: PowerRosterSection }
  | { type: 'set-power-section'; section: PowerRosterSection }
  | { type: 'open-layer'; layer: ObserverLayer; preserveCurrent?: boolean }
  | { type: 'replace-top-layer'; layer: ObserverLayer }
  | { type: 'close-top-layer' }
  | { type: 'close-all-layers' }
  | { type: 'reset'; state: ObserverNavigationState };

export function createObserverNavigationState(
  patch: Partial<ObserverNavigationState> = {},
): ObserverNavigationState {
  const requestedLayers = patch.layers ?? [{ kind: 'start' } satisfies ObserverLayer];
  const layers = requestedLayers.reduce<ObserverLayer[]>((journey, layer) => {
    if (!validLayer(layer)) return journey;
    if (journey.length === 1 && canPreserveJourney(journey[0], layer)) {
      return [journey[0], { ...layer }];
    }
    return [{ ...layer }];
  }, []);
  return {
    view: patch.view ?? 'world',
    powerRosterSection: patch.powerRosterSection ?? 'polities',
    layers,
  };
}

function validLayer(layer: ObserverLayer): boolean {
  if (layer.kind === 'event') return layer.eventId.trim().length > 0;
  if (layer.kind === 'situations') return layer.situationId.trim().length > 0;
  if (layer.kind === 'archive') return layer.subject.id.trim().length > 0;
  return true;
}

function canPreserveJourney(parent: ObserverLayer | undefined, child: ObserverLayer): boolean {
  if (!parent) return false;
  if (parent.kind === 'start' && child.kind === 'collection') return true;
  return child.kind === 'event'
    && (parent.kind === 'archive' || parent.kind === 'situations');
}

/**
 * Owns observer-only page transitions. A layer is visible only when it is at
 * the top of the stack, so impossible combinations cannot be represented.
 * Parent layers remain in the stack only for an intentional return journey.
 */
export function reduceObserverNavigation(
  state: ObserverNavigationState,
  action: ObserverNavigationAction,
): ObserverNavigationState {
  if (action.type === 'go-to-view') {
    return {
      view: action.view,
      powerRosterSection: action.section ?? state.powerRosterSection,
      layers: [],
    };
  }
  if (action.type === 'set-power-section') {
    return { ...state, powerRosterSection: action.section };
  }
  if (action.type === 'open-layer') {
    if (!validLayer(action.layer)) return state;
    const layers = action.preserveCurrent
      && state.layers.length === 1
      && canPreserveJourney(state.layers[0], action.layer)
      ? [...state.layers, { ...action.layer }]
      : [{ ...action.layer }];
    return { ...state, layers };
  }
  if (action.type === 'replace-top-layer') {
    if (!validLayer(action.layer)) return state;
    const parent = state.layers.length === 2 ? state.layers[0] : undefined;
    return {
      ...state,
      layers: parent && canPreserveJourney(parent, action.layer)
        ? [parent, { ...action.layer }]
        : [{ ...action.layer }],
    };
  }
  if (action.type === 'close-top-layer') {
    return state.layers.length
      ? { ...state, layers: state.layers.slice(0, -1) }
      : state;
  }
  if (action.type === 'close-all-layers') {
    return state.layers.length ? { ...state, layers: [] } : state;
  }
  return createObserverNavigationState(action.state);
}

export function topObserverLayer(state: ObserverNavigationState): ObserverLayer | null {
  return state.layers.at(-1) ?? null;
}

export function observerLayerIsOpen(
  state: ObserverNavigationState,
  kind: ObserverLayer['kind'],
): boolean {
  return topObserverLayer(state)?.kind === kind;
}

export function observerLayerIsInJourney(
  state: ObserverNavigationState,
  kind: ObserverLayer['kind'],
): boolean {
  return state.layers.some((layer) => layer.kind === kind);
}

export function selectedObserverEventId(state: ObserverNavigationState): string | null {
  const layer = topObserverLayer(state);
  return layer?.kind === 'event' ? layer.eventId : null;
}

export function observerPageIsVisible(
  state: ObserverNavigationState,
  view: ObserverView,
): boolean {
  return state.view === view && state.layers.length === 0;
}

export function observerNavigationIsBlocking(state: ObserverNavigationState): boolean {
  return state.layers.length > 0 || state.view === 'chronicle';
}
