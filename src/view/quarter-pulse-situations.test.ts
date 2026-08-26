import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim';
import type { SimulationFact, WorldState } from '../sim/types';
import type { SituationPhase, SituationState } from '../sim/situations';
import {
  MAX_QUARTER_PULSE_SITUATIONS,
  MIN_QUARTER_PULSE_TREND_DELTA,
  projectQuarterPulseSituations,
} from './quarter-pulse-situations';

const TURN = 7;

function testSituation(
  world: WorldState,
  id: string,
  patch: Partial<SituationState> = {},
): SituationState {
  const character = world.characters[0];
  const polity = world.polities[0];
  const region = world.regions[0];
  return {
    id,
    type: 'military_power_crisis',
    scopeKey: character.id,
    titleKey: 'military_power_crisis',
    status: 'open',
    phase: 'active',
    startedTurn: 3,
    phaseSinceTurn: TURN,
    lastUpdatedTurn: TURN,
    resolvedTurn: null,
    tension: 72,
    momentum: 10,
    consecutivePhaseRiseTurns: 0,
    consecutivePhaseFallTurns: 0,
    consecutiveBelowResolutionTurns: 0,
    participants: {
      coreCharacterIds: [character.id],
      supportingCharacterIds: [],
      opposingCharacterIds: [],
      familyIds: [],
      factionIds: [],
      polityIds: [polity.id],
      regionIds: [region.id],
      armyIds: [],
      fleetIds: [],
    },
    executableActorIds: [character.id],
    signals: [{
      key: 'weak_central_authority',
      role: 'structural',
      contribution: 14,
      refs: [{
        kind: 'index',
        entityType: 'polity',
        entityId: polity.id,
        field: 'authority',
        value: polity.authority,
      }],
    }],
    causalFactIds: ['fact-cause'],
    milestoneFactIds: [],
    recentChanges: [],
    possibleOutcomes: [],
    nextWatch: { key: 'watch_recall_or_refusal', refs: [] },
    startSnapshot: {
      turn: 3,
      pressure: 58,
      participantDigest: 'participants',
      evidenceDigest: 'evidence',
    },
    resolution: null,
    importance: 70,
    visibility: 80,
    ...patch,
  };
}

function milestoneFact(
  id: string,
  situation: SituationState,
  transition: 'formed' | 'phase_changed' | 'resolved',
  fromPhase: SituationPhase | null,
  toPhase: SituationPhase | null,
): Extract<SimulationFact, { kind: 'situation_milestone' }> {
  return {
    id,
    turn: TURN,
    year: 2,
    season: '冬',
    kind: 'situation_milestone',
    category: '政治',
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
      fromPhase,
      toPhase,
      tension: situation.tension,
      momentum: situation.momentum,
      outcomeKey: transition === 'resolved' ? situation.resolution?.outcomeKey ?? 'dissipated' : null,
    },
  };
}

function worldWith(
  situations: SituationState[],
  facts: SimulationFact[] = [],
  factIds: string[] = facts.map((fact) => fact.id),
): WorldState {
  const world = createWorld('C05季度局势投影');
  world.turn = TURN + 1;
  world.year = 3;
  world.season = '春';
  world.facts = facts;
  world.situationSystem = {
    ...world.situationSystem,
    lastReducedTurn: TURN,
    situations,
  };
  world.lastTurn = {
    turn: TURN,
    year: 2,
    season: '冬',
    factIds,
    eventIds: ['ordinary-history-event'],
  } as NonNullable<WorldState['lastTurn']>;
  return world;
}

function withMilestone(
  world: WorldState,
  id: string,
  kind: 'formed' | 'phase_changed' | 'resolved',
  fromPhase: SituationPhase | null,
  toPhase: SituationPhase | null,
  patch: Partial<SituationState> = {},
): { situation: SituationState; fact: Extract<SimulationFact, { kind: 'situation_milestone' }> } {
  const factId = `fact-${id}`;
  const situation = testSituation(world, id, {
    ...patch,
    milestoneFactIds: [factId],
    recentChanges: [{
      turn: TURN,
      kind,
      tension: patch.tension ?? 72,
      fromPhase,
      toPhase,
      sourceFactIds: ['fact-cause'],
    }],
  });
  return { situation, fact: milestoneFact(factId, situation, kind, fromPhase, toPhase) };
}

