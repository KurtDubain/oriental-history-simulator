import { describe, expect, it } from 'vitest';

import { stableHash } from '../random';
import { emitSimulationFact } from '../facts';
import type {
  HistoryEvent,
  OfficeAppointment,
  SimulationFact,
  WorldState,
} from '../types';
import { advanceWorld, advanceWorldBy, computeWorldHash, createWorld } from '../engine';
import { deserializeWorld, serializeWorld } from '../persistence';
import { processV02Politics } from '../v02';
import { calculateFactionPowerLedger, refreshFactionPowerLedgers } from '../politics/power-ledger';
import { validateRuntimeEmbodiedActions } from '../validation/embodiment';
import { reducePersonalMemorySystem } from './memory';
import { projectCharacterEmbodiedActions } from './decision';
import {
  createEmbodiedActionCommand,
  type EmbodiedActionCommand,
} from './embodiment';
import { courtAllianceIdentityFromCommand } from './embodied-court';

type PoliticsContext = Parameters<typeof processV02Politics>[1];
type PoliticsEmitter = Parameters<typeof processV02Politics>[2];

interface WinterCourtFixture {
  world: WorldState;
  polityId: string;
  dominantFactionId: string;
  aiPartnerFactionId: string;
  playerFactionId: string;
}

function addCourtOffice(
  world: WorldState,
  polityId: string,
  holderId: string,
  kind: Extract<OfficeAppointment['kind'], '宰辅' | '枢密使' | '廷臣'>,
  ordinal: number,
): void {
  world.counters.office += 1;
  world.offices.push({
    id: `office_v120_${ordinal}_${world.counters.office}`,
    polityId,
    kind,
    holderId,
    regionId: null,
    armyId: null,
    fleetId: null,
    rank: kind === '廷臣' ? 5 : 9,
    appointedTurn: world.turn,
    endedTurn: null,
    active: true,
  });
}

/**
 * A deliberately small winter court. Political resources, not a handwritten
 * faction.power value, establish the stable dominant/partner/player order.
 */
