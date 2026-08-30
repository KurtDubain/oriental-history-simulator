import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObserverView } from '../components/NavigationRail';
import type { PowerRosterSection } from './observer-shell-contract';

export const ROSTER_DOSSIER_MEDIA_QUERY = '(max-width: 840px)';
export const ROSTER_DOSSIER_COMPACT_MEDIA_QUERY = '(max-width: 760px)';

export interface RosterDossierReturnTarget {
  view: 'people' | 'powers';
  section: PowerRosterSection | null;
  itemId: string;
}

export interface RosterDossierFlow {
  returnTarget: RosterDossierReturnTarget | null;
  compactPresentation: boolean;
  begin: (itemId: string) => RosterDossierReturnTarget | null;
  clear: () => void;
  returnToRoster: () => RosterDossierReturnTarget | null;
}

export function createRosterDossierReturnTarget(
  activeView: ObserverView,
  section: PowerRosterSection,
  itemId: string,
  compactViewport: boolean,
): RosterDossierReturnTarget | null {
  if (!compactViewport || !itemId || (activeView !== 'people' && activeView !== 'powers')) return null;
  return {
    view: activeView,
    section: activeView === 'powers' ? section : null,
    itemId,
  };
}

export function focusRosterDossierReturnTarget(target: RosterDossierReturnTarget): boolean {
  if (typeof document === 'undefined') return false;
  const scope = document.querySelector<HTMLElement>(`.roster-panel[data-roster-scope="${target.view}"]`);
  const row = Array.from(scope?.querySelectorAll<HTMLElement>('[data-roster-id]') ?? [])
    .find((item) => item.dataset.rosterId === target.itemId);
  if (!row) {
    const fallback = scope?.querySelector<HTMLInputElement>('.roster-panel__search input')
      ?? scope?.querySelector<HTMLButtonElement>('.roster-panel__header > button');
    fallback?.focus({ preventScroll: true });
    return Boolean(fallback);
  }
  row.scrollIntoView({ block: 'nearest' });
  row.focus({ preventScroll: true });
  return true;
}

function matchesMedia(query: string): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches;
}

function restoreRosterFocusAfterCommit(target: RosterDossierReturnTarget): void {
  if (typeof window === 'undefined') return;
  const focus = () => focusRosterDossierReturnTarget(target);
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(focus));
  } else {
    window.setTimeout(focus, 0);
  }
}

/**
 * Owns one narrow-workspace return point from a roster into a dossier.
 *
 * The hook stores observer navigation only. Callers remain responsible for
 * changing the visible App surface with the returned target.
 */
export function useRosterDossierFlow(
  activeView: ObserverView,
  section: PowerRosterSection,
): RosterDossierFlow {
  const [returnTarget, setReturnTarget] = useState<RosterDossierReturnTarget | null>(null);
  const [compactPresentation, setCompactPresentation] = useState(
    () => matchesMedia(ROSTER_DOSSIER_COMPACT_MEDIA_QUERY),
  );
  const originTargetRef = useRef<RosterDossierReturnTarget | null>(null);
  const returnTargetRef = useRef<RosterDossierReturnTarget | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const dossierQuery = window.matchMedia(ROSTER_DOSSIER_MEDIA_QUERY);
    const compactQuery = window.matchMedia(ROSTER_DOSSIER_COMPACT_MEDIA_QUERY);
    const syncPresentation = () => {
      const next = dossierQuery.matches ? originTargetRef.current : null;
      returnTargetRef.current = next;
      setReturnTarget(next);
      setCompactPresentation(compactQuery.matches);
    };
    syncPresentation();
    dossierQuery.addEventListener('change', syncPresentation);
    compactQuery.addEventListener('change', syncPresentation);
    return () => {
      dossierQuery.removeEventListener('change', syncPresentation);
      compactQuery.removeEventListener('change', syncPresentation);
    };
  }, []);

  const begin = useCallback((itemId: string) => {
    const origin = createRosterDossierReturnTarget(activeView, section, itemId, true);
    originTargetRef.current = origin;
    const next = matchesMedia(ROSTER_DOSSIER_MEDIA_QUERY) ? origin : null;
    if (!origin) {
      returnTargetRef.current = null;
      setReturnTarget(null);
      return null;
    }
    returnTargetRef.current = next;
    setReturnTarget(next);
    return next;
  }, [activeView, section]);

  const clear = useCallback(() => {
    originTargetRef.current = null;
    returnTargetRef.current = null;
    setReturnTarget(null);
  }, []);

  const returnToRoster = useCallback(() => {
    const target = returnTargetRef.current;
    originTargetRef.current = null;
    returnTargetRef.current = null;
    setReturnTarget(null);
    if (target) restoreRosterFocusAfterCommit(target);
    return target;
  }, []);

  return { returnTarget, compactPresentation, begin, clear, returnToRoster };
}
