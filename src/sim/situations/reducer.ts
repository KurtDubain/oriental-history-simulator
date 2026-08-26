import { stableCompare, stableHash, stableStringify } from '../random';
import type { SimulationFact } from '../facts';
import {
  advanceCandidateRegistry,
  collectSituationCandidateObservations,
  normalizeSituationParticipants,
  observationsByCandidateKey,
  resolveSituationLimits,
  situationCandidateKey,
} from './candidate-registry';
import type {
  SituationCandidateObservation,
  SituationCandidateState,
  SituationLimits,
  SituationMilestoneAttachment,
  SituationPhase,
  SituationRecentChange,
  SituationReducerOptions,
  SituationState,
  SituationSystemState,
  SituationTemplate,
  SituationTransition,
  SituationTurnInput,
  SituationTurnResult,
} from './types';

const ARCHIVE_GENESIS = stableHash({ kind: 'situation-resolved-archive', version: 1 });

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedUniqueAppend(
  existing: readonly string[],
  additions: readonly string[],
  cap: number,
): string[] {
  const values = [...existing];
  for (const addition of [...new Set(additions)].sort(stableCompare)) {
    const previousIndex = values.indexOf(addition);
    if (previousIndex >= 0) values.splice(previousIndex, 1);
    values.push(addition);
  }
  return values.slice(-cap);
}

function appendRecentChange(
  previous: readonly SituationRecentChange[],
  change: SituationRecentChange,
  limits: SituationLimits,
): SituationRecentChange[] {
  return [...previous, change].slice(-limits.maxRecentChanges);
}

function evidenceFactIds(observation: SituationCandidateObservation): string[] {
  const ids = observation.signals.flatMap((signal) =>
    signal.refs.flatMap((ref) => (ref.kind === 'fact' ? [ref.factId] : [])),
  );
  ids.push(
    ...observation.nextWatch.refs.flatMap((ref) => (ref.kind === 'fact' ? [ref.factId] : [])),
    ...(observation.resolution?.resultFactIds ?? []),
  );
  return [...new Set(ids)].sort(stableCompare);
}

function validateTemplate(template: SituationTemplate): void {
  const thresholds: (keyof SituationTemplate)[] = [
    'formationThreshold',
    'activeEnterThreshold',
    'activeExitThreshold',
    'criticalEnterThreshold',
    'criticalExitThreshold',
    'resolutionThreshold',
  ];
  for (const key of thresholds) {
    const value = template[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Situation template ${template.type}.${key} must be between 0 and 100`);
    }
  }
  if (template.type.trim().length === 0 || template.titleKey.trim().length === 0) {
    throw new Error('Situation template type and titleKey must not be empty');
  }
  if (template.formationConfirmTurns < 2) {
    throw new Error(`Situation template ${template.type} must require at least two formation turns`);
  }
  const positiveIntegers: (keyof SituationTemplate)[] = [
    'formationConfirmTurns',
    'phaseConfirmTurns',
    'coolingConfirmTurns',
    'resolveAfterBelowTurns',
    'reformationCooldownTurns',
  ];
  for (const key of positiveIntegers) {
    const value = template[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Situation template ${template.type}.${key} must be a positive integer`);
    }
  }
  if (template.maxTensionRisePerTurn <= 0 || template.maxTensionFallPerTurn <= 0) {
    throw new Error(`Situation template ${template.type} tension rates must be positive`);
  }
  if (
    template.resolutionThreshold >= template.activeExitThreshold ||
    template.activeExitThreshold >= template.activeEnterThreshold ||
    template.activeEnterThreshold >= template.criticalEnterThreshold ||
    template.criticalExitThreshold >= template.criticalEnterThreshold
  ) {
    throw new Error(`Situation template ${template.type} has invalid hysteresis thresholds`);
  }
}

function templateRegistry(templates: readonly SituationTemplate[]): ReadonlyMap<string, SituationTemplate> {
  const registry = new Map<string, SituationTemplate>();
  for (const template of [...templates].sort((left, right) => stableCompare(left.type, right.type))) {
    validateTemplate(template);
    if (registry.has(template.type)) throw new Error(`Duplicate Situation template: ${template.type}`);
    registry.set(template.type, { ...template });
  }
  return registry;
}

export function createSituationSystemState(lastReducedTurn = -1): SituationSystemState {
  if (!Number.isSafeInteger(lastReducedTurn) || lastReducedTurn < -1) {
    throw new Error('Situation lastReducedTurn must be an integer of at least -1');
  }
  return {
    version: 1,
    lastReducedTurn,
    nextSituationNumber: 1,
    candidates: [],
    situations: [],
    archive: {
      resolvedCount: 0,
      resolvedDigest: ARCHIVE_GENESIS,
    },
  };
}

