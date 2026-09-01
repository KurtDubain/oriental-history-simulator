import { describe, expect, it } from 'vitest';

import { createWorld } from '../sim';
import { projectMilitaryAuthority } from './military-authority-reading';

describe('shared military authority reading', () => {
  it('distinguishes the lawful commander from the officer actually obeyed by the army', () => {
    const world = createWorld('军权阅读投影');
    const army = world.armies[0];
    if (!army) throw new Error('expected an opening army');
    const deputy = world.characters.find((character) => (
      character.alive && character.polityId === army.polityId && character.id !== army.commanderId
    ));
    if (!deputy) throw new Error('expected another officer in the army polity');
    army.deputyCommanderId = deputy.id;
    const lawful = world.characters.find((character) => character.id === army.commanderId);
    const actual = world.characters.find((character) => character.id === army.deputyCommanderId);
    if (!lawful || !actual) throw new Error('expected both command officers');
    army.allegiance = {
      characterId: actual.id,
      strength: 73,
      sinceTurn: world.turn,
      provenance: 'fact',
      sourceFactId: null,
    };
    army.order = {
      ...army.order,
      kind: 'reinforce',
      issuerId: lawful.id,
      targetArmyId: world.armies.find((candidate) => (
        candidate.polityId === army.polityId && candidate.id !== army.id
      ))?.id ?? null,
      reasonCode: 'frontline_support',
    };

    const reading = projectMilitaryAuthority(world, army);

    expect(reading).toMatchObject({
      lawfulCommanderId: lawful.id,
      lawfulCommanderName: lawful.name,
      actualAllegianceId: actual.id,
      actualAllegianceName: actual.name,
      allegianceStrength: 73,
      commandDiverged: true,
      orderIssuerId: lawful.id,
      orderIssuerName: lawful.name,
      orderKind: 'reinforce',
    });
    expect(reading.authoritySummary).toContain(`${lawful.name}依法掌令`);
    expect(reading.authoritySummary).toContain(`士卒更听${actual.name}`);
    expect(reading.retinueSoldiers).toBe(
      army.retinues.reduce((sum, retinue) => sum + retinue.soldiers, 0),
    );
  });
});
