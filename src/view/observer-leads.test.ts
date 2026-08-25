import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim';
import type { WarState, WorldState } from '../sim/types';
import { deriveObserverLeads } from './observer-leads';

function targetExists(world: WorldState, kind: string, id: string): boolean {
  if (kind === 'person') return world.characters.some((item) => item.id === id);
  if (kind === 'country') return world.polities.some((item) => item.id === id);
  if (kind === 'region') return world.regions.some((item) => item.id === id);
  if (kind === 'outbreak') return world.infections.some((item) => item.id === id);
  if (kind === 'seaZone') return world.seaZones.some((item) => item.id === id);
  return false;
}

describe('observer story leads', () => {
  it('always offers one person, one polity and one live tension without changing the world', () => {
    const world = createWorld('今世三问-固定测试');
    const hash = world.hash;
    const serialized = JSON.stringify(world);
    const leads = deriveObserverLeads(world);

    expect(leads.map((item) => item.slot)).toEqual(['person', 'polity', 'tension']);
    expect(leads).toHaveLength(3);
    expect(leads.every((item) => item.question.endsWith('？'))).toBe(true);
    expect(leads.every((item) => item.evidence.length === 2 && item.nextSignal.length > 0)).toBe(true);
    expect(leads.every((item) => item.tension >= 0 && item.tension <= 100)).toBe(true);
    expect(leads.every((item) => targetExists(world, item.target.kind, item.target.id))).toBe(true);
    expect(world.hash).toBe(hash);
    expect(JSON.stringify(world)).toBe(serialized);
  });

  it('is deterministic and promotes an active war to the live-tension line', () => {
    const world = createWorld('今世三问-战争测试');
    const [attacker, defender] = world.polities.filter((item) => item.alive);
    const war: WarState = {
      id: 'war-editorial-test',
      kind: 'interstate',
      attackerId: attacker.id,
      defenderId: defender.id,
      startedTurn: world.turn,
      endedTurn: null,
      active: true,
      attackerScore: 12,
      defenderScore: 9,
      reason: '边境争端',
      lastBattleTurn: world.turn,
      goal: '边境',
      targetRegionIds: defender.controlledRegionIds.slice(0, 1),
      exhaustion: 16,
    };
    const withWar: WorldState = { ...world, wars: [...world.wars, war] };

    expect(deriveObserverLeads(withWar)).toEqual(deriveObserverLeads(withWar));
    expect(deriveObserverLeads(withWar)[2]).toMatchObject({
      slot: 'tension',
      overlay: 'war',
      target: { kind: 'country', id: attacker.id },
    });
  });
});

