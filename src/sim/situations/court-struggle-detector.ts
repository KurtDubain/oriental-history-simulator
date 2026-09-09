import { makeSituationSignal as makeSignal, situationIndexRef as indexRef } from "./candidate-registry";
import type { CourtActionResolvedFact, SimulationFact } from '../facts';
import {
  calculateFactionPowerLedger,
  type FactionPowerLedger,
  type PoliticalPowerCategory,
} from '../politics/power-ledger';
import type {
  CharacterState,
  FactionState,
  PolityState,
  WorldState,
} from '../types';
import type {
  SituationCandidateObservation,
  SituationDetector,
  SituationEvidenceRef,
  SituationOutcomeOption,
  SituationParticipants,
  SituationSignal,
  SituationTemplate,
  SituationWatchSignal,
} from './types';

export const COURT_STRUGGLE_TYPE = 'court_power_struggle';

export const COURT_STRUGGLE_TEMPLATE: SituationTemplate = {
  type: COURT_STRUGGLE_TYPE,
  titleKey: 'situation.court_power_struggle',
  formationThreshold: 58,
  activeEnterThreshold: 66,
  activeExitThreshold: 52,
  criticalEnterThreshold: 80,
  criticalExitThreshold: 68,
  resolutionThreshold: 20,
  formationConfirmTurns: 2,
  phaseConfirmTurns: 2,
  coolingConfirmTurns: 2,
  resolveAfterBelowTurns: 3,
  reformationCooldownTurns: 12,
  maxTensionRisePerTurn: 18,
  maxTensionFallPerTurn: 16,
};

const MAX_FACT_REFS = 4;
const MAX_SOURCE_FACTS = 8;
const MAX_SUPPORTERS = 8;
const MAX_OPPONENTS = 6;

export interface CourtStruggleFactionIndex {
  faction: FactionState;
  ledger: FactionPowerLedger;
  categoryValues: Readonly<Record<PoliticalPowerCategory, number>>;
}

export interface CourtStruggleIndex {
  charactersById: ReadonlyMap<string, CharacterState>;
  politiesById: ReadonlyMap<string, PolityState>;
  factionsById: ReadonlyMap<string, CourtStruggleFactionIndex>;
  factionsByPolityId: ReadonlyMap<string, readonly CourtStruggleFactionIndex[]>;
}

export interface CourtStruggleSignal extends SituationSignal {
  sourceFactIds: readonly string[];
}

export interface CourtStruggleWatchSignal extends SituationWatchSignal {
}

export interface CourtStruggleCandidate extends SituationCandidateObservation {
  type: typeof COURT_STRUGGLE_TYPE;
  candidateKey: string;
  challengerFactionId: string;
  rulerFactionId: string | null;
  participants: SituationParticipants;
  executableActorIds: readonly string[];
  signals: readonly CourtStruggleSignal[];
  sourceFactIds: readonly string[];
  nextWatch: CourtStruggleWatchSignal;
  possibleOutcomes: readonly SituationOutcomeOption[];
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[], maximum = Number.POSITIVE_INFINITY): string[] {
  return [...new Set(values.filter(Boolean))].sort(stableCompare).slice(0, maximum);
}

function sortedMap<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map([...items]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((item) => [item.id, item]));
}

function factRefs(factIds: readonly string[]): SituationEvidenceRef[] {
  return uniqueSorted(factIds, MAX_FACT_REFS).map((factId) => ({ kind: 'fact', factId }));
}

function categoryValues(ledger: FactionPowerLedger): Record<PoliticalPowerCategory, number> {
  return {
    central_office: ledger.categories.find((item) => item.category === 'central_office')?.value ?? 0,
    regional_office: ledger.categories.find((item) => item.category === 'regional_office')?.value ?? 0,
    military_command: ledger.categories.find((item) => item.category === 'military_command')?.value ?? 0,
    family_backing: ledger.categories.find((item) => item.category === 'family_backing')?.value ?? 0,
    member_renown: ledger.categories.find((item) => item.category === 'member_renown')?.value ?? 0,
    alliance_support: ledger.categories.find((item) => item.category === 'alliance_support')?.value ?? 0,
    cohesion: ledger.categories.find((item) => item.category === 'cohesion')?.value ?? 0,
  };
}

