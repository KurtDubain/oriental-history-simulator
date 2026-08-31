import { describe, expect, it } from 'vitest';

import { createWorld, serializeWorld } from '../sim';
import { clearWorldArchiveDecodeCache, compactWorldArchive } from '../sim/archive';
import {
  familyRoster as familyRosterFromBarrel,
  militaryRoster as militaryRosterFromBarrel,
  peopleRoster as peopleRosterFromBarrel,
  polityRoster as polityRosterFromBarrel,
  toCausalEvent as toCausalEventFromBarrel,
  toChronicleEvent as toChronicleEventFromBarrel,
  toCountryArchive as toCountryArchiveFromBarrel,
  toCountryInspector as toCountryInspectorFromBarrel,
  toFamilyArchive as toFamilyArchiveFromBarrel,
  toFamilyInspector as toFamilyInspectorFromBarrel,
  toPersonArchive as toPersonArchiveFromBarrel,
  toPersonExperienceRecords as toPersonExperienceRecordsFromBarrel,
  toPersonInspector as toPersonInspectorFromBarrel,
} from './adapters';
import { toCountryArchive, toCountryInspector } from './country-dossier-adapter';
import { toFamilyArchive, toFamilyInspector } from './family-dossier-adapter';
import { toCausalEvent, toChronicleEvent } from './history-causal-adapter';
import {
  toPersonArchive,
  toPersonExperienceRecords,
  toPersonInspector,
} from './person-dossier-adapter';
import { familyRoster, militaryRoster, peopleRoster, polityRoster } from './roster-adapter';

describe('dossier adapter boundaries', () => {
  it('keeps each domain projection independently importable behind the compatibility barrel', () => {
    const world = createWorld('档案职责边界');
    const before = serializeWorld(world);
    const country = world.polities[0];
    const person = world.characters.find((candidate) => candidate.alive && candidate.polityId === country.id)
      ?? world.characters[0];
    const family = world.families.find((candidate) => candidate.memberIds.includes(person.id))
      ?? world.families[0];
    const event = world.history[0];

    expect(toCountryInspector(world, country)).toEqual(toCountryInspectorFromBarrel(world, country));
    expect(toCountryArchive(world, country)).toEqual(toCountryArchiveFromBarrel(world, country));
    expect(toPersonInspector(world, person)).toEqual(toPersonInspectorFromBarrel(world, person));
    expect(toPersonArchive(world, person)).toEqual(toPersonArchiveFromBarrel(world, person));
    expect(toPersonExperienceRecords(world, person))
      .toEqual(toPersonExperienceRecordsFromBarrel(world, person));
    expect(toFamilyInspector(world, family)).toEqual(toFamilyInspectorFromBarrel(world, family));
    expect(toFamilyArchive(world, family)).toEqual(toFamilyArchiveFromBarrel(world, family));
    expect(toChronicleEvent(world, event)).toEqual(toChronicleEventFromBarrel(world, event));
    expect(toCausalEvent(world, event)).toEqual(toCausalEventFromBarrel(world, event));
    expect(polityRoster(world)).toEqual(polityRosterFromBarrel(world));
    expect(peopleRoster(world)).toEqual(peopleRosterFromBarrel(world));
    expect(familyRoster(world)).toEqual(familyRosterFromBarrel(world));
    expect(militaryRoster(world)).toEqual(militaryRosterFromBarrel(world));
    expect(serializeWorld(world)).toBe(before);
  });

  it('keeps cold person, family and polity records visible through every dossier boundary', () => {
    const world = createWorld('冷卷对象史');
    const person = world.characters.find((candidate) => candidate.familyId !== null) ?? world.characters[0];
    const personFamily = world.families.find((candidate) => candidate.id === person.familyId)
      ?? world.families.find((candidate) => candidate.memberIds.includes(person.id));
    const country = world.polities.find((candidate) => candidate.id === person.polityId) ?? world.polities[0];
    if (!personFamily) throw new Error('expected a family for the cold dossier fixture');
    const coldEvent = {
      ...world.history[0],
      id: 'event_000002',
      turn: 2,
      year: 1,
      season: '秋' as const,
      kind: 'cold_dossier_record',
      title: `${person.name}入朝议事`,
      summary: `${person.name}代表${personFamily.name}参与${country.name}朝议。`,
      actorIds: [person.id],
      polityIds: [country.id],
      sourceFactIds: [],
    };
    person.biography.push({
      id: 'bio_cold_dossier_record',
      turn: coldEvent.turn,
      kind: '入朝议事',
      summary: coldEvent.summary,
      importance: coldEvent.importance,
      eventId: coldEvent.id,
      factId: null,
    });
    world.history.push(coldEvent);
    world.turn = 80;
    world.year = 21;
    world.season = '春';
    compactWorldArchive(world);

    expect(world.history.some((event) => event.id === coldEvent.id)).toBe(false);
    expect(toPersonExperienceRecords(world, person).some((record) => record.eventId === coldEvent.id)).toBe(true);
    expect(toPersonArchive(world, person).records.some((record) => record.eventId === coldEvent.id)).toBe(true);
    expect(toFamilyArchive(world, personFamily).records.some((record) => record.eventId === coldEvent.id)).toBe(true);
    expect(toCountryArchive(world, country).records.some((record) => record.eventId === coldEvent.id)).toBe(true);
  });

  it('keeps ordinary person, family and polity inspectors on the active history window', () => {
    const world = createWorld('冷卷不阻地图速览');
    const person = world.characters.find((candidate) => candidate.familyId !== null) ?? world.characters[0];
    const personFamily = world.families.find((candidate) => candidate.id === person.familyId)
      ?? world.families.find((candidate) => candidate.memberIds.includes(person.id));
    const country = world.polities.find((candidate) => candidate.id === person.polityId) ?? world.polities[0];
    if (!personFamily) throw new Error('expected a family for the active dossier fixture');
    world.turn = 80;
    world.year = 21;
    world.season = '春';
    compactWorldArchive(world);
    const coldBlock = world.archiveSystem.blocks[0];
    expect(coldBlock).toBeDefined();
    if (!coldBlock) return;
    coldBlock.payloadBase64 = `!${coldBlock.payloadBase64.slice(1)}`;
    clearWorldArchiveDecodeCache();

    expect(() => toPersonInspector(world, person)).not.toThrow();
    expect(() => toFamilyInspector(world, personFamily)).not.toThrow();
    expect(() => toCountryInspector(world, country)).not.toThrow();
  });
});
