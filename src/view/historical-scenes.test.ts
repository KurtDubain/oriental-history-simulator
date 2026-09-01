import { describe, expect, it } from 'vitest';
import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  projectCharacterEmbodiedActions,
} from '../sim';
import { compactWorldArchive } from '../sim/archive';
import type { SimulationFact } from '../sim/types';
import type { SituationState } from '../sim/situations';
import {
  projectFactNarrative,
  projectHistoricalScenes,
  projectSituationHistoricalScenes,
} from './historical-scenes';

describe('NAR01/NAR02 concrete historical scenes', () => {
  it('joins support, request, court response and direct consequences into one traceable scene', () => {
    let world = createWorld('军权春秋');
    let resolution = world.facts.find((fact) => fact.kind === 'agency_intent_resolved');
    for (let turn = 0; turn < 80 && !resolution; turn += 1) {
      world = advanceWorld(world);
      resolution = world.facts.find((fact) => fact.kind === 'agency_intent_resolved');
    }
    if (!resolution || resolution.kind !== 'agency_intent_resolved') throw new Error('expected a natural command resolution');
    const actor = world.characters.find((item) => item.id === resolution.payload.actorId);
    const army = world.armies.find((item) => item.id === resolution.payload.targetArmyId);
    const scene = projectHistoricalScenes(world, [resolution], 1)[0];
    expect(scene).toBeTruthy();
    expect(scene.shortText).toContain(actor?.name);
    expect(scene.shortText).toContain(army?.name);
    expect(scene.shortText).toMatch(/朝廷|军令/u);
    expect(scene.shortText).not.toMatch(/起源|进入发展|阶段转折|结构信号/u);
    expect(scene.sourceFactIds).toContain(resolution.id);
    expect(scene.sourceFactIds).toContain(resolution.payload.submissionFactId);
    const submission = world.facts.find((fact) => fact.id === resolution.payload.submissionFactId);
    expect(submission?.sourceFactIds.some((id) => scene.sourceFactIds.includes(id))).toBe(true);
  }, 30_000);

  it('joins a battle and same-quarter territorial transfer without reading Chronicle prose', () => {
    const world = advanceWorldBy(createWorld('具体战事场面'), 8);
    const battle = [...world.facts].reverse().find((fact) => fact.kind === 'battle');
    if (!battle || battle.kind !== 'battle') throw new Error('expected a natural battle');
    const related = world.facts.filter((fact) => (
      fact.turn === battle.turn
      && (
        fact.id === battle.id
        || (fact.kind === 'territory_control_changed' && fact.payload.warId === battle.payload.warId)
      )
    ));
    const withChronicle = projectHistoricalScenes(world, related, 1)[0];
    const withoutChronicle = projectHistoricalScenes({ ...world, history: [] }, related, 1)[0];
    expect(withChronicle.title).toContain('之战');
    expect(withChronicle.summary).toMatch(/取胜|守住/u);
    expect(withChronicle.shortText).toBe(withoutChronicle.shortText);
    expect(withoutChronicle.historyEventIds).toEqual([]);
  });

  it('makes the latest concrete scene the readable face of a Situation', () => {
    const world = advanceWorldBy(createWorld('局势具体场面'), 8);
    const situation = world.situationSystem.situations.find((item) => item.type === 'war_progress');
    if (!situation) throw new Error('expected a war Situation');
    const scenes = projectSituationHistoricalScenes(world, situation, 3);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.length).toBeLessThanOrEqual(3);
    expect(scenes[0].shortText).toMatch(/[㐀-鿿]+之战.*(取胜|守住)/u);
    expect(scenes[0].sourceFactIds.length).toBeGreaterThan(0);
  });

  it('names the people expelled in a court purge instead of hiding them behind a generic count', () => {
    const world = createWorld('朝堂清洗场面');
    const polity = world.polities.find((item) => item.alive);
    const factions = world.factions.filter((item) => item.active && item.polityId === polity?.id);
    const targetFaction = factions.find((item) => item.leaderId !== polity?.rulerId) ?? factions[0];
    const ruler = world.characters.find((item) => item.id === polity?.rulerId);
    const target = world.characters.find((item) => item.id === targetFaction?.leaderId);
    const removed = world.characters
      .filter((item) => item.id !== ruler?.id && item.id !== target?.id)
      .slice(0, 4);
    if (!polity || !targetFaction || !ruler || !target || removed.length < 4) throw new Error('expected court purge cast');
    const fact: SimulationFact = {
      id: 'fact_court_purge_scene',
      turn: world.turn,
      year: world.year,
      season: world.season,
      kind: 'court_action_resolved',
      category: '政治',
      importance: 4,
      actorIds: [ruler.id, target.id],
      polityIds: [polity.id],
      regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
      causes: [{ label: '中枢压制', role: '选择', weight: 1, evidence: '君主动用中央权威' }],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        action: 'purge',
        polityId: polity.id,
        actorFactionId: ruler.factionId,
        targetFactionId: targetFaction.id,
        initiatorId: ruler.id,
        targetId: target.id,
        reasonCode: 'central_reassertion',
        score: 72,
        threshold: 66,
        rulerBeforeId: ruler.id,
        rulerAfterId: ruler.id,
        affectedFactionIds: [targetFaction.id],
        removedMemberIds: removed.map((item) => item.id),
      },
    };

    const copy = projectFactNarrative(world, fact);
    expect(copy.title).toContain(targetFaction.name);
    expect(copy.summary).toContain(removed[0].name);
    expect(copy.summary).toContain(removed[1].name);
    expect(copy.summary).toContain(removed[2].name);
    expect(copy.summary).toContain(`等${removed.length}人`);
    expect(copy.summary).not.toContain('具名成员');
    expect(copy.summary).not.toContain('地方');
  });

  it('describes a broker only through the power roots frozen on its formation Fact', () => {
    const world = createWorld('POL06-权臣根基文案');
    const polity = world.polities.find((item) => item.alive);
    const ruler = world.characters.find((item) => item.id === polity?.rulerId);
    const faction = world.factions.find((item) => (
      item.active && item.polityId === polity?.id && item.leaderId !== ruler?.id
    ));
    const leader = world.characters.find((item) => item.id === faction?.leaderId);
    if (!polity || !ruler || !faction || !leader) throw new Error('expected court formation cast');
    const frozenRoots = '中枢官席18，地方任官16，家门声望14';
    const fact: SimulationFact = {
      id: 'fact_court_broker_roots', turn: world.turn, year: world.year, season: world.season,
      kind: 'court_action_resolved', category: '政治', importance: 3,
      actorIds: [leader.id, ruler.id], polityIds: [polity.id], regionIds: [],
      causes: [{ label: '派系资源', role: '结构', weight: 1, evidence: frozenRoots }],
      stateDeltas: [], sourceFactIds: [],
      payload: {
        action: 'power_broker_formed', polityId: polity.id,
        actorFactionId: faction.id, targetFactionId: ruler.factionId,
        initiatorId: leader.id, targetId: ruler.id,
        reasonCode: 'multi_resource_dominance', score: 70, threshold: 66,
        rulerBeforeId: ruler.id, rulerAfterId: ruler.id,
        affectedFactionIds: [faction.id], removedMemberIds: [],
      },
    };

    const copy = projectFactNarrative(world, fact);
    expect(copy.summary).toContain(frozenRoots);
    expect(copy.summary).not.toMatch(/军令|盟友|盟约/u);

    const fall: SimulationFact = {
      ...fact,
      id: 'fact_court_broker_fall_roots',
      causes: [{ label: '根基变化', role: '条件', weight: 1, evidence: `${faction.name}已经退出朝局` }],
      payload: {
        ...fact.payload,
        action: 'power_broker_fell',
        initiatorId: ruler.id,
        targetId: leader.id,
        actorFactionId: ruler.factionId,
        targetFactionId: faction.id,
        score: 0,
        threshold: 54,
      },
    };
    const fallCopy = projectFactNarrative(world, fall);
    expect(fallCopy.summary).toContain(`${faction.name}已经退出朝局`);
    expect(fallCopy.summary).not.toMatch(/官席|军令/u);
  });

  it('keeps same-polity third-party appointments and support out of a court struggle scene', () => {
    const world = createWorld('朝局第三派场面');
    const polity = world.polities.find((item) => (
      item.alive && world.factions.filter((faction) => faction.active && faction.polityId === item.id).length >= 3
    ));
    const [first, second, third] = world.factions.filter((item) => item.active && item.polityId === polity?.id);
    const related = world.characters.find((item) => item.id === first?.leaderId);
    const unrelated = world.characters.find((item) => item.id === third?.leaderId);
    const army = world.armies.find((item) => item.polityId === polity?.id);
    if (!polity || !first || !second || !third || !related || !unrelated || !army) {
      throw new Error('expected three same-polity factions and an army');
    }
    const appointment: SimulationFact = {
      id: 'fact_related_court_appointment', turn: world.turn, year: world.year, season: world.season,
      kind: 'appointment_started', category: '政治', importance: 2,
      actorIds: [related.id], polityIds: [polity.id], regionIds: [], causes: [], stateDeltas: [], sourceFactIds: [],
      payload: {
        appointmentId: 'office_related_court', action: 'started', officeKind: '宰辅', holderId: related.id,
        polityId: polity.id, regionId: null, armyId: null, fleetId: null, rank: 10,
      },
    };
    const unrelatedAppointment: SimulationFact = {
      ...appointment,
      id: 'fact_third_party_appointment',
      importance: 5,
      actorIds: [unrelated.id],
      payload: { ...appointment.payload, appointmentId: 'office_third_party', holderId: unrelated.id },
    };
    const unrelatedSupport: SimulationFact = {
      id: 'fact_third_party_support', turn: world.turn, year: world.year, season: world.season,
      kind: 'agency_support_resolved', category: '政治', importance: 5,
      actorIds: [unrelated.id], polityIds: [polity.id], regionIds: [army.regionId], causes: [], stateDeltas: [], sourceFactIds: [],
      payload: {
        actorId: unrelated.id, goalId: 'goal_third_party', planId: 'plan_third_party', planStepId: 'step_third_party',
        action: 'cultivate_military_support', attemptOrdinal: 1, targetKind: 'army_officers', targetId: unrelated.id,
        targetArmyId: army.id, targetArmyName: army.name, polityId: polity.id, outcome: 'secured', strength: 90,
        retryAfterTurn: null,
      },
    };
    const situation: SituationState = {
      id: 'situation_court_scene_filter', type: 'court_power_struggle', scopeKey: polity.id,
      titleKey: 'situation.court_power_struggle', status: 'open', phase: 'active',
      startedTurn: world.turn, phaseSinceTurn: world.turn, lastUpdatedTurn: world.turn, resolvedTurn: null,
      tension: 70, momentum: 4, consecutivePhaseRiseTurns: 1, consecutivePhaseFallTurns: 0,
      consecutiveBelowResolutionTurns: 0,
      participants: {
        coreCharacterIds: [related.id, second.leaderId], supportingCharacterIds: [], opposingCharacterIds: [],
        familyIds: [], factionIds: [first.id, second.id], polityIds: [polity.id], regionIds: [], armyIds: [], fleetIds: [],
      },
      executableActorIds: [related.id], signals: [], causalFactIds: [], milestoneFactIds: [], recentChanges: [],
      possibleOutcomes: [], nextWatch: { key: 'watch_court_power_resources', refs: [] },
      startSnapshot: { turn: world.turn, pressure: 70, participantDigest: 'participants', evidenceDigest: 'evidence' },
      resolution: null, importance: 4, visibility: 80,
    };
    world.facts = [appointment, unrelatedAppointment, unrelatedSupport];
    world.history = [];

    const scenes = projectSituationHistoricalScenes(world, situation, 3, null, 'active');

    expect(scenes[0]?.sourceFactIds).toEqual([appointment.id]);
    expect(scenes[0]?.shortText).toContain(related.name);
    expect(scenes.flatMap((scene) => scene.sourceFactIds)).not.toContain(unrelatedAppointment.id);
    expect(scenes.flatMap((scene) => scene.sourceFactIds)).not.toContain(unrelatedSupport.id);
  });

  it('shows the governor, place, measure, actual cost and local result instead of an action wrapper', () => {
    const initial = createWorld('地方施政场面');
    const actor = initial.characters.find((item) => item.alive && item.governedRegionId);
    const region = initial.regions.find((item) => item.id === actor?.governedRegionId);
    const polity = initial.polities.find((item) => item.id === actor?.polityId);
    if (!actor || !region || !polity) throw new Error('expected a local governor');
    actor.age = 35;
    actor.health = 100;
    actor.governance = 96;
    actor.loyalty = 90;
    region.unrest = 86;
    region.devastation = 38;
    region.food = Math.max(region.food, region.population * 2);
    polity.authority = 90;
    polity.administration = 92;
    polity.treasury = Math.max(polity.treasury, region.population);
    initial.hash = computeWorldHash(initial);
    const option = projectCharacterEmbodiedActions(initial, actor.id).find((item) => (
      item.command.kind === 'reduce_levy' && item.available
    ));
    if (!option) throw new Error('expected a tax relief action');
    const world = advanceWorld(initial, { embodiedAction: option.command });
    const fact = world.facts.find((item) => (
      item.turn === initial.turn
      && item.kind === 'local_governance_resolved'
      && item.payload.actorId === actor.id
    ));
    if (fact?.kind !== 'local_governance_resolved') throw new Error('expected local result fact');
    const scene = projectHistoricalScenes(world, [fact], 1)[0];
    expect(scene.shortText).toContain(actor.name);
    expect(scene.shortText).toContain(region.name);
    expect(scene.shortText).toContain('减免本季赋');
    expect(scene.shortText).toContain(new Intl.NumberFormat('zh-CN').format(fact.payload.treasurySpent));
    expect(scene.shortText).toMatch(/动荡由\d+降至\d+/u);
    expect(scene.shortText).not.toMatch(/人物行动|行动结果|阶段转折|结构信号/u);
  });

  it('links an exact cold Fact scene back to cold Chronicle while active mode stays hot-only', () => {
    const world = createWorld('冷卷事实场面');
    const person = world.characters[0];
    const fact: SimulationFact = {
      id: 'fact_000002',
      turn: 2,
      year: 1,
      season: '秋',
      kind: 'character_death',
      category: '人口',
      importance: 4,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [person.locationRegionId],
      causes: [{ label: '寿数已尽', role: '触发', weight: 1, evidence: '测试冷卷记录' }],
      stateDeltas: [{ entityType: 'character', entityId: person.id, field: 'alive', before: true, after: false }],
      sourceFactIds: [],
      payload: {
        characterId: person.id,
        age: person.age,
        role: person.role,
        health: person.health,
        diseaseId: person.activeDiseaseId,
      },
    };
    const coldEvent = {
      ...world.history[0],
      id: 'event_000002',
      turn: fact.turn,
      year: fact.year,
      season: fact.season,
      category: fact.category,
      kind: fact.kind,
      title: `${person.name}去世`,
      summary: `史册记录${person.name}生平至此。`,
      actorIds: [...fact.actorIds],
      polityIds: [...fact.polityIds],
      regionIds: [...fact.regionIds],
      sourceFactIds: [fact.id],
    };
    world.facts.push(fact);
    world.history.push(coldEvent);
    world.turn = 80;
    world.year = 21;
    world.season = '春';
    compactWorldArchive(world);

    expect(world.facts.some((item) => item.id === fact.id)).toBe(false);
    expect(projectHistoricalScenes(world, [fact], 1)[0].historyEventIds).toEqual([coldEvent.id]);
    expect(projectHistoricalScenes(world, [fact], 1, 'active')[0].historyEventIds).toEqual([]);
  });
});
