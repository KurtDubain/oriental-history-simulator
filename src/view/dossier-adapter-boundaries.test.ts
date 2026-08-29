import { describe, expect, it } from 'vitest';

import { createWorld, serializeWorld } from '../sim';
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
});
