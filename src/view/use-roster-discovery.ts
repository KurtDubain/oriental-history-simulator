import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRosterDiscoveryStates,
  createRosterVisibleCounts,
  ROSTER_PAGE_SIZE,
  type RosterDiscoveryState,
  type RosterDiscoveryStateMap,
  type RosterScope,
  type RosterVisibleCountMap,
} from './roster-discovery';

export interface RosterDiscoveryController {
  states: RosterDiscoveryStateMap;
  visibleCounts: RosterVisibleCountMap;
  update: (scope: RosterScope, state: RosterDiscoveryState) => void;
  showMore: (scope: RosterScope) => void;
  reset: () => void;
}

/** Observer-only roster controls, kept outside WorldState and reset at world boundaries. */
export function useRosterDiscovery(worldIdentity: string | null): RosterDiscoveryController {
  const identityRef = useRef(worldIdentity);
  const [states, setStates] = useState<RosterDiscoveryStateMap>(() => createRosterDiscoveryStates());
  const [visibleCounts, setVisibleCounts] = useState<RosterVisibleCountMap>(() => createRosterVisibleCounts());

  useEffect(() => {
    if (identityRef.current === worldIdentity) return;
    identityRef.current = worldIdentity;
    setStates(createRosterDiscoveryStates());
    setVisibleCounts(createRosterVisibleCounts());
  }, [worldIdentity]);

  const update = useCallback((scope: RosterScope, state: RosterDiscoveryState) => {
    setStates((current) => ({ ...current, [scope]: state }));
    setVisibleCounts((current) => ({ ...current, [scope]: ROSTER_PAGE_SIZE }));
  }, []);
  const showMore = useCallback((scope: RosterScope) => {
    setVisibleCounts((current) => ({ ...current, [scope]: current[scope] + ROSTER_PAGE_SIZE }));
  }, []);
  const reset = useCallback(() => {
    setStates(createRosterDiscoveryStates());
    setVisibleCounts(createRosterVisibleCounts());
  }, []);

  return { states, visibleCounts, update, showMore, reset };
}
