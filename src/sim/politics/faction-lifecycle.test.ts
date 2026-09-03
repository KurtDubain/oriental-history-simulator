import { describe, expect, it } from 'vitest';
import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  deserializeWorld,
  serializeWorld,
  stableHash,
} from '../index';
import type { FactionKind, PoliticalClass, Season, WorldState } from '../types';
import { validateCommitmentState } from '../validation/commitments';
import { validateFactionState } from '../validation/factions';
import {
  changeFactionRelation,
  bootstrapFactionModel,
  endPolityFactions,
  expelFactionMembers,
  factionKindFor,
  processFactionLifecycle,
  settleFactionDepartures,
} from './faction-lifecycle';

function quarterContext(
  world: WorldState,
  turnOffset = 1,
  season: Season = '夏',
): FactTurnBuffer {
  return {
    turn: world.turn + turnOffset,
    year: world.year,
    season,
    facts: [],
  };
}

function moveToQuarter(
  world: WorldState,
  turn: number,
  season: Season,
): FactTurnBuffer {
  world.turn = turn;
  world.year = Math.floor(turn / 4) + 1;
  world.season = season;
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    facts: [],
  };
}

describe('POL02 stable faction identity and lifecycle', () => {
  it('settles a group leader departure in the same quarter with causal evidence', () => {
    const world = createWorld('POL02-首领离境结算');
    const faction = world.factions.find((item) => item.active && item.coreMemberIds.length >= 2);
    if (!faction) throw new Error('expected a succession-capable group');
    const leader = world.characters.find((character) => character.id === faction.leaderId);
    const destination = world.polities.find((polity) => polity.id !== faction.polityId);
    if (!leader || !destination) throw new Error('expected leader and destination polity');
    const context = moveToQuarter(world, 1, '夏');
    const departureFact = emitSimulationFact(world, context, {
      kind: 'territory_control_changed', category: '政治', importance: 5,
      actorIds: [leader.id], polityIds: [faction.polityId, destination.id], regionIds: [leader.locationRegionId],
      causes: [{ label: '地方离境', role: '结果', weight: 1, evidence: `${leader.name}脱离旧属` }],
      stateDeltas: [{ entityType: 'character', entityId: leader.id, field: 'factionId', before: faction.id, after: null }],
      sourceFactIds: [],
      payload: { regionId: leader.locationRegionId, previousControllerId: faction.polityId, nextControllerId: destination.id, reason: 'rebellion', warId: null },
    });
    const previousLeaderId = leader.id;
    leader.polityId = destination.id;
    expelFactionMembers(world, faction.id, [leader.id]);
    settleFactionDepartures(world, context, [faction.id], [departureFact.id]);
    const afterFaction = world.factions.find((item) => item.id === faction.id);
    if (!afterFaction) throw new Error('expected the prior group after departure');

    expect(leader.factionId).toBeNull();
    expect(afterFaction.active).toBe(true);
    expect(afterFaction.leaderId).not.toBe(previousLeaderId);
    expect(afterFaction.memberIds).toContain(afterFaction.leaderId);
    expect(afterFaction.coreMemberIds).toContain(afterFaction.leaderId);
    expect(validateFactionState(world)).toEqual([]);

    const successionFact = context.facts.find((fact) => (
      fact.kind === 'faction_lifecycle'
      && fact.payload.transition === 'leader_changed'
      && fact.payload.affectedFactionIds.includes(faction.id)
      && fact.payload.previousLeaderId === previousLeaderId
    ));
    if (!successionFact || successionFact.kind !== 'faction_lifecycle') {
      throw new Error('expected causally linked departure and faction succession Facts');
    }
    expect(successionFact.payload).toMatchObject({
      reasonCode: 'leader_departed',
      nextLeaderId: afterFaction.leaderId,
    });
    expect(successionFact.sourceFactIds).toContain(departureFact.id);
  });
  it('forms two to four deterministic power-root groups per polity without forcing every adult into one', () => {
    const world = createWorld('POL02-开局派系身份');
    const repeated = createWorld('POL02-开局派系身份');
    const adults = world.characters.filter((character) => character.alive && character.age >= 16);
    const factions = world.factions.filter((faction) => faction.active);
    const membershipIds = factions.flatMap((faction) => faction.memberIds);

    expect(stableHash(world.factions)).toBe(stableHash(repeated.factions));
    expect(new Set(membershipIds).size).toBe(membershipIds.length);
    expect(membershipIds.length).toBeLessThan(adults.length);
    let crossedOldClassBoundary = false;

    for (const character of adults) {
      expect(factions.filter((faction) => faction.memberIds.includes(character.id)).map((faction) => faction.id))
        .toEqual(character.factionId ? [character.factionId] : []);
    }
    for (const polity of world.polities.filter((item) => item.alive)) {
      const active = factions.filter((faction) => faction.polityId === polity.id);
      expect(active.length).toBeGreaterThanOrEqual(2);
      expect(active.length).toBeLessThanOrEqual(4);
      for (const army of world.armies.filter((item) => item.polityId === polity.id && item.deputyCommanderId)) {
        const commander = world.characters.find((item) => item.id === army.commanderId);
        const deputy = world.characters.find((item) => item.id === army.deputyCommanderId);
        if (commander?.politicalClass !== deputy?.politicalClass) crossedOldClassBoundary = true;
        expect(commander?.factionId).toBeTruthy();
        expect(deputy?.factionId).toBe(commander?.factionId);
      }
    }
    expect(crossedOldClassBoundary).toBe(true);

    const foundingEvent = world.history.find((event) => event.kind === 'world_created');
    if (!foundingEvent) throw new Error('expected the opening world event');

    for (const faction of factions) {
      expect(faction.name).not.toMatch(/宗议|台阁$|清议|经略府|州牧议/);
      expect(faction.origin).toBe('opening');
      expect(faction.originFactId).not.toBeNull();
      expect(foundingEvent.sourceFactIds).toContain(faction.originFactId);

      const fact = world.facts.find((item) => item.id === faction.originFactId);
      if (!fact || fact.kind !== 'faction_lifecycle') {
        throw new Error(`missing lifecycle origin Fact for ${faction.id}`);
      }
      expect(fact.payload).toMatchObject({
        transition: 'formed',
        reasonCode: 'opening_order',
        polityId: faction.polityId,
        createdFactionIds: [faction.id],
      });
      expect(faction.lifecycle).toContainEqual(expect.objectContaining({
        transition: 'formed',
        reasonCode: 'opening_order',
        factId: fact.id,
      }));
    }
  });

  it('does not silently switch affiliation after political class and office changes', () => {
    const world = createWorld('POL02-身份不随官职漂移');
    const polity = world.polities[0];
    if (!polity) throw new Error('expected an opening polity');
    const character = world.characters.find((item) => item.id === polity.rulerId);
    if (!character?.factionId) throw new Error('expected the ruler to have an opening faction');
    const faction = world.factions.find((item) => item.id === character.factionId);
    const office = world.offices.find((item) => item.active && item.holderId === character.id);
    if (!faction || !office) throw new Error('expected the ruler faction and active office');
    const factionId = faction.id;
    const factionName = faction.name;

    const replacementClass: Record<FactionKind, PoliticalClass> = {
      宗室: '官僚',
      官僚: '士族',
      士族: '地方豪强',
      军门: '官僚',
      地方: '官僚',
    };
    character.politicalClass = replacementClass[faction.kind];
    office.kind = office.kind === '廷臣' ? '地方长官' : '廷臣';
    expect(factionKindFor(character)).not.toBe(faction.kind);

    processFactionLifecycle(world, quarterContext(world));

    expect(character.factionId).toBe(factionId);
    expect(faction.name).toBe(factionName);
    expect(faction.memberIds).toContain(character.id);
    expect(world.factions.filter((item) => item.active && item.memberIds.includes(character.id)).map((item) => item.id))
      .toEqual([factionId]);
  });

  it('leaves an unconnected minor person outside the visible groups', () => {
    const world = createWorld('POL02-不强塞无关系人物');
    const outsider = world.characters.find((character) => (
      character.role === '廷臣'
      && !world.offices.some((office) => office.active && office.holderId === character.id)
      && !world.armies.some((army) => [army.commanderId, army.deputyCommanderId].includes(character.id))
    ));
    if (!outsider) throw new Error('expected an unconnected courtier fixture');
    world.factions = [];
    world.counters.faction = 0;
    for (const character of world.characters) character.factionId = null;
    outsider.familyId = 'isolated_family';
    outsider.spouseIds = [];
    outsider.influence = 0;
    world.relationships = world.relationships.filter((relation) => (
      relation.sourceId !== outsider.id && relation.targetId !== outsider.id
    ));

    bootstrapFactionModel(world, 'opening');

    expect(outsider.factionId).toBeNull();
    expect(world.factions.some((faction) => faction.memberIds.includes(outsider.id))).toBe(false);
  });

  it('keeps living polities within the two-to-four visible-group band over sixteen quarters', () => {
    const world = advanceWorldBy(createWorld('POL02-集团数量长程'), 16);
    for (const polity of world.polities.filter((item) => item.alive)) {
      const count = world.factions.filter((faction) => faction.active && faction.polityId === polity.id).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
  }, 15_000);

  it('keeps an expelled member unaffiliated on the following quarter instead of rebuilding by class', () => {
    const world = createWorld('POL02-清洗不回填');
    const faction = world.factions.find((item) => (
      item.active && item.memberIds.some((memberId) => memberId !== item.leaderId)
    ));
    if (!faction) throw new Error('expected a faction with a non-leader member');
    const expelledId = faction.memberIds.find((memberId) => memberId !== faction.leaderId);
    if (!expelledId) throw new Error('expected an expellable faction member');
    const expelled = world.characters.find((character) => character.id === expelledId);
    if (!expelled) throw new Error(`missing character ${expelledId}`);

    expelFactionMembers(world, faction.id, [expelled.id]);
    expect(expelled.factionId).toBeNull();
    expect(faction.memberIds).not.toContain(expelled.id);

    processFactionLifecycle(world, quarterContext(world));

    expect(expelled.factionId).toBeNull();
    expect(world.factions.filter((item) => item.active && item.memberIds.includes(expelled.id))).toEqual([]);
  });

  it('retains the faction ID when a dead leader is succeeded by a surviving core member and emits a Fact', () => {
    const world = createWorld('POL02-核心继任');
    const faction = world.factions.find((item) => item.active && item.coreMemberIds.length >= 2);
    if (!faction) throw new Error('expected a faction with a succession-capable core');
    const factionId = faction.id;
    const originFactId = faction.originFactId;
    const previousLeaderId = faction.leaderId;
    const survivingCoreIds = faction.coreMemberIds.filter((id) => id !== previousLeaderId);
    const previousLeader = world.characters.find((character) => character.id === previousLeaderId);
    if (!previousLeader) throw new Error(`missing leader ${previousLeaderId}`);
    previousLeader.alive = false;
    previousLeader.deathTurn = world.turn + 1;
    previousLeader.lifeStage = '已故';

    const context = quarterContext(world);
    const deathFact = emitSimulationFact(world, context, {
      kind: 'character_death',
      category: '政治',
      importance: 2,
      actorIds: [previousLeader.id],
      polityIds: [previousLeader.polityId],
      regionIds: [previousLeader.locationRegionId],
      causes: [{ label: '人物死亡', role: '结果', weight: 1, evidence: `${previousLeader.name}本季逝世` }],
      stateDeltas: [{ entityType: 'character', entityId: previousLeader.id, field: 'alive', before: true, after: false }],
      sourceFactIds: [],
      payload: {
        characterId: previousLeader.id,
        age: previousLeader.age,
        role: previousLeader.role,
        health: previousLeader.health,
        diseaseId: null,
      },
    });
    processFactionLifecycle(world, context);

    expect(faction.id).toBe(factionId);
    expect(faction.active).toBe(true);
    expect(faction.originFactId).toBe(originFactId);
    expect(faction.leaderId).not.toBe(previousLeaderId);
    expect(survivingCoreIds).toContain(faction.leaderId);
    expect(faction.memberIds).not.toContain(previousLeaderId);

    const fact = context.facts.find((item) => (
      item.kind === 'faction_lifecycle'
      && item.payload.transition === 'leader_changed'
      && item.payload.affectedFactionIds.includes(factionId)
    ));
    if (!fact || fact.kind !== 'faction_lifecycle') {
      throw new Error(`missing leader succession Fact for ${factionId}`);
    }
    expect(fact.payload).toMatchObject({
      transition: 'leader_changed',
      reasonCode: 'leader_unavailable',
      affectedFactionIds: [factionId],
      previousLeaderId,
      nextLeaderId: faction.leaderId,
    });
    expect(fact.actorIds).toContain(previousLeaderId);
    expect(fact.sourceFactIds).toEqual([deathFact.id]);
    expect(fact.causes.find((cause) => cause.label === '政治变化')?.evidence).toContain('原领袖');
    expect(fact.causes.map((cause) => cause.evidence).join(' ')).not.toContain('leader_unavailable');
    expect(world.facts).toContainEqual(fact);
    expect(faction.lifecycle.at(-1)).toMatchObject({
      transition: 'leader_changed',
      reasonCode: 'leader_unavailable',
      factId: fact.id,
    });
  });

  it('records explicit bilateral alliance and rivalry while keeping the two relations mutually exclusive', () => {
    const world = createWorld('POL02-派系关系互斥');
    const polity = world.polities.find((item) => (
      world.factions.filter((faction) => faction.active && faction.polityId === item.id).length >= 2
    ));
    if (!polity) throw new Error('expected a polity with two factions');
    const [left, right] = world.factions.filter((item) => item.active && item.polityId === polity.id);
    if (!left || !right) throw new Error('expected two active factions');

    const allianceContext = quarterContext(world);
    const allianceFact = changeFactionRelation(
      world,
      allianceContext,
      left.id,
      right.id,
      'alliance',
      'formed',
      'test_shared_interest',
    );
    if (!allianceFact || allianceFact.kind !== 'faction_relation_changed') {
      throw new Error('expected an alliance relation Fact');
    }
    expect(left.alliedFactionIds).toContain(right.id);
    expect(right.alliedFactionIds).toContain(left.id);
    expect(left.rivalFactionIds).not.toContain(right.id);
    expect(right.rivalFactionIds).not.toContain(left.id);
    expect(allianceFact.payload).toMatchObject({
      leftFactionId: left.id,
      rightFactionId: right.id,
      relation: 'alliance',
      action: 'formed',
      reasonCode: 'test_shared_interest',
    });
    expect(allianceContext.facts).toEqual([allianceFact]);

    const rivalryContext = quarterContext(world, 2, '秋');
    const rivalryFact = changeFactionRelation(
      world,
      rivalryContext,
      left.id,
      right.id,
      'rivalry',
      'formed',
      'test_open_rift',
    );
    if (!rivalryFact || rivalryFact.kind !== 'faction_relation_changed') {
      throw new Error('expected a rivalry relation Fact');
    }
    expect(left.rivalFactionIds).toContain(right.id);
    expect(right.rivalFactionIds).toContain(left.id);
    expect(left.alliedFactionIds).not.toContain(right.id);
    expect(right.alliedFactionIds).not.toContain(left.id);
    expect(left.relationSinceTurns[right.id]).toBe(rivalryContext.turn);
    expect(right.relationSinceTurns[left.id]).toBe(rivalryContext.turn);
    expect(rivalryFact.payload).toMatchObject({
      leftFactionId: left.id,
      rightFactionId: right.id,
      relation: 'rivalry',
      action: 'formed',
      reasonCode: 'test_open_rift',
    });
    expect(rivalryFact.causes.map((cause) => cause.evidence).join(' ')).not.toContain('test_open_rift');
    const allianceEndedFact = rivalryContext.facts.find((item) => (
      item.kind === 'faction_relation_changed'
      && item.payload.relation === 'alliance'
      && item.payload.action === 'ended'
    ));
    if (!allianceEndedFact || allianceEndedFact.kind !== 'faction_relation_changed') {
      throw new Error('expected the superseded alliance to end explicitly');
    }
    expect(allianceEndedFact.payload.reasonCode).toBe('test_open_rift_superseded');
    expect(rivalryFact.sourceFactIds).toContain(allianceEndedFact.id);
    expect(rivalryContext.facts).toEqual([allianceEndedFact, rivalryFact]);
    expect(world.facts).toEqual(expect.arrayContaining([allianceFact, allianceEndedFact, rivalryFact]));
  });

  it('splits a persistently incoherent faction into a new stable ID with typed lineage evidence', () => {
    const world = createWorld('POL02-确定性分裂');
    const parent = world.factions.find((item) => item.active && item.memberIds.length >= 4);
    if (!parent) throw new Error('expected a faction large enough to split');
    const parentId = parent.id;
    const factionIdsBefore = new Set(world.factions.map((item) => item.id));
    const released = world.factions.find((item) => item.active && item.polityId === parent.polityId && item.id !== parent.id);
    if (!released) throw new Error('expected another group to release a bounded active slot');
    released.active = false;
    released.endedTurn = world.turn;
    for (const memberId of released.memberIds) {
      const member = world.characters.find((item) => item.id === memberId);
      if (member?.factionId === released.id) member.factionId = null;
    }
    released.memberIds = [];
    released.coreMemberIds = [];
    const challengerId = parent.memberIds.find((id) => id !== parent.leaderId);
    const challenger = world.characters.find((item) => item.id === challengerId);
    if (!challenger) throw new Error('expected a non-leader challenger');

    parent.cohesion = 0;
    parent.lastLifecycleTurn = -100;
    challenger.ambition = 100;
    challenger.loyalty = 0;
    challenger.insubordination = 100;

    const context = moveToQuarter(world, 19, '冬');
    processFactionLifecycle(world, context);

    const branch = world.factions.find((item) => !factionIdsBefore.has(item.id));
    if (!branch) throw new Error('expected a newly identified split faction');
    expect(branch.id).not.toBe(parentId);
    expect(branch.active).toBe(true);
    expect(branch.origin).toBe('split');
    expect(branch.predecessorFactionIds).toEqual([parentId]);
    expect(parent.successorFactionIds).toContain(branch.id);
    expect(parent.active).toBe(true);
    expect(parent.memberIds).not.toContain(challenger.id);
    expect(branch.memberIds).toContain(challenger.id);
    expect(challenger.factionId).toBe(branch.id);

    const splitFact = context.facts.find((item) => (
      item.kind === 'faction_lifecycle'
      && item.payload.transition === 'split'
      && item.payload.createdFactionIds.includes(branch.id)
    ));
    if (!splitFact || splitFact.kind !== 'faction_lifecycle') {
      throw new Error(`missing typed split Fact for ${branch.id}`);
    }
    expect(splitFact.payload).toMatchObject({
      transition: 'split',
      reasonCode: 'internal_break',
      polityId: parent.polityId,
      createdFactionIds: [branch.id],
      endedFactionIds: [],
    });
    expect(splitFact.payload.affectedFactionIds).toEqual(expect.arrayContaining([parentId, branch.id]));
    expect(branch.originFactId).toBe(splitFact.id);
    expect(parent.lifecycle.at(-1)).toMatchObject({ transition: 'split', factId: splitFact.id });
    expect(branch.lifecycle).toContainEqual(expect.objectContaining({ transition: 'split', factId: splitFact.id }));
  });

  it('merges two allied factions into one new ID and records both predecessor-successor links', () => {
    const world = createWorld('POL02-确定性兼并');
    let left = undefined as (typeof world.factions)[number] | undefined;
    let right = undefined as (typeof world.factions)[number] | undefined;
    for (const polity of world.polities) {
      const factions = world.factions.filter((item) => item.active && item.polityId === polity.id);
      for (let leftIndex = 0; leftIndex < factions.length && !left; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < factions.length; rightIndex += 1) {
          const candidateLeft = factions[leftIndex];
          const candidateRight = factions[rightIndex];
          if (candidateLeft && candidateRight && candidateLeft.memberIds.length + candidateRight.memberIds.length <= 8) {
            left = candidateLeft;
            right = candidateRight;
            break;
          }
        }
      }
      if (left && right) break;
    }
    if (!left || !right) throw new Error('expected a mergeable faction pair');
    const leftId = left.id;
    const rightId = right.id;
    const memberIds = [...left.memberIds, ...right.memberIds];
    const factionIdsBefore = new Set(world.factions.map((item) => item.id));

    left.agenda = '维持秩序';
    right.agenda = '维持秩序';
    for (const faction of world.factions.filter((item) => item.active && item.polityId === left?.polityId)) {
      faction.cohesion = 100;
    }
    left.lastLifecycleTurn = -100;
    right.lastLifecycleTurn = -100;

    const leaderRelations = world.relationships.filter((relation) => (
      (relation.sourceId === left?.leaderId && relation.targetId === right?.leaderId)
      || (relation.sourceId === right?.leaderId && relation.targetId === left?.leaderId)
    ));
    if (leaderRelations.length) {
      for (const relation of leaderRelations) {
        relation.trust = 90;
        relation.grievance = 0;
      }
    } else {
      world.counters.relationship += 1;
      world.relationships.push({
        id: `rel_${String(world.counters.relationship).padStart(5, '0')}`,
        sourceId: left.leaderId,
        targetId: right.leaderId,
        kinship: '无',
        affinity: 70,
        trust: 90,
        fear: 0,
        grievance: 0,
        gratitude: 0,
        lastInteractionTurn: world.turn,
        memories: [],
      });
    }

    const allianceFact = changeFactionRelation(
      world,
      quarterContext(world),
      left.id,
      right.id,
      'alliance',
      'formed',
      'test_merge_compact',
    );
    if (!allianceFact) throw new Error('expected the merge alliance to form');

    const context = moveToQuarter(world, 19, '冬');
    processFactionLifecycle(world, context);

    const merged = world.factions.find((item) => !factionIdsBefore.has(item.id));
    if (!merged) throw new Error('expected a newly identified merged faction');
    expect(merged.id).not.toBe(leftId);
    expect(merged.id).not.toBe(rightId);
    expect(merged.active).toBe(true);
    expect(merged.origin).toBe('merged');
    expect(merged.predecessorFactionIds).toEqual([leftId, rightId].sort());
    expect(left.active).toBe(false);
    expect(right.active).toBe(false);
    expect(left.endedReason).toBe('merged');
    expect(right.endedReason).toBe('merged');
    expect(left.successorFactionIds).toContain(merged.id);
    expect(right.successorFactionIds).toContain(merged.id);
    expect(memberIds.every((id) => merged.memberIds.includes(id))).toBe(true);
    expect(memberIds.every((id) => world.characters.find((item) => item.id === id)?.factionId === merged.id)).toBe(true);

    const mergeFact = context.facts.find((item) => (
      item.kind === 'faction_lifecycle'
      && item.payload.transition === 'merged'
      && item.payload.createdFactionIds.includes(merged.id)
    ));
    if (!mergeFact || mergeFact.kind !== 'faction_lifecycle') {
      throw new Error(`missing typed merge Fact for ${merged.id}`);
    }
    expect(mergeFact.payload).toMatchObject({
      transition: 'merged',
      reasonCode: 'allied_union',
      polityId: left.polityId,
      createdFactionIds: [merged.id],
    });
    expect(mergeFact.payload.endedFactionIds).toEqual([leftId, rightId].sort());
    expect(mergeFact.causes.find((cause) => cause.label === '成员归属')?.evidence)
      .toContain(`变化后有${memberIds.length}人`);
    expect(mergeFact.causes.map((cause) => cause.evidence).join(' ')).not.toContain('allied_union');
    expect(left.endedFactId).toBe(mergeFact.id);
    expect(right.endedFactId).toBe(mergeFact.id);
    expect(merged.originFactId).toBe(mergeFact.id);
  });

  it('ends every faction with its polity and never reactivates those IDs on later lifecycle processing', () => {
    const world = createWorld('POL02-政权消亡派系退场');
    const polity = world.polities.find((item) => (
      world.factions.filter((faction) => faction.active && faction.polityId === item.id).length >= 2
    ));
    if (!polity) throw new Error('expected a polity with active factions');
    const [relatedLeft, relatedRight] = world.factions
      .filter((item) => item.active && item.polityId === polity.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!relatedLeft || !relatedRight) throw new Error('expected two factions for an ending relation');
    const allianceFact = changeFactionRelation(
      world,
      quarterContext(world),
      relatedLeft.id,
      relatedRight.id,
      'alliance',
      'formed',
      'court_support_exchange',
    );
    if (!allianceFact) throw new Error('expected an alliance before polity destruction');
    const factionIds = world.factions
      .filter((item) => item.active && item.polityId === polity.id)
      .map((item) => item.id)
      .sort();
    polity.alive = false;

    const endContext = moveToQuarter(world, 4, '春');
    const nextPolity = world.polities.find((item) => item.id !== polity.id);
    const sourceRegion = world.regions.find((item) => item.controllerId === polity.id);
    if (!nextPolity || !sourceRegion) throw new Error('expected a destruction source fixture');
    const destructionFact = emitSimulationFact(world, endContext, {
      kind: 'territory_control_changed',
      category: '军事',
      importance: 4,
      actorIds: [],
      polityIds: [polity.id, nextPolity.id],
      regionIds: [sourceRegion.id],
      causes: [{ label: '政权覆亡', role: '结果', weight: 1, evidence: `${polity.name}失去最后立足之地` }],
      stateDeltas: [{ entityType: 'region', entityId: sourceRegion.id, field: 'controllerId', before: polity.id, after: nextPolity.id }],
      sourceFactIds: [],
      payload: {
        regionId: sourceRegion.id,
        previousControllerId: polity.id,
        nextControllerId: nextPolity.id,
        reason: 'battle_capture',
        warId: null,
      },
    });
    endPolityFactions(world, endContext, polity.id, 'polity_destroyed', [destructionFact.id]);

    const ended = world.factions.filter((item) => factionIds.includes(item.id));
    expect(ended.map((item) => item.id).sort()).toEqual(factionIds);
    expect(ended.every((item) => !item.active)).toBe(true);
    expect(ended.every((item) => item.endedReason === 'polity_destroyed')).toBe(true);
    expect(ended.every((item) => item.endedTurn === endContext.turn)).toBe(true);
    expect(world.characters.filter((item) => item.polityId === polity.id).every((item) => item.factionId === null)).toBe(true);

    for (const faction of ended) {
      const fact = world.facts.find((item) => item.id === faction.endedFactId);
      if (!fact || fact.kind !== 'faction_lifecycle') {
        throw new Error(`missing typed end Fact for ${faction.id}`);
      }
      expect(fact.payload).toMatchObject({
        transition: 'ended',
        reasonCode: 'polity_destroyed',
        polityId: polity.id,
        endedFactionIds: [faction.id],
      });
      expect(fact.sourceFactIds).toContain(destructionFact.id);
    }
    const endedRelationFact = endContext.facts.find((item) => (
      item.kind === 'faction_relation_changed'
      && item.payload.action === 'ended'
      && [item.payload.leftFactionId, item.payload.rightFactionId].includes(relatedLeft.id)
      && [item.payload.leftFactionId, item.payload.rightFactionId].includes(relatedRight.id)
    ));
    if (!endedRelationFact || endedRelationFact.kind !== 'faction_relation_changed') {
      throw new Error('expected the alliance to end with an explicit relation Fact');
    }
    expect(endedRelationFact.sourceFactIds).toEqual([destructionFact.id]);
    const relationOwnerEnd = world.facts.find((item) => (
      item.kind === 'faction_lifecycle'
      && item.payload.transition === 'ended'
      && item.payload.endedFactionIds.includes(endedRelationFact.payload.leftFactionId)
    ));
    expect(relationOwnerEnd?.sourceFactIds).toEqual([destructionFact.id, endedRelationFact.id].sort());

    const endedFaction = ended[0];
    const endedLifecycleFact = endedFaction?.endedFactId
      ? world.facts.find((item) => item.id === endedFaction.endedFactId)
      : null;
    if (!endedFaction || endedLifecycleFact?.kind !== 'faction_lifecycle') {
      throw new Error('expected an ended lifecycle pointer fixture');
    }
    endedLifecycleFact.payload.endedFactionIds = [];
    expect(validateFactionState(world).some((violation) => (
      violation.code === 'faction.end-fact' && violation.entityId === endedFaction.id
    ))).toBe(true);
    endedLifecycleFact.payload.endedFactionIds = [endedFaction.id];

    const laterContext = moveToQuarter(world, 5, '夏');
    processFactionLifecycle(world, laterContext);
    expect(world.factions.filter((item) => item.active && item.polityId === polity.id)).toEqual([]);
    expect(world.factions.filter((item) => factionIds.includes(item.id)).every((item) => !item.active)).toBe(true);
  });

  it('authenticates an older schema-4 save before assigning legacy identities without inventing past Facts', () => {
    const legacy = createWorld('POL02-旧存档身份边界');
    const originalFactionIds = legacy.factions.map((faction) => faction.id).sort();
    const legacyPolity = legacy.polities.find((polity) => (
      legacy.factions.filter((faction) => faction.active && faction.polityId === polity.id).length >= 2
    ));
    const [legacyLeft, legacyRight] = legacy.factions
      .filter((faction) => faction.active && faction.polityId === legacyPolity?.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!legacyLeft || !legacyRight) throw new Error('expected an old bilateral alliance fixture');
    legacyLeft.alliedFactionIds = [legacyRight.id];
    legacyRight.alliedFactionIds = [legacyLeft.id];

    for (const character of legacy.characters) {
      delete (character as unknown as Record<string, unknown>).factionId;
    }
    delete (legacy as unknown as Record<string, unknown>).legacyFactionFactBoundaryTurn;
    for (const faction of legacy.factions) {
      const oldFaction = faction as unknown as Record<string, unknown>;
      faction.name = `${faction.name}旧称`;
      for (const field of [
        'rivalFactionIds',
        'relationSinceTurns',
        'origin',
        'formedTurn',
        'coreMemberIds',
        'predecessorFactionIds',
        'successorFactionIds',
        'leaderSinceTurn',
        'lastLifecycleTurn',
        'originFactId',
        'endedReason',
        'endedFactId',
        'lifecycle',
      ]) delete oldFaction[field];
    }

    // POL02 did not exist when this schema-4 boundary was written. Authenticate
    // that original state, then migrate current affiliation without fabricating
    // retrospective lifecycle evidence.
    legacy.facts = [];
    legacy.factDigest = stableHash([]);
    legacy.counters.fact = 0;
    const foundingEvent = legacy.history[0];
    if (!foundingEvent) throw new Error('expected the opening world event');
    foundingEvent.sourceFactIds = [];
    const legacyAllianceEvent = {
      id: 'event_000002',
      turn: 0,
      year: 1,
      season: '春' as const,
      category: '政治' as const,
      kind: 'political_alliance',
      title: `${legacyLeft.name}与${legacyRight.name}结盟`,
      summary: `${legacyLeft.name}与${legacyRight.name}交换朝中支持，形成旧卷政治联盟。`,
      importance: 3 as const,
      actorIds: [legacyLeft.leaderId, legacyRight.leaderId].sort(),
      polityIds: [legacyLeft.polityId],
      regionIds: [],
      causes: [{ label: '交换支持', role: '选择' as const, weight: 1, evidence: '旧卷只保留盟约结果' }],
      evidence: [],
      stateDeltas: [],
      sourceFactIds: [],
      situationIds: [],
    };
    legacy.history.push(legacyAllianceEvent);
    legacy.counters.event = 2;
    legacy.counters.commitment = 1;
    legacy.commitments.push({
      id: 'commit_00001',
      kind: '政治联盟',
      promisorId: legacyLeft.leaderId,
      promiseeId: legacyRight.leaderId,
      polityIds: [legacyLeft.polityId],
      terms: '在朝廷议程中互相支持',
      madeTurn: 0,
      dueTurn: 16,
      status: '生效',
      resolvedTurn: null,
      eventId: legacyAllianceEvent.id,
      resolutionEventId: null,
      trustStake: 18,
    });
    legacy.historyDigest = stableHash([stableHash(foundingEvent), legacyAllianceEvent]);
    (legacy as unknown as Record<string, unknown>).schemaVersion = 4;
    delete (legacy as unknown as Record<string, unknown>).personalForces;
    for (const army of legacy.armies as Array<WorldState['armies'][number] & Record<string, unknown>>) {
      delete (army as Record<string, unknown>).participantIds;
    }
    legacy.hash = computeWorldHash(legacy);

    const oldSave = serializeWorld(legacy);
    const restored = deserializeWorld(oldSave);
    expect(restored.factions.map((faction) => faction.id).sort()).toEqual(originalFactionIds);
    expect(restored.factions.every((faction) => faction.origin === 'legacy')).toBe(true);
    expect(restored.factions.every((faction) => faction.originFactId === null)).toBe(true);
    expect(restored.legacyFactionFactBoundaryTurn).toBe(0);
    expect(restored.commitments).toContainEqual(expect.objectContaining({
      id: 'commit_00001',
      kind: '政治联盟',
      status: '生效',
    }));
    expect(validateCommitmentState(restored)).toEqual([]);
    expect(restored.facts.some((fact) => fact.kind === 'faction_lifecycle' || fact.kind === 'faction_relation_changed')).toBe(false);
    const restoredLeft = restored.factions.find((faction) => faction.id === legacyLeft.id);
    const restoredRight = restored.factions.find((faction) => faction.id === legacyRight.id);
    expect(restoredLeft?.alliedFactionIds).toEqual([legacyRight.id]);
    expect(restoredRight?.alliedFactionIds).toEqual([legacyLeft.id]);
    expect(restoredLeft?.relationSinceTurns).toEqual({});
    expect(restoredRight?.relationSinceTurns).toEqual({});

    const activeMembershipIds = restored.factions
      .filter((faction) => faction.active)
      .flatMap((faction) => faction.memberIds);
    expect(new Set(activeMembershipIds).size).toBe(activeMembershipIds.length);
    for (const character of restored.characters.filter((item) => item.alive && item.age >= 16)) {
      expect(restored.factions.filter((faction) => faction.active && faction.memberIds.includes(character.id)).map((faction) => faction.id))
        .toEqual(character.factionId ? [character.factionId] : []);
    }

    const left = advanceWorld(deserializeWorld(oldSave));
    const right = advanceWorld(deserializeWorld(oldSave));
    expect(serializeWorld(left)).toBe(serializeWorld(right));
    expect(left.hash).toBe(computeWorldHash(left));

    const allianceGone = deserializeWorld(oldSave);
    const goneLeft = allianceGone.factions.find((faction) => faction.id === legacyLeft.id);
    const goneRight = allianceGone.factions.find((faction) => faction.id === legacyRight.id);
    if (!goneLeft || !goneRight) throw new Error('expected restored legacy alliance endpoints');
    goneLeft.alliedFactionIds = goneLeft.alliedFactionIds.filter((id) => id !== goneRight.id);
    goneRight.alliedFactionIds = goneRight.alliedFactionIds.filter((id) => id !== goneLeft.id);
    const legacyCommitment = allianceGone.commitments.find((item) => item.id === 'commit_00001');
    if (!legacyCommitment) throw new Error('expected restored legacy commitment');
    for (const actorId of [legacyCommitment.promisorId, legacyCommitment.promiseeId]) {
      const actor = allianceGone.characters.find((character) => character.id === actorId);
      if (!actor) continue;
      actor.alive = false;
      actor.lifeStage = '已故';
      actor.deathTurn = allianceGone.turn;
      actor.factionId = null;
      for (const faction of allianceGone.factions) {
        faction.memberIds = faction.memberIds.filter((id) => id !== actor.id);
        faction.coreMemberIds = faction.coreMemberIds.filter((id) => id !== actor.id);
      }
    }
    allianceGone.hash = computeWorldHash(allianceGone);
    const conservativelySettled = advanceWorldBy(allianceGone, 4);
    const settledCommitment = conservativelySettled.commitments.find((item) => item.id === 'commit_00001');
    expect(settledCommitment).toMatchObject({ status: '失效', resolvedTurn: 3 });
    const settledEvent = conservativelySettled.history.find((event) => event.id === settledCommitment?.resolutionEventId);
    expect(settledEvent).toMatchObject({
      kind: 'commitment_ended',
      sourceFactIds: [],
    });
    expect(conservativelySettled.history.some((event) => (
      event.kind === 'commitment_fulfilled'
      && event.stateDeltas.some((delta) => delta.entityId === settledCommitment?.id)
    ))).toBe(false);

    const modern = createWorld('POL02-现代承诺必须有建立事实');
    modern.counters.commitment += 1;
    modern.commitments.push({
      id: 'commit_00001',
      kind: '政治联盟',
      promisorId: modern.factions[0]?.leaderId ?? '',
      promiseeId: modern.factions[1]?.leaderId ?? '',
      polityIds: [modern.factions[0]?.polityId ?? ''],
      terms: '缺失建立事实的现代承诺',
      madeTurn: modern.turn,
      dueTurn: modern.turn + 16,
      status: '生效',
      resolvedTurn: null,
      eventId: modern.history[0]?.id ?? '',
      resolutionEventId: null,
      trustStake: 18,
    });
    expect(modern.legacyFactionFactBoundaryTurn).toBeNull();
    expect(validateCommitmentState(modern)).toContainEqual(expect.objectContaining({
      code: 'commitment.faction-alliance-source',
      entityId: 'commit_00001',
    }));
  });

  it('rejects origin and lifecycle pointers whose role, polity, turn, or reason no longer matches', () => {
    const world = createWorld('POL02-派系事实指针校验');
    expect(validateFactionState(world)).toEqual([]);
    const faction = world.factions.find((item) => item.origin !== 'legacy' && item.originFactId !== null);
    if (!faction?.originFactId) throw new Error('expected an origin Fact pointer');
    const originFact = world.facts.find((item) => item.id === faction.originFactId);
    if (originFact?.kind !== 'faction_lifecycle') throw new Error('expected a lifecycle origin Fact');

    const created = [...originFact.payload.createdFactionIds];
    originFact.payload.createdFactionIds = [];
    expect(validateFactionState(world).some((violation) => (
      violation.code === 'faction.origin-fact' && violation.entityId === faction.id
    ))).toBe(true);
    originFact.payload.createdFactionIds = created;

    const polityId = originFact.payload.polityId;
    originFact.payload.polityId = 'polity_tampered';
    expect(validateFactionState(world).some((violation) => (
      violation.code === 'faction.origin-fact' && violation.entityId === faction.id
    ))).toBe(true);
    originFact.payload.polityId = polityId;

    const turn = originFact.turn;
    originFact.turn += 1;
    expect(validateFactionState(world).some((violation) => (
      violation.code === 'faction.origin-fact' && violation.entityId === faction.id
    ))).toBe(true);
    originFact.turn = turn;

    const record = faction.lifecycle.find((item) => item.factId === originFact.id);
    if (!record) throw new Error('expected the origin lifecycle record');
    const reasonCode = record.reasonCode;
    record.reasonCode = 'tampered_reason';
    expect(validateFactionState(world).some((violation) => (
      violation.code === 'faction.lifecycle-fact' && violation.entityId === faction.id
    ))).toBe(true);
    record.reasonCode = reasonCode;
    expect(validateFactionState(world)).toEqual([]);
  });
});