/**
 * Builds a read-only POL01 index. Ended factions remain addressable as
 * historical carriers for same-turn court resolutions, but only active
 * factions participate in the polity ranking. The legacy `FactionState.power`
 * scalar is not read.
 */
export function buildCourtStruggleIndex(world: WorldState): CourtStruggleIndex {
  const indexedFactions = [...world.factions]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((faction): CourtStruggleFactionIndex => {
      const ledger = calculateFactionPowerLedger(world, faction);
      return { faction, ledger, categoryValues: categoryValues(ledger) };
    });
  const factionsByPolityId = new Map<string, CourtStruggleFactionIndex[]>();
  for (const indexed of indexedFactions.filter((item) => item.faction.active)) {
    const group = factionsByPolityId.get(indexed.faction.polityId) ?? [];
    group.push(indexed);
    factionsByPolityId.set(indexed.faction.polityId, group);
  }
  for (const group of factionsByPolityId.values()) {
    group.sort((left, right) => (
      right.ledger.total - left.ledger.total
      || stableCompare(left.faction.id, right.faction.id)
    ));
  }
  return {
    charactersById: sortedMap(world.characters),
    politiesById: sortedMap(world.polities),
    factionsById: new Map(indexedFactions.map((item) => [item.faction.id, item])),
    factionsByPolityId,
  };
}

function courtActionFact(fact: SimulationFact): CourtActionResolvedFact | null {
  return fact.kind === 'court_action_resolved' ? fact : null;
}

function actorFactionId(index: CourtStruggleIndex, actorId: string): string | null {
  const character = index.charactersById.get(actorId);
  return character?.factionId && index.factionsById.has(character.factionId)
    ? character.factionId
    : null;
}

function relevantCourtActionFacts(
  facts: readonly SimulationFact[],
  polityId: string,
  factionId: string,
): CourtActionResolvedFact[] {
  return facts
    .map(courtActionFact)
    .filter((fact): fact is CourtActionResolvedFact => Boolean(
      fact
      && fact.polityIds.includes(polityId)
      && fact.payload.polityId === polityId
      && (
        fact.payload.actorFactionId === factionId
        || fact.payload.targetFactionId === factionId
        || fact.payload.affectedFactionIds.includes(factionId)
      ),
    ))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function courtFactFactionId(fact: CourtActionResolvedFact): string | null {
  const primary = fact.payload.action === 'coup'
    || fact.payload.action === 'usurpation'
    || fact.payload.action === 'power_broker_formed'
    ? fact.payload.actorFactionId
    : fact.payload.targetFactionId;
  const secondary = primary === fact.payload.actorFactionId
    ? fact.payload.targetFactionId
    : fact.payload.actorFactionId;
  return primary ?? secondary ?? fact.payload.affectedFactionIds[0] ?? null;
}

function relevantRelationFacts(
  facts: readonly SimulationFact[],
  polityId: string,
  factionId: string,
): Extract<SimulationFact, { kind: 'faction_relation_changed' }>[] {
  return facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'faction_relation_changed' }> => (
      fact.kind === 'faction_relation_changed'
      && fact.payload.polityId === polityId
      && (fact.payload.leftFactionId === factionId || fact.payload.rightFactionId === factionId)
    ))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function relevantResourceFacts(
  facts: readonly SimulationFact[],
  index: CourtStruggleIndex,
  polityId: string,
  factionId: string,
): SimulationFact[] {
  return facts
    .filter((fact) => {
      if (!fact.polityIds.includes(polityId)) return false;
      if (fact.kind === 'agency_support_resolved') {
        return actorFactionId(index, fact.payload.actorId) === factionId;
      }
      if (fact.kind === 'agency_intent_resolved') {
        return actorFactionId(index, fact.payload.actorId) === factionId
          || actorFactionId(index, fact.payload.previousCommanderId) === factionId;
      }
      if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
        return actorFactionId(index, fact.payload.holderId) === factionId;
      }
      return false;
    })
    .sort((left, right) => stableCompare(left.id, right.id));
}

