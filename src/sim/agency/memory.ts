import { stableCompare, stableHash } from '../random';
import type {
  CharacterState,
  OfficeKind,
  SimulationFact,
  WorldState,
} from '../types';

export const MAX_PERSONAL_MEMORIES = 16;
export const MAX_PINNED_PERSONAL_MEMORIES = 4;
export const MAX_PERSONAL_MEMORY_SOURCE_FACTS = 4;
export const MAX_PERSONAL_MEMORY_SUBJECTS = 4;

export const PERSONAL_MEMORY_SCOPES = ['personal', 'political', 'military', 'family'] as const;
export type PersonalMemoryScope = (typeof PERSONAL_MEMORY_SCOPES)[number];

export const PERSONAL_MEMORY_KINDS = [
  'battle_victory',
  'battle_defeat',
  'office_gained',
  'office_lost',
  'marriage_formed',
  'war_began',
  'war_won',
  'war_lost',
  'war_settled',
  'territory_gained',
  'territory_lost',
  'situation_formed',
  'situation_escalated',
  'situation_resolved',
  'support_secured',
  'support_denied',
  'command_appeased',
  'command_curbed',
  'embodied_action_succeeded',
  'embodied_action_setback',
] as const;

export type PersonalMemoryKind = (typeof PERSONAL_MEMORY_KINDS)[number];
export type PersonalMemorySubjectKind = 'character' | 'polity' | 'family' | 'region' | 'army' | 'fleet' | 'war' | 'situation';

export interface PersonalMemorySubjectRef {
  kind: PersonalMemorySubjectKind;
  id: string;
  primary: boolean;
}

/**
 * Authoritative semantic memory. Player prose is deliberately projected later
 * so Chronicle wording can never feed back into simulation state.
 */
export interface PersonalMemoryState {
  id: string;
  characterId: string;
  scope: PersonalMemoryScope;
  kind: PersonalMemoryKind;
  qualifier: string | null;
  subjectRefs: readonly PersonalMemorySubjectRef[];
  firstTurn: number;
  lastTurn: number;
  occurrenceCount: number;
  salience: number;
  valence: number;
  pinned: boolean;
  sourceFactIds: readonly string[];
  evidenceDigest: string;
}

export interface CharacterPersonalMemoryState {
  characterId: string;
  memories: readonly PersonalMemoryState[];
}

export interface AgencySystemState {
  version: 1;
  memoryThroughTurn: number;
  characters: readonly CharacterPersonalMemoryState[];
}

export interface PersonalMemoryPlayerView {
  id: string;
  dateLabel: string;
  scopeLabel: string;
  title: string;
  interpretation: string;
  pinned: boolean;
  occurrences: number;
  sourceEventId: string | null;
}

interface MemoryCandidate {
  characterId: string;
  scope: PersonalMemoryScope;
  kind: PersonalMemoryKind;
  qualifier: string | null;
  subjects: readonly PersonalMemorySubjectRef[];
  turn: number;
  salience: number;
  valence: number;
  pinnedEligible: boolean;
  factId: string;
}

const SCOPE_LABELS: Readonly<Record<PersonalMemoryScope, string>> = {
  personal: '私事',
  political: '朝局',
  military: '军旅',
  family: '家门',
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function uniqueSubjects(subjects: readonly PersonalMemorySubjectRef[]): readonly PersonalMemorySubjectRef[] {
  const seen = new Set<string>();
  const result: PersonalMemorySubjectRef[] = [];
  for (const item of subjects) {
    if (!item.id) continue;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, primary: result.length === 0 });
    if (result.length >= MAX_PERSONAL_MEMORY_SUBJECTS) break;
  }
  return result;
}

function subject(kind: PersonalMemorySubjectKind, id: string, primary = false): PersonalMemorySubjectRef {
  return { kind, id, primary };
}

function memoryId(candidate: MemoryCandidate): string {
  const primary = candidate.subjects.find((item) => item.primary) ?? candidate.subjects[0];
  return `pm_${stableHash([
    candidate.characterId,
    candidate.scope,
    candidate.kind,
    candidate.qualifier,
    primary?.kind ?? 'none',
    primary?.id ?? 'none',
  ]).slice(0, 14)}`;
}