function winterCourtFixture(seed = 'v1.20-朝臣入世闭环'): WinterCourtFixture {
  const world = advanceWorldBy(createWorld(seed), 3);

  const polity = world.polities.find((item) => {
    const factions = world.factions.filter((faction) => faction.active && faction.polityId === item.id);
    const nonRuler = factions.filter((faction) => faction.leaderId !== item.rulerId);
    const hasRecordedPowerBroker = world.facts.some((fact) => (
      fact.kind === 'court_action_resolved'
      && fact.payload.polityId === item.id
      && fact.payload.action === 'power_broker_formed'
    ));
    return factions.length >= 3 && nonRuler.length >= 2 && !hasRecordedPowerBroker;
  });
  if (!polity) throw new Error('court fixture requires one polity with three factions and two non-ruler leaders');
  const factions = world.factions
    .filter((faction) => faction.active && faction.polityId === polity.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const nonRuler = factions.filter((faction) => faction.leaderId !== polity.rulerId);
  const dominant = nonRuler[0];
  const player = nonRuler[1];
  const aiPartner = factions.find((faction) => (
    faction.id !== dominant?.id
    && faction.id !== player?.id
    && faction.memberIds.length >= 2
  )) ?? factions.find((faction) => faction.id !== dominant?.id && faction.id !== player?.id);
  if (!dominant || !player || !aiPartner) throw new Error('court fixture requires three distinct factions');

  for (const item of world.polities) {
    item.lastCourtCrisisTurn = world.turn;
    item.authority = 100;
  }
  for (const faction of world.factions) {
    faction.alliedFactionIds = [];
    faction.rivalFactionIds = [];
    faction.relationSinceTurns = {};
    faction.lastActionTurn = world.turn;
    faction.lastLifecycleTurn = world.turn;
    faction.cohesion = faction.polityId === polity.id
      && [dominant.id, aiPartner.id, player.id].includes(faction.id)
      ? 100
      : 0;
  }
  for (const office of world.offices) {
    if (office.polityId === polity.id) {
      office.active = false;
      office.endedTurn = world.turn;
    }
  }
  for (const character of world.characters.filter((item) => item.polityId === polity.id)) {
    character.influence = 0;
    character.renown = 0;
    character.ambition = 0;
    character.loyalty = 100;
    character.caution = 100;
  }
  for (const family of world.families.filter((item) => item.polityId === polity.id)) {
    family.prestige = 0;
    family.politicalInfluence = 0;
    family.wealth = 0;
  }

  const dominantLeader = world.characters.find((item) => item.id === dominant.leaderId);
  const playerLeader = world.characters.find((item) => item.id === player.leaderId);
  const partnerLeader = world.characters.find((item) => item.id === aiPartner.leaderId);
  if (!dominantLeader || !playerLeader || !partnerLeader) throw new Error('court fixture requires three living leaders');
  for (const leader of [dominantLeader, playerLeader]) {
    leader.alive = true;
    leader.age = 36;
    leader.role = '廷臣';
    leader.polityId = polity.id;
  }
  for (const memberId of dominant.memberIds) {
    const member = world.characters.find((item) => item.id === memberId);
    if (!member) continue;
    member.influence = 100;
    member.renown = 100;
    const family = world.families.find((item) => item.id === member.familyId);
    if (family) {
      family.prestige = 100;
      family.politicalInfluence = 100;
      family.wealth = 1_000;
    }
  }

  addCourtOffice(world, polity.id, dominantLeader.id, '宰辅', 1);
  addCourtOffice(world, polity.id, dominantLeader.id, '枢密使', 2);
  addCourtOffice(world, polity.id, dominantLeader.id, '廷臣', 3);
  addCourtOffice(world, polity.id, partnerLeader.id, '宰辅', 4);
  addCourtOffice(world, polity.id, partnerLeader.id, '枢密使', 5);
  addCourtOffice(world, polity.id, playerLeader.id, '廷臣', 6);

  const successorId = aiPartner.memberIds.find((id) => id !== aiPartner.leaderId);
  if (successorId && !aiPartner.coreMemberIds.includes(successorId)) {
    aiPartner.coreMemberIds = [aiPartner.leaderId, successorId, ...aiPartner.coreMemberIds]
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 3);
  }

  refreshFactionPowerLedgers(world, polity.id);
  if (!(dominant.power > aiPartner.power && aiPartner.power > player.power)) {
    throw new Error(`court fixture power order drifted: ${dominant.power}/${aiPartner.power}/${player.power}`);
  }
  if (dominant.power >= 62) throw new Error(`court fixture must stay below the power-broker threshold: ${dominant.power}`);

  return {
    world,
    polityId: polity.id,
    dominantFactionId: dominant.id,
    aiPartnerFactionId: aiPartner.id,
    playerFactionId: player.id,
  };
}

function contextFor(world: WorldState, command: EmbodiedActionCommand | null = null): PoliticsContext {
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    facts: [],
    events: [],
    embodiedActionCommand: command,
  };
}

function eventEmitter(world: WorldState, context: PoliticsContext): PoliticsEmitter {
  return (input) => {
    world.counters.event += 1;
    const event: HistoryEvent = {
      id: `event_${String(world.counters.event).padStart(6, '0')}`,
      turn: context.turn,
      year: context.year,
      season: context.season,
      category: input.category,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      importance: input.importance,
      actorIds: [...new Set(input.actorIds ?? [])].sort(),
      polityIds: [...new Set(input.polityIds ?? [])].sort(),
      regionIds: [...new Set(input.regionIds ?? [])].sort(),
      causes: input.causes.map((cause) => ({ ...cause })),
      evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
      sourceFactIds: [...new Set(input.sourceFactIds ?? [])].sort(),
      situationIds: [...new Set(input.situationIds ?? [])].sort(),
    };
    context.events.push(event);
    world.history.push(event);
    world.historyDigest = stableHash([world.historyDigest, event]);
    return event;
  };
}

function runPolitics(world: WorldState, command: EmbodiedActionCommand | null = null) {
  const context = contextFor(world, command);
  processV02Politics(world, context, eventEmitter(world, context));
  return context;
}

