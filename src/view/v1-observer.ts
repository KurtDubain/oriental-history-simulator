import type { HistoryEvent, SimulationFact, WorldState } from '../sim/types';
import type { SituationState } from '../sim/situations/types';
import {
  normalizeObserverLeadContinuity,
  type ObserverLeadContinuityState,
} from './observer-leads';
import { projectSituationHistoricalScenes } from './historical-scenes';

export const OBSERVER_DESK_STORAGE_KEY = 'canghai-observer-desk-v1';
export const OBSERVER_DESK_SETTINGS_VERSION = 3 as const;
export const MAX_OBSERVER_WATCH_ITEMS = 32;
export const MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES = 32;

export type ObserverWatchKind =
  | 'country'
  | 'family'
  | 'person'
  | 'region'
  | 'seaZone'
  | 'army'
  | 'fleet'
  | 'tradeCorridor'
  | 'practice'
  | 'outbreak'
  | 'migration'
  | 'situation';

export interface ObserverWatchItem {
  kind: ObserverWatchKind;
  id: string;
  label: string;
  detail: string;
  alert: boolean;
}

export type ObserverGuideStepId =
  | 'world-opened'
  | 'quarter-advanced'
  | 'overlay-switched'
  | 'cause-traced'
  | 'entity-watched';

export interface ObserverPauseRules {
  enabled: boolean;
  majorHistory: boolean;
  importanceThreshold: 2 | 3 | 4 | 5;
  wars: boolean;
  powerTransfers: boolean;
  outbreaks: boolean;
  watchlistHits: boolean;
  situationChanges: boolean;
}

export interface ObserverGuideState {
  completedSteps: ObserverGuideStepId[];
  dismissed: boolean;
}

export interface ObserverDeskSettings {
  version: typeof OBSERVER_DESK_SETTINGS_VERSION;
  watchlist: ObserverWatchItem[];
  pauseRules: ObserverPauseRules;
  guide: ObserverGuideState;
  leadContinuity: ObserverLeadContinuityState | null;
}

export type ObserverSituationPauseTrigger =
  | 'formation'
  | 'phase-change'
  | 'core-character-death'
  | 'resolution';

export type ObserverPauseSignal = 'war' | 'power-transfer' | 'outbreak' | 'situation-change';

export interface ObserverPauseCandidate {
  id: string;
  title: string;
  importance: number;
  signals: ObserverPauseSignal[];
  refs: Array<{ kind: ObserverWatchKind; id: string }>;
  /** Present only for candidates projected from current-quarter authoritative Facts. */
  situationId?: string;
  situationTrigger?: ObserverSituationPauseTrigger;
  sourceFactId?: string;
}

export type ObserverPauseRuleId =
  | 'watchlistHits'
  | 'wars'
  | 'powerTransfers'
  | 'outbreaks'
  | 'situationChanges'
  | 'majorHistory';

export interface ObserverPauseMatch {
  eventId: string;
  eventTitle: string;
  rule: ObserverPauseRuleId;
  reason: string;
  watchMatches: ObserverWatchItem[];
  situationId?: string;
  situationTrigger?: ObserverSituationPauseTrigger;
  sourceFactId?: string;
}

export const OBSERVER_GUIDE_STEPS: ReadonlyArray<{
  id: ObserverGuideStepId;
  label: string;
  detail: string;
}> = [
  { id: 'world-opened', label: '开启一个世界', detail: '输入种子，让第一卷历史落笔。' },
  { id: 'quarter-advanced', label: '推进一个季度', detail: '观察人口、财政与人物选择如何共同结算。' },
  { id: 'overlay-switched', label: '切换舆图叠层', detail: '从疆界转到粮情、商路、疾疫或海权。' },
  { id: 'cause-traced', label: '追溯一次因果', detail: '在史册中打开“为什么”，核对证据与状态差量。' },
  { id: 'entity-watched', label: '关注一个对象', detail: '把人物、家族、政权或地区留在观察台。' },
] as const;

const WATCH_KINDS = new Set<ObserverWatchKind>([
  'country',
  'family',
  'person',
  'region',
  'seaZone',
  'army',
  'fleet',
  'tradeCorridor',
  'practice',
  'outbreak',
  'migration',
  'situation',
]);