function courtActionSignal(
  facts: readonly CourtActionResolvedFact[],
  challenger: CourtStruggleFactionIndex,
): CourtStruggleSignal | null {
  if (facts.length === 0) return null;
  let contribution = 0;
  for (const fact of facts) {
    const action = fact.payload.action;
    const scoreMargin = fact.payload.score - fact.payload.threshold;
    if (action === 'power_broker_formed') contribution += 9 + clamp(scoreMargin * 0.08, 0, 4);
    else if (action === 'power_broker_fell') contribution -= 20;
    else if (action === 'purge') {
      contribution += fact.payload.targetFactionId === challenger.faction.id ? -12 : 5;
    } else if (action === 'coup' || action === 'usurpation') {
      contribution += fact.payload.actorFactionId === challenger.faction.id ? 16 : -16;
    }
  }
  return makeSignal('recent_court_action',
      'trigger',
      contribution,
      factRefs(facts.map((fact) => fact.id)),
      facts.map((fact) => fact.id),
      8
  );
}

function relationSignal(
  facts: readonly Extract<SimulationFact, { kind: 'faction_relation_changed' }>[],
): CourtStruggleSignal | null {
  if (facts.length === 0) return null;
  let contribution = 0;
  for (const fact of facts) {
    if (fact.payload.relation === 'rivalry') contribution += fact.payload.action === 'formed' ? 7 : -4;
    else contribution += fact.payload.action === 'formed' ? 5 : -6;
  }
  return makeSignal('recent_faction_relation',
      'trigger',
      contribution,
      factRefs(facts.map((fact) => fact.id)),
      facts.map((fact) => fact.id),
      8
  );
}

function resourceFactSignal(facts: readonly SimulationFact[]): CourtStruggleSignal | null {
  if (facts.length === 0) return null;
  let contribution = 0;
  for (const fact of facts) {
    if (fact.kind === 'agency_support_resolved') {
      contribution += fact.payload.outcome === 'secured' ? 3 : fact.payload.outcome === 'refused' ? -2 : 0;
    } else if (fact.kind === 'agency_intent_resolved') {
      contribution += fact.payload.institutionResponse === 'command_granted'
        ? 6
        : fact.payload.institutionResponse === 'curbed'
          ? -8
          : fact.payload.institutionResponse === 'appeased'
            ? -2
            : 0;
    } else if (fact.kind === 'appointment_started') {
      contribution += fact.payload.officeKind === '军团主帅' || fact.payload.officeKind === '水师提督' ? 6 : 4;
    } else if (fact.kind === 'appointment_ended') {
      contribution -= fact.payload.officeKind === '军团主帅' || fact.payload.officeKind === '水师提督' ? 7 : 5;
    }
  }
  return makeSignal('recent_power_resource_change',
      contribution >= 0 ? 'trigger' : 'inhibitor',
      contribution,
      factRefs(facts.map((fact) => fact.id)),
      facts.map((fact) => fact.id),
      8
  );
}