function actionFor(world: WorldState, actorFactionId: string) {
  const faction = world.factions.find((item) => item.id === actorFactionId);
  if (!faction) throw new Error(`missing actor faction ${actorFactionId}`);
  const actions = projectCharacterEmbodiedActions(world, faction.leaderId);
  const action = actions.find((item) => item.command.kind === 'form_court_alliance');
  if (!action) throw new Error(`missing court action for ${faction.leaderId}`);
  return { faction, actions, action };
}

function courtResolution(
  facts: readonly SimulationFact[],
  actionId: string,
): Extract<SimulationFact, { kind: 'embodied_action_resolved' }> {
  const fact = facts.find((item): item is Extract<SimulationFact, { kind: 'embodied_action_resolved' }> => (
    item.kind === 'embodied_action_resolved' && item.payload.actionId === actionId
  ));
  if (!fact) throw new Error(`missing embodied resolution for ${actionId}`);
  return fact;
}

function formedAlliance(
  facts: readonly SimulationFact[],
  polityId: string,
): Extract<SimulationFact, { kind: 'faction_relation_changed' }>[] {
  return facts.filter((item): item is Extract<SimulationFact, { kind: 'faction_relation_changed' }> => (
    item.kind === 'faction_relation_changed'
    && item.payload.polityId === polityId
    && item.payload.relation === 'alliance'
    && item.payload.action === 'formed'
    && item.payload.reasonCode === 'court_support_exchange'
  ));
}