const GUIDE_STEPS = new Set<ObserverGuideStepId>(OBSERVER_GUIDE_STEPS.map((step) => step.id));

const WAR_KINDS = new Set([
  'war_declared',
  'rebellion',
  'battle',
  'capital_fall',
  'amphibious_operation_prepared',
  'amphibious_landing',
  'polity_eliminated',
  'peace',
]);

const POWER_TRANSFER_KINDS = new Set([
  'coup',
  'succession',
  'usurpation',
  'regency',
  'rebellion',
  'polity_dissolved',
]);

const OUTBREAK_KINDS = new Set([
  'disease_imported',
  'outbreak_detected',
  'notable_person_ill',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeThreshold(value: unknown): ObserverPauseRules['importanceThreshold'] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 4;
  return Math.max(2, Math.min(5, Math.round(value))) as ObserverPauseRules['importanceThreshold'];
}

function parseWatchItem(value: unknown): ObserverWatchItem | null {
  if (!isRecord(value) || !WATCH_KINDS.has(value.kind as ObserverWatchKind)) return null;
  const id = safeText(value.id, 160);
  const label = safeText(value.label, 80);
  if (!id || !label) return null;
  return {
    kind: value.kind as ObserverWatchKind,
    id,
    label,
    detail: safeText(value.detail, 180),
    alert: safeBoolean(value.alert, false),
  };
}

export function createObserverDeskSettings(): ObserverDeskSettings {
  return {
    version: OBSERVER_DESK_SETTINGS_VERSION,
    watchlist: [],
    pauseRules: {
      enabled: true,
      majorHistory: true,
      importanceThreshold: 4,
      wars: true,
      powerTransfers: true,
      outbreaks: true,
      watchlistHits: true,
      situationChanges: true,
    },
    guide: { completedSteps: [], dismissed: false },
    leadContinuity: null,
  };
}

/** Safely normalizes unknown data without retaining caller-owned object references. */
export function normalizeObserverDeskSettings(value: unknown): ObserverDeskSettings {
  const defaults = createObserverDeskSettings();
  if (!isRecord(value)) return defaults;

  const rawWatchlist = Array.isArray(value.watchlist) ? value.watchlist : [];
  const seen = new Set<string>();
  const watchlist: ObserverWatchItem[] = [];
  for (const rawItem of rawWatchlist) {
    const item = parseWatchItem(rawItem);
    if (!item) continue;
    const key = observerWatchKey(item.kind, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    watchlist.push(item);
    if (watchlist.length >= MAX_OBSERVER_WATCH_ITEMS) break;
  }

  const rawRules = isRecord(value.pauseRules) ? value.pauseRules : {};
  const rawGuide = isRecord(value.guide) ? value.guide : {};
  const completedSteps = Array.isArray(rawGuide.completedSteps)
    ? rawGuide.completedSteps.filter((step): step is ObserverGuideStepId => (
      typeof step === 'string' && GUIDE_STEPS.has(step as ObserverGuideStepId)
    ))
    : [];

  return {
    version: OBSERVER_DESK_SETTINGS_VERSION,
    watchlist,
    pauseRules: {
      enabled: safeBoolean(rawRules.enabled, defaults.pauseRules.enabled),
      majorHistory: safeBoolean(rawRules.majorHistory, defaults.pauseRules.majorHistory),
      importanceThreshold: safeThreshold(rawRules.importanceThreshold),
      wars: safeBoolean(rawRules.wars, defaults.pauseRules.wars),
      powerTransfers: safeBoolean(rawRules.powerTransfers, defaults.pauseRules.powerTransfers),
      outbreaks: safeBoolean(rawRules.outbreaks, defaults.pauseRules.outbreaks),
      watchlistHits: safeBoolean(rawRules.watchlistHits, defaults.pauseRules.watchlistHits),
      situationChanges: safeBoolean(rawRules.situationChanges, defaults.pauseRules.situationChanges),
    },
    guide: {
      completedSteps: [...new Set(completedSteps)],
      dismissed: safeBoolean(rawGuide.dismissed, false),
    },
    leadContinuity: normalizeObserverLeadContinuity(value.leadContinuity),
  };
}

/** Accepts a localStorage JSON string or already-decoded unknown value and never throws. */
export function parseObserverDeskSettings(raw: unknown): ObserverDeskSettings {
  if (typeof raw !== 'string') return normalizeObserverDeskSettings(raw);
  try {
    return normalizeObserverDeskSettings(JSON.parse(raw) as unknown);
  } catch {
    return createObserverDeskSettings();
  }
}

export function serializeObserverDeskSettings(settings: ObserverDeskSettings): string {
  return JSON.stringify(normalizeObserverDeskSettings(settings));
}

export function observerWatchKey(kind: ObserverWatchKind, id: string): string {
  return `${kind}:${id}`;
}

export function upsertObserverWatch(
  settings: ObserverDeskSettings,
  item: ObserverWatchItem,
): ObserverDeskSettings {
  const normalized = parseWatchItem(item);
  if (!normalized) return normalizeObserverDeskSettings(settings);
  const key = observerWatchKey(normalized.kind, normalized.id);
  const withoutExisting = settings.watchlist.filter((candidate) => (
    observerWatchKey(candidate.kind, candidate.id) !== key
  ));
  return normalizeObserverDeskSettings({
    ...settings,
    watchlist: [normalized, ...withoutExisting].slice(0, MAX_OBSERVER_WATCH_ITEMS),
    guide: {
      ...settings.guide,
      completedSteps: [...settings.guide.completedSteps, 'entity-watched'],
    },
  });
}

export function removeObserverWatch(
  settings: ObserverDeskSettings,
  kind: ObserverWatchKind,
  id: string,
): ObserverDeskSettings {
  const key = observerWatchKey(kind, id);
  return normalizeObserverDeskSettings({
    ...settings,
    watchlist: settings.watchlist.filter((item) => observerWatchKey(item.kind, item.id) !== key),
  });
}

export function setObserverWatchAlert(
  settings: ObserverDeskSettings,
  kind: ObserverWatchKind,
  id: string,
  alert: boolean,
): ObserverDeskSettings {
  const key = observerWatchKey(kind, id);
  return normalizeObserverDeskSettings({
    ...settings,
    watchlist: settings.watchlist.map((item) => (
      observerWatchKey(item.kind, item.id) === key ? { ...item, alert } : item
    )),
  });
}

export function completeObserverGuideStep(
  settings: ObserverDeskSettings,
  step: ObserverGuideStepId,
): ObserverDeskSettings {
  if (!GUIDE_STEPS.has(step)) return normalizeObserverDeskSettings(settings);
  return normalizeObserverDeskSettings({
    ...settings,
    guide: {
      ...settings.guide,
      completedSteps: [...settings.guide.completedSteps, step],
    },
  });
}

export function observerGuideProgress(settings: ObserverDeskSettings): {
  completed: number;
  total: number;
  percent: number;
} {
  const completed = OBSERVER_GUIDE_STEPS.filter((step) => settings.guide.completedSteps.includes(step.id)).length;
  const total = OBSERVER_GUIDE_STEPS.length;
  return { completed, total, percent: Math.round((completed / total) * 100) };
}

const SITUATION_TRIGGER_PRIORITY: Readonly<Record<ObserverSituationPauseTrigger, number>> = {
  resolution: 0,
  'core-character-death': 1,
  'phase-change': 2,
  formation: 3,
};

const SITUATION_TRIGGER_LABEL: Readonly<Record<ObserverSituationPauseTrigger, string>> = {
  formation: '形成',
  'phase-change': '阶段变化',
  'core-character-death': '核心人物死亡',
  resolution: '结案',
};

const SITUATION_PHASE_LABEL = {
  emerging: '萌芽',
  active: '发展',
  critical: '临界',
} as const;

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function situationPauseTitle(world: WorldState, situation: SituationState): string {
  const polityName = (id: string | undefined) => (
    world.polities.find((item) => item.id === id)?.shortName
    ?? world.polities.find((item) => item.id === id)?.name
    ?? '未载政权'
  );
  const characterName = (id: string | undefined) => (
    world.characters.find((item) => item.id === id)?.name ?? '未载人物'
  );
  if (situation.type === 'military_power_crisis') {
    return `${characterName(situation.participants.coreCharacterIds[0])}与${polityName(situation.participants.polityIds[0])}的军权之争`;
  }
  if (situation.type === 'inheritance_crisis') {
    return `${polityName(situation.participants.polityIds[0])}的继承之局`;
  }
  if (situation.type === 'war_progress') {
    const war = world.wars.find((item) => item.id === situation.scopeKey);
    return war
      ? `${polityName(war.attackerId)}进攻${polityName(war.defenderId)}的战争进程`
      : '这场战争的进程';
  }
  return '这场历史局势';
}

function milestoneMatchesSituation(
  fact: Extract<SimulationFact, { kind: 'situation_milestone' }>,
  situation: SituationState,
  settledTurn: number,
): boolean {
  if (
    fact.turn !== settledTurn
    || fact.payload.situationType !== situation.type
    || !situation.milestoneFactIds.includes(fact.id)
  ) return false;

  if (fact.payload.transition === 'formed') {
    return situation.startedTurn === settledTurn
      && situation.recentChanges.some((change) => change.turn === settledTurn && change.kind === 'formed');
  }
  if (fact.payload.transition === 'resolved') {
    return situation.status === 'resolved'
      && situation.resolvedTurn === settledTurn
      && situation.recentChanges.some((change) => change.turn === settledTurn && change.kind === 'resolved');
  }
  return situation.recentChanges.some((change) => (
    change.turn === settledTurn
    && change.kind === 'phase_changed'
    && change.fromPhase === fact.payload.fromPhase
    && change.toPhase === fact.payload.toPhase
  ));
}

function milestoneTrigger(
  fact: Extract<SimulationFact, { kind: 'situation_milestone' }>,
): ObserverSituationPauseTrigger {
  if (fact.payload.transition === 'formed') return 'formation';
  if (fact.payload.transition === 'resolved') return 'resolution';
  return 'phase-change';
}

function milestoneCandidateTitle(
  world: WorldState,
  situation: SituationState,
  fact: Extract<SimulationFact, { kind: 'situation_milestone' }>,
): string {
  const scene = projectSituationHistoricalScenes(world, situation, 1, fact.turn)[0];
  if (scene) return scene.title;
  const title = situationPauseTitle(world, situation);
  if (fact.payload.transition === 'formed') return `${title}开始显形`;
  if (fact.payload.transition === 'resolved') return `${title}告一段落`;
  const phase = fact.payload.toPhase ? SITUATION_PHASE_LABEL[fact.payload.toPhase] : '未定';
  return `${title}转入${phase}`;
}

function situationPauseCandidate(
  situation: SituationState,
  trigger: ObserverSituationPauseTrigger,
  fact: SimulationFact,
  title: string,
): ObserverPauseCandidate {
  return {
    id: `situation-pause:${fact.id}:${situation.id}:${trigger}`,
    title,
    importance: fact.importance,
    signals: ['situation-change'],
    // Deliberately omit proxy people/polities. A Situation pause can only match
    // the stable Situation id that the player explicitly followed.
    refs: [{ kind: 'situation', id: situation.id }],
    situationId: situation.id,
    situationTrigger: trigger,
    sourceFactId: fact.id,
  };
}

/**
 * Projects the just-settled quarter's authoritative Situation/death Facts into
 * a bounded local pause contract. `world.turn` is the next simulation cursor;
 * `lastTurn.turn` plus its exact Fact ids define the only eligible quarter.
 */
export function worldToSituationPauseCandidates(world: WorldState): ObserverPauseCandidate[] {
  const report = world.lastTurn;
  if (!report) return [];

  const reportFactIds = new Set(report.factIds);
  const facts = world.facts.filter((fact) => (
    fact.turn === report.turn && reportFactIds.has(fact.id)
  ));
  const situationById = new Map(world.situationSystem.situations.map((item) => [item.id, item]));
  const candidates = new Map<string, ObserverPauseCandidate>();

  for (const fact of facts) {
    if (fact.kind !== 'situation_milestone') continue;
    const situation = situationById.get(fact.payload.situationId);
    if (!situation || !milestoneMatchesSituation(fact, situation, report.turn)) continue;
    const trigger = milestoneTrigger(fact);
    const candidate = situationPauseCandidate(
      situation,
      trigger,
      fact,
      milestoneCandidateTitle(world, situation, fact),
    );
    candidates.set(candidate.id, candidate);
  }

  const eligibleSituations = world.situationSystem.situations
    .filter((situation) => situation.status === 'open' || situation.resolvedTurn === report.turn)
    .sort((left, right) => stableCompare(left.id, right.id));
  for (const fact of facts) {
    if (fact.kind !== 'character_death') continue;
    const character = world.characters.find((item) => item.id === fact.payload.characterId);
    if (!character || character.alive || character.deathTurn !== report.turn) continue;
    for (const situation of eligibleSituations) {
      if (!situation.participants.coreCharacterIds.includes(character.id)) continue;
      const candidate = situationPauseCandidate(
        situation,
        'core-character-death',
        fact,
        `${situationPauseTitle(world, situation)}的核心人物${character.name}逝世`,
      );
      candidates.set(candidate.id, candidate);
    }
  }

  return [...candidates.values()]
    .sort((left, right) => {
      const priority = SITUATION_TRIGGER_PRIORITY[left.situationTrigger as ObserverSituationPauseTrigger]
        - SITUATION_TRIGGER_PRIORITY[right.situationTrigger as ObserverSituationPauseTrigger];
      if (priority !== 0) return priority;
      return stableCompare(
        `${left.sourceFactId ?? ''}\u241f${left.situationId ?? ''}`,
        `${right.sourceFactId ?? ''}\u241f${right.situationId ?? ''}`,
      );
    })
    .slice(0, MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES);
}

function watchKindFromEntityType(entityType: string): ObserverWatchKind | null {
  const mapped: Partial<Record<string, ObserverWatchKind>> = {
    polity: 'country',
    character: 'person',
    family: 'family',
    region: 'region',
    seaZone: 'seaZone',
    army: 'army',
    fleet: 'fleet',
    tradeCorridor: 'tradeCorridor',
    practice: 'practice',
    infection: 'outbreak',
    migration: 'migration',
  };
  return mapped[entityType] ?? null;
}

/** Converts an authoritative history event to the small, UI-owned pause contract. */
export function historyEventToPauseCandidate(event: HistoryEvent): ObserverPauseCandidate {
  const refs = new Map<string, { kind: ObserverWatchKind; id: string }>();
  const addRef = (kind: ObserverWatchKind | null, id: string) => {
    if (!kind || !id) return;
    refs.set(observerWatchKey(kind, id), { kind, id });
  };

  for (const id of event.actorIds) addRef('person', id);
  for (const id of event.polityIds) addRef('country', id);
  for (const id of event.regionIds) addRef('region', id);
  for (const delta of event.stateDeltas) addRef(watchKindFromEntityType(delta.entityType), delta.entityId);
  for (const cause of event.causes) {
    for (const ref of cause.refs ?? []) addRef(watchKindFromEntityType(ref.entityType), ref.entityId);
  }

  const signals: ObserverPauseSignal[] = [];
  if (WAR_KINDS.has(event.kind)) signals.push('war');
  if (POWER_TRANSFER_KINDS.has(event.kind)) signals.push('power-transfer');
  if (event.category === '疾病' || OUTBREAK_KINDS.has(event.kind)) signals.push('outbreak');

  return {
    id: event.id,
    title: event.title,
    importance: event.importance,
    signals,
    refs: [...refs.values()],
  };
}

function matchingWatchItems(
  watchlist: ObserverWatchItem[],
  candidate: ObserverPauseCandidate,
): ObserverWatchItem[] {
  const eventRefs = new Set(candidate.refs.map((ref) => observerWatchKey(ref.kind, ref.id)));
  const situationIdentity = validSituationCandidateIdentity(candidate);
  return watchlist.filter((item) => {
    if (item.kind === 'situation') {
      return situationIdentity !== null
        && item.id === situationIdentity.situationId
        && eventRefs.has(observerWatchKey(item.kind, item.id));
    }
    return eventRefs.has(observerWatchKey(item.kind, item.id));
  });
}

function validSituationCandidateIdentity(candidate: ObserverPauseCandidate): {
  situationId: string;
  trigger: ObserverSituationPauseTrigger;
} | null {
  const situationId = candidate.situationId;
  const trigger = candidate.situationTrigger;
  if (
    !situationId
    || !trigger
    || !(trigger in SITUATION_TRIGGER_PRIORITY)
    || !candidate.signals.includes('situation-change')
    || !candidate.refs.some((ref) => ref.kind === 'situation' && ref.id === situationId)
  ) return null;
  return { situationId, trigger };
}

/** Returns one deterministic pause reason; watched Situation changes use explicit priority. */
export function evaluateObserverPause(
  settings: ObserverDeskSettings,
  candidates: ObserverPauseCandidate[],
): ObserverPauseMatch | null {
  const normalized = normalizeObserverDeskSettings(settings);
  if (!normalized.pauseRules.enabled) return null;

  if (normalized.pauseRules.situationChanges) {
    const situationMatches = candidates.flatMap((candidate) => {
      const identity = validSituationCandidateIdentity(candidate);
      if (!identity) return [];
      const watchMatches = matchingWatchItems(normalized.watchlist, candidate)
        .filter((item) => item.kind === 'situation' && item.id === identity.situationId);
      return watchMatches.length > 0 ? [{ candidate, identity, watchMatches }] : [];
    }).sort((left, right) => {
      const priority = SITUATION_TRIGGER_PRIORITY[left.identity.trigger]
        - SITUATION_TRIGGER_PRIORITY[right.identity.trigger];
      return priority !== 0 ? priority : stableCompare(left.candidate.id, right.candidate.id);
    });
    const first = situationMatches[0];
    if (first) {
      return {
        eventId: first.candidate.id,
        eventTitle: first.candidate.title,
        rule: 'situationChanges',
        reason: `关注局势“${first.watchMatches[0].label}”发生${SITUATION_TRIGGER_LABEL[first.identity.trigger]}`,
        watchMatches: first.watchMatches,
        situationId: first.identity.situationId,
        situationTrigger: first.identity.trigger,
        sourceFactId: first.candidate.sourceFactId,
      };
    }
  }

  for (const candidate of candidates) {
    // Authoritative Situation candidates have an isolated rule path. They must
    // never fall through to generic watch-hit or major-history semantics.
    if (
      candidate.signals.includes('situation-change')
      || candidate.situationId !== undefined
      || candidate.situationTrigger !== undefined
    ) continue;
    const watchMatches = matchingWatchItems(normalized.watchlist, candidate);
    if (normalized.pauseRules.watchlistHits && watchMatches.length > 0) {
      return {
        eventId: candidate.id,
        eventTitle: candidate.title,
        rule: 'watchlistHits',
        reason: `关注对象“${watchMatches[0].label}”卷入史事`,
        watchMatches,
      };
    }
    if (normalized.pauseRules.wars && candidate.signals.includes('war')) {
      return { eventId: candidate.id, eventTitle: candidate.title, rule: 'wars', reason: '战争态势发生变化', watchMatches };
    }
    if (normalized.pauseRules.powerTransfers && candidate.signals.includes('power-transfer')) {
      return { eventId: candidate.id, eventTitle: candidate.title, rule: 'powerTransfers', reason: '发生政变、继承或政权转移', watchMatches };
    }
    if (normalized.pauseRules.outbreaks && candidate.signals.includes('outbreak')) {
      return { eventId: candidate.id, eventTitle: candidate.title, rule: 'outbreaks', reason: '出现新的疾疫变化', watchMatches };
    }
    if (
      normalized.pauseRules.majorHistory
      && candidate.importance >= normalized.pauseRules.importanceThreshold
    ) {
      return { eventId: candidate.id, eventTitle: candidate.title, rule: 'majorHistory', reason: `史事重要度达到 ${normalized.pauseRules.importanceThreshold}`, watchMatches };
    }
  }
  return null;
}

export function applyObserverEventAlerts(
  settings: ObserverDeskSettings,
  candidates: ObserverPauseCandidate[],
): ObserverDeskSettings {
  const hitKeys = new Set<string>();
  for (const candidate of candidates) {
    for (const item of matchingWatchItems(settings.watchlist, candidate)) {
      hitKeys.add(observerWatchKey(item.kind, item.id));
    }
  }
  return normalizeObserverDeskSettings({
    ...settings,
    watchlist: settings.watchlist.map((item) => ({
      ...item,
      alert: item.alert || hitKeys.has(observerWatchKey(item.kind, item.id)),
    })),
  });
}