function recentSourceIds(previous: readonly string[], incoming: string): readonly string[] {
  const first = previous[0] ?? incoming;
  const recent = [...previous.slice(1), incoming]
    .filter((id, index, values) => values.indexOf(id) === index)
    .slice(-(MAX_PERSONAL_MEMORY_SOURCE_FACTS - 1));
  return [first, ...recent.filter((id) => id !== first)].slice(0, MAX_PERSONAL_MEMORY_SOURCE_FACTS);
}

function militaryOffice(kind: OfficeKind): boolean {
  return kind === '军团主帅' || kind === '军团副将' || kind === '水师提督' || kind === '水师副将';
}

function battleCandidates(fact: Extract<SimulationFact, { kind: 'battle' }>): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const force of [fact.payload.attacker, ...fact.payload.defenders]) {
    const attackingSide = force === fact.payload.attacker;
    const won = attackingSide === fact.payload.attackerWon;
    const lossesRatio = force.losses / Math.max(1, force.soldiersBefore);
    for (const characterId of [force.commanderId, force.deputyCommanderId].filter((id): id is string => Boolean(id))) {
      candidates.push({
        characterId,
        scope: 'military',
        kind: won ? 'battle_victory' : 'battle_defeat',
        qualifier: null,
        subjects: uniqueSubjects([
          subject('war', fact.payload.warId, true),
          subject('region', fact.payload.targetRegionId),
          subject('army', force.armyId),
        ]),
        turn: fact.turn,
        salience: clamp(fact.importance * 15 + lossesRatio * 28 + (force.deputyCommanderId === characterId ? 3 : 7)),
        valence: won ? clamp(45 + fact.importance * 7) : -clamp(45 + lossesRatio * 35),
        pinnedEligible: fact.importance >= 5 || lossesRatio >= 0.35,
        factId: fact.id,
      });
    }
  }
  return candidates;
}

function appointmentCandidates(
  fact: Extract<SimulationFact, { kind: 'appointment_started' | 'appointment_ended' }>,
): MemoryCandidate[] {
  const started = fact.kind === 'appointment_started';
  const primary = fact.payload.armyId
    ? subject('army', fact.payload.armyId, true)
    : fact.payload.fleetId
      ? subject('fleet', fact.payload.fleetId, true)
      : fact.payload.regionId
        ? subject('region', fact.payload.regionId, true)
        : subject('polity', fact.payload.polityId, true);
  return [{
    characterId: fact.payload.holderId,
    scope: militaryOffice(fact.payload.officeKind) ? 'military' : 'political',
    kind: started ? 'office_gained' : 'office_lost',
    qualifier: fact.payload.officeKind,
    subjects: uniqueSubjects([primary, subject('polity', fact.payload.polityId)]),
    turn: fact.turn,
    salience: clamp(22 + fact.payload.rank * 0.72),
    valence: started ? clamp(25 + fact.payload.rank * 0.55) : -clamp(20 + fact.payload.rank * 0.5),
    pinnedEligible: fact.payload.rank >= 80,
    factId: fact.id,
  }];
}

function marriageCandidates(fact: Extract<SimulationFact, { kind: 'marriage' }>): MemoryCandidate[] {
  const pairs = [
    [fact.payload.leftCharacterId, fact.payload.rightCharacterId, fact.payload.rightFamilyId],
    [fact.payload.rightCharacterId, fact.payload.leftCharacterId, fact.payload.leftFamilyId],
  ] as const;
  return pairs.map(([characterId, otherId, otherFamilyId]) => ({
    characterId,
    scope: 'family',
    kind: 'marriage_formed',
    qualifier: fact.payload.diplomatic ? 'diplomatic' : null,
    subjects: uniqueSubjects([
      subject('character', otherId, true),
      subject('family', otherFamilyId),
    ]),
    turn: fact.turn,
    salience: clamp(58 + (fact.payload.diplomatic ? 20 : 0)),
    valence: 55,
    pinnedEligible: fact.payload.diplomatic || fact.importance >= 4,
    factId: fact.id,
  }));
}

