import { describe, expect, it } from 'vitest';

import { createWorld } from '../sim';
import {
  compactWorldArchive,
  readWorldHistory,
} from '../sim/archive';
import type { SituationState } from '../sim/situations';
import type { HistoryEvent, SimulationFact, WorldState } from '../sim/types';
import { toFamilyArchive, toFamilyInspector } from './family-dossier-adapter';
import { toPersonArchive, toPersonInspector } from './person-dossier-adapter';
import {
  projectFamilyPoliticalFocus,
  projectHistoryEventPoliticalFocus,
  projectPersonPoliticalFocus,
  projectSituationPoliticalFocus,
} from './political-focus';
import { projectSituationSnapshotItem } from './situation-snapshot';

type CourtActionResolvedFact = Extract<SimulationFact, { kind: 'court_action_resolved' }>;
type SituationMilestoneFact = Extract<SimulationFact, { kind: 'situation_milestone' }>;

function nextFactId(world: WorldState): string {
  world.counters.fact += 1;
  return `fact_${String(world.counters.fact).padStart(7, '0')}`;
}

function nextEventId(world: WorldState): string {
  world.counters.event += 1;
  return `event_${String(world.counters.event).padStart(6, '0')}`;
}

function appendFactionSourceChain(
  world: WorldState,
  actorFactionId: string,
  targetFactionId: string,
  distractorName: string,
): HistoryEvent {
  const polityId = world.factions.find((item) => item.id === actorFactionId)?.polityId
    ?? world.polities[0].id;
  const initiatorId = world.characters[0].id;
  const targetId = world.characters[1].id;
  const direct: CourtActionResolvedFact = {
    id: nextFactId(world),
    turn: 1,
    year: 1,
    season: '夏',
    kind: 'court_action_resolved',
    category: '政治',
    importance: 3,
    actorIds: [initiatorId, targetId],
    polityIds: [polityId],
    regionIds: [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      action: 'purge',
      polityId,
      actorFactionId,
      targetFactionId,
      initiatorId,
      targetId,
      reasonCode: 'test_explicit_factions',
      score: 70,
      threshold: 60,
      rulerBeforeId: initiatorId,
      rulerAfterId: initiatorId,
      affectedFactionIds: [actorFactionId, targetFactionId],
      removedMemberIds: [],
    },
  };
  const wrapper: SituationMilestoneFact = {
    id: nextFactId(world),
    turn: 2,
    year: 1,
    season: '秋',
    kind: 'situation_milestone',
    category: '政治',
    importance: 3,
    actorIds: [],
    polityIds: [polityId],
    regionIds: [],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [direct.id],
    payload: {
      situationId: 'situation_focus_test',
      situationType: 'court_power_struggle',
      transition: 'formed',
      fromPhase: null,
      toPhase: 'emerging',
      tension: 60,
      momentum: 4,
      outcomeKey: null,
    },
  };
  const event: HistoryEvent = {
    id: nextEventId(world),
    turn: 2,
    year: 1,
    season: '秋',
    category: '政治',
    kind: 'focus_test_event',
    title: `${distractorName}据说参与朝议`,
    summary: `这段文案反复提到${distractorName}，但来源 Fact 并未登记它。`,
    importance: 3,
    actorIds: [],
    polityIds: [polityId],
    regionIds: [],
    causes: [],
    evidence: [],
    stateDeltas: [],
    sourceFactIds: [wrapper.id],
    situationIds: [],
  };
  world.facts.push(direct, wrapper);
  world.history.push(event);
  return event;
}

function situationWithFactions(world: WorldState, factionIds: readonly string[]): SituationState {
  const polityId = world.factions.find((item) => item.id === factionIds[0])?.polityId
    ?? world.polities[0].id;
  return {
    id: 'situation_political_focus',
    type: 'court_power_struggle',
    scopeKey: polityId,
    titleKey: 'court_power_struggle',
    status: 'open',
    phase: 'active',
    startedTurn: 1,
    phaseSinceTurn: 1,
    lastUpdatedTurn: 1,
    resolvedTurn: null,
    tension: 70,
    momentum: 2,
    consecutivePhaseRiseTurns: 0,
    consecutivePhaseFallTurns: 0,
    consecutiveBelowResolutionTurns: 0,
    participants: {
      coreCharacterIds: [],
      supportingCharacterIds: [],
      opposingCharacterIds: [],
      familyIds: [],
      factionIds,
      polityIds: [polityId],
      regionIds: [],
      armyIds: [],
      fleetIds: [],
    },
    executableActorIds: [],
    signals: [],
    causalFactIds: [],
    milestoneFactIds: [],
    recentChanges: [],
    possibleOutcomes: [],
    nextWatch: { key: 'watch_court_balance', refs: [] },
    startSnapshot: {
      turn: 1,
      pressure: 70,
      participantDigest: 'participants',
      evidenceDigest: 'evidence',
    },
    resolution: null,
    importance: 70,
    visibility: 80,
  };
}

