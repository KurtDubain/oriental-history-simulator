import { stableCompare, stableStringify } from '../random';
import { DEFAULT_SITUATION_LIMITS, EMPTY_SITUATION_PARTICIPANTS } from './constants';
import type {
  SituationCandidateObservation,
  SituationCandidateState,
  SituationDetector,
  SituationEvidenceRef,
  SituationLimits,
  SituationOutcomeOption,
  SituationParticipants,
  SituationSignal,
  SituationTemplate,
  SituationTurnInput,
  SituationWatchSignal,
} from './types';

const KEY_SEPARATOR = '\u241f';

const SIGNAL_ROLE_ORDER: Record<SituationSignal['role'], number> = {
  structural: 0,
  trigger: 1,
  capability: 2,
  inhibitor: 3,
  outcome: 4,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

function sortedUnique(values: readonly string[], cap: number): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort(stableCompare)
    .slice(0, cap);
}

function normalizeRef(
  ref: SituationEvidenceRef,
  currentFactIds: ReadonlySet<string>,
): SituationEvidenceRef {
  if (ref.kind === 'fact') {
    const factId = requireNonEmpty(ref.factId, 'fact evidence id');
    if (!currentFactIds.has(factId)) {
      throw new Error(`Situation evidence must reference a current-turn Fact: ${factId}`);
    }
    return { kind: 'fact', factId };
  }

  return {
    kind: 'index',
    entityType: requireNonEmpty(ref.entityType, 'index entity type'),
    entityId: requireNonEmpty(ref.entityId, 'index entity id'),
    field: requireNonEmpty(ref.field, 'index field'),
    value: ref.value,
  };
}

function normalizeRefs(
  refs: readonly SituationEvidenceRef[],
  limits: SituationLimits,
  currentFactIds: ReadonlySet<string>,
): SituationEvidenceRef[] {
  const byKey = new Map<string, SituationEvidenceRef>();
  for (const ref of refs) {
    const normalized = normalizeRef(ref, currentFactIds);
    byKey.set(stableStringify(normalized), normalized);
  }
  return [...byKey.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (left.kind !== right.kind) return left.kind === 'fact' ? -1 : 1;
      return stableCompare(leftKey, rightKey);
    })
    .slice(0, limits.maxSignalRefs)
    .map(([, ref]) => ref);
}

function normalizeSignal(
  signal: SituationSignal,
  limits: SituationLimits,
  currentFactIds: ReadonlySet<string>,
): SituationSignal {
  if (!Number.isFinite(signal.contribution)) {
    throw new Error(`Situation signal contribution must be finite: ${signal.key}`);
  }
  return {
    key: requireNonEmpty(signal.key, 'signal key'),
    role: signal.role,
    contribution: clamp(signal.contribution, -100, 100),
    refs: normalizeRefs(signal.refs, limits, currentFactIds),
  };
}

function compareSignals(left: SituationSignal, right: SituationSignal): number {
  const roleOrder = SIGNAL_ROLE_ORDER[left.role] - SIGNAL_ROLE_ORDER[right.role];
  if (roleOrder !== 0) return roleOrder;
  const contributionOrder = Math.abs(right.contribution) - Math.abs(left.contribution);
  if (contributionOrder !== 0) return contributionOrder;
  const keyOrder = stableCompare(left.key, right.key);
  if (keyOrder !== 0) return keyOrder;
  return stableCompare(stableStringify(left), stableStringify(right));
}

function mergeSignals(
  signals: readonly SituationSignal[],
  limits: SituationLimits,
  currentFactIds: ReadonlySet<string>,
): SituationSignal[] {
  const byKey = new Map<string, SituationSignal>();
  for (const source of signals) {
    const signal = normalizeSignal(source, limits, currentFactIds);
    const identity = `${signal.role}${KEY_SEPARATOR}${signal.key}`;
    const previous = byKey.get(identity);
    if (
      previous === undefined ||
      Math.abs(signal.contribution) > Math.abs(previous.contribution) ||
      (Math.abs(signal.contribution) === Math.abs(previous.contribution) &&
        stableCompare(stableStringify(signal), stableStringify(previous)) < 0)
    ) {
      byKey.set(identity, signal);
    } else {
      byKey.set(identity, {
        ...previous,
        refs: normalizeRefs([...previous.refs, ...signal.refs], limits, currentFactIds),
      });
      continue;
    }
    const selected = byKey.get(identity);
    if (selected !== undefined && previous !== undefined) {
      byKey.set(identity, {
        ...selected,
        refs: normalizeRefs([...previous.refs, ...selected.refs], limits, currentFactIds),
      });
    }
  }
  const ranked = [...byKey.values()].sort(compareSignals);
  const selected = ranked.slice(0, limits.maxSignals);
  if (!selected.some((signal) => signal.refs.some((ref) => ref.kind === 'fact'))) {
    const factBacked = ranked.find((signal) => signal.refs.some((ref) => ref.kind === 'fact'));
    if (factBacked !== undefined && selected.length > 0) {
      selected[selected.length - 1] = factBacked;
      return [...new Map(selected.map((signal) => [
        `${signal.role}${KEY_SEPARATOR}${signal.key}`,
        signal,
      ])).values()].sort(compareSignals);
    }
  }
  return selected;
}

