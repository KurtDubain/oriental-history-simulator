import { describe, expect, it } from 'vitest';
import type { SimulationFact } from '../facts';
import { stableStringify } from '../random';
import {
  attachSituationMilestoneFacts,
  createSituationSystemState,
  reduceSituationTurn,
  validateSituationSystemState,
} from './reducer';
import type {
  SituationCandidateObservation,
  SituationDetector,
  SituationLimits,
  SituationSystemState,
  SituationTemplate,
} from './types';

interface TestIndex {
  observations: readonly SituationCandidateObservation[];
}

const TEMPLATE: SituationTemplate = {
  type: 'test-crisis',
  titleKey: 'situation.test-crisis',
  formationThreshold: 50,
  activeEnterThreshold: 60,
  activeExitThreshold: 45,
  criticalEnterThreshold: 80,
  criticalExitThreshold: 65,
  resolutionThreshold: 20,
  formationConfirmTurns: 2,
  phaseConfirmTurns: 2,
  coolingConfirmTurns: 2,
  resolveAfterBelowTurns: 3,
  reformationCooldownTurns: 2,
  maxTensionRisePerTurn: 100,
  maxTensionFallPerTurn: 100,
};

const DETECTOR: SituationDetector<TestIndex> = {
  id: 'test-detector',
  detect: ({ index }) => index.observations,
};

function fact(turn: number, id = `fact_${turn}`): SimulationFact {
  return { id, turn } as SimulationFact;
}

function observation(
  scopeKey: string,
  pressure: number,
  factId?: string,
  overrides: Partial<SituationCandidateObservation> = {},
): SituationCandidateObservation {
  return {
    type: 'test-crisis',
    scopeKey,
    pressure,
    participants: {
      coreCharacterIds: [`character_${scopeKey}`],
      polityIds: [`polity_${scopeKey}`],
    },
    executableActorIds: [],
    signals: [
      {
        key: 'structural-a',
        role: 'structural',
        contribution: 45,
        refs: [
          { kind: 'index', entityType: 'polity', entityId: scopeKey, field: 'authority', value: 35 },
          ...(factId ? ([{ kind: 'fact', factId }] as const) : []),
        ],
      },
      {
        key: 'structural-b',
        role: 'structural',
        contribution: 40,
        refs: [
          { kind: 'index', entityType: 'army', entityId: scopeKey, field: 'loyalty', value: 30 },
        ],
      },
    ],
    nextWatch: {
      key: 'watch-executable-actor',
      refs: [
        { kind: 'index', entityType: 'character', entityId: scopeKey, field: 'ambition', value: 70 },
      ],
    },
    possibleOutcomes: [{ key: 'settled', confidence: 30 }],
    ...overrides,
  };
}

function step(
  state: SituationSystemState,
  turn: number,
  observations: readonly SituationCandidateObservation[],
  facts: readonly SimulationFact[] = [],
  overrides: Partial<SituationLimits> = {},
) {
  return reduceSituationTurn(
    state,
    { turn, facts, index: { observations }, detectors: [DETECTOR] },
    { templates: [TEMPLATE], limits: overrides },
  );
}

