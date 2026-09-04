import { stableCompare } from '../sim/random';

export type RosterScope = 'people' | 'polities' | 'families' | 'military';

export const ROSTER_PAGE_SIZE = 120;

export type RosterAttentionKind =
  | 'watched-alert'
  | 'critical-situation'
  | 'current-event'
  | 'watched'
  | 'open-situation'
  | 'recent-event'
  | 'urgent-status'
  | 'authority'
  | 'command'
  | 'standing';

export type RosterReasonTarget =
  | { kind: 'event'; id: string }
  | { kind: 'situation'; id: string }
  | { kind: 'item'; id: string };

export interface RosterReason {
  kind: RosterAttentionKind;
  label: string;
  target: RosterReasonTarget;
}

export interface RosterAttentionOrder {
  kind: RosterAttentionKind;
  phase: number;
  tension: number;
  turn: number;
  importance: number;
  value: number;
}

export interface RosterItemDiscovery {
  quickViews: readonly string[];
  filters: Readonly<Record<string, string>>;
  sortValues: Readonly<Record<string, number>>;
  attention: RosterAttentionOrder;
}

export interface RosterItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  accent?: string;
  alert?: boolean;
  reason?: RosterReason;
  discovery?: RosterItemDiscovery;
}

export interface RosterOption {
  id: string;
  label: string;
}

export interface RosterFilterDefinition {
  id: string;
  label: string;
  options: readonly RosterOption[];
}

export interface RosterSortDefinition extends RosterOption {
  direction: 'asc' | 'desc';
}

export interface RosterDiscoveryDefinition {
  scope: RosterScope;
  unitLabel: string;
  quickViews: readonly RosterOption[];
  filters: readonly RosterFilterDefinition[];
  sorts: readonly RosterSortDefinition[];
}

export interface RosterDiscoveryState {
  query: string;
  quickView: string;
  filters: Readonly<Record<string, string>>;
  sort: string;
}

export type RosterDiscoveryStateMap = Readonly<Record<RosterScope, RosterDiscoveryState>>;
export type RosterVisibleCountMap = Readonly<Record<RosterScope, number>>;

export interface RosterDiscoveryResult {
  state: RosterDiscoveryState;
  items: RosterItem[];
  totalCount: number;
  matchedCount: number;
  activeFilterCount: number;
  conditionLabels: string[];
  conditionSummary: string;
  emptyMessage: string;
}

const ATTENTION_PRIORITY: Readonly<Record<RosterAttentionKind, number>> = {
  'watched-alert': 0,
  'critical-situation': 1,
  'current-event': 2,
  watched: 3,
  'open-situation': 4,
  'recent-event': 5,
  'urgent-status': 6,
  authority: 7,
  command: 8,
  standing: 9,
};

export function createRosterDiscoveryState(scope?: RosterScope): RosterDiscoveryState {
  return { query: '', quickView: scope === 'people' ? 'living' : 'all', filters: {}, sort: 'attention' };
}

export function createRosterDiscoveryStates(): RosterDiscoveryStateMap {
  return {
    people: createRosterDiscoveryState('people'),
    polities: createRosterDiscoveryState(),
    families: createRosterDiscoveryState(),
    military: createRosterDiscoveryState(),
  };
}

export function createRosterVisibleCounts(): RosterVisibleCountMap {
  return {
    people: ROSTER_PAGE_SIZE,
    polities: ROSTER_PAGE_SIZE,
    families: ROSTER_PAGE_SIZE,
    military: ROSTER_PAGE_SIZE,
  };
}

function optionExists(options: readonly RosterOption[], id: string): boolean {
  return options.some((option) => option.id === id);
}

