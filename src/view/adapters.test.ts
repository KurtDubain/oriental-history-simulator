import { describe, expect, it } from 'vitest';

import { advanceWorldBy, createWorld, type BiographyFact, type CharacterState } from '../sim';
import { toPersonArchive, toPersonExperienceRecords, toPersonInspector, toSystemInspector } from './adapters';

describe('map object dossiers', () => {
  it('projects a clicked land army into its own commander, location and readiness dossier', () => {
    const world = createWorld('陆军档案');
    const army = world.armies[0];
    const commander = world.characters.find((character) => character.id === army.commanderId);
    const dossier = toSystemInspector(world, 'army', army.id);

    expect(dossier).toMatchObject({ id: army.id, kind: 'army', name: army.name });
    expect(dossier?.facts).toContainEqual({ label: '主帅', value: commander?.name });
    expect(dossier?.facts).toContainEqual({ label: '最近移动', value: '尚未移营' });
    expect(dossier?.meters?.map((meter) => meter.label)).toEqual(['士气', '训练', '战阵经验', '补给']);
    expect(dossier?.links).toContainEqual(expect.objectContaining({ kind: 'person', id: army.commanderId }));
    expect(dossier?.links).toContainEqual(expect.objectContaining({ kind: 'region', id: army.regionId }));
  });
});