function formSituation(
  candidate: SituationCandidateState,
  template: SituationTemplate,
  turn: number,
  id: string,
  limits: SituationLimits,
): SituationState {
  const observation = candidate.observation;
  const participants = normalizeSituationParticipants(observation.participants, limits);
  const causalFactIds = boundedUniqueAppend(
    candidate.evidenceFactIds,
    evidenceFactIds(observation),
    limits.maxMilestoneFactIds,
  );
  const tension = clamp(observation.pressure, 0, 100);
  const change: SituationRecentChange = {
    turn,
    kind: 'formed',
    tension,
    fromPhase: null,
    toPhase: 'emerging',
    sourceFactIds: causalFactIds.slice(-limits.maxResolutionFactIds),
  };
  return {
    id,
    type: candidate.type,
    scopeKey: candidate.scopeKey,
    titleKey: template.titleKey,
    status: 'open',
    phase: 'emerging',
    startedTurn: turn,
    phaseSinceTurn: turn,
    lastUpdatedTurn: turn,
    resolvedTurn: null,
    tension,
    momentum: 0,
    consecutivePhaseRiseTurns: 0,
    consecutivePhaseFallTurns: 0,
    consecutiveBelowResolutionTurns:
      observation.pressure <= template.resolutionThreshold ? 1 : 0,
    participants,
    executableActorIds: [...(observation.executableActorIds ?? [])].slice(
      0,
      limits.maxExecutableActors,
    ),
    signals: observation.signals.slice(0, limits.maxSignals),
    causalFactIds,
    milestoneFactIds: [],
    recentChanges: [change],
    possibleOutcomes: (observation.possibleOutcomes ?? []).slice(0, limits.maxPossibleOutcomes),
    nextWatch: observation.nextWatch,
    startSnapshot: {
      turn,
      pressure: observation.pressure,
      participantDigest: stableHash(participants),
      evidenceDigest: stableHash(observation.signals),
    },
    resolution: null,
    importance: clamp(observation.importance ?? 50, 0, 100),
    visibility: clamp(observation.visibility ?? 50, 0, 100),
  };
}

interface UpdatedSituation {
  situation: SituationState;
  transition: SituationTransition | null;
}

function moveTension(
  previous: number,
  target: number,
  template: SituationTemplate,
): { tension: number; momentum: number } {
  const delta = target - previous;
  const limited =
    delta >= 0
      ? Math.min(delta, template.maxTensionRisePerTurn)
      : Math.max(delta, -template.maxTensionFallPerTurn);
  return {
    tension: clamp(previous + limited, 0, 100),
    momentum: clamp(limited, -100, 100),
  };
}