export function normalizeRosterDiscoveryState(
  definition: RosterDiscoveryDefinition,
  state: RosterDiscoveryState,
): RosterDiscoveryState {
  const quickView = optionExists(definition.quickViews, state.quickView) ? state.quickView : createRosterDiscoveryState(definition.scope).quickView;
  const sort = optionExists(definition.sorts, state.sort) ? state.sort : 'attention';
  const filters = Object.fromEntries(definition.filters.map((filter) => {
    const selected = state.filters[filter.id] ?? 'all';
    return [filter.id, optionExists(filter.options, selected) ? selected : 'all'];
  }));
  return { query: state.query, quickView, filters, sort };
}

function attentionCompare(left: RosterItem, right: RosterItem): number {
  const a = left.discovery?.attention;
  const b = right.discovery?.attention;
  if (!a && !b) return stableCompare(left.id, right.id);
  if (!a) return 1;
  if (!b) return -1;
  return ATTENTION_PRIORITY[a.kind] - ATTENTION_PRIORITY[b.kind]
    || a.phase - b.phase
    || b.tension - a.tension
    || b.turn - a.turn
    || b.importance - a.importance
    || b.value - a.value
    || stableCompare(left.id, right.id);
}

function matchesQuery(item: RosterItem, query: string): boolean {
  const tokens = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = `${item.title} ${item.subtitle} ${item.meta} ${item.reason?.label ?? ''}`
    .toLocaleLowerCase('zh-CN');
  return tokens.every((token) => haystack.includes(token));
}

function selectedOptionLabel(options: readonly RosterOption[], id: string): string | null {
  return options.find((option) => option.id === id)?.label ?? null;
}

export function applyRosterDiscovery(
  items: readonly RosterItem[],
  definition: RosterDiscoveryDefinition,
  rawState: RosterDiscoveryState,
): RosterDiscoveryResult {
  const state = normalizeRosterDiscoveryState(definition, rawState);
  const filtered = items.filter((item) => {
    if (!matchesQuery(item, state.query)) return false;
    if (state.quickView !== 'all' && !item.discovery?.quickViews.includes(state.quickView)) return false;
    return definition.filters.every((filter) => {
      const selected = state.filters[filter.id] ?? 'all';
      return selected === 'all' || item.discovery?.filters[filter.id] === selected;
    });
  });
  const sort = definition.sorts.find((option) => option.id === state.sort) ?? definition.sorts[0];
  filtered.sort((left, right) => {
    if (!sort || sort.id === 'attention') return attentionCompare(left, right);
    const a = left.discovery?.sortValues[sort.id] ?? 0;
    const b = right.discovery?.sortValues[sort.id] ?? 0;
    return (sort.direction === 'asc' ? a - b : b - a) || stableCompare(left.id, right.id);
  });

  const conditionLabels: string[] = [];
  if (state.query.trim()) conditionLabels.push(`检索“${state.query.trim()}”`);
  if (state.quickView !== 'all') {
    const label = selectedOptionLabel(definition.quickViews, state.quickView);
    if (label) conditionLabels.push(label);
  }
  for (const filter of definition.filters) {
    const selected = state.filters[filter.id] ?? 'all';
    if (selected === 'all') continue;
    const label = selectedOptionLabel(filter.options, selected);
    if (label) conditionLabels.push(label);
  }
  const sortLabel = selectedOptionLabel(definition.sorts, state.sort) ?? '值得关注';
  const activeFilterCount = conditionLabels.length + Number(state.sort !== 'attention');
  const narrowedBy = conditionLabels.length ? conditionLabels.join(' · ') : '当前条件';
  return {
    state,
    items: filtered,
    totalCount: items.length,
    matchedCount: filtered.length,
    activeFilterCount,
    conditionLabels,
    conditionSummary: `${filtered.length} / ${items.length} ${definition.unitLabel} · ${sortLabel}${conditionLabels.length ? ` · ${conditionLabels.join(' · ')}` : ''}`,
    emptyMessage: `没有符合${narrowedBy}的${definition.unitLabel}。可清除条件或换一种查看方式。`,
  };
}