describe('political focus projection', () => {
  it('uses a person factionId rather than names, roles or dossier prose', () => {
    const world = createWorld('POL07-人物真实派系');
    const person = world.characters.find((item) => item.factionId !== null);
    if (!person?.factionId) throw new Error('expected an affiliated person');
    const faction = world.factions.find((item) => item.id === person.factionId);
    const distractor = world.factions.find((item) => item.id !== person.factionId);
    if (!faction || !distractor) throw new Error('expected two factions');
    person.name = distractor.name;
    person.biographyDigest = `${distractor.name}所属派系`;
    const before = JSON.stringify(world);

    const focus = projectPersonPoliticalFocus(world, person);

    expect(focus).toEqual([expect.objectContaining({
      polityId: faction.polityId,
      factionId: faction.id,
      factionName: faction.name,
      active: faction.active,
    })]);
    expect(focus.some((link) => link.factionId === distractor.id)).toBe(false);
    expect(toPersonInspector(world, person).politicalFocus).toEqual(focus);
    expect(toPersonArchive(world, person).politicalFocus).toEqual(focus);
    expect(JSON.stringify(world)).toBe(before);

    person.factionId = null;
    person.name = faction.name;
    expect(projectPersonPoliticalFocus(world, person)).toEqual([]);
  });

  it('returns every ledger-backed family faction without claiming one family-wide affiliation', () => {
    const world = createWorld('POL07-家族多派并立');
    const factions = world.factions.filter((item) => item.active).slice(0, 2);
    const family = world.families.find((item) => item.active);
    const members = world.characters.filter((item) => item.alive).slice(0, 2);
    if (factions.length < 2 || !family || members.length < 2) {
      throw new Error('expected two factions, a family and two living people');
    }
    const otherFamily = world.families.find((item) => item.id !== family.id);
    for (const character of world.characters) {
      if (character.familyId === family.id && !members.includes(character) && otherFamily) {
        character.familyId = otherFamily.id;
      }
    }
    family.memberIds = [];
    members.forEach((member, index) => {
      for (const faction of world.factions) {
        faction.memberIds = faction.memberIds.filter((id) => id !== member.id);
        faction.coreMemberIds = faction.coreMemberIds.filter((id) => id !== member.id);
      }
      member.alive = true;
      member.familyId = family.id;
      member.polityId = factions[index].polityId;
      member.factionId = factions[index].id;
      factions[index].memberIds.push(member.id);
      if (!family.memberIds.includes(member.id)) family.memberIds.push(member.id);
    });
    const before = JSON.stringify(world);

    const focus = projectFamilyPoliticalFocus(world, family);

    expect(focus.map((link) => link.factionId).sort()).toEqual(factions.map((item) => item.id).sort());
    expect(focus).toHaveLength(2);
    expect(focus.every((link) => link.active && link.detail.includes('权势支点'))).toBe(true);
    expect(focus.every((link) => !link.detail.includes('唯一'))).toBe(true);
    expect(toFamilyInspector(world, family).politicalFocus).toEqual(focus);
    expect(toFamilyArchive(world, family).politicalFocus).toEqual(focus);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('follows hot and cold source-Fact chains, ignores prose matches, and retains ended factions', () => {
    const world = createWorld('POL07-史事冷热事实');
    const [endedFaction, activeFaction, distractor] = world.factions.slice(0, 3);
    if (!endedFaction || !activeFaction || !distractor) throw new Error('expected three factions');
    endedFaction.active = false;
    endedFaction.endedTurn = 6;
    const event = appendFactionSourceChain(world, endedFaction.id, activeFaction.id, distractor.name);

    const hot = projectHistoryEventPoliticalFocus(world, event);
    expect(hot.map((link) => link.factionId).sort()).toEqual([endedFaction.id, activeFaction.id].sort());
    expect(hot.some((link) => link.factionId === distractor.id)).toBe(false);
    expect(hot.find((link) => link.factionId === endedFaction.id)).toMatchObject({
      active: false,
      detail: expect.stringContaining('退出当下朝局'),
    });

    world.turn = 80;
    world.year = 21;
    world.season = '春';
    compactWorldArchive(world);
    expect(world.facts.some((fact) => event.sourceFactIds.includes(fact.id))).toBe(false);
    const coldEvent = readWorldHistory(world).find((item) => item.id === event.id);
    if (!coldEvent) throw new Error('expected the cold Chronicle event');
    const before = JSON.stringify(world);

    expect(projectHistoryEventPoliticalFocus(world, coldEvent)).toEqual(hot);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('uses only persisted Situation faction participants and exposes them on snapshots', () => {
    const world = createWorld('POL07-局势参与派系');
    const [activeFaction, endedFaction, distractor] = world.factions.slice(0, 3);
    if (!activeFaction || !endedFaction || !distractor) throw new Error('expected three factions');
    endedFaction.active = false;
    endedFaction.endedTurn = 4;
    const situation = situationWithFactions(world, [
      activeFaction.id,
      endedFaction.id,
      activeFaction.id,
      'faction_missing',
    ]);
    situation.titleKey = distractor.name;
    const before = JSON.stringify(world);

    const focus = projectSituationPoliticalFocus(world, situation);

    expect(focus.map((link) => link.factionId).sort()).toEqual([activeFaction.id, endedFaction.id].sort());
    expect(focus.find((link) => link.factionId === endedFaction.id)).toMatchObject({
      active: false,
      detail: expect.stringContaining('退出当下朝局'),
    });
    expect(focus.some((link) => link.factionId === distractor.id)).toBe(false);
    expect(projectSituationSnapshotItem(situation, world).politicalFocus).toEqual(focus);
    expect(JSON.stringify(world)).toBe(before);
  });
});