function explicitResolution(
  courtFacts: readonly CourtActionResolvedFact[],
  relationFacts: readonly Extract<SimulationFact, { kind: 'faction_relation_changed' }>[],
  challenger: CourtStruggleFactionIndex,
  rulerFaction: CourtStruggleFactionIndex | null,
): { outcomeKey: string; resultFactIds: readonly string[] } | null {
  const resolutions: { factId: string; outcomeKey: string }[] = [];
  for (const fact of courtFacts) {
    const action = fact.payload.action;
    if (action === 'power_broker_fell') {
      resolutions.push({ factId: fact.id, outcomeKey: 'power_broker_fell' });
    }
    if (
      (action === 'coup' || action === 'usurpation')
      && fact.payload.rulerBeforeId !== fact.payload.rulerAfterId
    ) {
      resolutions.push({ factId: fact.id, outcomeKey: 'palace_coup_succeeded' });
    }
    if (
      action === 'purge'
      && fact.payload.targetFactionId === challenger.faction.id
      && challenger.ledger.total <= COURT_STRUGGLE_TEMPLATE.resolutionThreshold
    ) {
      resolutions.push({ factId: fact.id, outcomeKey: 'ruler_reasserted_control' });
    }
  }
  if (rulerFaction) {
    const directRelations = relationFacts
      .filter((fact) => new Set([
        fact.payload.leftFactionId,
        fact.payload.rightFactionId,
      ]).size === 2 && (
        (fact.payload.leftFactionId === challenger.faction.id && fact.payload.rightFactionId === rulerFaction.faction.id)
        || (fact.payload.rightFactionId === challenger.faction.id && fact.payload.leftFactionId === rulerFaction.faction.id)
      ))
      .sort((left, right) => stableCompare(right.id, left.id));
    const latestDirectRelation = directRelations[0];
    if (
      latestDirectRelation?.payload.relation === 'alliance'
      && latestDirectRelation.payload.action === 'formed'
    ) {
      resolutions.push({ factId: latestDirectRelation.id, outcomeKey: 'factional_compromise' });
    }
  }
  const resolution = resolutions.sort((left, right) => stableCompare(right.factId, left.factId))[0];
  return resolution
    ? { outcomeKey: resolution.outcomeKey, resultFactIds: [resolution.factId] }
    : null;
}

function participantIds(
  index: CourtStruggleIndex,
  polity: PolityState,
  challenger: CourtStruggleFactionIndex,
  rulerFaction: CourtStruggleFactionIndex | null,
  courtFacts: readonly CourtActionResolvedFact[],
): SituationParticipants {
  const leader = index.charactersById.get(challenger.faction.leaderId);
  const ruler = index.charactersById.get(polity.rulerId);
  const courtCharacters = courtFacts.flatMap((fact) => [
    index.charactersById.get(fact.payload.initiatorId),
    index.charactersById.get(fact.payload.targetId),
  ]).filter((item): item is CharacterState => Boolean(item));
  const allied = challenger.faction.alliedFactionIds
    .map((id) => index.factionsById.get(id))
    .filter((item): item is CourtStruggleFactionIndex => Boolean(item));
  const rivals = challenger.faction.rivalFactionIds
    .map((id) => index.factionsById.get(id))
    .filter((item): item is CourtStruggleFactionIndex => Boolean(item));
  const resources = challenger.ledger.resources;
  return {
    coreCharacterIds: uniqueSorted([
      polity.rulerId,
      challenger.faction.leaderId,
      ...courtFacts.flatMap((fact) => [fact.payload.initiatorId, fact.payload.targetId]),
    ], 6),
    supportingCharacterIds: uniqueSorted([
      ...challenger.faction.coreMemberIds.filter((id) => id !== challenger.faction.leaderId),
      ...allied.map((item) => item.faction.leaderId),
      ...courtFacts.flatMap((fact) => fact.payload.removedMemberIds),
    ], MAX_SUPPORTERS),
    opposingCharacterIds: uniqueSorted([
      ...(rulerFaction?.faction.coreMemberIds ?? []).filter((id) => id !== polity.rulerId),
      ...rivals.map((item) => item.faction.leaderId),
    ], MAX_OPPONENTS),
    familyIds: uniqueSorted([
      leader?.familyId ?? '',
      ruler?.familyId ?? '',
      ...courtCharacters.map((character) => character.familyId),
    ]),
    factionIds: uniqueSorted([
      challenger.faction.id,
      rulerFaction?.faction.id ?? '',
      ...challenger.faction.alliedFactionIds,
      ...challenger.faction.rivalFactionIds,
      ...courtFacts.flatMap((fact) => [
        fact.payload.actorFactionId ?? '',
        fact.payload.targetFactionId ?? '',
        ...fact.payload.affectedFactionIds,
      ]),
    ], 8),
    polityIds: [polity.id],
    regionIds: uniqueSorted(resources.flatMap((resource) => resource.regionIds), 12),
    armyIds: uniqueSorted(resources.flatMap((resource) => resource.evidence
      .filter((ref) => ref.entityType === 'army')
      .map((ref) => ref.entityId)), 12),
    fleetIds: uniqueSorted(resources.flatMap((resource) => resource.evidence
      .filter((ref) => ref.entityType === 'fleet')
      .map((ref) => ref.entityId)), 8),
  };
}