function warCandidates(
  world: WorldState,
  fact: Extract<SimulationFact, { kind: 'war_started' | 'war_ended' }>,
): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const characterId of fact.actorIds) {
    const character = world.characters.find((item) => item.id === characterId);
    if (!character) continue;
    const ownSide = character.polityId === fact.payload.attackerId
      ? fact.payload.attackerId
      : character.polityId === fact.payload.defenderId
        ? fact.payload.defenderId
        : null;
    if (!ownSide) continue;
    let kind: PersonalMemoryKind = 'war_began';
    let valence = -35;
    if (fact.kind === 'war_ended') {
      kind = fact.payload.winnerId === null ? 'war_settled' : fact.payload.winnerId === ownSide ? 'war_won' : 'war_lost';
      valence = fact.payload.winnerId === null ? 0 : fact.payload.winnerId === ownSide ? 70 : -70;
    }
    const otherPolityId = ownSide === fact.payload.attackerId ? fact.payload.defenderId : fact.payload.attackerId;
    candidates.push({
      characterId,
      scope: 'military',
      kind,
      qualifier: null,
      subjects: uniqueSubjects([
        subject('war', fact.payload.warId, true),
        subject('polity', otherPolityId),
      ]),
      turn: fact.turn,
      salience: clamp(fact.importance * 17),
      valence,
      pinnedEligible: fact.importance >= 5 || fact.kind === 'war_ended',
      factId: fact.id,
    });
  }
  return candidates;
}

function territoryCandidates(
  world: WorldState,
  fact: Extract<SimulationFact, { kind: 'territory_control_changed' }>,
): MemoryCandidate[] {
  return fact.actorIds.flatMap((characterId): MemoryCandidate[] => {
    const character = world.characters.find((item) => item.id === characterId);
    if (!character) return [];
    const gained = character.polityId === fact.payload.nextControllerId;
    const lost = character.polityId === fact.payload.previousControllerId;
    if (!gained && !lost) return [];
    return [{
      characterId,
      scope: fact.payload.reason === 'rebellion' ? 'political' : 'military',
      kind: gained ? 'territory_gained' : 'territory_lost',
      qualifier: fact.payload.reason,
      subjects: uniqueSubjects([
        subject('region', fact.payload.regionId, true),
        ...(fact.payload.warId ? [subject('war', fact.payload.warId)] : []),
      ]),
      turn: fact.turn,
      salience: clamp(fact.importance * 17),
      valence: gained ? 68 : -68,
      pinnedEligible: fact.importance >= 5,
      factId: fact.id,
    }];
  });
}

function situationCandidates(
  fact: Extract<SimulationFact, { kind: 'situation_milestone' }>,
): MemoryCandidate[] {
  const kind: PersonalMemoryKind = fact.payload.transition === 'formed'
    ? 'situation_formed'
    : fact.payload.transition === 'resolved'
      ? 'situation_resolved'
      : 'situation_escalated';
  const military = /war|military|军|战/.test(fact.payload.situationType);
  return fact.actorIds.map((characterId) => ({
    characterId,
    scope: military ? 'military' : 'political',
    kind,
    qualifier: fact.payload.situationType,
    subjects: uniqueSubjects([
      subject('situation', fact.payload.situationId, true),
      ...fact.polityIds.map((id) => subject('polity', id)),
      ...fact.regionIds.map((id) => subject('region', id)),
    ]),
    turn: fact.turn,
    salience: clamp(fact.importance * 16 + fact.payload.tension * 0.18),
    valence: fact.payload.transition === 'resolved' ? 0 : -clamp(25 + fact.payload.tension * 0.45),
    pinnedEligible: fact.importance >= 5 || fact.payload.toPhase === 'critical' || fact.payload.transition === 'resolved',
    factId: fact.id,
  }));
}

function supportCandidates(
  fact: Extract<SimulationFact, { kind: 'agency_support_resolved' }>,
): MemoryCandidate[] {
  const primary = fact.payload.targetKind === 'army_officers'
    ? subject('army', fact.payload.targetArmyId, true)
    : subject('character', fact.payload.targetId, true);
  return [{
    characterId: fact.payload.actorId,
    scope: fact.payload.targetKind === 'army_officers' ? 'military' : fact.payload.targetKind === 'family_head' ? 'family' : 'political',
    kind: fact.payload.outcome === 'secured' ? 'support_secured' : 'support_denied',
    qualifier: `${fact.payload.action}:${fact.payload.outcome}`,
    subjects: uniqueSubjects([primary, subject('army', fact.payload.targetArmyId), subject('polity', fact.payload.polityId)]),
    turn: fact.turn,
    salience: clamp(28 + fact.importance * 12),
    valence: fact.payload.outcome === 'secured' ? 48 : fact.payload.outcome === 'refused' ? -42 : -16,
    pinnedEligible: false,
    factId: fact.id,
  }];
}

