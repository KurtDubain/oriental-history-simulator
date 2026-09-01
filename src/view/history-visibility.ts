import type { HistoryEvent } from '../sim/types';

export const DEFAULT_HIDDEN_HISTORY_KIND_PREFIXES = ['situation_'] as const;

/**
 * Situation milestones are detector bookkeeping, not player-facing history.
 * Authoritative events remain in saves and hashes; ordinary chronicles surface
 * the concrete facts that those milestones wrap.
 */
export function isDefaultVisibleHistoryEvent(event: HistoryEvent): boolean {
  return DEFAULT_HIDDEN_HISTORY_KIND_PREFIXES.every((prefix) => !event.kind.startsWith(prefix));
}