function updateOpenSituation(
  previous: SituationState,
  observation: SituationCandidateObservation | undefined,
  template: SituationTemplate,
  turn: number,
  limits: SituationLimits,
): UpdatedSituation {
  const targetPressure = observation?.pressure ?? 0;
  const { tension, momentum } = moveTension(previous.tension, targetPressure, template);
  const participants = observation
    ? normalizeSituationParticipants(observation.participants, limits)
    : previous.participants;
  const participantsChanged = stableStringify(participants) !== stableStringify(previous.participants);
  const executableActorIds = observation
    ? [...(observation.executableActorIds ?? [])].slice(0, limits.maxExecutableActors)
    : [];
  const sourceFactIds = observation ? evidenceFactIds(observation) : [];
  const causalFactIds = boundedUniqueAppend(
    previous.causalFactIds,
    sourceFactIds,
    limits.maxMilestoneFactIds,
  );
  const transitionSourceFactIds = (
    sourceFactIds.length > 0 ? sourceFactIds : causalFactIds
  ).slice(-limits.maxResolutionFactIds);
  const observationHasStructuralEvidence = Boolean(
    observation &&
      observation.signals.filter(
        (signal) => signal.role === 'structural' && signal.refs.length > 0,
      ).length >= 2 &&
      new Set(observation.signals
        .filter((signal) => signal.role === 'structural')
        .flatMap((signal) => signal.refs.map((ref) => stableStringify(ref))))
        .size >= 2,
  );
  let phase: SituationPhase = previous.phase;
  let phaseSinceTurn = previous.phaseSinceTurn;
  let riseTurns = previous.consecutivePhaseRiseTurns;
  let fallTurns = previous.consecutivePhaseFallTurns;

  if (phase === 'emerging') {
    riseTurns = tension >= template.activeEnterThreshold ? riseTurns + 1 : 0;
    fallTurns = 0;
    if (riseTurns >= template.phaseConfirmTurns) {
      phase = 'active';
      phaseSinceTurn = turn;
      riseTurns = 0;
    }
  } else if (phase === 'active') {
    const canBecomeCritical =
      tension >= template.criticalEnterThreshold && executableActorIds.length > 0;
    riseTurns = canBecomeCritical ? riseTurns + 1 : 0;
    fallTurns = tension < template.activeExitThreshold ? fallTurns + 1 : 0;
    if (riseTurns >= template.phaseConfirmTurns) {
      phase = 'critical';
      phaseSinceTurn = turn;
      riseTurns = 0;
      fallTurns = 0;
    } else if (fallTurns >= template.coolingConfirmTurns) {
      phase = 'emerging';
      phaseSinceTurn = turn;
      riseTurns = 0;
      fallTurns = 0;
    }
  } else {
    riseTurns = 0;
    if (executableActorIds.length === 0) {
      phase = 'active';
      phaseSinceTurn = turn;
      fallTurns = 0;
    } else {
      fallTurns = tension < template.criticalExitThreshold ? fallTurns + 1 : 0;
      if (fallTurns >= template.coolingConfirmTurns) {
        phase = 'active';
        phaseSinceTurn = turn;
        fallTurns = 0;
      }
    }
  }

  const belowTurns =
    targetPressure <= template.resolutionThreshold
      ? previous.consecutiveBelowResolutionTurns + 1
      : 0;
  const explicitResolution =
    observation?.resolution && observation.resolution.resultFactIds.length > 0
      ? observation.resolution
      : null;
  const dissipated =
    explicitResolution === null &&
    belowTurns >= template.resolveAfterBelowTurns &&
    tension <= template.resolutionThreshold;
  const isResolved = explicitResolution !== null || dissipated;
  const outcomeKey = explicitResolution?.outcomeKey ?? (dissipated ? 'dissipated' : null);
  const resultFactIds = (explicitResolution?.resultFactIds ?? []).slice(
    0,
    limits.maxResolutionFactIds,
  );
  const phaseChanged = phase !== previous.phase;
  let recentChanges = previous.recentChanges.slice(-limits.maxRecentChanges);
  if (participantsChanged) {
    recentChanges = appendRecentChange(
      recentChanges,
      {
        turn,
        kind: 'participants_changed',
        tension,
        fromPhase: phase,
        toPhase: phase,
        sourceFactIds: transitionSourceFactIds,
      },
      limits,
    );
  }
  // Resolution is an atomic public transition. If losing the executable actor
  // also changes phase in the same quarter, the resolved record already keeps
  // the complete previous.phase -> phase edge; emitting a second phase change
  // would create a recent change with no separate milestone Fact.
  if (phaseChanged && !isResolved) {
    recentChanges = appendRecentChange(
      recentChanges,
      {
        turn,
        kind: 'phase_changed',
        tension,
        fromPhase: previous.phase,
        toPhase: phase,
        sourceFactIds: transitionSourceFactIds,
      },
      limits,
    );
  }
  if (isResolved) {
    recentChanges = appendRecentChange(
      recentChanges,
      {
        turn,
        kind: 'resolved',
        tension,
        fromPhase: previous.phase,
        toPhase: phase,
        sourceFactIds:
          resultFactIds.length > 0 ? resultFactIds : transitionSourceFactIds,
      },
      limits,
    );
  }

  const next: SituationState = {
    ...previous,
    status: isResolved ? 'resolved' : 'open',
    phase,
    phaseSinceTurn,
    lastUpdatedTurn: turn,
    resolvedTurn: isResolved ? turn : null,
    tension,
    momentum,
    consecutivePhaseRiseTurns: riseTurns,
    consecutivePhaseFallTurns: fallTurns,
    consecutiveBelowResolutionTurns: belowTurns,
    participants,
    executableActorIds,
    signals: observationHasStructuralEvidence
      ? observation?.signals.slice(0, limits.maxSignals) ?? previous.signals
      : previous.signals,
    causalFactIds,
    milestoneFactIds: previous.milestoneFactIds,
    recentChanges,
    possibleOutcomes:
      observation?.possibleOutcomes?.slice(0, limits.maxPossibleOutcomes) ??
      previous.possibleOutcomes,
    nextWatch:
      observation && observation.nextWatch.refs.length > 0
        ? observation.nextWatch
        : previous.nextWatch,
    resolution: isResolved
      ? {
          outcomeKey: outcomeKey ?? 'dissipated',
          resolvedTurn: turn,
          resultFactIds,
          belowThresholdTurns: belowTurns,
          finalSnapshotDigest: stableHash({
            phase,
            tension,
            participants,
            sourceFactIds,
            resultFactIds,
          }),
        }
      : null,
    importance: observation?.importance ?? previous.importance,
    visibility: observation?.visibility ?? previous.visibility,
  };

  if (isResolved) {
    return {
      situation: next,
      transition: {
        turn,
        kind: 'resolved',
        situationId: next.id,
        sourceFactIds:
          resultFactIds.length > 0 ? resultFactIds : transitionSourceFactIds,
        fromPhase: previous.phase,
        toPhase: phase,
        outcomeKey: outcomeKey ?? 'dissipated',
      },
    };
  }
  if (phaseChanged) {
    return {
      situation: next,
      transition: {
        turn,
        kind: 'phase_changed',
        situationId: next.id,
        sourceFactIds: transitionSourceFactIds,
        fromPhase: previous.phase,
        toPhase: phase,
        outcomeKey: null,
      },
    };
  }
  return { situation: next, transition: null };
}