function possibleOutcomes(
  pressure: number,
  polity: PolityState,
  leader: CharacterState,
  challenger: CourtStruggleFactionIndex,
): SituationOutcomeOption[] {
  const categories = challenger.categoryValues;
  const coupCapacity = categories.central_office + categories.military_command + categories.cohesion;
  return [
    {
      key: 'ruler_reasserted_control',
      confidence: Math.round(clamp(polity.authority * 0.5 + polity.courtInfluence * 0.22 + (100 - pressure) * 0.18)),
    },
    {
      key: 'factional_compromise',
      confidence: Math.round(clamp(leader.loyalty * 0.34 + leader.caution * 0.2 + polity.legitimacy * 0.2 + challenger.faction.cohesion * 0.12)),
    },
    {
      key: 'power_broker_fell',
      confidence: Math.round(clamp(polity.authority * 0.36 + (100 - challenger.faction.cohesion) * 0.2 + pressure * 0.16)),
    },
    {
      key: 'palace_coup_succeeded',
      confidence: Math.round(clamp(coupCapacity * 0.65 + leader.ambition * 0.2 + (100 - leader.loyalty) * 0.16 + (100 - polity.authority) * 0.18)),
    },
  ].sort((left, right) => right.confidence - left.confidence || stableCompare(left.key, right.key));
}

function categorySignal(
  challenger: CourtStruggleFactionIndex,
  category: PoliticalPowerCategory,
  key: string,
  coefficient: number,
): CourtStruggleSignal {
  const value = challenger.categoryValues[category];
  return makeSignal(key,
      value > 0 ? 'structural' : 'inhibitor',
      value * coefficient,
      [indexRef('faction_power_ledger', challenger.faction.id, category, value)],
      [],
      8
  );
}

function buildCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<CourtStruggleIndex> },
  polity: PolityState,
  challenger: CourtStruggleFactionIndex,
  rulerFaction: CourtStruggleFactionIndex | null,
  forcedCourtFact: CourtActionResolvedFact | null,
): CourtStruggleCandidate | null {
  const leader = context.index.charactersById.get(challenger.faction.leaderId);
  const ruler = context.index.charactersById.get(polity.rulerId);
  const courtFacts = [...new Map([
    ...relevantCourtActionFacts(context.facts, polity.id, challenger.faction.id),
    ...(forcedCourtFact ? [forcedCourtFact] : []),
  ].map((fact) => [fact.id, fact])).values()].sort((left, right) => stableCompare(left.id, right.id));
  const relationFacts = relevantRelationFacts(context.facts, polity.id, challenger.faction.id);
  const resolution = explicitResolution(courtFacts, relationFacts, challenger, rulerFaction);
  if (!leader?.alive || !ruler?.alive || (leader.id === ruler.id && !resolution)) return null;
  const values = challenger.categoryValues;
  const resourceFacts = relevantResourceFacts(context.facts, context.index, polity.id, challenger.faction.id);
  const signals: CourtStruggleSignal[] = [
    categorySignal(challenger, 'central_office', 'challenger_central_office', 0.8),
    categorySignal(challenger, 'regional_office', 'challenger_regional_office', 0.55),
    categorySignal(challenger, 'military_command', 'challenger_military_command', 0.8),
  ];
  const familyRenown = values.family_backing + values.member_renown;
  signals.push(makeSignal('challenger_family_renown',
      familyRenown > 0 ? 'structural' : 'inhibitor',
      familyRenown * 0.25,
      [
      indexRef('faction_power_ledger', challenger.faction.id, 'family_backing', values.family_backing),
      indexRef('faction_power_ledger', challenger.faction.id, 'member_renown', values.member_renown),
    ],
      [],
      8
  ));
  signals.push(categorySignal(challenger, 'alliance_support', 'challenger_alliance_support', 0.65));
  signals.push(categorySignal(challenger, 'cohesion', 'challenger_cohesion', 0.55));

  const rulerPower = rulerFaction?.ledger.total ?? 0;
  const margin = challenger.ledger.total - rulerPower;
  signals.push(makeSignal('challenger_power_margin',
      margin >= 0 ? 'structural' : 'inhibitor',
      clamp(margin * 0.34, -10, 12),
      [
      indexRef('faction_power_ledger', challenger.faction.id, 'total', challenger.ledger.total),
      indexRef('faction_power_ledger', rulerFaction?.faction.id ?? polity.id, 'ruler_faction_total', rulerPower),
    ],
      [],
      8
  ));
  const authorityContribution = polity.authority <= 55
    ? clamp((60 - polity.authority) * 0.38, 1, 16)
    : -clamp((polity.authority - 52) * 0.22, 1, 10);
  signals.push(makeSignal(polity.authority <= 55 ? 'weak_court_authority' : 'strong_court_authority',
      polity.authority <= 55 ? 'structural' : 'inhibitor',
      authorityContribution,
      [
      indexRef('polity', polity.id, 'authority', polity.authority),
      indexRef('polity', polity.id, 'courtInfluence', polity.courtInfluence),
    ],
      [],
      8
  ));
  const opposedToRuler = Boolean(rulerFaction && challenger.faction.rivalFactionIds.includes(rulerFaction.faction.id));
  if (opposedToRuler) {
    signals.push(makeSignal('public_faction_rivalry',
      'trigger',
      7,
      [indexRef('faction', challenger.faction.id, `rivalry:${rulerFaction?.faction.id ?? ''}`, true)],
      [],
      8
    ));
  }
  const actionSignal = courtActionSignal(courtFacts, challenger);
  const factionRelationSignal = relationSignal(relationFacts);
  const movementSignal = resourceFactSignal(resourceFacts);
  if (actionSignal) signals.push(actionSignal);
  if (factionRelationSignal) signals.push(factionRelationSignal);
  if (movementSignal) signals.push(movementSignal);

  const institutionalKinds = [values.central_office, values.regional_office, values.military_command]
    .filter((value) => value > 0).length;
  const rawPressure = 8 + signals.reduce((sum, signal) => sum + signal.contribution, 0);
  const pressure = Math.round(clamp(institutionalKinds === 0 ? Math.min(38, rawPressure) : rawPressure));
  const coupCapable = values.central_office + values.military_command >= 20
    && values.cohesion >= 6
    && leader.ambition >= 65
    && leader.loyalty <= 65;
  const executableActorIds = uniqueSorted([
    polity.rulerId,
    ...(coupCapable ? [leader.id] : []),
  ], 4);
  const participants = participantIds(context.index, polity, challenger, rulerFaction, courtFacts);
  const sourceFactIds = uniqueSorted([
    ...courtFacts.map((fact) => fact.id),
    ...relationFacts.map((fact) => fact.id),
    ...resourceFacts.map((fact) => fact.id),
  ], MAX_SOURCE_FACTS);
  const nextWatch: CourtStruggleWatchSignal = {
    key: 'watch_court_power_resources',
    refs: [
      indexRef('faction_power_ledger', challenger.faction.id, 'central_office', values.central_office),
      indexRef('faction_power_ledger', challenger.faction.id, 'military_command', values.military_command),
      indexRef('faction_power_ledger', challenger.faction.id, 'alliance_support', values.alliance_support),
      indexRef('polity', polity.id, 'authority', polity.authority),
    ],
  };
  return {
    type: COURT_STRUGGLE_TYPE,
    scopeKey: polity.id,
    candidateKey: `${COURT_STRUGGLE_TYPE}:${polity.id}`,
    challengerFactionId: challenger.faction.id,
    rulerFactionId: rulerFaction?.faction.id ?? null,
    pressure,
    participants,
    executableActorIds,
    signals,
    sourceFactIds,
    nextWatch,
    possibleOutcomes: possibleOutcomes(pressure, polity, leader, challenger),
    resolution,
    importance: clamp(45 + pressure * 0.5),
    visibility: clamp(45 + pressure * 0.55),
  };
}