describe('Situation reducer', () => {
  it('accepts engine turn zero from the default genesis state', () => {
    const result = reduceSituationTurn(
      createSituationSystemState(),
      { turn: 0, facts: [], index: { observations: [] }, detectors: [DETECTOR] },
      { templates: [TEMPLATE] },
    );
    expect(result.state.lastReducedTurn).toBe(0);
  });

  it('requires two consecutive qualifying quarters and carries bounded prior Fact evidence', () => {
    const firstFact = fact(1, 'battle_spring');
    const afterSpring = step(
      createSituationSystemState(0),
      1,
      [observation('north', 72, firstFact.id)],
      [firstFact],
    );
    expect(afterSpring.state.situations).toHaveLength(0);
    expect(afterSpring.state.candidates[0]?.consecutiveQualifyingTurns).toBe(1);

    const afterQuietSummer = step(
      afterSpring.state,
      2,
      [observation('north', 68)],
    );
    expect(afterQuietSummer.state.situations).toHaveLength(1);
    expect(afterQuietSummer.state.situations[0]?.causalFactIds).toEqual(['battle_spring']);
    expect(afterQuietSummer.state.situations[0]?.milestoneFactIds).toEqual([]);
    expect(afterQuietSummer.transitions[0]?.sourceFactIds).toEqual(['battle_spring']);

    const formed = afterQuietSummer.transitions[0];
    const milestoneFact = {
      id: 'situation_milestone_north',
      turn: 2,
      kind: 'situation_milestone',
      payload: {
        situationId: formed?.situationId ?? '',
        transition: 'formed',
      },
    } as unknown as SimulationFact;
    const attached = attachSituationMilestoneFacts(
      afterQuietSummer.state,
      [{
        situationId: formed?.situationId ?? '',
        turn: 2,
        transitionKind: 'formed',
        milestoneFactIds: [milestoneFact.id],
      }],
      [milestoneFact],
    );
    expect(attached.situations[0]?.milestoneFactIds).toEqual([milestoneFact.id]);
    expect(() => attachSituationMilestoneFacts(
      afterQuietSummer.state,
      [{
        situationId: formed?.situationId ?? '',
        turn: 2,
        transitionKind: 'resolved',
        milestoneFactIds: [milestoneFact.id],
      }],
      [milestoneFact],
    )).toThrow(/payload does not match attachment/);

    let noFactEvidence = step(createSituationSystemState(0), 1, [observation('unproven', 80)]);
    noFactEvidence = step(noFactEvidence.state, 2, [observation('unproven', 80)]);
    expect(noFactEvidence.state.situations).toHaveLength(0);

    const spikeFact = fact(1, 'single_spike');
    const spike = step(
      createSituationSystemState(0),
      1,
      [observation('east', 95, spikeFact.id)],
      [spikeFact],
    );
    const afterGap = step(spike.state, 2, []);
    const afterReturn = step(afterGap.state, 3, [observation('east', 95)]);
    expect(afterReturn.state.situations).toHaveLength(0);
    expect(afterReturn.state.candidates[0]?.consecutiveQualifyingTurns).toBe(1);
  });

  it('merges detector output deterministically and does not expose Chronicle input', () => {
    let contextHadHistory = false;
    const springFact = fact(1, 'battle_merge');
    const left: SituationDetector<TestIndex> = {
      id: 'left',
      detect: (context) => {
        contextHadHistory ||= 'history' in context;
        return [
          observation('court', 60, springFact.id, {
            participants: { coreCharacterIds: ['z', 'a'] },
          }),
        ];
      },
    };
    const right: SituationDetector<TestIndex> = {
      id: 'right',
      detect: (context) => {
        contextHadHistory ||= 'history' in context;
        return [
          observation('court', 80, springFact.id, {
            participants: { coreCharacterIds: ['m', 'a'] },
          }),
        ];
      },
    };
    const input = { turn: 1, facts: [springFact], index: { observations: [] } };
    const first = reduceSituationTurn(
      createSituationSystemState(0),
      { ...input, detectors: [left, right] },
      { templates: [TEMPLATE] },
    );
    const second = reduceSituationTurn(
      createSituationSystemState(0),
      { ...input, detectors: [right, left] },
      { templates: [TEMPLATE] },
    );
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(first.state.candidates[0]?.latestPressure).toBe(80);
    expect(first.state.candidates[0]?.observation.participants?.coreCharacterIds).toEqual([
      'a',
      'm',
      'z',
    ]);
    expect(contextHadHistory).toBe(false);
  });

  it('uses phase hysteresis, requires an executable critical actor, and freezes resolved records', () => {
    const springFact = fact(1, 'battle_phase');
    let result = step(
      createSituationSystemState(0),
      1,
      [observation('phase', 90, springFact.id, { executableActorIds: ['general'] })],
      [springFact],
    );
    result = step(result.state, 2, [observation('phase', 90, undefined, { executableActorIds: ['general'] })]);
    expect(result.state.situations[0]?.phase).toBe('emerging');
    result = step(result.state, 3, [observation('phase', 90, undefined, { executableActorIds: ['general'] })]);
    expect(result.state.situations[0]?.phase).toBe('emerging');
    result = step(result.state, 4, [observation('phase', 90, undefined, { executableActorIds: ['general'] })]);
    expect(result.state.situations[0]?.phase).toBe('active');
    expect(result.transitions[0]?.sourceFactIds).toEqual(['battle_phase']);
    result = step(result.state, 5, [observation('phase', 90, undefined, { executableActorIds: ['general'] })]);
    result = step(result.state, 6, [observation('phase', 90, undefined, { executableActorIds: ['general'] })]);
    expect(result.state.situations[0]?.phase).toBe('critical');

    result = step(result.state, 7, [observation('phase', 90)]);
    expect(result.state.situations[0]?.phase).toBe('active');
    result = step(result.state, 8, [observation('phase', 30)]);
    expect(result.state.situations[0]?.phase).toBe('active');
    result = step(result.state, 9, [observation('phase', 30)]);
    expect(result.state.situations[0]?.phase).toBe('emerging');
    result = step(result.state, 10, [observation('phase', 0)]);
    result = step(result.state, 11, [observation('phase', 0)]);
    result = step(result.state, 12, [observation('phase', 0)]);
    const resolved = result.state.situations[0];
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution?.outcomeKey).toBe('dissipated');
    expect(result.transitions[0]?.sourceFactIds).toEqual(['battle_phase']);
    const frozenRecord = stableStringify(resolved);

    result = step(result.state, 13, [observation('phase', 95)]);
    expect(stableStringify(result.state.situations[0])).toBe(frozenRecord);
  });

  it('accepts explicit resolution only when it points to a current-turn Fact', () => {
    const firstFact = fact(1, 'battle_resolution_seed');
    let result = step(
      createSituationSystemState(0),
      1,
      [observation('resolve', 70, firstFact.id)],
      [firstFact],
    );
    result = step(result.state, 2, [observation('resolve', 70)]);
    expect(() =>
      step(
        result.state,
        3,
        [
          observation('resolve', 70, undefined, {
            resolution: { outcomeKey: 'arrested', resultFactIds: ['missing_fact'] },
          }),
        ],
      ),
    ).toThrow(/current-turn Fact/);

    const resultFact = fact(3, 'appointment_arrest');
    result = step(
      result.state,
      3,
      [
        observation('resolve', 70, resultFact.id, {
          resolution: { outcomeKey: 'arrested', resultFactIds: [resultFact.id] },
        }),
      ],
      [resultFact],
    );
    expect(result.state.situations[0]?.resolution?.resultFactIds).toEqual([resultFact.id]);
  });

  it('collapses a same-turn critical phase drop and explicit resolution into one public transition', () => {
    const firstFact = fact(1, 'battle_critical_resolution');
    const pressured = (turn: number) => observation(
      'critical-resolution',
      90,
      turn === 1 ? firstFact.id : undefined,
      { executableActorIds: ['general'] },
    );
    let result = step(createSituationSystemState(0), 1, [pressured(1)], [firstFact]);
    for (let turn = 2; turn <= 6; turn += 1) result = step(result.state, turn, [pressured(turn)]);
    expect(result.state.situations[0]?.phase).toBe('critical');

    const deathFact = fact(7, 'death_critical_general');
    result = step(
      result.state,
      7,
      [
        observation('critical-resolution', 90, deathFact.id, {
          executableActorIds: [],
          resolution: { outcomeKey: 'actor_died', resultFactIds: [deathFact.id] },
        }),
      ],
      [deathFact],
    );

    const changes = result.state.situations[0]?.recentChanges.filter((change) => change.turn === 7);
    expect(changes?.map((change) => change.kind)).toEqual(['resolved']);
    expect(changes?.[0]).toMatchObject({ fromPhase: 'critical', toPhase: 'active' });
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      kind: 'resolved',
      fromPhase: 'critical',
      toPhase: 'active',
      outcomeKey: 'actor_died',
    });
  });

  it('enforces deterministic open, candidate, participant, signal, outcome, and recent-change caps', () => {
    const limits: Partial<SituationLimits> = {
      maxOpenSituations: 2,
      maxCandidates: 3,
      maxSignals: 4,
      maxSignalRefs: 2,
      maxRecentChanges: 2,
      maxPossibleOutcomes: 2,
      maxCoreCharacterIds: 3,
    };
    const firstFact = fact(1, 'battle_caps');
    const many = Array.from({ length: 5 }, (_, index) =>
      observation(`scope_${index}`, 60 + index, firstFact.id, {
        participants: {
          coreCharacterIds: Array.from({ length: 20 }, (__, participant) => `c_${participant}`),
        },
        signals: Array.from({ length: 20 }, (__, signal) => ({
          key: `structural_${String(signal).padStart(2, '0')}`,
          role: 'structural' as const,
          contribution: 100 - signal,
          refs: [
            { kind: 'index' as const, entityType: 'scope', entityId: String(index), field: String(signal), value: signal },
            ...(signal === 0
              ? ([{ kind: 'fact' as const, factId: firstFact.id }] as const)
              : []),
          ],
        })),
        possibleOutcomes: Array.from({ length: 8 }, (__, outcome) => ({
          key: `outcome_${outcome}`,
          confidence: 90 - outcome,
        })),
      }),
    );
    let result = step(createSituationSystemState(0), 1, many, [firstFact], limits);
    expect(result.state.candidates).toHaveLength(3);
    const quietMany = many.map((entry) => ({
      ...entry,
      signals: entry.signals.map((signal) => ({
        ...signal,
        refs: signal.refs.filter((ref) => ref.kind === 'index'),
      })),
    }));
    result = step(
      result.state,
      2,
      quietMany,
      [],
      limits,
    );
    expect(result.state.situations).toHaveLength(2);
    expect(result.state.situations.map((entry) => entry.scopeKey)).toEqual(['scope_4', 'scope_3']);
    const formed = result.state.situations[0];
    expect(formed?.signals.length).toBeLessThanOrEqual(4);
    expect(formed?.possibleOutcomes.length).toBeLessThanOrEqual(2);
    expect(formed?.participants.coreCharacterIds.length).toBeLessThanOrEqual(3);
    expect(formed?.recentChanges.length).toBeLessThanOrEqual(2);
    expect(validateSituationSystemState(result.state, limits)).toEqual([]);
  });

  it('bounds readable resolved history and folds overflow into a deterministic archive digest', () => {
    const limits: Partial<SituationLimits> = {
      maxOpenSituations: 1,
      maxResolvedSituations: 1,
      maxCandidates: 6,
    };
    let state = createSituationSystemState(0);
    for (const cycle of [0, 1, 2]) {
      const startTurn = cycle * 3 + 1;
      const scope = `archive_${cycle}`;
      const evidence = fact(startTurn, `battle_archive_${cycle}`);
      let result = step(
        state,
        startTurn,
        [observation(scope, 70, evidence.id)],
        [evidence],
        limits,
      );
      result = step(result.state, startTurn + 1, [observation(scope, 70)], [], limits);
      const resolution = fact(startTurn + 2, `resolution_archive_${cycle}`);
      result = step(
        result.state,
        startTurn + 2,
        [
          observation(scope, 70, resolution.id, {
            resolution: { outcomeKey: 'settled', resultFactIds: [resolution.id] },
          }),
        ],
        [resolution],
        limits,
      );
      state = result.state;
    }
    expect(state.situations.filter((entry) => entry.status === 'resolved')).toHaveLength(1);
    expect(state.archive.resolvedCount).toBe(2);
    expect(state.archive.resolvedDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(validateSituationSystemState(state, limits)).toEqual([]);
  });

  it('is pure with respect to the previous authoritative state', () => {
    const previous = createSituationSystemState(0);
    const before = stableStringify(previous);
    const firstFact = fact(1, 'battle_pure');
    step(previous, 1, [observation('pure', 70, firstFact.id)], [firstFact]);
    expect(stableStringify(previous)).toBe(before);
  });
});