function archiveResolvedOverflow(
  situations: readonly SituationState[],
  previousArchive: SituationSystemState['archive'],
  limits: SituationLimits,
): { situations: SituationState[]; archive: SituationSystemState['archive'] } {
  const open = situations.filter((situation) => situation.status === 'open');
  const resolved = situations
    .filter((situation) => situation.status === 'resolved')
    .sort(
      (left, right) =>
        (left.resolvedTurn ?? Number.MAX_SAFE_INTEGER) -
          (right.resolvedTurn ?? Number.MAX_SAFE_INTEGER) ||
        stableCompare(left.id, right.id),
    );
  const removeCount = Math.max(0, resolved.length - limits.maxResolvedSituations);
  let resolvedCount = previousArchive.resolvedCount;
  let resolvedDigest = previousArchive.resolvedDigest;
  for (const archived of resolved.slice(0, removeCount)) {
    resolvedCount += 1;
    resolvedDigest = stableHash({ previousDigest: resolvedDigest, archived });
  }
  const retained = [...open, ...resolved.slice(removeCount)].sort((left, right) =>
    stableCompare(left.id, right.id),
  );
  return { situations: retained, archive: { resolvedCount, resolvedDigest } };
}

/**
 * Completes the reducer/emitter handshake. The reducer first emits causal
 * transitions; after the Fact emitter creates `situation_milestone` Facts, this
 * pure function attaches their real ids to the same-turn authoritative state.
 */