function commandResponseCandidates(
  fact: Extract<SimulationFact, { kind: 'agency_intent_resolved' }>,
): MemoryCandidate[] {
  if (fact.payload.institutionResponse !== 'appeased' && fact.payload.institutionResponse !== 'curbed') return [];
  return [{
    characterId: fact.payload.actorId,
    scope: 'political',
    kind: fact.payload.institutionResponse === 'appeased' ? 'command_appeased' : 'command_curbed',
    qualifier: fact.payload.reasonCode,
    subjects: uniqueSubjects([
      subject('army', fact.payload.targetArmyId, true),
      subject('character', fact.payload.appointingAuthorityId),
      subject('polity', fact.payload.polityId),
    ]),
    turn: fact.turn,
    salience: fact.payload.institutionResponse === 'curbed' ? 72 : 54,
    valence: fact.payload.institutionResponse === 'curbed' ? -78 : 18,
    pinnedEligible: fact.payload.institutionResponse === 'curbed',
    factId: fact.id,
  }];
}

function embodiedActionCandidates(
  fact: Extract<SimulationFact, { kind: 'embodied_action_resolved' }>,
): MemoryCandidate[] {
  // Role-specific actions already produce the authoritative Agency support or
  // command memory. The observer envelope must not create a second memory for
  // the same deed.
  if (fact.payload.domainFactId) return [];
  const primary = fact.payload.targetKind === 'character'
    ? subject('character', fact.payload.targetId, true)
    : fact.payload.targetKind === 'army'
      ? subject('army', fact.payload.targetId, true)
      : subject('polity', fact.polityIds[0] ?? '', true);
  return [{
    characterId: fact.payload.actorId,
    scope: fact.payload.action === 'strengthen_relationship' ? 'personal' : 'political',
    kind: fact.payload.outcome === 'succeeded' ? 'embodied_action_succeeded' : 'embodied_action_setback',
    qualifier: `${fact.payload.action}:${fact.payload.outcome}`,
    subjects: uniqueSubjects([primary]),
    turn: fact.turn,
    salience: clamp(34 + fact.importance * 12),
    valence: fact.payload.outcome === 'succeeded' ? 50 : fact.payload.outcome === 'invalidated' ? -20 : -35,
    pinnedEligible: false,
    factId: fact.id,
  }];
}

function candidatesForFact(world: WorldState, fact: SimulationFact): MemoryCandidate[] {
  if (fact.kind === 'battle') return battleCandidates(fact);
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') return appointmentCandidates(fact);
  if (fact.kind === 'marriage') return marriageCandidates(fact);
  if (fact.kind === 'war_started' || fact.kind === 'war_ended') return warCandidates(world, fact);
  if (fact.kind === 'territory_control_changed') return territoryCandidates(world, fact);
  if (fact.kind === 'situation_milestone') return situationCandidates(fact);
  if (fact.kind === 'agency_support_resolved') return supportCandidates(fact);
  if (fact.kind === 'agency_intent_resolved') return commandResponseCandidates(fact);
  if (fact.kind === 'embodied_action_resolved') return embodiedActionCandidates(fact);
  return [];
}

function retentionScore(memory: PersonalMemoryState, turn: number): number {
  const agePenalty = Math.min(24, Math.floor(Math.max(0, turn - memory.lastTurn) / 4));
  const repetition = Math.min(12, Math.max(0, memory.occurrenceCount - 1) * 3);
  return memory.salience + repetition - agePenalty;
}