describe('C05 QuarterPulse Situation projection', () => {
  it('classifies only current authoritative lifecycle milestones as 新生、升温、降温与结案', () => {
    const labels = createWorld('C05局势四类');
    const formed = withMilestone(labels, 'situation-born', 'formed', null, 'emerging', {
      phase: 'emerging',
      tension: 63,
      momentum: 0,
      startedTurn: TURN,
    });
    const heated = withMilestone(labels, 'situation-heated', 'phase_changed', 'emerging', 'active', {
      phase: 'active',
      tension: 74,
      momentum: 7,
    });
    const cooled = withMilestone(labels, 'situation-cooled', 'phase_changed', 'critical', 'active', {
      phase: 'active',
      tension: 69,
      momentum: -6,
    });
    const resolved = withMilestone(labels, 'situation-resolved', 'resolved', 'active', 'active', {
      status: 'resolved',
      resolvedTurn: TURN,
      tension: 28,
      momentum: -12,
      resolution: {
        outcomeKey: 'submission',
        resolvedTurn: TURN,
        resultFactIds: ['fact-result'],
        belowThresholdTurns: 0,
        finalSnapshotDigest: 'resolved',
      },
    });
    const world = worldWith(
      [formed.situation, heated.situation, cooled.situation, resolved.situation],
      [formed.fact, heated.fact, cooled.fact, resolved.fact],
    );

    const projection = projectQuarterPulseSituations(world);

    expect(projection.map((item) => item.kind)).toEqual(['resolved', 'born', 'heated', 'cooled']);
    expect(projection.map((item) => item.basis)).toEqual(['lifecycle', 'lifecycle', 'phase', 'phase']);
    expect(projection.every((item) => item.milestoneFactId?.startsWith('fact-situation-'))).toBe(true);
    expect(projection[0]?.detail).toContain('重新归于朝廷');
    expect(projection[1]?.detail).toContain('进入萌芽');
    expect(projection[2]?.detail).toContain('萌芽→发展');
    expect(projection[3]?.detail).toContain('临界→发展');
  });

  it('uses persisted momentum for a substantial trend but keeps small or stale tension jitter silent', () => {
    const labels = createWorld('C05强走势');
    const heated = testSituation(labels, 'situation-trend-up', {
      tension: 76,
      momentum: MIN_QUARTER_PULSE_TREND_DELTA,
      importance: 80,
    });
    const cooled = testSituation(labels, 'situation-trend-down', {
      tension: 61,
      momentum: -11,
      importance: 70,
    });
    const jitter = testSituation(labels, 'situation-jitter', {
      tension: 68,
      momentum: MIN_QUARTER_PULSE_TREND_DELTA - 1,
    });
    const stale = testSituation(labels, 'situation-stale', {
      tension: 75,
      momentum: 16,
      lastUpdatedTurn: TURN - 1,
    });
    const world = worldWith([heated, cooled, jitter, stale]);

    const projection = projectQuarterPulseSituations(world);

    expect(projection.map((item) => [item.id, item.kind, item.basis])).toEqual([
      ['situation-trend-up', 'heated', 'trend'],
      ['situation-trend-down', 'cooled', 'trend'],
    ]);
    expect(projection[0]?.detail).toContain('张力 68→76（+8）');
    expect(projection[0]?.detail).toContain('中央权威不足');
    expect(projection[1]?.detail).toContain('张力 72→61（−11）');
  });

  it('rejects orphan, unlisted, and lifecycle-mismatched milestone Facts without mutating the world', () => {
    const labels = createWorld('C05坏证据降级');
    const validShape = withMilestone(labels, 'situation-mismatch', 'formed', null, 'emerging', {
      phase: 'emerging',
      tension: 64,
      momentum: 0,
      startedTurn: TURN,
    });
    validShape.situation.recentChanges = [{
      ...validShape.situation.recentChanges[0],
      kind: 'participants_changed',
      fromPhase: 'emerging',
    }];
    const orphan = milestoneFact('fact-orphan', testSituation(labels, 'missing-situation'), 'formed', null, 'emerging');
    const unlisted = milestoneFact('fact-unlisted', validShape.situation, 'formed', null, 'emerging');
    const world = worldWith(
      [validShape.situation],
      [validShape.fact, orphan, unlisted],
      [validShape.fact.id, orphan.id],
    );
    const before = JSON.stringify({
      situations: world.situationSystem,
      facts: world.facts,
      report: world.lastTurn,
      hash: world.hash,
    });

    expect(projectQuarterPulseSituations(world)).toEqual([]);
    expect(JSON.stringify({
      situations: world.situationSystem,
      facts: world.facts,
      report: world.lastTurn,
      hash: world.hash,
    })).toBe(before);
  });

  it('has deterministic ordering and a hard display cap', () => {
    const labels = createWorld('C05有界排序');
    const situations = Array.from({ length: MAX_QUARTER_PULSE_SITUATIONS + 3 }, (_, index) => (
      testSituation(labels, `situation-${String(index).padStart(2, '0')}`, {
        tension: 74,
        momentum: 10,
        importance: 70,
      })
    ));
    const world = worldWith(situations);

    const first = projectQuarterPulseSituations(world);
    const second = projectQuarterPulseSituations(world);

    expect(first).toEqual(second);
    expect(first).toHaveLength(MAX_QUARTER_PULSE_SITUATIONS);
    expect(first.map((item) => item.id)).toEqual([
      'situation-00',
      'situation-01',
      'situation-02',
      'situation-03',
    ]);
  });
});