function mergeOutcomes(
  outcomes: readonly SituationOutcomeOption[],
  limits: SituationLimits,
): SituationOutcomeOption[] {
  const byKey = new Map<string, SituationOutcomeOption>();
  for (const source of outcomes) {
    const key = requireNonEmpty(source.key, 'outcome key');
    if (!Number.isFinite(source.confidence)) {
      throw new Error(`Situation outcome confidence must be finite: ${key}`);
    }
    const outcome = { key, confidence: clamp(source.confidence, 0, 100) };
    const previous = byKey.get(key);
    if (previous === undefined || outcome.confidence > previous.confidence) {
      byKey.set(key, outcome);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.confidence - left.confidence || stableCompare(left.key, right.key))
    .slice(0, limits.maxPossibleOutcomes);
}

function participantCap(key: keyof SituationParticipants, limits: SituationLimits): number {
  switch (key) {
    case 'coreCharacterIds':
      return limits.maxCoreCharacterIds;
    case 'supportingCharacterIds':
      return limits.maxSupportingCharacterIds;
    case 'opposingCharacterIds':
      return limits.maxOpposingCharacterIds;
    case 'familyIds':
      return limits.maxFamilyIds;
    case 'factionIds':
      return limits.maxFactionIds;
    case 'polityIds':
      return limits.maxPolityIds;
    case 'regionIds':
      return limits.maxRegionIds;
    case 'armyIds':
      return limits.maxArmyIds;
    case 'fleetIds':
      return limits.maxFleetIds;
  }
}

export function normalizeSituationParticipants(
  participants: Partial<SituationParticipants> | undefined,
  limits: SituationLimits,
): SituationParticipants {
  const result = {} as Record<keyof SituationParticipants, readonly string[]>;
  for (const key of Object.keys(EMPTY_SITUATION_PARTICIPANTS) as (keyof SituationParticipants)[]) {
    result[key] = sortedUnique(participants?.[key] ?? [], participantCap(key, limits));
  }
  return result;
}

function mergeParticipants(
  observations: readonly SituationCandidateObservation[],
  limits: SituationLimits,
): SituationParticipants {
  const result = {} as Record<keyof SituationParticipants, readonly string[]>;
  for (const key of Object.keys(EMPTY_SITUATION_PARTICIPANTS) as (keyof SituationParticipants)[]) {
    result[key] = sortedUnique(
      observations.flatMap((observation) => observation.participants?.[key] ?? []),
      participantCap(key, limits),
    );
  }
  return result;
}

function normalizeWatch(
  watch: SituationWatchSignal,
  limits: SituationLimits,
  currentFactIds: ReadonlySet<string>,
): SituationWatchSignal {
  return {
    key: requireNonEmpty(watch.key, 'next-watch key'),
    refs: normalizeRefs(watch.refs, limits, currentFactIds),
  };
}

export function situationCandidateKey(type: string, scopeKey: string): string {
  return `${type}${KEY_SEPARATOR}${scopeKey}`;
}

export function resolveSituationLimits(overrides?: Partial<SituationLimits>): SituationLimits {
  const limits = { ...DEFAULT_SITUATION_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Situation limit ${key} must be a positive integer`);
    }
  }
  if (limits.maxCandidates < limits.maxOpenSituations) {
    throw new Error('maxCandidates must be at least maxOpenSituations');
  }
  if (limits.maxResolvedSituations < limits.maxOpenSituations) {
    throw new Error('maxResolvedSituations must be at least maxOpenSituations');
  }
  return limits;
}

export function collectSituationCandidateObservations<Index>(
  input: SituationTurnInput<Index>,
  limits: SituationLimits,
): SituationCandidateObservation[] {
  const factIds = new Set(input.facts.map((fact) => fact.id));
  if (factIds.size !== input.facts.length) throw new Error('Current-turn Fact ids must be unique');
  for (const fact of input.facts) {
    if (fact.turn !== input.turn) {
      throw new Error(`Situation reducer received Fact ${fact.id} from turn ${fact.turn}`);
    }
  }

  const grouped = new Map<string, SituationCandidateObservation[]>();
  const detectors = [...input.detectors].sort((left, right) => stableCompare(left.id, right.id));
  const detectorIds = new Set<string>();
  for (const detector of detectors) {
    if (detectorIds.has(detector.id)) throw new Error(`Duplicate Situation detector id: ${detector.id}`);
    detectorIds.add(detector.id);
    for (const raw of detector.detect({ turn: input.turn, facts: input.facts, index: input.index })) {
      const type = requireNonEmpty(raw.type, 'situation type');
      const scopeKey = requireNonEmpty(raw.scopeKey, 'situation scope key');
      if (!Number.isFinite(raw.pressure)) {
        throw new Error(`Situation pressure must be finite: ${type}/${scopeKey}`);
      }
      const normalized: SituationCandidateObservation = {
        type,
        scopeKey,
        pressure: clamp(raw.pressure, 0, 100),
        participants: normalizeSituationParticipants(raw.participants, limits),
        executableActorIds: sortedUnique(raw.executableActorIds ?? [], limits.maxExecutableActors),
        signals: mergeSignals(raw.signals, limits, factIds),
        nextWatch: normalizeWatch(raw.nextWatch, limits, factIds),
        possibleOutcomes: mergeOutcomes(raw.possibleOutcomes ?? [], limits),
        resolution:
          raw.resolution === null || raw.resolution === undefined
            ? null
            : {
                outcomeKey: requireNonEmpty(raw.resolution.outcomeKey, 'resolution outcome key'),
                resultFactIds: sortedUnique(
                  raw.resolution.resultFactIds.map((factId) => {
                    if (!factIds.has(factId)) {
                      throw new Error(`Situation resolution must reference a current-turn Fact: ${factId}`);
                    }
                    return factId;
                  }),
                  limits.maxResolutionFactIds,
                ),
              },
        importance: clamp(raw.importance ?? 50, 0, 100),
        visibility: clamp(raw.visibility ?? 50, 0, 100),
      };
      const key = situationCandidateKey(type, scopeKey);
      const group = grouped.get(key) ?? [];
      group.push(normalized);
      grouped.set(key, group);
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([, observations]) => mergeObservationGroup(observations, limits, factIds));
}

function mergeObservationGroup(
  observations: readonly SituationCandidateObservation[],
  limits: SituationLimits,
  currentFactIds: ReadonlySet<string>,
): SituationCandidateObservation {
  const ranked = [...observations].sort(
    (left, right) =>
      right.pressure - left.pressure ||
      stableCompare(stableStringify(left), stableStringify(right)),
  );
  const lead = ranked[0];
  if (lead === undefined) throw new Error('Cannot merge an empty Situation observation group');
  const resolutions = observations
    .flatMap((observation) => (observation.resolution ? [observation.resolution] : []))
    .sort((left, right) => stableCompare(stableStringify(left), stableStringify(right)));

  return {
    type: lead.type,
    scopeKey: lead.scopeKey,
    pressure: Math.max(...observations.map((observation) => observation.pressure)),
    participants: mergeParticipants(observations, limits),
    executableActorIds: sortedUnique(
      observations.flatMap((observation) => observation.executableActorIds ?? []),
      limits.maxExecutableActors,
    ),
    signals: mergeSignals(
      observations.flatMap((observation) => observation.signals),
      limits,
      currentFactIds,
    ),
    nextWatch: lead.nextWatch,
    possibleOutcomes: mergeOutcomes(
      observations.flatMap((observation) => observation.possibleOutcomes ?? []),
      limits,
    ),
    resolution: resolutions[0] ?? null,
    importance: Math.max(...observations.map((observation) => observation.importance ?? 50)),
    visibility: Math.max(...observations.map((observation) => observation.visibility ?? 50)),
  };
}

export function candidateQualifies(
  observation: SituationCandidateObservation,
  template: SituationTemplate,
): boolean {
  const structuralSignals = observation.signals.filter(
    (signal) => signal.role === 'structural' && signal.refs.length > 0,
  );
  const structuralEvidence = new Set(
    structuralSignals.flatMap((signal) => signal.refs.map((ref) => stableStringify(ref))),
  );
  return (
    observation.pressure >= template.formationThreshold &&
    structuralSignals.length >= 2 &&
    structuralEvidence.size >= 2 &&
    observation.nextWatch.refs.length > 0
  );
}

function observationFactIds(observation: SituationCandidateObservation): string[] {
  return [...new Set(
    observation.signals.flatMap((signal) =>
      signal.refs.flatMap((ref) => (ref.kind === 'fact' ? [ref.factId] : [])),
    ),
  )].sort(stableCompare);
}

export function advanceCandidateRegistry(
  previous: readonly SituationCandidateState[],
  observations: readonly SituationCandidateObservation[],
  turn: number,
  templates: ReadonlyMap<string, SituationTemplate>,
  limits: SituationLimits,
): SituationCandidateState[] {
  const observationsByKey = new Map(
    observations.map((observation) => [situationCandidateKey(observation.type, observation.scopeKey), observation]),
  );
  const previousByKey = new Map(previous.map((candidate) => [candidate.key, candidate]));
  if (previousByKey.size !== previous.length) throw new Error('Situation candidate keys must be unique');
  const allKeys = [...new Set([...previousByKey.keys(), ...observationsByKey.keys()])].sort(stableCompare);
  const next: SituationCandidateState[] = [];

  for (const key of allKeys) {
    const prior = previousByKey.get(key);
    const observation = observationsByKey.get(key);
    if (observation !== undefined) {
      const template = templates.get(observation.type);
      if (template === undefined) throw new Error(`Missing Situation template: ${observation.type}`);
      const qualifies = candidateQualifies(observation, template);
      const consecutive = qualifies
        ? prior !== undefined && prior.lastSeenTurn === turn - 1 && prior.consecutiveQualifyingTurns > 0
          ? prior.consecutiveQualifyingTurns + 1
          : 1
        : 0;
      const evidenceFactIds = [...(prior?.evidenceFactIds ?? [])];
      for (const factId of observationFactIds(observation)) {
        const previousIndex = evidenceFactIds.indexOf(factId);
        if (previousIndex >= 0) evidenceFactIds.splice(previousIndex, 1);
        evidenceFactIds.push(factId);
      }
      next.push({
        key,
        type: observation.type,
        scopeKey: observation.scopeKey,
        firstSeenTurn: prior?.firstSeenTurn ?? turn,
        lastSeenTurn: turn,
        consecutiveQualifyingTurns: consecutive,
        consecutiveBelowTurns: qualifies ? 0 : (prior?.consecutiveBelowTurns ?? 0) + 1,
        latestPressure: observation.pressure,
        peakPressure: Math.max(prior?.peakPressure ?? 0, observation.pressure),
        evidenceFactIds: evidenceFactIds.slice(-limits.maxMilestoneFactIds),
        linkedSituationId: prior?.linkedSituationId ?? null,
        rearmAfterTurn: prior?.rearmAfterTurn ?? 0,
        observation,
      });
      continue;
    }

    if (prior !== undefined && turn - prior.lastSeenTurn <= limits.maxCandidateDormantTurns) {
      next.push({
        ...prior,
        consecutiveQualifyingTurns: 0,
        consecutiveBelowTurns: prior.consecutiveBelowTurns + 1,
        latestPressure: 0,
      });
    }
  }

  const linked = next
    .filter((candidate) => candidate.linkedSituationId !== null)
    .sort((left, right) => stableCompare(left.key, right.key));
  if (linked.length > limits.maxCandidates) {
    throw new Error('Linked Situation candidates exceed maxCandidates');
  }
  const unlinked = next
    .filter((candidate) => candidate.linkedSituationId === null)
    .sort(
      (left, right) =>
        right.consecutiveQualifyingTurns - left.consecutiveQualifyingTurns ||
        right.latestPressure - left.latestPressure ||
        right.lastSeenTurn - left.lastSeenTurn ||
        stableCompare(left.key, right.key),
    )
    .slice(0, limits.maxCandidates - linked.length);
  return [...linked, ...unlinked].sort((left, right) => stableCompare(left.key, right.key));
}

export function observationsByCandidateKey(
  observations: readonly SituationCandidateObservation[],
): ReadonlyMap<string, SituationCandidateObservation> {
  return new Map(
    observations.map((observation) => [situationCandidateKey(observation.type, observation.scopeKey), observation]),
  );
}

export function detectorsForIndex<Index>(
  detectors: readonly SituationDetector<Index>[],
): readonly SituationDetector<Index>[] {
  return detectors;
}