function mergeCandidate(memories: readonly PersonalMemoryState[], candidate: MemoryCandidate): readonly PersonalMemoryState[] {
  const id = memoryId(candidate);
  const existing = memories.find((memory) => memory.id === id);
  const pinnedCount = memories.filter((memory) => memory.pinned).length;
  const pinned = Boolean(existing?.pinned || (candidate.pinnedEligible && pinnedCount < MAX_PINNED_PERSONAL_MEMORIES));
  const next: PersonalMemoryState = existing
    ? {
        ...existing,
        lastTurn: Math.max(existing.lastTurn, candidate.turn),
        occurrenceCount: existing.occurrenceCount + 1,
        salience: Math.max(existing.salience, candidate.salience),
        valence: clamp(
          (existing.valence * existing.occurrenceCount + candidate.valence) / (existing.occurrenceCount + 1),
          -100,
          100,
        ),
        pinned,
        sourceFactIds: recentSourceIds(existing.sourceFactIds, candidate.factId),
        evidenceDigest: stableHash([existing.evidenceDigest, candidate.factId]),
      }
    : {
        id,
        characterId: candidate.characterId,
        scope: candidate.scope,
        kind: candidate.kind,
        qualifier: candidate.qualifier,
        subjectRefs: candidate.subjects,
        firstTurn: candidate.turn,
        lastTurn: candidate.turn,
        occurrenceCount: 1,
        salience: candidate.salience,
        valence: candidate.valence,
        pinned,
        sourceFactIds: [candidate.factId],
        evidenceDigest: stableHash([candidate.factId]),
      };
  return [...memories.filter((memory) => memory.id !== id), next];
}

function boundMemories(memories: readonly PersonalMemoryState[], turn: number): readonly PersonalMemoryState[] {
  return [...memories]
    .sort((left, right) => (
      Number(right.pinned) - Number(left.pinned)
      || retentionScore(right, turn) - retentionScore(left, turn)
      || right.lastTurn - left.lastTurn
      || right.occurrenceCount - left.occurrenceCount
      || stableCompare(left.id, right.id)
    ))
    .slice(0, MAX_PERSONAL_MEMORIES);
}

export function createAgencySystemState(memoryThroughTurn = -1): AgencySystemState {
  return { version: 1, memoryThroughTurn, characters: [] };
}

/** Consumes only one sealed quarter of typed Facts; Chronicle is never inspected. */
export function reducePersonalMemorySystem(
  world: WorldState,
  turn: number,
  facts: readonly SimulationFact[],
): AgencySystemState {
  const current = world.agencySystem;
  if (current.memoryThroughTurn >= turn) return current;
  if (current.memoryThroughTurn !== turn - 1) {
    throw new Error(`PersonalMemory expected turn ${current.memoryThroughTurn + 1}, received ${turn}`);
  }
  const states = new Map<string, { characterId: string; memories: PersonalMemoryState[] }>(current.characters.map((entry) => [
    entry.characterId,
    {
      characterId: entry.characterId,
      memories: entry.memories.map((memory) => ({
        ...memory,
        subjectRefs: memory.subjectRefs.map((ref) => ({ ...ref })),
        sourceFactIds: [...memory.sourceFactIds],
      })),
    },
  ]));
  const candidates = facts
    .flatMap((fact) => candidatesForFact(world, fact))
    .filter((candidate) => world.characters.some((character) => character.id === candidate.characterId))
    .sort((left, right) => stableCompare(left.factId, right.factId)
      || stableCompare(left.characterId, right.characterId)
      || stableCompare(memoryId(left), memoryId(right)));
  for (const candidate of candidates) {
    const state = states.get(candidate.characterId) ?? { characterId: candidate.characterId, memories: [] as PersonalMemoryState[] };
    state.memories = [...mergeCandidate(state.memories, candidate)];
    states.set(candidate.characterId, state);
  }
  return {
    version: 1,
    memoryThroughTurn: turn,
    characters: [...states.values()]
      .map((entry) => ({ ...entry, memories: boundMemories(entry.memories, turn) }))
      .filter((entry) => entry.memories.length > 0)
      .sort((left, right) => stableCompare(left.characterId, right.characterId)),
  };
}

function turnLabel(turn: number): string {
  const safe = Math.max(0, Math.floor(turn));
  const seasons = ['春', '夏', '秋', '冬'] as const;
  return `第 ${Math.floor(safe / 4) + 1} 年${seasons[safe % 4]}`;
}

function primarySubject(memory: PersonalMemoryState): PersonalMemorySubjectRef | null {
  return memory.subjectRefs.find((ref) => ref.primary) ?? memory.subjectRefs[0] ?? null;
}

