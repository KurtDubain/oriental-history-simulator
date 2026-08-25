import type { ObserverFocus, ObserverState } from './types';

export function createObserverState(): ObserverState {
  return { focused: null, followed: [] };
}

export function focusObserver(state: ObserverState, focus: ObserverFocus | null): ObserverState {
  return { ...state, focused: focus ? { ...focus } : null };
}

export function toggleFollow(state: ObserverState, focus: ObserverFocus): ObserverState {
  const exists = state.followed.some((item) => item.kind === focus.kind && item.id === focus.id);
  return {
    ...state,
    followed: exists
      ? state.followed.filter((item) => item.kind !== focus.kind || item.id !== focus.id)
      : [...state.followed, { ...focus }],
  };
}