describe('person experience attribution', () => {
  it('drops a biography row linked to somebody else and makes shared-event attribution explicit', () => {
    const world = advanceWorldBy(createWorld('人物经历归属'), 8);
    const sourceEvent = world.history.find((event) => (
      event.actorIds.length > 0 && event.actorIds.length < world.characters.length
    ));
    expect(sourceEvent).toBeDefined();
    if (!sourceEvent) return;

    const stranger = world.characters.find((character) => !sourceEvent.actorIds.includes(character.id));
    const participant = world.characters.find((character) => sourceEvent.actorIds.includes(character.id));
    expect(stranger).toBeDefined();
    expect(participant).toBeDefined();
    if (!stranger || !participant) return;

    const misplaced: BiographyFact = {
      id: `${stranger.id}:bio:misplaced`,
      turn: sourceEvent.turn,
      kind: '错置经历',
      summary: `${participant.name}完成了这件事。`,
      importance: 3,
      eventId: sourceEvent.id,
      factId: null,
    };
    stranger.biography.push(misplaced);
    expect(toPersonExperienceRecords(world, stranger).some((record) => record.id === misplaced.id)).toBe(false);
    expect(toPersonInspector(world, stranger).experiences?.some((record) => record.id === misplaced.id)).toBe(false);
    expect(toPersonArchive(world, stranger).records.some((record) => record.id === misplaced.id)).toBe(false);

    const sharedEvent = {
      ...sourceEvent,
      id: 'event_person_attribution_fixture',
      turn: world.turn - 1,
      title: `${stranger.name}整顿朝局`,
      summary: `${stranger.name}主持朝议，${participant.name}协理其事。`,
      actorIds: [stranger.id, participant.id],
      sourceFactIds: [],
    };
    // The selected participant is deliberately the second actor even though
    // both names occur in the prose. This used to keep the first actor's
    // viewpoint and still looked pasted into the second actor's dossier.
    world.history.push(sharedEvent);
    const sharedBiography: BiographyFact = {
      id: `${participant.id}:bio:${sharedEvent.id}:related`,
      turn: sharedEvent.turn,
      kind: '卷入朝局',
      summary: sharedEvent.summary,
      importance: 3,
      eventId: sharedEvent.id,
      factId: null,
    };
    participant.biography.push(sharedBiography);
    const projected = toPersonExperienceRecords(world, participant).find((record) => record.id === sharedBiography.id);
    expect(projected?.summary).toBe(`${participant.name}卷中记为「${sharedBiography.kind}」，见于「${sharedEvent.title}」；同卷人物还有${stranger.name}。`);
    expect(projected?.summary.startsWith(stranger.name)).toBe(false);

    const misleadingPrimaryEvent = {
      ...sharedEvent,
      id: 'event_person_attribution_sorted_primary',
      title: `${stranger.name}成为权力中枢`,
      summary: `${stranger.name}凭借官职与家族声望执掌朝局。`,
      actorIds: [participant.id, stranger.id],
    };
    world.history.push(misleadingPrimaryEvent);
    const misleadingPrimaryBiography: BiographyFact = {
      id: `${participant.id}:bio:${misleadingPrimaryEvent.id}:court`,
      turn: misleadingPrimaryEvent.turn,
      kind: '卷入朝局',
      summary: misleadingPrimaryEvent.summary,
      importance: 3,
      eventId: misleadingPrimaryEvent.id,
      factId: null,
    };
    participant.biography.push(misleadingPrimaryBiography);
    const safePrimary = toPersonExperienceRecords(world, participant).find((record) => record.id === misleadingPrimaryBiography.id);
    expect(safePrimary?.summary.startsWith(participant.name)).toBe(true);
    expect(safePrimary?.summary).not.toBe(misleadingPrimaryEvent.summary);

    const eventOnly = {
      ...sharedEvent,
      id: 'event_person_attribution_event_only',
      title: `${stranger.name}重定朝仪`,
    };
    world.history.push(eventOnly);
    const eventOnlyRecord = toPersonExperienceRecords(world, participant).find((record) => record.id === eventOnly.id);
    expect(eventOnlyRecord?.summary).toBe(`${participant.name}直接卷入「${eventOnly.title}」；同卷人物还有${stranger.name}。`);
  });

  it('keeps genuine deputy, appointment and marriage records from a fixed natural world', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 8);

    const deputy = world.characters.find((character) => character.biography.some((entry) => entry.kind === '首次参战' && entry.factId));
    expect(deputy).toBeDefined();
    if (deputy) {
      const firstBattle = deputy.biography.find((entry) => entry.kind === '首次参战' && entry.factId);
      const records = toPersonArchive(world, deputy).records;
      expect(records.some((record) => record.id === firstBattle?.id)).toBe(true);
      const source = world.facts.find((fact) => fact.id === firstBattle?.factId);
      expect(source?.actorIds).toContain(deputy.id);
      if (source?.kind === 'battle') {
        expect([source.payload.attacker, ...source.payload.defenders].some((force) => (
          force.deputyCommanderId === deputy.id || force.commanderId === deputy.id
        ))).toBe(true);
      }
    }

    const appointment = world.facts.find((fact) => fact.kind === 'appointment_started');
    expect(appointment).toBeDefined();
    if (appointment?.kind === 'appointment_started') {
      const holder = world.characters.find((character) => character.id === appointment.payload.holderId) as CharacterState;
      const recordId = `${holder.id}:experience:${appointment.id}`;
      const records = toPersonArchive(world, holder).records;
      expect(records).toContainEqual(expect.objectContaining({
        id: recordId,
        title: `就任${appointment.payload.officeKind}`,
      }));
      expect(records.find((record) => record.id === recordId)?.summary).toContain(holder.name);
    }

    const marriage = world.facts.find((fact) => fact.kind === 'marriage');
    expect(marriage).toBeDefined();
    if (marriage?.kind === 'marriage') {
      const spouse = world.characters.find((character) => character.id === marriage.payload.leftCharacterId) as CharacterState;
      const event = world.history.find((candidate) => candidate.sourceFactIds.includes(marriage.id));
      expect(event?.actorIds).toContain(spouse.id);
      expect(toPersonArchive(world, spouse).records.some((record) => record.eventId === event?.id)).toBe(true);
    }
  });

  it('never projects a record whose linked source does not reference the selected person', () => {
    const world = advanceWorldBy(createWorld('人物经历来源审计'), 20);
    for (const person of world.characters) {
      const biographyById = new Map(person.biography.map((entry) => [entry.id, entry]));
      const eventById = new Map(world.history.map((event) => [event.id, event]));
      const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
      const officeByInitialRecordId = new Map(world.offices
        .filter((office) => office.holderId === person.id)
        .map((office) => [`${person.id}:experience:${office.id}:initial`, office]));

      for (const record of toPersonExperienceRecords(world, person)) {
        const biography = biographyById.get(record.id);
        if (biography) {
          if (biography.eventId) expect(eventById.get(biography.eventId)?.actorIds).toContain(person.id);
          if (biography.factId) expect(factById.get(biography.factId)?.actorIds).toContain(person.id);
          continue;
        }
        const event = eventById.get(record.id);
        if (event) {
          expect(event.actorIds).toContain(person.id);
          continue;
        }
        const appointment = world.facts.find((fact) => (
          (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
          && `${person.id}:experience:${fact.id}` === record.id
        ));
        if (appointment?.kind === 'appointment_started' || appointment?.kind === 'appointment_ended') {
          expect(appointment.actorIds).toContain(person.id);
          expect(appointment.payload.holderId).toBe(person.id);
          continue;
        }
        expect(officeByInitialRecordId.get(record.id)?.holderId).toBe(person.id);
      }
    }
  }, 15_000);
});