function resolutionFactForPolity(
  facts: readonly SimulationFact[],
  polityId: string,
): CourtActionResolvedFact | null {
  return facts
    .map(courtActionFact)
    .filter((fact): fact is CourtActionResolvedFact => Boolean(
      fact
      && fact.polityIds.includes(polityId)
      && (
        fact.payload.action === 'power_broker_fell'
        || fact.payload.action === 'purge'
        || fact.payload.action === 'coup'
        || fact.payload.action === 'usurpation'
      ),
    ))
    .sort((left, right) => stableCompare(right.id, left.id))[0] ?? null;
}

function compromiseFactionIdForPolity(
  facts: readonly SimulationFact[],
  polityId: string,
  rulerFactionId: string | null,
): string | null {
  if (!rulerFactionId) return null;
  const settledPairs = new Set<string>();
  for (const fact of [...facts].sort((left, right) => stableCompare(right.id, left.id))) {
    if (
      fact.kind !== 'faction_relation_changed'
      || fact.payload.polityId !== polityId
      || fact.payload.relation !== 'alliance'
      || (fact.payload.leftFactionId !== rulerFactionId && fact.payload.rightFactionId !== rulerFactionId)
    ) continue;
    const otherFactionId = fact.payload.leftFactionId === rulerFactionId
      ? fact.payload.rightFactionId
      : fact.payload.leftFactionId;
    const pairKey = [rulerFactionId, otherFactionId].sort(stableCompare).join(':');
    if (settledPairs.has(pairKey)) continue;
    settledPairs.add(pairKey);
    if (fact.payload.action === 'formed') return otherFactionId;
  }
  return null;
}

export function detectCourtStruggleCandidatesFromIndex(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<CourtStruggleIndex> },
): CourtStruggleCandidate[] {
  const candidates: CourtStruggleCandidate[] = [];
  for (const polity of [...context.index.politiesById.values()]
    .filter((item) => item.alive)
    .sort((left, right) => stableCompare(left.id, right.id))) {
    const ruler = context.index.charactersById.get(polity.rulerId);
    if (!ruler?.alive) continue;
    const factions = [...(context.index.factionsByPolityId.get(polity.id) ?? [])];
    const rulerFaction = ruler.factionId
      ? context.index.factionsById.get(ruler.factionId) ?? null
      : null;
    const resolutionFact = resolutionFactForPolity(context.facts, polity.id);
    const explicitFactionId = resolutionFact
      ? courtFactFactionId(resolutionFact)
      : compromiseFactionIdForPolity(context.facts, polity.id, rulerFaction?.faction.id ?? null);
    const explicitFaction = explicitFactionId
      ? context.index.factionsById.get(explicitFactionId)
      : undefined;
    const leadingChallenger = factions
      .filter((item) => (
        item.faction.id !== rulerFaction?.faction.id
        && item.faction.leaderId !== polity.rulerId
      ))
      .sort((left, right) => (
        right.ledger.total - left.ledger.total
        || stableCompare(left.faction.id, right.faction.id)
      ))[0];
    const challenger = explicitFaction ?? leadingChallenger ?? (resolutionFact ? factions[0] : undefined);
    if (!challenger || challenger.faction.polityId !== polity.id) continue;
    const candidate = buildCandidate(context, polity, challenger, rulerFaction, resolutionFact);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((left, right) => stableCompare(left.scopeKey, right.scopeKey));
}

export function detectCourtStruggleCandidates(
  world: WorldState,
  facts: readonly SimulationFact[],
): CourtStruggleCandidate[] {
  return detectCourtStruggleCandidatesFromIndex({
    turn: world.turn,
    facts,
    index: buildCourtStruggleIndex(world),
  });
}

export const courtStruggleDetector: SituationDetector<CourtStruggleIndex> = {
  id: COURT_STRUGGLE_TYPE,
  detect: detectCourtStruggleCandidatesFromIndex,
};