export function attachSituationMilestoneFacts(
  state: SituationSystemState,
  attachments: readonly SituationMilestoneAttachment[],
  facts: readonly SimulationFact[],
  limitOverrides?: Partial<SituationLimits>,
): SituationSystemState {
  const limits = resolveSituationLimits(limitOverrides);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  if (factById.size !== facts.length) throw new Error('Milestone Fact ids must be unique');
  const grouped = new Map<string, SituationMilestoneAttachment>();
  for (const attachment of attachments) {
    if (attachment.turn !== state.lastReducedTurn) {
      throw new Error(
        `Milestone attachment must target reduced turn ${state.lastReducedTurn}: ${attachment.situationId}`,
      );
    }
    if (attachment.milestoneFactIds.length === 0) {
      throw new Error(`Milestone attachment is empty: ${attachment.situationId}`);
    }
    const key = `${attachment.situationId}\u241f${attachment.turn}\u241f${attachment.transitionKind}`;
    const previous = grouped.get(key);
    grouped.set(key, {
      ...attachment,
      milestoneFactIds: [...new Set([
        ...(previous?.milestoneFactIds ?? []),
        ...attachment.milestoneFactIds,
      ])].sort(stableCompare),
    });
  }

  const bySituationId = new Map<string, SituationMilestoneAttachment[]>();
  for (const attachment of [...grouped.values()].sort((left, right) =>
    stableCompare(
      `${left.situationId}\u241f${left.transitionKind}`,
      `${right.situationId}\u241f${right.transitionKind}`,
    ),
  )) {
    for (const factId of attachment.milestoneFactIds) {
      const fact = factById.get(factId);
      if (fact === undefined || fact.turn !== attachment.turn) {
        throw new Error(`Milestone attachment must reference a same-turn Fact: ${factId}`);
      }
      if (fact.kind !== 'situation_milestone') {
        throw new Error(`Milestone attachment must reference a situation_milestone Fact: ${factId}`);
      }
      if (
        fact.payload.situationId !== attachment.situationId
        || fact.payload.transition !== attachment.transitionKind
      ) {
        throw new Error(
          `Milestone Fact payload does not match attachment: ${factId}/${attachment.situationId}/${attachment.transitionKind}`,
        );
      }
      if (fact.kind === 'situation_milestone') {
        if (
          fact.payload.situationId !== attachment.situationId ||
          fact.payload.transition !== attachment.transitionKind
        ) {
          throw new Error(
            `Milestone Fact payload does not match attachment: ${factId}/${attachment.situationId}`,
          );
        }
      }
    }
    const entries = bySituationId.get(attachment.situationId) ?? [];
    entries.push(attachment);
    bySituationId.set(attachment.situationId, entries);
  }

  const seenSituationIds = new Set<string>();
  const situations = state.situations.map((situation) => {
    const entries = bySituationId.get(situation.id);
    if (entries === undefined) return situation;
    seenSituationIds.add(situation.id);
    if (situation.lastUpdatedTurn !== state.lastReducedTurn) {
      throw new Error(`Milestone attachment cannot update an older Situation: ${situation.id}`);
    }
    let milestoneFactIds = [...situation.milestoneFactIds];
    for (const entry of entries) {
      const matchingChange = situation.recentChanges.some(
        (change) =>
          change.turn === entry.turn &&
          change.kind === entry.transitionKind,
      );
      if (!matchingChange) {
        throw new Error(
          `Milestone attachment has no matching transition: ${situation.id}/${entry.transitionKind}`,
        );
      }
      milestoneFactIds = boundedUniqueAppend(
        milestoneFactIds,
        entry.milestoneFactIds,
        limits.maxMilestoneFactIds,
      );
    }
    return { ...situation, milestoneFactIds };
  });
  for (const situationId of bySituationId.keys()) {
    if (!seenSituationIds.has(situationId)) {
      throw new Error(`Milestone attachment references unknown Situation: ${situationId}`);
    }
  }
  const next = { ...state, situations };
  const errors = validateSituationSystemState(next, limits);
  if (errors.length > 0) throw new Error(`Invalid milestone attachment: ${errors.join('; ')}`);
  return next;
}

