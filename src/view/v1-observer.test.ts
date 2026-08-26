import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim';
import type { HistoryEvent, SimulationFact, WorldState } from '../sim/types';
import type { SituationState } from '../sim/situations/types';
import type { ObserverLeadContinuityState } from './observer-leads';
import {
  OBSERVER_DESK_SETTINGS_VERSION,
  MAX_OBSERVER_WATCH_ITEMS,
  MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES,
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
  worldToSituationPauseCandidates,
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

const SETTLED_TURN = 7;

function situationState(patch: Partial<SituationState> = {}): SituationState {
  const id = patch.id ?? 'situation-alpha';
  return {
    id,
    type: 'military_power_crisis',
    scopeKey: 'character-core',
    titleKey: 'military_power_crisis',
    status: 'open',
    phase: 'emerging',
    startedTurn: SETTLED_TURN,
    phaseSinceTurn: SETTLED_TURN,
    lastUpdatedTurn: SETTLED_TURN,
    resolvedTurn: null,
    tension: 64,
    momentum: 8,
    consecutivePhaseRiseTurns: 0,
    consecutivePhaseFallTurns: 0,
    consecutiveBelowResolutionTurns: 0,
    participants: {
      coreCharacterIds: ['character-core'],
      supportingCharacterIds: [],
      opposingCharacterIds: [],
      familyIds: [],
      factionIds: [],
      polityIds: ['polity-yan'],
      regionIds: ['region-capital'],
      armyIds: [],
      fleetIds: [],
    },
    executableActorIds: ['character-core'],
    signals: [],
    causalFactIds: ['fact-cause'],
    milestoneFactIds: [],
    recentChanges: [{
      turn: SETTLED_TURN,
      kind: 'formed',
      tension: 64,
      fromPhase: null,
      toPhase: 'emerging',
      sourceFactIds: ['fact-cause'],
    }],
    possibleOutcomes: [],
    nextWatch: { key: 'watch-command', refs: [{ kind: 'fact', factId: 'fact-cause' }] },
    startSnapshot: {
      turn: SETTLED_TURN,
      pressure: 64,
      participantDigest: 'participants',
      evidenceDigest: 'evidence',
    },
    resolution: null,
    importance: 4,
    visibility: 80,
    ...patch,
  };
}

function milestoneFact(
  id: string,
  situation: SituationState,
  transition: 'formed' | 'phase_changed' | 'resolved',
): Extract<SimulationFact, { kind: 'situation_milestone' }> {
  const change = situation.recentChanges.find((item) => (
    item.turn === SETTLED_TURN
    && item.kind === (transition === 'phase_changed' ? 'phase_changed' : transition)
  ));
  return {
    id,
    turn: SETTLED_TURN,
    year: 2,
    season: '冬',
    kind: 'situation_milestone',
    category: situation.type === 'war_progress' ? '军事' : '政治',
    importance: transition === 'resolved' ? 4 : 3,
    actorIds: [...situation.participants.coreCharacterIds],
    polityIds: [...situation.participants.polityIds],
    regionIds: [...situation.participants.regionIds],
    causes: [],
    stateDeltas: [],
    sourceFactIds: ['fact-cause'],
    payload: {
      situationId: situation.id,
      situationType: situation.type,
      transition,
      fromPhase: change?.fromPhase ?? null,
      toPhase: change?.toPhase ?? null,
      tension: situation.tension,
      momentum: situation.momentum,
      outcomeKey: transition === 'resolved' ? situation.resolution?.outcomeKey ?? 'dissipated' : null,
    },
  };
}

function deathFact(characterId: string, id = 'fact-death'): Extract<SimulationFact, { kind: 'character_death' }> {
  return {
    id,
    turn: SETTLED_TURN,
    year: 2,
    season: '冬',
    kind: 'character_death',
    category: '政治',
    importance: 4,
    actorIds: [characterId],
    polityIds: [],
    regionIds: [],
    causes: [],
    stateDeltas: [{ entityType: 'character', entityId: characterId, field: 'alive', before: true, after: false }],
    sourceFactIds: [],
    payload: { characterId, age: 63, role: '君主', health: 0, diseaseId: null },
  };
}

function worldWithSituationFacts(
  situations: SituationState[],
  facts: SimulationFact[],
  factIds: string[] = facts.map((fact) => fact.id),
): WorldState {
  const world = createWorld('观察局势暂停测试');
  world.turn = SETTLED_TURN + 1;
  world.year = 3;
  world.season = '春';
  world.facts = facts;
  world.situationSystem = {
    ...world.situationSystem,
    lastReducedTurn: SETTLED_TURN,
    situations,
  };
  world.lastTurn = {
    turn: SETTLED_TURN,
    year: 2,
    season: '冬',
    factIds,
  } as NonNullable<WorldState['lastTurn']>;
  return world;
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

  it('migrates v2 settings to v3 and preserves stable Situation watches', () => {
    const settings = normalizeObserverDeskSettings({
      version: 2,
      watchlist: [
        { kind: 'situation', id: ' situation-0007 ', label: '北军军权之争', detail: '临界', alert: true },
        { kind: 'situation', id: 'situation-0007', label: '重复项', detail: '', alert: false },
      ],
      pauseRules: {
        enabled: true,
        watchlistHits: true,
      },
    });

    expect(settings.version).toBe(3);
    expect(settings.pauseRules.situationChanges).toBe(true);
    expect(settings.watchlist).toEqual([{
      kind: 'situation',
      id: 'situation-0007',
      label: '北军军权之争',
      detail: '临界',
      alert: true,
    }]);
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

  it('keeps Situation watch alerts isolated across local branch settings', () => {
    const base = createObserverDeskSettings();
    const branchA = upsertObserverWatch(base, {
      kind: 'situation', id: 'situation-a', label: '甲线', detail: '发展', alert: false,
    });
    const branchB = upsertObserverWatch(base, {
      kind: 'situation', id: 'situation-b', label: '乙线', detail: '萌芽', alert: false,
    });
    const situation = situationState({ id: 'situation-a', milestoneFactIds: ['fact-formed-a'] });
    const fact = milestoneFact('fact-formed-a', situation, 'formed');
    const [candidate] = worldToSituationPauseCandidates(worldWithSituationFacts([situation], [fact]));
    const alertedA = applyObserverEventAlerts(branchA, [candidate]);
    const alertedB = applyObserverEventAlerts(branchB, [candidate]);

    expect(base.watchlist).toEqual([]);
    expect(alertedA.watchlist[0].alert).toBe(true);
    expect(alertedB.watchlist[0].alert).toBe(false);
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

describe('C03/C04 authoritative Situation pause projection', () => {
  it('uses lastTurn Fact ids instead of the next world cursor and rejects invalid Situation ids', () => {
    const valid = situationState({ id: 'situation-valid', milestoneFactIds: ['fact-valid'] });
    const validFact = milestoneFact('fact-valid', valid, 'formed');
    const unlistedFact = milestoneFact('fact-not-in-report', valid, 'formed');
    const missingSituationFact = {
      ...milestoneFact('fact-missing-situation', valid, 'formed'),
      payload: {
        ...milestoneFact('fact-missing-situation', valid, 'formed').payload,
        situationId: 'situation-does-not-exist',
      },
    };
    const staleFact = { ...milestoneFact('fact-stale', valid, 'formed'), turn: SETTLED_TURN - 1 };
    const world = worldWithSituationFacts(
      [valid],
      [validFact, unlistedFact, missingSituationFact, staleFact],
      ['fact-valid', 'fact-missing-situation', 'fact-stale'],
    );
    const before = JSON.stringify(world);

    const candidates = worldToSituationPauseCandidates(world);

    expect(world.turn).toBe(SETTLED_TURN + 1);
    expect(candidates).toEqual([
      expect.objectContaining({
        situationId: 'situation-valid',
        situationTrigger: 'formation',
        sourceFactId: 'fact-valid',
        refs: [{ kind: 'situation', id: 'situation-valid' }],
      }),
    ]);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('derives and orders resolution, core death, phase change and formation deterministically', () => {
    const world = createWorld('观察局势人物');
    const deceased = world.characters[0];
    deceased.alive = false;
    deceased.deathTurn = SETTLED_TURN;

    const resolved = situationState({
      id: 'situation-resolved',
      status: 'resolved',
      phase: 'critical',
      startedTurn: 1,
      resolvedTurn: SETTLED_TURN,
      milestoneFactIds: ['fact-resolved'],
      recentChanges: [{
        turn: SETTLED_TURN, kind: 'resolved', tension: 71,
        fromPhase: 'critical', toPhase: null, sourceFactIds: ['fact-cause'],
      }],
      resolution: {
        outcomeKey: 'dissipated', resolvedTurn: SETTLED_TURN,
        resultFactIds: ['fact-cause'], belowThresholdTurns: 3, finalSnapshotDigest: 'resolved',
      },
    });
    const death = situationState({
      id: 'situation-death',
      startedTurn: 1,
      participants: {
        ...situationState().participants,
        coreCharacterIds: [deceased.id],
      },
      recentChanges: [],
    });
    const phase = situationState({
      id: 'situation-phase',
      phase: 'active',
      startedTurn: 1,
      phaseSinceTurn: SETTLED_TURN,
      milestoneFactIds: ['fact-phase'],
      recentChanges: [{
        turn: SETTLED_TURN, kind: 'phase_changed', tension: 72,
        fromPhase: 'emerging', toPhase: 'active', sourceFactIds: ['fact-cause'],
      }],
    });
    const formed = situationState({ id: 'situation-formed', milestoneFactIds: ['fact-formed'] });
    const facts: SimulationFact[] = [
      milestoneFact('fact-formed', formed, 'formed'),
      milestoneFact('fact-phase', phase, 'phase_changed'),
      deathFact(deceased.id),
      milestoneFact('fact-resolved', resolved, 'resolved'),
    ];
    const projectedWorld = worldWithSituationFacts([formed, phase, death, resolved], facts);
    const projectedDeceased = projectedWorld.characters.find((item) => item.id === deceased.id);
    if (!projectedDeceased) throw new Error('expected character fixture');
    projectedDeceased.alive = false;
    projectedDeceased.deathTurn = SETTLED_TURN;

    const candidates = worldToSituationPauseCandidates(projectedWorld);

    expect(candidates.map((candidate) => candidate.situationTrigger)).toEqual([
      'resolution', 'core-character-death', 'phase-change', 'formation',
    ]);
    expect(candidates[1]).toMatchObject({
      situationId: 'situation-death',
      sourceFactId: 'fact-death',
      refs: [{ kind: 'situation', id: 'situation-death' }],
    });
  });

  it('ignores non-core, stale and invalid character deaths', () => {
    const world = createWorld('观察无关人物死亡');
    const deceased = world.characters[0];
    const unrelated = world.characters[1];
    deceased.alive = false;
    deceased.deathTurn = SETTLED_TURN;
    const active = situationState({
      id: 'situation-active',
      startedTurn: 1,
      participants: {
        ...situationState().participants,
        coreCharacterIds: [unrelated.id],
      },
      recentChanges: [],
    });
    const staleResolved = situationState({
      id: 'situation-stale',
      status: 'resolved',
      startedTurn: 1,
      resolvedTurn: SETTLED_TURN - 1,
      participants: {
        ...situationState().participants,
        coreCharacterIds: [deceased.id],
      },
      recentChanges: [],
    });
    const facts: SimulationFact[] = [deathFact(deceased.id), deathFact('character-invalid', 'fact-invalid-death')];
    const projected = worldWithSituationFacts([active, staleResolved], facts);
    const projectedDeceased = projected.characters.find((item) => item.id === deceased.id);
    if (!projectedDeceased) throw new Error('expected character fixture');
    projectedDeceased.alive = false;
    projectedDeceased.deathTurn = SETTLED_TURN;

    expect(worldToSituationPauseCandidates(projected)).toEqual([]);
  });

  it('pauses only an exactly watched Situation and never falls through generic rules', () => {
    const situation = situationState({ id: 'situation-exact', milestoneFactIds: ['fact-exact'] });
    const fact = milestoneFact('fact-exact', situation, 'formed');
    const [candidate] = worldToSituationPauseCandidates(worldWithSituationFacts([situation], [fact]));
    const proxyWatch = upsertObserverWatch(createObserverDeskSettings(), {
      kind: 'person', id: 'character-core', label: '代理人物', detail: '', alert: false,
    });
    const otherSituation = upsertObserverWatch(createObserverDeskSettings(), {
      kind: 'situation', id: 'situation-other-branch', label: '另一分支', detail: '', alert: false,
    });
    const exactWatch = upsertObserverWatch(createObserverDeskSettings(), {
      kind: 'situation', id: 'situation-exact', label: '军权之争', detail: '', alert: false,
    });

    expect(evaluateObserverPause(proxyWatch, [candidate])).toBeNull();
    expect(evaluateObserverPause(otherSituation, [candidate])).toBeNull();
    expect(evaluateObserverPause(exactWatch, [candidate])).toMatchObject({
      rule: 'situationChanges',
      situationId: 'situation-exact',
      situationTrigger: 'formation',
      sourceFactId: 'fact-exact',
      watchMatches: [expect.objectContaining({ kind: 'situation', id: 'situation-exact' })],
    });

    const disabled = normalizeObserverDeskSettings({
      ...exactWatch,
      pauseRules: {
        ...exactWatch.pauseRules,
        situationChanges: false,
        watchlistHits: true,
        majorHistory: true,
        importanceThreshold: 2,
      },
    });
    expect(evaluateObserverPause(disabled, [candidate])).toBeNull();
    expect(applyObserverEventAlerts(disabled, [candidate]).watchlist[0].alert).toBe(true);
  });

  it('does not let a generic Chronicle event impersonate a Situation watch hit', () => {
    const watched = upsertObserverWatch(createObserverDeskSettings(), {
      kind: 'situation', id: 'situation-exact', label: '军权之争', detail: '', alert: false,
    });
    const generic = historyEventToPauseCandidate(historyEvent({
      id: 'event-situation-copy',
      kind: 'situation_milestone',
      title: '史册中的局势文案',
      importance: 4,
      actorIds: [],
      polityIds: [],
      regionIds: [],
      causes: [],
      stateDeltas: [{
        entityType: 'situation', entityId: 'situation-exact', field: 'phase', before: 'emerging', after: 'active',
      }],
    }));
    const genericOnly = normalizeObserverDeskSettings({
      ...watched,
      pauseRules: {
        ...watched.pauseRules,
        wars: false,
        powerTransfers: false,
        outbreaks: false,
        majorHistory: false,
        situationChanges: true,
        watchlistHits: true,
      },
    });

    expect(generic.refs).not.toContainEqual({ kind: 'situation', id: 'situation-exact' });
    expect(evaluateObserverPause(genericOnly, [generic])).toBeNull();
    expect(applyObserverEventAlerts(genericOnly, [generic]).watchlist[0].alert).toBe(false);
  });

  it('chooses the highest-priority watched change independently of candidate order', () => {
    const formed = situationState({ id: 'situation-priority', milestoneFactIds: ['fact-formed-priority'] });
    const resolved = situationState({
      ...formed,
      status: 'resolved',
      phase: 'critical',
      resolvedTurn: SETTLED_TURN,
      milestoneFactIds: ['fact-resolved-priority'],
      recentChanges: [{
        turn: SETTLED_TURN, kind: 'resolved', tension: 70,
        fromPhase: 'critical', toPhase: null, sourceFactIds: ['fact-cause'],
      }],
      resolution: {
        outcomeKey: 'dissipated', resolvedTurn: SETTLED_TURN,
        resultFactIds: ['fact-cause'], belowThresholdTurns: 3, finalSnapshotDigest: 'resolved',
      },
    });
    const formationCandidate = worldToSituationPauseCandidates(worldWithSituationFacts(
      [formed], [milestoneFact('fact-formed-priority', formed, 'formed')],
    ))[0];
    const resolutionCandidate = worldToSituationPauseCandidates(worldWithSituationFacts(
      [resolved], [milestoneFact('fact-resolved-priority', resolved, 'resolved')],
    ))[0];
    const watched = upsertObserverWatch(createObserverDeskSettings(), {
      kind: 'situation', id: 'situation-priority', label: '优先级局势', detail: '', alert: false,
    });

    expect(evaluateObserverPause(watched, [formationCandidate, resolutionCandidate])).toMatchObject({
      rule: 'situationChanges',
      situationTrigger: 'resolution',
      sourceFactId: 'fact-resolved-priority',
    });
  });

  it('bounds a hostile current-quarter projection without mutating WorldState', () => {
    const situations = Array.from({ length: MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES + 9 }, (_, index) => (
      situationState({
        id: `situation-${String(index).padStart(3, '0')}`,
        milestoneFactIds: [`fact-${String(index).padStart(3, '0')}`],
      })
    ));
    const facts = situations.map((situation, index) => (
      milestoneFact(`fact-${String(index).padStart(3, '0')}`, situation, 'formed')
    ));
    const world = worldWithSituationFacts(situations, facts);
    const before = JSON.stringify(world);

    const first = worldToSituationPauseCandidates(world);
    const second = worldToSituationPauseCandidates(world);

    expect(first).toHaveLength(MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES);
    expect(first).toEqual(second);
    expect(first[0].situationId).toBe('situation-000');
    expect(first.at(-1)?.situationId).toBe(`situation-${String(MAX_OBSERVER_SITUATION_PAUSE_CANDIDATES - 1).padStart(3, '0')}`);
    expect(JSON.stringify(world)).toBe(before);
  });
});
