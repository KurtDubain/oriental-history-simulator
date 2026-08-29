import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld, serializeWorld } from '../sim';
import {
  selectedEntityLabel,
  watchItemForSelection,
  watchItemForSituation,
} from './observer-selection';

describe('observer selection projection', () => {
  it('resolves entity labels and watch entries without mutating the world', () => {
    const world = createWorld('架构-对象关注');
    const before = serializeWorld(world);
    const region = world.regions[0];
    const polity = world.polities.find((item) => item.id === region.controllerId) ?? world.polities[0];
    const character = world.characters[0];

    expect(selectedEntityLabel(world, { kind: 'region', id: region.id })).toBe(region.name);
    expect(selectedEntityLabel(world, { kind: 'country', id: polity.id })).toBe(polity.name);
    expect(selectedEntityLabel(world, { kind: 'person', id: character.id })).toBe(character.name);
    expect(selectedEntityLabel(world, { kind: 'region', id: 'missing' })).toBeNull();

    expect(watchItemForSelection(world, { kind: 'region', id: region.id })).toMatchObject({
      kind: 'region',
      id: region.id,
      label: region.name,
      alert: false,
    });
    expect(watchItemForSelection(world, { kind: 'country', id: polity.id })?.detail).toContain('州域');
    expect(watchItemForSelection(world, { kind: 'region', id: 'missing' })).toBeNull();
    expect(serializeWorld(world)).toBe(before);
  });

  it('projects current situations and rejects missing situation ids', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 8);
    const situation = world.situationSystem.situations[0];

    expect(watchItemForSituation(world, 'missing')).toBeNull();
    expect(situation).toBeDefined();
    if (!situation) throw new Error('固定种子应在第八季形成可观察局势');
    expect(watchItemForSituation(world, situation.id)).toMatchObject({
      kind: 'situation',
      id: situation.id,
      alert: false,
    });
  });
});
