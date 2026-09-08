import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld, serializeWorld } from '../sim';
import type { HistoryEvent, SimulationFact } from '../sim/types';
import { toPersonExperienceRecords, toPersonInspector } from './person-dossier-adapter';
import { readableParticipant } from './historical-scenes';
import { projectSituationDetail } from './situation-detail';

const base = advanceWorldBy(createWorld('春战副将'), 8);
const battle = base.facts.find((fact) => fact.kind === 'battle')!;
if (battle.kind !== 'battle') throw new Error('battle fixture missing');

describe('ordinary player story truth', () => {
  it('reads the first battle and deputy debut from all battle facts after biography eviction', () => {
    const world = structuredClone(base);
    const person = world.characters.find((item) => item.id === battle.payload.attacker.commanderId)!;
    const first = { ...structuredClone(battle), id: 'battle_early', turn: 1 };
    const deputy = { ...structuredClone(battle), id: 'battle_deputy', turn: 92,
      payload: { ...structuredClone(battle.payload), attacker: { ...structuredClone(battle.payload.attacker),
        commanderId: world.characters.find((item) => item.id !== person.id)!.id, deputyCommanderId: person.id } } };
    world.facts = [deputy, first]; world.history = []; world.turn = 109;
    person.biography = [{ id: 'late-bio', kind: '首次参战', turn: 92, summary: '进入事实档案',
      importance: 2, factId: deputy.id, eventId: null }];
    const before = serializeWorld(world);
    const records = toPersonExperienceRecords(world, person);
    expect(records.filter((item) => item.title.startsWith('首次参战'))).toHaveLength(1);
    expect(records.find((item) => item.title.startsWith('首次参战'))?.date).toContain('1 年');
    expect(records.find((item) => item.title.startsWith('首次以副将'))?.date).toContain('24 年');
    expect(records.some((item) => item.summary.includes('事实档案'))).toBe(false);
    person.biography = [];
    expect(toPersonExperienceRecords(world, person)).toEqual(records);
    person.biography = [{ id: 'late-bio', kind: '首次参战', turn: 92, summary: '进入事实档案',
      importance: 2, factId: deputy.id, eventId: null }];
    expect(serializeWorld(world)).toBe(before);
  });

  it('deduplicates the same pact across biography and separate Facts/Events and resolves internal names', () => {
    const world = structuredClone(base);
    const person = world.characters[0]!;
    const other = world.characters[1]!;
    const pact: SimulationFact = { ...structuredClone(battle), id: 'pact_a', kind: 'faction_relation_changed', turn: 4,
      actorIds: [person.id, other.id], payload: { polityId: person.polityId!, leftFactionId: world.factions[0]!.id,
        rightFactionId: world.factions[1]!.id, leftLeaderId: person.id, rightLeaderId: other.id,
        action: 'formed', relation: 'alliance', reasonCode: 'cooperation' } };
    const event: HistoryEvent = { ...world.history[0]!, id: 'pact_event', turn: 4, kind: 'faction_alliance',
      actorIds: [person.id, other.id], sourceFactIds: [pact.id], title: '两系结盟', summary: `${person.id}与${other.id}结盟。` };
    world.facts = [pact, { ...pact, id: 'pact_b' }];
    world.history = [event, { ...event, id: 'pact_duplicate', sourceFactIds: ['pact_b'] },
      { ...event, id: 'birth_fixture', sourceFactIds: [], title: '出生', summary: `${person.id}出生。具名出生是人口群体中的叙事标记，不重复增加州域人口。` }];
    person.biography = [0, 1].map((index) => ({ id: `bio_${index}`, kind: '结盟', turn: 4, summary: event.summary,
      eventId: event.id, factId: null, importance: 3 }));
    const records = toPersonExperienceRecords(world, person);
    expect(records.filter((item) => item.title === '两系结盟')).toHaveLength(1);
    const visible = records.map((item) => item.title + item.summary).join('');
    expect(visible).toContain(`${person.name}与${other.name}`);
    expect(visible).not.toMatch(/c_\d+|人口群体|不重复增加|进入事实档案|可核验/);
    const relation = world.relationships.find((item) => item.sourceId === person.id || item.targetId === person.id);
    if (relation?.memories[0]) relation.memories[0].summary = `${person.id}与${other.id}同守一地`;
    expect(JSON.stringify(toPersonInspector(world, person).relationships)).not.toMatch(/所记[^"\n]*c_\d+/);
  });

  it('prefers a readable real participant without changing command ownership', () => {
    const world = structuredClone(base);
    const [empty, rooted] = world.characters;
    world.offices = world.offices.filter((office) => office.holderId !== empty!.id);
    world.personalForces = world.personalForces.filter((force) => force.ownerId !== empty!.id);
    world.relationships = world.relationships.filter((relation) => relation.sourceId !== empty!.id && relation.targetId !== empty!.id);
    world.factions.forEach((faction) => { if (faction.leaderId === empty!.id) faction.leaderId = rooted!.id; });
    empty!.biography = []; world.agencyDecisionSystem.actors = [];
    const before = JSON.stringify(world);
    expect(readableParticipant(world, [empty!.id, rooted!.id])?.id).toBe(rooted!.id);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('treats military appointments as succession background unless the same fact changes succession', () => {
    const world = structuredClone(base);
    const source = world.situationSystem.situations[0]!;
    const appointment = world.facts.find((fact) => fact.kind === 'appointment_started')!;
    if (appointment.kind !== 'appointment_started') throw new Error('appointment fixture missing');
    const fact = { ...appointment, id: 'succession_appointment', turn: 6, payload: { ...appointment.payload, officeKind: '军团主帅' as const },
      stateDeltas: [{ entityType: 'office' as const, entityId: appointment.payload.appointmentId, field: 'active', before: false, after: true }] };
    const situation = { ...source, type: 'inheritance_crisis' as const, startedTurn: 0, lastUpdatedTurn: 7,
      causalFactIds: [fact.id], milestoneFactIds: [], resolution: null, status: 'open' as const,
      participants: { ...source.participants, coreCharacterIds: [fact.payload.holderId], polityIds: [fact.payload.polityId] } };
    world.facts = [fact];
    let detail = projectSituationDetail(world, situation);
    expect(detail.scenes).toHaveLength(0);
    expect(detail.recentDeltas).toHaveLength(0);
    world.facts = [{ ...fact, stateDeltas: [{ entityType: 'polity', entityId: fact.payload.polityId,
      field: 'rulerId', before: null, after: fact.payload.holderId }] }];
    detail = projectSituationDetail(world, situation);
    expect(detail.scenes.length).toBeGreaterThan(0);
    expect(detail.recentDeltas[0]?.afterLabel).toBe(world.characters.find((item) => item.id === fact.payload.holderId)?.name);
    const death: SimulationFact = { ...battle, id: 'succession_death', turn: 6, kind: 'character_death', actorIds: [fact.payload.holderId],
      payload: { characterId: fact.payload.holderId, cause: 'natural', age: 80, role: '君主', health: 0, diseaseId: null },
      stateDeltas: [{ entityType: 'character', entityId: fact.payload.holderId, field: 'alive', before: true, after: false }] };
    world.facts = [death]; situation.causalFactIds = [death.id];
    detail = projectSituationDetail(world, situation);
    expect(detail.recentDeltas[0]).toMatchObject({ fieldLabel: '生死', afterLabel: '已故' });
    death.stateDeltas.push({ entityType: 'polity', entityId: fact.payload.polityId, field: 'alive', before: true, after: false });
    detail = projectSituationDetail(world, situation);
    expect(detail.recentDeltas.find((delta) => delta.entityId === fact.payload.polityId))
      .toMatchObject({ fieldLabel: '政权存续', afterLabel: '已亡' });
  });
});