export function validateSituationSystemState(
  state: SituationSystemState,
  limitOverrides?: Partial<SituationLimits>,
): string[] {
  const limits = resolveSituationLimits(limitOverrides);
  const errors: string[] = [];
  if (state.version !== 1) errors.push(`unsupported Situation state version ${String(state.version)}`);
  if (!Number.isSafeInteger(state.lastReducedTurn) || state.lastReducedTurn < -1) {
    errors.push('invalid Situation last-reduced turn');
  }
  if (!Number.isSafeInteger(state.nextSituationNumber) || state.nextSituationNumber < 1) {
    errors.push('invalid next Situation number');
  }
  if (state.candidates.length > limits.maxCandidates) errors.push('candidate cap exceeded');
  const candidateKeys = new Set(state.candidates.map((candidate) => candidate.key));
  if (candidateKeys.size !== state.candidates.length) errors.push('candidate keys are not unique');
  const situationIds = new Set(state.situations.map((situation) => situation.id));
  if (situationIds.size !== state.situations.length) errors.push('situation ids are not unique');
  const open = state.situations.filter((situation) => situation.status === 'open');
  const resolved = state.situations.filter((situation) => situation.status === 'resolved');
  if (open.length > limits.maxOpenSituations) errors.push('open Situation cap exceeded');
  if (resolved.length > limits.maxResolvedSituations) errors.push('resolved Situation cap exceeded');
  if (
    !Number.isSafeInteger(state.archive.resolvedCount) ||
    state.archive.resolvedCount < 0 ||
    state.archive.resolvedDigest.length === 0
  ) {
    errors.push('invalid resolved Situation archive');
  }
  const linkedSituationIds = new Set<string>();
  for (const candidate of state.candidates) {
    if (candidate.evidenceFactIds.length > limits.maxMilestoneFactIds) {
      errors.push(`${candidate.key}: candidate evidence cap exceeded`);
    }
    if (candidate.key !== situationCandidateKey(candidate.type, candidate.scopeKey)) {
      errors.push(`${candidate.key}: candidate key does not match type/scope`);
    }
    if (
      candidate.observation.type !== candidate.type ||
      candidate.observation.scopeKey !== candidate.scopeKey
    ) {
      errors.push(`${candidate.key}: candidate observation does not match type/scope`);
    }
    if (candidate.firstSeenTurn > candidate.lastSeenTurn) {
      errors.push(`${candidate.key}: candidate first-seen turn is after last-seen turn`);
    }
    if (candidate.lastSeenTurn > state.lastReducedTurn) {
      errors.push(`${candidate.key}: candidate comes from a future turn`);
    }
    if (candidate.observation.signals.length > limits.maxSignals) {
      errors.push(`${candidate.key}: candidate signal cap exceeded`);
    }
    if (candidate.observation.signals.some((signal) => signal.refs.length > limits.maxSignalRefs)) {
      errors.push(`${candidate.key}: candidate signal evidence cap exceeded`);
    }
    if (candidate.observation.nextWatch.refs.length > limits.maxSignalRefs) {
      errors.push(`${candidate.key}: candidate next-watch evidence cap exceeded`);
    }
    if ((candidate.observation.executableActorIds?.length ?? 0) > limits.maxExecutableActors) {
      errors.push(`${candidate.key}: candidate executable-actor cap exceeded`);
    }
    if ((candidate.observation.possibleOutcomes?.length ?? 0) > limits.maxPossibleOutcomes) {
      errors.push(`${candidate.key}: candidate outcome cap exceeded`);
    }
    if (
      (candidate.observation.resolution?.resultFactIds.length ?? 0) >
      limits.maxResolutionFactIds
    ) {
      errors.push(`${candidate.key}: candidate resolution Fact cap exceeded`);
    }
    const candidateParticipants = candidate.observation.participants;
    const candidateParticipantChecks: [readonly string[] | undefined, number, string][] = [
      [candidateParticipants?.coreCharacterIds, limits.maxCoreCharacterIds, 'core characters'],
      [
        candidateParticipants?.supportingCharacterIds,
        limits.maxSupportingCharacterIds,
        'supporting characters',
      ],
      [
        candidateParticipants?.opposingCharacterIds,
        limits.maxOpposingCharacterIds,
        'opposing characters',
      ],
      [candidateParticipants?.familyIds, limits.maxFamilyIds, 'families'],
      [candidateParticipants?.factionIds, limits.maxFactionIds, 'factions'],
      [candidateParticipants?.polityIds, limits.maxPolityIds, 'polities'],
      [candidateParticipants?.regionIds, limits.maxRegionIds, 'regions'],
      [candidateParticipants?.armyIds, limits.maxArmyIds, 'armies'],
      [candidateParticipants?.fleetIds, limits.maxFleetIds, 'fleets'],
    ];
    for (const [values, cap, label] of candidateParticipantChecks) {
      if ((values?.length ?? 0) > cap) errors.push(`${candidate.key}: candidate ${label} cap exceeded`);
    }
    if (candidate.linkedSituationId !== null) {
      if (!situationIds.has(candidate.linkedSituationId)) {
        errors.push(`${candidate.key}: linked Situation does not exist`);
      }
      if (linkedSituationIds.has(candidate.linkedSituationId)) {
        errors.push(`${candidate.key}: multiple candidates link the same Situation`);
      }
      linkedSituationIds.add(candidate.linkedSituationId);
    }
  }

  for (const situation of state.situations) {
    if (!Number.isFinite(situation.tension) || situation.tension < 0 || situation.tension > 100) {
      errors.push(`${situation.id}: invalid tension`);
    }
    if (!Number.isFinite(situation.momentum) || situation.momentum < -100 || situation.momentum > 100) {
      errors.push(`${situation.id}: invalid momentum`);
    }
    if (situation.signals.length > limits.maxSignals) errors.push(`${situation.id}: signal cap exceeded`);
    for (const signal of situation.signals) {
      if (signal.refs.length > limits.maxSignalRefs) {
        errors.push(`${situation.id}: signal evidence cap exceeded`);
      }
    }
    if (situation.milestoneFactIds.length > limits.maxMilestoneFactIds) {
      errors.push(`${situation.id}: milestone cap exceeded`);
    }
    if (situation.nextWatch.refs.length > limits.maxSignalRefs) {
      errors.push(`${situation.id}: next-watch evidence cap exceeded`);
    }
    if (situation.causalFactIds.length > limits.maxMilestoneFactIds) {
      errors.push(`${situation.id}: causal Fact cap exceeded`);
    }
    if (situation.causalFactIds.length === 0) {
      errors.push(`${situation.id}: Situation lacks causal Fact evidence`);
    }
    if (situation.recentChanges.length > limits.maxRecentChanges) {
      errors.push(`${situation.id}: recent-change cap exceeded`);
    }
    for (const change of situation.recentChanges) {
      if (change.sourceFactIds.length === 0) {
        errors.push(`${situation.id}: recent change lacks a causal Fact`);
      }
      if (change.sourceFactIds.length > limits.maxResolutionFactIds) {
        errors.push(`${situation.id}: recent-change Fact cap exceeded`);
      }
    }
    if (situation.possibleOutcomes.length > limits.maxPossibleOutcomes) {
      errors.push(`${situation.id}: outcome cap exceeded`);
    }
    if (
      situation.resolution !== null &&
      situation.resolution.resultFactIds.length > limits.maxResolutionFactIds
    ) {
      errors.push(`${situation.id}: resolution Fact cap exceeded`);
    }
    if (situation.executableActorIds.length > limits.maxExecutableActors) {
      errors.push(`${situation.id}: executable-actor cap exceeded`);
    }
    const participantChecks: [readonly string[], number, string][] = [
      [situation.participants.coreCharacterIds, limits.maxCoreCharacterIds, 'core characters'],
      [
        situation.participants.supportingCharacterIds,
        limits.maxSupportingCharacterIds,
        'supporting characters',
      ],
      [
        situation.participants.opposingCharacterIds,
        limits.maxOpposingCharacterIds,
        'opposing characters',
      ],
      [situation.participants.familyIds, limits.maxFamilyIds, 'families'],
      [situation.participants.factionIds, limits.maxFactionIds, 'factions'],
      [situation.participants.polityIds, limits.maxPolityIds, 'polities'],
      [situation.participants.regionIds, limits.maxRegionIds, 'regions'],
      [situation.participants.armyIds, limits.maxArmyIds, 'armies'],
      [situation.participants.fleetIds, limits.maxFleetIds, 'fleets'],
    ];
    for (const [values, cap, label] of participantChecks) {
      if (values.length > cap) errors.push(`${situation.id}: ${label} cap exceeded`);
    }
    if (situation.status === 'resolved') {
      if (situation.resolution === null || situation.resolvedTurn === null) {
        errors.push(`${situation.id}: resolved Situation lacks resolution proof`);
      }
    } else {
      const structuralSignals = situation.signals.filter(
        (signal) => signal.role === 'structural' && signal.refs.length > 0,
      );
      const structuralEvidence = new Set(structuralSignals.flatMap((signal) => (
        signal.refs.map((ref) => stableStringify(ref))
      )));
      if (structuralSignals.length < 2 || structuralEvidence.size < 2) {
        errors.push(`${situation.id}: open Situation lacks two structural evidence signals`);
      }
      if (situation.nextWatch.refs.length === 0) {
        errors.push(`${situation.id}: open Situation lacks a next-watch signal`);
      }
      if (situation.phase === 'critical' && situation.executableActorIds.length === 0) {
        errors.push(`${situation.id}: critical Situation lacks an executable actor`);
      }
      if (situation.resolution !== null || situation.resolvedTurn !== null) {
        errors.push(`${situation.id}: open Situation carries resolution state`);
      }
      const candidateKey = situationCandidateKey(situation.type, situation.scopeKey);
      const candidate = state.candidates.find((entry) => entry.key === candidateKey);
      if (candidate?.linkedSituationId !== situation.id) {
        errors.push(`${situation.id}: open Situation lacks linked candidate`);
      }
    }
  }
  return errors;
}