function entityName(world: WorldState, ref: PersonalMemorySubjectRef | null): string {
  if (!ref) return '往事';
  if (ref.kind === 'character') return world.characters.find((item) => item.id === ref.id)?.name ?? '一位人物';
  if (ref.kind === 'polity') return world.polities.find((item) => item.id === ref.id)?.shortName ?? '一方政权';
  if (ref.kind === 'family') return world.families.find((item) => item.id === ref.id)?.name ?? '一个家族';
  if (ref.kind === 'region') return world.regions.find((item) => item.id === ref.id)?.name ?? '一地';
  if (ref.kind === 'army') return world.armies.find((item) => item.id === ref.id)?.name ?? '一支军团';
  if (ref.kind === 'fleet') return world.fleets.find((item) => item.id === ref.id)?.name ?? '一支水师';
  if (ref.kind === 'war') return world.wars.find((item) => item.id === ref.id)?.reason ?? '一场战事';
  const titleKey = world.situationSystem.situations.find((item) => item.id === ref.id)?.titleKey ?? '';
  if (titleKey.includes('inheritance_crisis')) return '继承风波';
  if (titleKey.includes('military_power_crisis')) return '军权之争';
  if (titleKey.includes('war_progress')) return '战局变迁';
  return '一场持续局势';
}

function memoryTitle(world: WorldState, memory: PersonalMemoryState): string {
  const name = entityName(world, primarySubject(memory));
  const repeated = memory.occurrenceCount > 1 ? `${memory.occurrenceCount}次` : '';
  if (memory.kind === 'battle_victory') return `${repeated}${name}战中得胜`;
  if (memory.kind === 'battle_defeat') return `${repeated}${name}战中失利`;
  if (memory.kind === 'office_gained') return `${repeated}受任${memory.qualifier ?? '官职'}`;
  if (memory.kind === 'office_lost') return `${repeated}卸下${memory.qualifier ?? '官职'}`;
  if (memory.kind === 'marriage_formed') return `与${name}结为婚姻`;
  if (memory.kind === 'war_began') return `${name}战事初起`;
  if (memory.kind === 'war_won') return `${name}战事告捷`;
  if (memory.kind === 'war_lost') return `${name}战事失利`;
  if (memory.kind === 'war_settled') return `${name}战事议定`;
  if (memory.kind === 'territory_gained') return `${name}归入己方`;
  if (memory.kind === 'territory_lost') return `${name}脱离己方`;
  if (memory.kind === 'situation_formed') return `${name}初现`;
  if (memory.kind === 'situation_escalated') return `${name}生变`;
  if (memory.kind === 'support_secured') return `${name}答应相助`;
  if (memory.kind === 'support_denied') return `${name}未肯相助`;
  if (memory.kind === 'command_appeased') return `请领${name}未准，另受安抚`;
  if (memory.kind === 'command_curbed') return `请领${name}未准并遭削权`;
  if (memory.kind === 'embodied_action_succeeded') return `与${name}有关的一件事办成了`;
  if (memory.kind === 'embodied_action_setback') return `与${name}有关的一件事未能如愿`;
  return `${name}落定`;
}

function memoryInterpretation(character: CharacterState, memory: PersonalMemoryState): string {
  const repeated = memory.occurrenceCount > 1 ? '这些反复出现的经历' : '这件事';
  if (memory.valence >= 25) return `${repeated}让${character.name}更相信自己的做法能够换来结果。`;
  if (memory.valence <= -25) return `${repeated}使${character.name}面对相似局面时多留一分戒心。`;
  return `${repeated}至今仍会影响${character.name}衡量眼前局势。`;
}

/** Player projection may link a Fact back to Chronicle, but simulation never does the reverse. */
export function toPersonalMemoryPlayerViews(world: WorldState, characterId: string): readonly PersonalMemoryPlayerView[] {
  const character = world.characters.find((item) => item.id === characterId);
  if (!character) return [];
  const state = world.agencySystem.characters.find((entry) => entry.characterId === characterId);
  if (!state) return [];
  return state.memories.map((memory) => {
    const sourceEvent = [...world.history].reverse().find((event) => (
      event.sourceFactIds.some((factId) => memory.sourceFactIds.includes(factId))
    ));
    return {
      id: memory.id,
      dateLabel: memory.firstTurn === memory.lastTurn
        ? turnLabel(memory.lastTurn)
        : `${turnLabel(memory.firstTurn)}至${turnLabel(memory.lastTurn)}`,
      scopeLabel: SCOPE_LABELS[memory.scope],
      title: memoryTitle(world, memory),
      interpretation: memoryInterpretation(character, memory),
      pinned: memory.pinned,
      occurrences: memory.occurrenceCount,
      sourceEventId: sourceEvent?.id ?? null,
    };
  });
}