describe('v1.20 embodied court alliance', () => {
  it('does not invent a court bargain merely because a fixed world reaches winter', () => {
    const world = advanceWorldBy(createWorld('v1.20-natural-court-0'), 3);
    const before = stableHash(world);
    const courtActions = world.characters.flatMap((character) => (
      projectCharacterEmbodiedActions(world, character.id).filter((action) => (
        action.command.kind === 'form_court_alliance' && action.available
      ))
    ));

    expect(world.season).toBe('冬');
    expect(courtActions).toEqual([]);
    expect(stableHash(world)).toBe(before);
  });

  it('purely projects one fourth action for an adult courtier who leads a faction from a real central office', () => {
    const { world, dominantFactionId, aiPartnerFactionId } = winterCourtFixture();
    const before = stableHash(world);
    const { faction, actions, action } = actionFor(world, dominantFactionId);
    const identity = courtAllianceIdentityFromCommand(world, action.command);

    expect(actions).toHaveLength(4);
    expect(action).toMatchObject({
      label: '交换朝中支持',
      available: true,
      unavailableReason: null,
      command: {
        actorId: faction.leaderId,
        kind: 'form_court_alliance',
        targetKind: 'faction',
        targetId: aiPartnerFactionId,
      },
    });
    expect(identity).toMatchObject({
      valid: true,
      actorFactionId: dominantFactionId,
      targetFactionId: aiPartnerFactionId,
    });
    expect(stableHash(world)).toBe(before);
  });

  it('lets AI and player reach the same domain result without a player modifier, then traces every consequence', () => {
    const fixture = winterCourtFixture('v1.20-同一朝议裁决');
    const projected = actionFor(fixture.world, fixture.dominantFactionId).action;
    const aiWorld = structuredClone(fixture.world);
    const playerWorld = structuredClone(fixture.world);
    const aiContext = runPolitics(aiWorld);
    const playerContext = runPolitics(playerWorld, projected.command);
    const aiDomain = formedAlliance(aiContext.facts, fixture.polityId).find((fact) => (
      fact.payload.leftFactionId === fixture.dominantFactionId
    ));
    const playerDomain = formedAlliance(playerContext.facts, fixture.polityId).find((fact) => (
      fact.payload.leftFactionId === fixture.dominantFactionId
    ));
    if (!aiDomain || !playerDomain) throw new Error('both runs must form the same court alliance');
    const submission = playerContext.facts.find((fact) => fact.kind === 'embodied_action_submitted');
    const resolution = courtResolution(playerContext.facts, projected.command.actionId);

    expect(playerDomain.payload).toEqual(aiDomain.payload);
    expect(playerDomain.stateDeltas).toEqual(aiDomain.stateDeltas);
    expect(playerDomain.payload).toMatchObject({
      leftFactionId: fixture.dominantFactionId,
      rightFactionId: fixture.aiPartnerFactionId,
      leftLeaderId: projected.command.actorId,
    });
    expect(submission).toMatchObject({ stateDeltas: [], payload: { action: 'form_court_alliance' } });
    expect(resolution).toMatchObject({
      stateDeltas: [],
      sourceFactIds: [submission?.id, playerDomain.id],
      payload: {
        outcome: 'succeeded',
        reasonCode: 'accepted',
        domainFactId: playerDomain.id,
        score: expect.any(Number),
        threshold: 104,
      },
    });
    const left = playerWorld.factions.find((item) => item.id === fixture.dominantFactionId);
    const right = playerWorld.factions.find((item) => item.id === fixture.aiPartnerFactionId);
    expect(resolution.payload.score).toBe((left?.cohesion ?? 0) + (right?.cohesion ?? 0));
    expect(validateRuntimeEmbodiedActions(playerContext.facts)).toEqual([]);

    const event = playerWorld.history.find((item) => item.sourceFactIds.includes(playerDomain.id));
    const commitment = playerWorld.commitments.find((item) => item.eventId === event?.id);
    expect(event).toMatchObject({ kind: 'faction_alliance_formed', sourceFactIds: [playerDomain.id] });
    expect(commitment).toMatchObject({
      kind: '政治联盟',
      promisorId: playerDomain.payload.leftLeaderId,
      promiseeId: playerDomain.payload.rightLeaderId,
      madeTurn: 3,
      dueTurn: 19,
      status: '生效',
    });
    for (const [sourceId, targetId] of [
      [playerDomain.payload.leftLeaderId, playerDomain.payload.rightLeaderId],
      [playerDomain.payload.rightLeaderId, playerDomain.payload.leftLeaderId],
    ] as const) {
      expect(playerWorld.relationships.find((item) => (
        item.sourceId === sourceId && item.targetId === targetId
      ))?.memories).toContainEqual(expect.objectContaining({
        turn: 3,
        kind: '恩义',
        impact: 10,
        eventId: event?.id,
      }));
      expect(playerWorld.characters.find((item) => item.id === sourceId)?.biography).toContainEqual(
        expect.objectContaining({ factId: playerDomain.id, kind: '结成政治联盟' }),
      );
    }
    for (const faction of [left, right]) {
      if (!faction) throw new Error('missing allied faction after resolution');
      expect(faction.power).toBe(calculateFactionPowerLedger(playerWorld, faction).total);
      expect(calculateFactionPowerLedger(playerWorld, faction).categories.find((item) => (
        item.category === 'alliance_support'
      ))?.value).toBeGreaterThan(0);
    }

    playerWorld.agencySystem = reducePersonalMemorySystem(playerWorld, 3, playerContext.facts);
    expect(playerWorld.agencySystem.characters.find((item) => (
      item.characterId === projected.command.actorId
    ))?.memories).toContainEqual(expect.objectContaining({
      kind: 'court_alliance_formed',
      pinned: true,
      sourceFactIds: [playerDomain.id],
      subjectRefs: expect.arrayContaining([
        expect.objectContaining({ kind: 'character', id: playerDomain.payload.rightLeaderId, primary: true }),
      ]),
    }));

    const corrupted = structuredClone(playerContext.facts);
    const corruptedDomain = corrupted.find((item) => item.id === playerDomain.id);
    if (!corruptedDomain || corruptedDomain.kind !== 'faction_relation_changed') {
      throw new Error('missing copied court domain fact');
    }
    corruptedDomain.payload.rightFactionId = fixture.playerFactionId;
    expect(validateRuntimeEmbodiedActions(corrupted).map((item) => item.code))
      .toContain('runtime.embodied-action-domain');
  });

  it('keeps one submitted/resolved envelope across a full turn, save restore and deterministic continuation', () => {
    const fixture = winterCourtFixture('v1.20-朝臣完整回合与存档');
    fixture.world.hash = computeWorldHash(fixture.world);
    const saved = serializeWorld(fixture.world);
    const restored = deserializeWorld(saved);
    const directAction = actionFor(fixture.world, fixture.dominantFactionId).action;
    const restoredAction = actionFor(restored, fixture.dominantFactionId).action;

    expect(restoredAction.command).toEqual(directAction.command);
    const direct = advanceWorld(fixture.world, { embodiedAction: directAction.command });
    const afterLoad = advanceWorld(restored, { embodiedAction: restoredAction.command });
    const turnFacts = direct.facts.filter((fact) => fact.turn === 3);
    const submissions = turnFacts.filter((fact) => (
      fact.kind === 'embodied_action_submitted'
      && fact.payload.actionId === directAction.command.actionId
    ));
    const resolutions = turnFacts.filter((fact) => (
      fact.kind === 'embodied_action_resolved'
      && fact.payload.actionId === directAction.command.actionId
    ));

    expect(submissions).toHaveLength(1);
    expect(resolutions).toHaveLength(1);
    expect(validateRuntimeEmbodiedActions(turnFacts)).toEqual([]);
    expect(serializeWorld(afterLoad)).toBe(serializeWorld(direct));
    expect(serializeWorld(fixture.world)).toBe(saved);

    const directContinuation = advanceWorldBy(direct, 4);
    const restoredContinuation = advanceWorldBy(afterLoad, 4);
    expect(restoredContinuation.hash).toBe(directContinuation.hash);
    expect(serializeWorld(restoredContinuation)).toBe(serializeWorld(directContinuation));
  });

  it('defers a weaker non-dominant player in the same one-seat polity queue with an empty envelope', () => {
    const fixture = winterCourtFixture('v1.20-朝议单席队列');
    const projected = actionFor(fixture.world, fixture.playerFactionId).action;
    expect(projected.command.targetId).toBe(fixture.dominantFactionId);

    const context = runPolitics(fixture.world, projected.command);
    const resolution = courtResolution(context.facts, projected.command.actionId);
    const alliances = formedAlliance(context.facts, fixture.polityId);

    expect(alliances).toHaveLength(1);
    expect(alliances[0]?.payload).toMatchObject({
      leftFactionId: fixture.dominantFactionId,
      rightFactionId: fixture.aiPartnerFactionId,
    });
    expect(resolution).toMatchObject({
      stateDeltas: [],
      sourceFactIds: [expect.any(String)],
      payload: {
        outcome: 'deferred',
        reasonCode: 'insufficient_support',
        domainFactId: null,
      },
    });
    expect(resolution.payload.score).toBeLessThan(resolution.payload.threshold);
    expect(validateRuntimeEmbodiedActions(context.facts)).toEqual([]);
    const playerFaction = fixture.world.factions.find((item) => item.id === fixture.playerFactionId);
    expect(playerFaction?.alliedFactionIds).not.toContain(fixture.dominantFactionId);

    fixture.world.agencySystem = reducePersonalMemorySystem(fixture.world, 3, context.facts);
    expect(fixture.world.agencySystem.characters.find((item) => (
      item.characterId === projected.command.actorId
    ))?.memories.some((item) => item.kind === 'court_alliance_formed')).not.toBe(true);
  });

  it('invalidates forged cross-polity and retired targets without linking a domain mutation', () => {
    for (const scenario of ['cross-polity', 'retired'] as const) {
      const fixture = winterCourtFixture(`v1.20-伪造朝议-${scenario}`);
      const projected = actionFor(fixture.world, fixture.dominantFactionId).action;
      let command = projected.command;
      if (scenario === 'cross-polity') {
        const foreign = fixture.world.factions.find((item) => (
          item.active && item.polityId !== fixture.polityId
        ));
        if (!foreign) throw new Error('cross-polity scenario requires a foreign faction');
        command = createEmbodiedActionCommand(
          fixture.world,
          projected.command.actorId,
          'form_court_alliance',
          'faction',
          foreign.id,
        );
      } else {
        const target = fixture.world.factions.find((item) => item.id === projected.command.targetId);
        if (!target) throw new Error('retired scenario requires the projected target');
        target.active = false;
        target.endedTurn = fixture.world.turn;
        target.endedReason = 'core_exhausted';
      }

      const context = runPolitics(fixture.world, command);
      const resolution = courtResolution(context.facts, command.actionId);
      expect(resolution).toMatchObject({
        stateDeltas: [],
        sourceFactIds: [expect.any(String)],
        payload: {
          outcome: 'invalidated',
          reasonCode: 'conditions_changed',
          domainFactId: null,
        },
      });
      expect(validateRuntimeEmbodiedActions(context.facts)).toEqual([]);
    }
  });

  it('keeps an out-of-season court proposal disabled and invalidates a forged submission', () => {
    const fixture = winterCourtFixture('v1.20-非冬季朝议');
    fixture.world.season = '秋';
    const projected = actionFor(fixture.world, fixture.dominantFactionId).action;

    expect(projected.available).toBe(false);
    expect(projected.unavailableReason).toContain('只在冬季');
    const context = runPolitics(fixture.world, projected.command);
    const resolution = courtResolution(context.facts, projected.command.actionId);
    expect(resolution).toMatchObject({
      stateDeltas: [],
      sourceFactIds: [expect.any(String)],
      payload: {
        outcome: 'invalidated',
        reasonCode: 'conditions_changed',
        domainFactId: null,
      },
    });
    expect(formedAlliance(context.facts, fixture.polityId)).toEqual([]);
    expect(validateRuntimeEmbodiedActions(context.facts)).toEqual([]);
  });

  it('defers an otherwise valid proposal when the court must first record a fallen power broker', () => {
    const fixture = winterCourtFixture('v1.20-权臣失势先议');
    const projected = actionFor(fixture.world, fixture.dominantFactionId).action;
    const polity = fixture.world.polities.find((item) => item.id === fixture.polityId);
    const brokerFaction = fixture.world.factions.find((item) => item.id === fixture.playerFactionId);
    const broker = fixture.world.characters.find((item) => item.id === brokerFaction?.leaderId);
    const ruler = fixture.world.characters.find((item) => item.id === polity?.rulerId);
    if (!polity || !polity.capitalRegionId || !brokerFaction || !broker || !ruler) {
      throw new Error('fallen-broker fixture is incomplete');
    }
    emitSimulationFact(fixture.world, {
      turn: 2,
      year: 1,
      season: '秋',
      facts: [],
    }, {
      kind: 'court_action_resolved',
      category: '政治',
      importance: 3,
      actorIds: [broker.id, ruler.id],
      polityIds: [polity.id],
      regionIds: [polity.capitalRegionId],
      causes: [{ label: '既有权臣', role: '结果', weight: 1, evidence: `${broker.name}此前据有权力中枢` }],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        action: 'power_broker_formed',
        polityId: polity.id,
        actorFactionId: brokerFaction.id,
        targetFactionId: ruler.factionId,
        initiatorId: broker.id,
        targetId: ruler.id,
        reasonCode: 'v120_existing_broker',
        score: 66,
        threshold: 66,
        rulerBeforeId: ruler.id,
        rulerAfterId: ruler.id,
        affectedFactionIds: [brokerFaction.id],
        removedMemberIds: [],
      },
    });

    const context = runPolitics(fixture.world, projected.command);
    const resolution = courtResolution(context.facts, projected.command.actionId);
    expect(context.facts).toContainEqual(expect.objectContaining({
      kind: 'court_action_resolved',
      payload: expect.objectContaining({ action: 'power_broker_fell', targetId: broker.id }),
    }));
    expect(resolution).toMatchObject({
      stateDeltas: [],
      sourceFactIds: [expect.any(String)],
      payload: {
        outcome: 'deferred',
        reasonCode: 'insufficient_support',
        domainFactId: null,
      },
    });
    expect(formedAlliance(context.facts, fixture.polityId)).toEqual([]);
    expect(validateRuntimeEmbodiedActions(context.facts)).toEqual([]);
  });

  it('invalidates a stale proposal when lifecycle merges the actor into a newly identified faction', () => {
    const fixture = winterCourtFixture('v1.20-朝议发起派系合并');
    const projected = actionFor(fixture.world, fixture.dominantFactionId).action;
    const actorFaction = fixture.world.factions.find((item) => item.id === fixture.dominantFactionId);
    const donorFaction = fixture.world.factions.find((item) => item.id === fixture.playerFactionId);
    const targetFaction = fixture.world.factions.find((item) => item.id === projected.command.targetId);
    const actor = fixture.world.characters.find((item) => item.id === actorFaction?.leaderId);
    const donorLeader = fixture.world.characters.find((item) => item.id === donorFaction?.leaderId);
    if (!actorFaction || !donorFaction || !targetFaction || !actor || !donorLeader) {
      throw new Error('actor-merge scenario requires three live faction identities');
    }
    if (donorFaction.id === targetFaction.id) {
      throw new Error('actor-merge scenario requires a third faction outside the requested pair');
    }

    for (const faction of [actorFaction, donorFaction]) {
      for (const memberId of faction.memberIds) {
        if (memberId === faction.leaderId) continue;
        const member = fixture.world.characters.find((item) => item.id === memberId);
        if (member) member.factionId = null;
      }
      faction.lastLifecycleTurn = fixture.world.turn - 16;
      faction.cohesion = 100;
    }
    donorFaction.agenda = actorFaction.agenda;
    actorFaction.alliedFactionIds = [donorFaction.id];
    donorFaction.alliedFactionIds = [actorFaction.id];
    actorFaction.relationSinceTurns = { [donorFaction.id]: fixture.world.turn - 16 };
    donorFaction.relationSinceTurns = { [actorFaction.id]: fixture.world.turn - 16 };
    actor.influence = 100;
    actor.renown = 100;
    actor.cunning = 100;
    actor.merit = 100;
    donorLeader.influence = 0;
    donorLeader.renown = 0;
    donorLeader.cunning = 0;
    donorLeader.merit = 0;
    const relation = fixture.world.relationships.find((item) => (
      (item.sourceId === actor.id && item.targetId === donorLeader.id)
      || (item.sourceId === donorLeader.id && item.targetId === actor.id)
    ));
    if (relation) {
      relation.trust = 100;
      relation.grievance = 0;
    } else {
      fixture.world.relationships.push({
        id: 'rel_v120_actor_merge',
        sourceId: actor.id,
        targetId: donorLeader.id,
        kinship: '无',
        affinity: 80,
        trust: 100,
        fear: 0,
        grievance: 0,
        gratitude: 20,
        lastInteractionTurn: fixture.world.turn,
        memories: [],
      });
    }

    const context = runPolitics(fixture.world, projected.command);
    const resolution = courtResolution(context.facts, projected.command.actionId);
    const mergedFaction = fixture.world.factions.find((item) => (
      item.active
      && item.predecessorFactionIds.includes(actorFaction.id)
      && item.predecessorFactionIds.includes(donorFaction.id)
    ));

    expect(mergedFaction).toMatchObject({ leaderId: actor.id });
    expect(actor.factionId).toBe(mergedFaction?.id);
    expect(actor.factionId).not.toBe(actorFaction.id);
    expect(resolution).toMatchObject({
      stateDeltas: [],
      payload: {
        outcome: 'invalidated',
        reasonCode: 'conditions_changed',
        domainFactId: null,
      },
    });
    expect(validateRuntimeEmbodiedActions(context.facts)).toEqual([]);
  });

  it('invalidates a stale proposal when lifecycle maintenance replaces its target faction leader', () => {
    const fixture = winterCourtFixture('v1.20-朝议对象领袖变化');
    const projected = actionFor(fixture.world, fixture.dominantFactionId).action;
    const target = fixture.world.factions.find((item) => item.id === projected.command.targetId);
    if (!target) throw new Error('leader-change scenario requires the projected target faction');
    const oldLeaderId = target.leaderId;
    const successorId = target.memberIds.find((id) => id !== oldLeaderId);
    if (!successorId) throw new Error('leader-change scenario requires a successor');
    target.coreMemberIds = [oldLeaderId, successorId];
    const oldLeader = fixture.world.characters.find((item) => item.id === oldLeaderId);
    if (!oldLeader) throw new Error('leader-change scenario requires the old leader');
    oldLeader.factionId = null;

    const context = runPolitics(fixture.world, projected.command);
    const resolution = courtResolution(context.facts, projected.command.actionId);

    expect(target.leaderId).not.toBe(oldLeaderId);
    expect(resolution).toMatchObject({
      stateDeltas: [],
      sourceFactIds: [expect.any(String)],
      payload: {
        outcome: 'invalidated',
        reasonCode: 'conditions_changed',
        domainFactId: null,
      },
    });
    expect(validateRuntimeEmbodiedActions(context.facts)).toEqual([]);
  });
});