export function reduceSituationTurn<Index>(
  previous: SituationSystemState,
  input: SituationTurnInput<Index>,
  options: SituationReducerOptions,
): SituationTurnResult {
  const limits = resolveSituationLimits(options.limits);
  const previousErrors = validateSituationSystemState(previous, limits);
  if (previousErrors.length > 0) {
    throw new Error(`Invalid previous Situation state: ${previousErrors.join('; ')}`);
  }
  if (input.turn !== previous.lastReducedTurn + 1) {
    throw new Error(
      `Situation turns must be reduced sequentially: expected ${previous.lastReducedTurn + 1}, got ${input.turn}`,
    );
  }
  const templates = templateRegistry(options.templates);
  const maxOpenByType = new Map<string, number>();
  for (const [type, cap] of Object.entries(options.maxOpenByType ?? {}).sort(([left], [right]) => (
    stableCompare(left, right)
  ))) {
    if (!templates.has(type)) throw new Error(`Situation admission budget references unknown type: ${type}`);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > limits.maxOpenSituations) {
      throw new Error(`Situation admission budget for ${type} must be between 1 and ${limits.maxOpenSituations}`);
    }
    maxOpenByType.set(type, cap);
  }
  const observations = collectSituationCandidateObservations(input, limits);
  const currentObservations = observationsByCandidateKey(observations);
  let candidates = advanceCandidateRegistry(
    previous.candidates,
    observations,
    input.turn,
    templates,
    limits,
  );
  const transitions: SituationTransition[] = [];
  const updated: SituationState[] = [];
  const resolvedCandidateKeys = new Set<string>();

  for (const situation of previous.situations) {
    if (situation.status === 'resolved') {
      updated.push(situation);
      continue;
    }
    const key = situationCandidateKey(situation.type, situation.scopeKey);
    const template = templates.get(situation.type);
    if (template === undefined) throw new Error(`Missing Situation template: ${situation.type}`);
    const result = updateOpenSituation(
      situation,
      currentObservations.get(key),
      template,
      input.turn,
      limits,
    );
    updated.push(result.situation);
    if (result.transition) transitions.push(result.transition);
    if (result.situation.status === 'resolved') resolvedCandidateKeys.add(key);
  }

  candidates = candidates.map((candidate) => {
    if (!resolvedCandidateKeys.has(candidate.key)) return candidate;
    const template = templates.get(candidate.type);
    if (template === undefined) throw new Error(`Missing Situation template: ${candidate.type}`);
    return {
      ...candidate,
      linkedSituationId: null,
      rearmAfterTurn: input.turn + template.reformationCooldownTurns,
      consecutiveQualifyingTurns: 0,
    };
  });

  const existingOpenCount = updated.filter((situation) => situation.status === 'open').length;
  const availableSlots = Math.max(0, limits.maxOpenSituations - existingOpenCount);
  const rankedEligible = candidates
    .filter((candidate) => {
      const template = templates.get(candidate.type);
      const observation = currentObservations.get(candidate.key);
      return (
        template !== undefined &&
        observation !== undefined &&
        candidate.linkedSituationId === null &&
        candidate.consecutiveQualifyingTurns >= template.formationConfirmTurns &&
        candidate.evidenceFactIds.length > 0 &&
        input.turn >= candidate.rearmAfterTurn &&
        !(observation.resolution && observation.resolution.resultFactIds.length > 0)
      );
    })
    .sort(
      (left, right) =>
        right.latestPressure - left.latestPressure ||
        right.consecutiveQualifyingTurns - left.consecutiveQualifyingTurns ||
        stableCompare(left.key, right.key),
    );
  const openByType = new Map<string, number>();
  for (const situation of updated) {
    if (situation.status !== 'open') continue;
    openByType.set(situation.type, (openByType.get(situation.type) ?? 0) + 1);
  }
  const admittedByType = new Map<string, number>();
  const eligible: SituationCandidateState[] = [];
  for (const candidate of rankedEligible) {
    if (eligible.length >= availableSlots) break;
    const cap = maxOpenByType.get(candidate.type) ?? limits.maxOpenSituations;
    const occupied = (openByType.get(candidate.type) ?? 0) + (admittedByType.get(candidate.type) ?? 0);
    if (occupied >= cap) continue;
    eligible.push(candidate);
    admittedByType.set(candidate.type, (admittedByType.get(candidate.type) ?? 0) + 1);
  }

  let nextSituationNumber = previous.nextSituationNumber;
  const formedIds = new Map<string, string>();
  for (const candidate of eligible) {
    const template = templates.get(candidate.type);
    if (template === undefined) continue;
    const id = `situation_${String(nextSituationNumber).padStart(6, '0')}`;
    nextSituationNumber += 1;
    const situation = formSituation(candidate, template, input.turn, id, limits);
    updated.push(situation);
    formedIds.set(candidate.key, id);
    transitions.push({
      turn: input.turn,
      kind: 'formed',
      situationId: id,
      sourceFactIds: situation.causalFactIds.slice(-limits.maxResolutionFactIds),
      fromPhase: null,
      toPhase: 'emerging',
      outcomeKey: null,
    });
  }
  candidates = candidates.map((candidate) => {
    const id = formedIds.get(candidate.key);
    return id ? { ...candidate, linkedSituationId: id } : candidate;
  });

  const archived = archiveResolvedOverflow(updated, previous.archive, limits);
  const state: SituationSystemState = {
    version: 1,
    lastReducedTurn: input.turn,
    nextSituationNumber,
    candidates: [...candidates].sort((left, right) => stableCompare(left.key, right.key)),
    situations: archived.situations,
    archive: archived.archive,
  };
  const errors = validateSituationSystemState(state, limits);
  if (errors.length > 0) throw new Error(`Invalid reduced Situation state: ${errors.join('; ')}`);
  return {
    state,
    transitions: transitions.sort(
      (left, right) =>
        stableCompare(left.situationId, right.situationId) || stableCompare(left.kind, right.kind),
    ),
  };
}