function expectedMemoryId(memory: PersonalMemoryState): string {
  const primary = primarySubject(memory);
  return `pm_${stableHash([
    memory.characterId,
    memory.scope,
    memory.kind,
    memory.qualifier,
    primary?.kind ?? 'none',
    primary?.id ?? 'none',
  ]).slice(0, 14)}`;
}

/** Full-save validation for the bounded authoritative memory owner. */
export function validateAgencySystemState(world: WorldState): readonly string[] {
  const messages: string[] = [];
  const system = world.agencySystem;
  if (!system || system.version !== 1) return ['AgencySystem版本无效'];
  if (system.memoryThroughTurn !== world.turn - 1) {
    messages.push(`PersonalMemory游标应为${world.turn - 1}，实际${system.memoryThroughTurn}`);
  }
  const characterIds = new Set<string>();
  const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
  for (const entry of system.characters) {
    if (characterIds.has(entry.characterId)) messages.push(`${entry.characterId}存在重复PersonalMemory账户`);
    characterIds.add(entry.characterId);
    if (!world.characters.some((character) => character.id === entry.characterId)) {
      messages.push(`${entry.characterId}的PersonalMemory账户没有人物载体`);
    }
    if (entry.memories.length === 0 || entry.memories.length > MAX_PERSONAL_MEMORIES) {
      messages.push(`${entry.characterId}的PersonalMemory数量越界`);
    }
    if (entry.memories.filter((memory) => memory.pinned).length > MAX_PINNED_PERSONAL_MEMORIES) {
      messages.push(`${entry.characterId}的永久PersonalMemory超过上限`);
    }
    const memoryIds = new Set<string>();
    for (const memory of entry.memories) {
      if (memoryIds.has(memory.id)) messages.push(`${entry.characterId}存在重复记忆${memory.id}`);
      memoryIds.add(memory.id);
      if (memory.characterId !== entry.characterId || memory.id !== expectedMemoryId(memory)) {
        messages.push(`${memory.id}的记忆身份与人物或语义不一致`);
      }
      if (!PERSONAL_MEMORY_SCOPES.includes(memory.scope) || !PERSONAL_MEMORY_KINDS.includes(memory.kind)) {
        messages.push(`${memory.id}的记忆类型无效`);
      }
      if (!Number.isInteger(memory.firstTurn) || !Number.isInteger(memory.lastTurn)
        || memory.firstTurn < 0 || memory.firstTurn > memory.lastTurn || memory.lastTurn > system.memoryThroughTurn) {
        messages.push(`${memory.id}的记忆时间范围无效`);
      }
      if (!Number.isSafeInteger(memory.occurrenceCount) || memory.occurrenceCount < 1
        || !Number.isFinite(memory.salience) || memory.salience < 0 || memory.salience > 100
        || !Number.isFinite(memory.valence) || memory.valence < -100 || memory.valence > 100) {
        messages.push(`${memory.id}的次数、重要度或感受无效`);
      }
      if (memory.subjectRefs.length === 0 || memory.subjectRefs.length > MAX_PERSONAL_MEMORY_SUBJECTS
        || memory.subjectRefs.filter((ref) => ref.primary).length !== 1
        || memory.subjectRefs.some((ref) => !ref.id || ![
          'character', 'polity', 'family', 'region', 'army', 'fleet', 'war', 'situation',
        ].includes(ref.kind))) {
        messages.push(`${memory.id}的记忆对象引用无效`);
      }
      if (memory.sourceFactIds.length === 0 || memory.sourceFactIds.length > MAX_PERSONAL_MEMORY_SOURCE_FACTS
        || new Set(memory.sourceFactIds).size !== memory.sourceFactIds.length
        || memory.sourceFactIds.some((factId) => {
          const fact = factById.get(factId);
          return !fact || fact.turn < memory.firstTurn || fact.turn > memory.lastTurn;
        })
        || !memory.evidenceDigest) {
        messages.push(`${memory.id}的事实来源无效`);
      }
    }
  }
  return messages;
}
