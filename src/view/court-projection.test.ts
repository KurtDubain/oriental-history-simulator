import { describe, expect, it } from 'vitest';
import {
  advanceWorldBy,
  compactWorldArchive,
  createWorld,
  emitSimulationFact,
  serializeWorld,
} from '../sim';
import type { HistoryEvent, OfficeAppointment } from '../sim/types';
import { projectCourt } from './court-projection';

function worldWithCourt(seed: string) {
  const world = advanceWorldBy(createWorld(seed), 4);
  const polity = world.polities.find((candidate) => (
    candidate.alive
    && world.factions.filter((faction) => faction.active && faction.polityId === candidate.id).length >= 3
    && world.offices.some((office) => office.active && office.polityId === candidate.id && office.kind === '君主')
  ));
  if (!polity) throw new Error('expected a polity with a court and at least three factions');
  return { world, polity };
}

describe('court projection', () => {
  it('keeps every live central seat backed by a concrete appointment reason in a real four-quarter world', () => {
    const world = advanceWorldBy(createWorld('军权春秋'), 4);
    const seats = world.polities
      .filter((polity) => polity.alive)
      .flatMap((polity) => projectCourt(world, polity.id, 'all').seats);
    const foundingEvent = world.history.find((event) => event.kind === 'world_created');
    const openingCentralFacts = world.facts.filter((fact) => (
      foundingEvent?.sourceFactIds.includes(fact.id)
      && fact.kind === 'appointment_started'
      && ['君主', '宰辅', '枢密使', '廷臣'].includes(fact.payload.officeKind)
    ));

    expect(seats.length).toBeGreaterThan(0);
    expect(seats.length).toBeLessThanOrEqual(openingCentralFacts.length);
    expect(seats.every((seat) => Boolean(seat.appointmentEvidence))).toBe(true);
    expect(seats.every((seat) => !/\b(?:c|office)_\d+\b/.test(seat.appointmentEvidence ?? ''))).toBe(true);
    expect(openingCentralFacts).toHaveLength(24);
    expect(openingCentralFacts.every((fact) => foundingEvent?.sourceFactIds.includes(fact.id))).toBe(true);
  });

  it('uses only active central appointments and keeps military or regional roots outside the bench', () => {
    const { world, polity } = worldWithCourt('朝仪座次');
    const holder = world.characters.find((character) => character.alive && character.polityId === polity.id);
    if (!holder) throw new Error('expected a living court subject');
    const additions: OfficeAppointment[] = [
      {
        id: 'office_test_governor', polityId: polity.id, kind: '地方长官', holderId: holder.id,
        regionId: polity.capitalRegionId, armyId: null, fleetId: null, rank: 99,
        appointedTurn: world.turn, endedTurn: null, active: true,
      },
      {
        id: 'office_test_inactive_court', polityId: polity.id, kind: '廷臣', holderId: holder.id,
        regionId: polity.capitalRegionId, armyId: null, fleetId: null, rank: 99,
        appointedTurn: world.turn, endedTurn: world.turn, active: false,
      },
    ];
    world.offices.push(...additions);
    const before = serializeWorld(world);
    const projection = projectCourt(world, polity.id);

    expect(projection.seats.length).toBeGreaterThan(0);
    expect(projection.ruler?.office).toBe('君主');
    expect(projection.seats.every((seat) => ['君主', '宰辅', '枢密使', '廷臣'].includes(seat.office))).toBe(true);
    expect(projection.seats.some((seat) => seat.officeId === 'office_test_governor')).toBe(false);
    expect(projection.seats.some((seat) => seat.officeId === 'office_test_inactive_court')).toBe(false);
    expect(projection.factionPositions.every((faction) => faction.topRoots.length <= 2)).toBe(true);
    expect(projection.graphFactionIds.length).toBeLessThanOrEqual(4);
    expect(serializeWorld(world)).toBe(before);
  });

  it('orders factions deterministically, projects unique alliances and rivalries, and names the first power in its summary', () => {
    const { world, polity } = worldWithCourt('朝局分合');
    const factions = world.factions
      .filter((faction) => faction.active && faction.polityId === polity.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    const [first, second, third] = factions;
    if (!first || !second || !third) throw new Error('expected three active factions');
    for (const faction of factions) {
      faction.alliedFactionIds = [];
      faction.rivalFactionIds = [];
      faction.relationSinceTurns = {};
    }
    first.alliedFactionIds = [second.id];
    second.alliedFactionIds = [first.id];
    first.rivalFactionIds = [third.id];
    third.rivalFactionIds = [first.id];
    first.relationSinceTurns = { [second.id]: 2, [third.id]: 3 };
    second.relationSinceTurns = { [first.id]: 2 };
    third.relationSinceTurns = { [first.id]: 3 };

    const firstProjection = projectCourt(world, polity.id);
    const replay = projectCourt(world, polity.id);
    expect(replay).toEqual(firstProjection);
    expect(firstProjection.relations).toHaveLength(2);
    expect(firstProjection.relations.map((relation) => relation.kind).sort()).toEqual(['allied', 'opposed']);
    expect(firstProjection.relations.map((relation) => relation.sinceLabel))
      .toEqual(expect.arrayContaining(['第1年秋季起', '第1年冬季起']));
    expect(new Set(firstProjection.relations.map((relation) => relation.id)).size).toBe(2);
    expect(firstProjection.factionPositions[0]?.dominant).toBe(true);
    expect(firstProjection.factionPositions.slice(1).every((faction) => !faction.dominant)).toBe(true);
    expect(firstProjection.summary).toContain(firstProjection.factionPositions[0]?.name ?? 'missing');
    expect(firstProjection.summary).toContain(firstProjection.ruler?.holder ?? '君位空悬');
  });

  it('labels an inherited alliance date as unknown instead of using the save migration quarter', () => {
    const { world, polity } = worldWithCourt('旧卷盟约年月');
    const [left, right] = world.factions
      .filter((faction) => faction.active && faction.polityId === polity.id)
      .sort((first, second) => first.id.localeCompare(second.id));
    if (!left || !right) throw new Error('expected two active factions');
    for (const faction of world.factions.filter((item) => item.polityId === polity.id)) {
      faction.alliedFactionIds = [];
      faction.rivalFactionIds = [];
      faction.relationSinceTurns = {};
    }
    left.alliedFactionIds = [right.id];
    right.alliedFactionIds = [left.id];

    const relation = projectCourt(world, polity.id).relations.find((item) => item.kind === 'allied');
    expect(relation).toMatchObject({
      leftFactionId: left.id,
      rightFactionId: right.id,
      sinceLabel: '旧卷年月未详',
    });
    expect(relation?.sinceLabel).not.toContain(`第${Math.floor(world.turn / 4) + 1}年`);
  });

  it('assigns each occupied seat to the character authoritative current faction', () => {
    const { world, polity } = worldWithCourt('一人一派座次');
    const projection = projectCourt(world, polity.id);
    for (const seat of projection.seats) {
      const holder = world.characters.find((character) => character.id === seat.holderId);
      if (!holder?.factionId) continue;
      expect(seat.factionId).toBe(holder.factionId);
      expect(projection.factionPositions.find((faction) => faction.factionId === holder.factionId)?.seatIds).toContain(seat.id);
    }

    const seat = projection.seats[0];
    const holder = world.characters.find((character) => character.id === seat?.holderId);
    const staleFaction = world.factions.find((faction) => faction.active && faction.polityId === polity.id);
    if (!seat || !holder || !staleFaction) throw new Error('expected an occupied seat and active faction');
    holder.factionId = null;
    staleFaction.memberIds = [...new Set([...staleFaction.memberIds, holder.id])];
    expect(projectCourt(world, polity.id).seats.find((candidate) => candidate.id === seat.id)?.factionId).toBeNull();
  });

  it('collapses repeated offices in a faction without hiding the occupied seats', () => {
    const { world, polity } = worldWithCourt('同派席位合并');
    const faction = world.factions.find((candidate) => candidate.active && candidate.polityId === polity.id);
    const holder = faction && world.characters.find((candidate) => candidate.id === faction.leaderId);
    if (!faction || !holder) throw new Error('expected an active faction leader');
    holder.factionId = faction.id;
    faction.memberIds = [...new Set([...faction.memberIds, holder.id])];
    world.offices.push(...[0, 1].map((index): OfficeAppointment => ({
      id: `office_test_courtier_${index}`,
      polityId: polity.id,
      kind: '廷臣',
      holderId: holder.id,
      regionId: null,
      armyId: null,
      fleetId: null,
      rank: 40 - index,
      appointedTurn: world.turn,
      endedTurn: null,
      active: true,
    })));

    const projection = projectCourt(world, polity.id);
    const occupiedCourtierSeats = projection.seats.filter((seat) => seat.factionId === faction.id && seat.office === '廷臣');
    const position = projection.factionPositions.find((candidate) => candidate.factionId === faction.id);
    expect(occupiedCourtierSeats.length).toBeGreaterThanOrEqual(2);
    expect(position?.seatIds).toEqual(expect.arrayContaining(occupiedCourtierSeats.map((seat) => seat.id)));
    expect(position?.seatLabels.filter((label) => label.startsWith('廷臣'))).toEqual([`廷臣×${occupiedCourtierSeats.length}`]);
  });

  it('resolves current appointments and faction relations through archived causal facts', () => {
    const { world, polity } = worldWithCourt('朝局冷史溯源');
    const office = world.offices.find((candidate) => (
      candidate.active
      && candidate.polityId === polity.id
      && ['君主', '宰辅', '枢密使', '廷臣'].includes(candidate.kind)
    ));
    const factions = world.factions.filter((candidate) => candidate.active && candidate.polityId === polity.id);
    const [left, right] = factions;
    const holder = office && world.characters.find((candidate) => candidate.id === office.holderId);
    if (!office || !left || !right || !holder) throw new Error('expected a current seat and two active factions');

    for (const faction of factions) {
      faction.alliedFactionIds = [];
      faction.rivalFactionIds = [];
      faction.relationSinceTurns = {};
      faction.memberIds = faction.memberIds.filter((characterId) => characterId !== holder.id);
    }
    holder.factionId = left.id;
    left.memberIds = [...new Set([...left.memberIds, holder.id])];
    left.alliedFactionIds = [right.id];
    right.alliedFactionIds = [left.id];
    left.relationSinceTurns[right.id] = world.turn;
    right.relationSinceTurns[left.id] = world.turn;

    const factContext = { turn: world.turn, year: world.year, season: world.season, facts: [] };
    const relationFact = emitSimulationFact(world, factContext, {
      kind: 'faction_relation_changed',
      category: '政治',
      importance: 3,
      actorIds: [left.leaderId, right.leaderId],
      polityIds: [polity.id],
      regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
      causes: [{ label: '共同议程', role: '选择', weight: 1, evidence: `${left.name}与${right.name}决定彼此支持` }],
      stateDeltas: [{ entityType: 'faction', entityId: left.id, field: `alliance:${right.id}`, before: false, after: true }],
      sourceFactIds: [],
      payload: {
        polityId: polity.id,
        leftFactionId: left.id,
        rightFactionId: right.id,
        relation: 'alliance',
        action: 'formed',
        reasonCode: 'test_court_archive',
        leftLeaderId: left.leaderId,
        rightLeaderId: right.leaderId,
      },
    });
    world.counters.event += 1;
    const relationEvent: HistoryEvent = {
      id: `event_${String(world.counters.event).padStart(6, '0')}`,
      turn: world.turn,
      year: world.year,
      season: world.season,
      category: '政治',
      kind: 'faction_alliance_formed',
      title: `${left.name}与${right.name}结成盟约`,
      summary: `${left.name}与${right.name}交换朝中支持。`,
      importance: 3,
      actorIds: [left.leaderId, right.leaderId],
      polityIds: [polity.id],
      regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
      causes: relationFact.causes,
      evidence: [],
      stateDeltas: relationFact.stateDeltas,
      sourceFactIds: [relationFact.id],
      situationIds: [],
    };
    world.history.push(relationEvent);
    const appointmentFact = emitSimulationFact(world, factContext, {
      kind: 'appointment_started',
      category: '政治',
      importance: 2,
      actorIds: [office.holderId],
      polityIds: [office.polityId],
      regionIds: office.regionId ? [office.regionId] : [],
      causes: [{ label: '朝中支持', role: '触发', weight: 1, evidence: `${left.name}与${right.name}的支持促成任命` }],
      stateDeltas: [{ entityType: 'office', entityId: office.id, field: 'active', before: false, after: true }],
      sourceFactIds: [relationFact.id],
      payload: {
        appointmentId: office.id,
        action: 'started',
        officeKind: office.kind,
        holderId: office.holderId,
        polityId: office.polityId,
        regionId: office.regionId,
        armyId: office.armyId,
        fleetId: office.fleetId ?? null,
        rank: office.rank,
      },
    });

    world.lastTurn = null;
    world.turn = 96;
    compactWorldArchive(world);
    expect(world.facts.some((fact) => fact.id === relationFact.id || fact.id === appointmentFact.id)).toBe(false);
    expect(world.history.some((event) => event.id === relationEvent.id)).toBe(false);
    const before = serializeWorld(world);
    const projection = projectCourt(world, polity.id, 'all');
    expect(projection.seats.find((seat) => seat.officeId === office.id)?.sourceEventId).toBe(relationEvent.id);
    expect(projection.relations.find((relation) => (
      [relation.leftFactionId, relation.rightFactionId].includes(left.id)
      && [relation.leftFactionId, relation.rightFactionId].includes(right.id)
    ))?.sourceEventId).toBe(relationEvent.id);
    expect(serializeWorld(world)).toBe(before);
  });
});
