import { describe, expect, it } from 'vitest';
import {
  createObserverNavigationState,
  observerLayerIsInJourney,
  observerLayerIsOpen,
  observerPageIsVisible,
  reduceObserverNavigation,
  selectedObserverEventId,
} from './observer-navigation';

describe('observer navigation', () => {
  it('represents one visible layer while preserving an intentional return journey', () => {
    let state = createObserverNavigationState({ layers: [] });
    state = reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'archive', subject: { kind: 'person', id: 'person-1' } },
    });
    state = reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'event', eventId: 'event-7' },
      preserveCurrent: true,
    });

    expect(observerLayerIsOpen(state, 'event')).toBe(true);
    expect(observerLayerIsOpen(state, 'archive')).toBe(false);
    expect(observerLayerIsInJourney(state, 'archive')).toBe(true);
    expect(selectedObserverEventId(state)).toBe('event-7');

    state = reduceObserverNavigation(state, { type: 'close-top-layer' });
    expect(observerLayerIsOpen(state, 'archive')).toBe(true);
    expect(selectedObserverEventId(state)).toBeNull();
  });

  it('keeps the history page as the return target beneath event evidence', () => {
    let state = createObserverNavigationState({ view: 'chronicle', layers: [] });
    state = reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'event', eventId: 'event-9' },
      preserveCurrent: true,
    });

    expect(observerPageIsVisible(state, 'chronicle')).toBe(false);
    state = reduceObserverNavigation(state, { type: 'close-top-layer' });
    expect(observerPageIsVisible(state, 'chronicle')).toBe(true);
  });

  it('replaces unrelated layers and clears them on main-page navigation', () => {
    let state = createObserverNavigationState();
    state = reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'settings' },
    });
    expect(state.layers).toEqual([{ kind: 'settings' }]);

    state = reduceObserverNavigation(state, {
      type: 'go-to-view',
      view: 'powers',
      section: 'families',
    });
    expect(state).toEqual({ view: 'powers', powerRosterSection: 'families', layers: [] });
  });

  it('does not admit an event layer without an identity', () => {
    const state = createObserverNavigationState({ layers: [] });
    expect(reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'event', eventId: '   ' },
    })).toBe(state);
  });

  it('rejects arbitrary nested layers while allowing the world-menu collection journey', () => {
    let state = createObserverNavigationState();
    state = reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'archive', subject: { kind: 'person', id: 'person-1' } },
      preserveCurrent: true,
    });
    expect(state.layers).toEqual([{ kind: 'archive', subject: { kind: 'person', id: 'person-1' } }]);

    state = createObserverNavigationState();
    state = reduceObserverNavigation(state, {
      type: 'open-layer',
      layer: { kind: 'collection' },
      preserveCurrent: true,
    });
    expect(state.layers).toEqual([{ kind: 'start' }, { kind: 'collection' }]);
  });

  it('normalizes reset input to a legal journey no deeper than two layers', () => {
    const state = createObserverNavigationState({
      layers: [
        { kind: 'start' },
        { kind: 'settings' },
        { kind: 'event', eventId: 'event-1' },
      ],
    });
    expect(state.layers).toEqual([{ kind: 'event', eventId: 'event-1' }]);
  });
});
