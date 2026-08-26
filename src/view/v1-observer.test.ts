import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '../sim/types';
import type { ObserverLeadContinuityState } from './observer-leads';
import {
  OBSERVER_DESK_SETTINGS_VERSION,
  MAX_OBSERVER_WATCH_ITEMS,
  applyObserverEventAlerts,
  completeObserverGuideStep,
  createObserverDeskSettings,
  evaluateObserverPause,
  historyEventToPauseCandidate,
  normalizeObserverDeskSettings,
  observerGuideProgress,
  parseObserverDeskSettings,
  removeObserverWatch,
  serializeObserverDeskSettings,
  setObserverWatchAlert,
  upsertObserverWatch,
} from './v1-observer';

function historyEvent(patch: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: 'event-1',
    turn: 4,
    year: 2,
    season: '春',
    category: '政治',
    kind: 'succession',
    title: '少主继位',
    summary: '旧君亡故，少主在摄政安排下继位。',
    importance: 4,
    actorIds: ['character-heir'],
    polityIds: ['polity-yan'],
    regionIds: ['region-capital'],
    causes: [{
      label: '谱系',
      weight: 1,
      evidence: '继承人谱系可查',
      refs: [{ kind: 'entity', entityType: 'fleet', entityId: 'fleet-guard', label: '护送舰队' }],
    }],
    evidence: [],
    stateDeltas: [{
      entityType: 'family',
      entityId: 'family-zhao',
      field: 'headId',
      before: 'character-old',
      after: 'character-heir',
    }],
    ...patch,
    sourceFactIds: patch.sourceFactIds ?? [],
    situationIds: patch.situationIds ?? [],
  };
}

describe('V1 observer desk persistence', () => {
  it('returns independent defaults for malformed localStorage JSON', () => {
    const first = parseObserverDeskSettings('{not-json');
    const second = parseObserverDeskSettings(null);
    first.watchlist.push({ kind: 'person', id: 'changed', label: '甲', detail: '', alert: false });

    expect(second).toEqual(createObserverDeskSettings());
    expect(second.watchlist).toHaveLength(0);
  });

  it('normalizes hostile or stale fields, deduplicates and bounds the watchlist', () => {
    const watchlist = Array.from({ length: MAX_OBSERVER_WATCH_ITEMS + 8 }, (_, index) => ({
      kind: 'person',
      id: ` person-${index} `,
      label: `人物${index}`,
      detail: 42,
      alert: index === 0,
    }));
    watchlist.splice(1, 0, { ...watchlist[0] });
    const settings = normalizeObserverDeskSettings({
      version: 99,
      watchlist: [...watchlist, { kind: 'forged', id: 'x', label: '伪造' }],
      pauseRules: { importanceThreshold: 99, wars: false, enabled: 'yes' },
      guide: { completedSteps: ['world-opened', 'world-opened', 'unknown'], dismissed: true },
    });

    expect(settings.version).toBe(OBSERVER_DESK_SETTINGS_VERSION);
    expect(settings.watchlist).toHaveLength(MAX_OBSERVER_WATCH_ITEMS);
    expect(settings.watchlist[0]).toEqual({ kind: 'person', id: 'person-0', label: '人物0', detail: '', alert: true });
    expect(settings.pauseRules).toMatchObject({ enabled: true, wars: false, importanceThreshold: 5 });
    expect(settings.guide).toEqual({ completedSteps: ['world-opened'], dismissed: true });
    expect(parseObserverDeskSettings(serializeObserverDeskSettings(settings))).toEqual(settings);
  });

  it('round-trips bounded lead continuity and detaches it from caller-owned data', () => {
    const continuity: ObserverLeadContinuityState = {
      version: 1,
      worldSeed: ' 春战副将 ',
      lastTurn: 8,
      lastWorldHash: 'hash-turn-8',
      slots: [
        {
          slot: 'person', leadId: 'lead-situation:situation-person', situationId: 'situation-person',
          selectedSinceTurn: 6, retainThroughTurn: 99, challengerId: null, challengerAheadTurns: 0,
          decision: 'incumbent_stable',
        },
        {
          slot: 'polity', leadId: 'lead-situation:situation-polity', situationId: 'situation-polity',
          selectedSinceTurn: 7, retainThroughTurn: 99, challengerId: 'lead-situation:challenger', challengerAheadTurns: 1,
          decision: 'critical_challenger_pending',
        },
        {
          slot: 'tension', leadId: 'lead-tension-region:r_yanjing', situationId: null,
          selectedSinceTurn: 8, retainThroughTurn: 99, challengerId: null, challengerAheadTurns: 2,
          decision: 'legacy_fallback',
        },
      ],
    };
    const settings = normalizeObserverDeskSettings({
      ...createObserverDeskSettings(),
      leadContinuity: continuity,
    });
    const restored = parseObserverDeskSettings(serializeObserverDeskSettings(settings));

    expect(restored.version).toBe(OBSERVER_DESK_SETTINGS_VERSION);
    expect(restored.leadContinuity).toEqual({
      ...continuity,
      slots: [
        { ...continuity.slots[0], retainThroughTurn: 8 },
        { ...continuity.slots[1], retainThroughTurn: 9 },
        { ...continuity.slots[2], retainThroughTurn: 10, challengerAheadTurns: 0 },
      ],
    });
    expect(restored.leadContinuity).not.toBe(continuity);
    expect(restored.leadContinuity?.slots).not.toBe(continuity.slots);
    continuity.slots[0].leadId = 'mutated-after-normalize';
    expect(restored.leadContinuity?.slots[0].leadId).toBe('lead-situation:situation-person');
  });

  it('rejects incomplete or duplicated continuity slots without disturbing other observer settings', () => {
    const settings = normalizeObserverDeskSettings({
      ...createObserverDeskSettings(),
      watchlist: [{ kind: 'person', id: 'character-1', label: '赵衡' }],
      leadContinuity: {
        version: 1,
        worldSeed: '春战副将',
        lastTurn: 8,
        lastWorldHash: 'hash-turn-8',
        slots: [
          { slot: 'person', leadId: 'lead-person:a', selectedSinceTurn: 7, challengerAheadTurns: 0 },
          { slot: 'person', leadId: 'lead-person:b', selectedSinceTurn: 7, challengerAheadTurns: 0 },
          { slot: 'tension', leadId: 'lead-tension-region:r_yanjing', selectedSinceTurn: 7, challengerAheadTurns: 0 },
        ],
      },
    });

    expect(settings.leadContinuity).toBeNull();
    expect(settings.watchlist).toEqual([
      expect.objectContaining({ kind: 'person', id: 'character-1', label: '赵衡' }),
    ]);
  });

  it('adds, replaces, removes and clears watch items without mutating the input', () => {
    const original = createObserverDeskSettings();
    const added = upsertObserverWatch(original, {
      kind: 'person', id: 'character-1', label: '赵衡', detail: '燕国将领', alert: true,
    });
    const replaced = upsertObserverWatch(added, {
      kind: 'person', id: 'character-1', label: '赵衡', detail: '北军主帅', alert: true,
    });
    const cleared = setObserverWatchAlert(replaced, 'person', 'character-1', false);
    const removed = removeObserverWatch(cleared, 'person', 'character-1');

    expect(original.watchlist).toHaveLength(0);
    expect(added.guide.completedSteps).toContain('entity-watched');
    expect(replaced.watchlist).toEqual([expect.objectContaining({ detail: '北军主帅' })]);
    expect(cleared.watchlist[0].alert).toBe(false);
    expect(removed.watchlist).toHaveLength(0);
  });

  it('records the five real guide actions once and reports completion', () => {
    let settings = createObserverDeskSettings();
    for (const step of ['world-opened', 'quarter-advanced', 'overlay-switched', 'cause-traced', 'entity-watched'] as const) {
      settings = completeObserverGuideStep(settings, step);
      settings = completeObserverGuideStep(settings, step);
    }
    expect(settings.guide.completedSteps).toHaveLength(5);
    expect(observerGuideProgress(settings)).toEqual({ completed: 5, total: 5, percent: 100 });
  });
});

