import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld, serializeWorld } from '../index';
import {
  calculateCharacterPowerPosition,
  calculateFactionPowerLedger,
} from './power-ledger';

describe('POL01 political power ledger', () => {
  it('derives every faction total from concrete bounded assets without reading the old total', () => {
    const world = advanceWorldBy(createWorld('权势资源账'), 8);
    const before = serializeWorld(world);
    const active = world.factions.filter((faction) => faction.active);
    expect(active.length).toBeGreaterThan(0);

    for (const faction of active) {
      const ledger = calculateFactionPowerLedger(world, faction);
      expect(ledger.total).toBe(faction.power);
      expect(ledger.total).toBeGreaterThanOrEqual(0);
      expect(ledger.total).toBeLessThanOrEqual(100);
      expect(ledger.categories.map((category) => category.category)).toEqual([
        'central_office',
        'regional_office',
        'military_command',
        'family_backing',
        'member_renown',
        'alliance_support',
        'cohesion',
      ]);
      expect(ledger.resources.length).toBeLessThanOrEqual(48);
      expect(ledger.resources.every((resource) => resource.evidence.length > 0)).toBe(true);
      expect(ledger.resources.some((resource) => resource.evidence.some((ref) => ref.field === 'power'))).toBe(false);
      for (const category of ledger.categories) {
        expect(category.value).toBeLessThanOrEqual(category.maximum + 0.1);
      }
    }
    expect(serializeWorld(world)).toBe(before);
  });

  it('shows a person only the offices, commands, family standing and explicit support they actually possess', () => {
    const world = advanceWorldBy(createWorld('人物权势落点'), 12);
    const person = world.characters.find((character) => (
      character.alive
      && world.offices.some((office) => office.active && office.holderId === character.id)
    ));
    if (!person) throw new Error('expected a living office holder');
    const position = calculateCharacterPowerPosition(world, person.id);
    expect(position.total).toBeGreaterThan(0);
    expect(position.resources.length).toBeLessThanOrEqual(8);
    expect(position.resources.every((resource) => resource.characterIds.includes(person.id))).toBe(true);
    expect(position.resources.some((resource) => (
      resource.evidence.some((ref) => ref.entityType === 'office')
      || resource.evidence.some((ref) => ref.entityType === 'family')
    ))).toBe(true);
  });
});