describe('V1 observer pause decisions', () => {
  it('derives power-transfer signals and every watchable reference from history evidence', () => {
    const candidate = historyEventToPauseCandidate(historyEvent());
    expect(candidate.signals).toContain('power-transfer');
    expect(candidate.refs).toEqual(expect.arrayContaining([
      { kind: 'person', id: 'character-heir' },
      { kind: 'country', id: 'polity-yan' },
      { kind: 'region', id: 'region-capital' },
      { kind: 'family', id: 'family-zhao' },
      { kind: 'fleet', id: 'fleet-guard' },
    ]));
  });

  it('prioritizes a watch hit, marks its alert and then respects disabled rules', () => {
    const watched = upsertObserverWatch(createObserverDeskSettings(), {
      kind: 'person', id: 'character-heir', label: '赵衡', detail: '储君', alert: false,
    });
    const candidate = historyEventToPauseCandidate(historyEvent());
    const match = evaluateObserverPause(watched, [candidate]);
    const alerted = applyObserverEventAlerts(watched, [candidate]);

    expect(match).toMatchObject({ rule: 'watchlistHits', eventId: 'event-1' });
    expect(match?.watchMatches[0].label).toBe('赵衡');
    expect(alerted.watchlist[0].alert).toBe(true);
    expect(evaluateObserverPause({
      ...watched,
      pauseRules: { ...watched.pauseRules, enabled: false },
    }, [candidate])).toBeNull();
  });

  it('detects war and epidemic changes independently of the major-event threshold', () => {
    const settings = normalizeObserverDeskSettings({
      ...createObserverDeskSettings(),
      pauseRules: {
        ...createObserverDeskSettings().pauseRules,
        watchlistHits: false,
        majorHistory: false,
      },
    });
    const war = historyEventToPauseCandidate(historyEvent({
      id: 'event-war', kind: 'war_declared', category: '军事', title: '两国开战', importance: 2,
    }));
    const disease = historyEventToPauseCandidate(historyEvent({
      id: 'event-plague', kind: 'outbreak_detected', category: '疾病', title: '疫病暴发', importance: 2,
    }));

    expect(evaluateObserverPause(settings, [war])?.rule).toBe('wars');
    expect(evaluateObserverPause(settings, [disease])?.rule).toBe('outbreaks');
  });
});
