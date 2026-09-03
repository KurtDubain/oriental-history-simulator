import { describe, expect, it } from 'vitest';

import {
  archiveDecodeCacheEntryCount,
  advanceWorld,
  clearWorldArchiveDecodeCache,
  compactWorldArchive,
  createWorld,
  serializeWorld,
} from '../sim';
import { toCountryInspector } from './country-dossier-adapter';
import { polityPopulation, worldPopulation } from './dossier-adapter-shared';
import {
  projectRosterCollection,
  projectRosterDirectory,
  rosterScopeFor,
} from './roster-adapter';
import { createRosterDiscoveryState, type RosterItem, type RosterScope } from './roster-discovery';

function values(items: readonly RosterItem[], key: string): number[] {
  return items.map((item) => item.discovery?.sortValues[key] ?? Number.NaN);
}

function expectDescending(items: readonly RosterItem[], key: string): void {
  const projected = values(items, key);
  expect(projected.every((value, index) => index === 0 || projected[index - 1] >= value)).toBe(true);
}

function expectAscending(items: readonly RosterItem[], key: string): void {
  const projected = values(items, key);
  expect(projected.every((value, index) => index === 0 || projected[index - 1] <= value)).toBe(true);
}

describe('roster domain projection', () => {
  it('is pure, deterministic and emits only navigable attention reasons', () => {
    const world = createWorld('名录纯投影');
    const before = serializeWorld(world);
    const watchedPerson = world.characters.find((item) => item.alive) ?? world.characters[0];
    const watched = [{ kind: 'person' as const, id: watchedPerson.id, alert: true }];

    const first = projectRosterDirectory(world, watched);
    const second = projectRosterDirectory(world, watched);

    expect(second).toEqual(first);
    expect(serializeWorld(world)).toBe(before);
    expect(first.people.items.find((item) => item.id === watchedPerson.id)?.reason?.kind).toBe('watched-alert');

    const collections: Array<[RosterScope, readonly RosterItem[]]> = [
      ['people', first.people.items],
      ['polities', first.polities.items],
      ['families', first.families.items],
      ['military', first.military.items],
    ];
    const activeEventIds = new Set(world.history.map((item) => item.id));
    const activeSituationIds = new Set(world.situationSystem.situations.map((item) => item.id));
    for (const [, items] of collections) {
      const itemIds = new Set(items.map((item) => item.id));
      for (const item of items) {
        expect(item.reason).toBeDefined();
        if (item.reason?.target.kind === 'event') expect(activeEventIds.has(item.reason.target.id)).toBe(true);
        if (item.reason?.target.kind === 'situation') expect(activeSituationIds.has(item.reason.target.id)).toBe(true);
        if (item.reason?.target.kind === 'item') expect(itemIds.has(item.reason.target.id)).toBe(true);
      }
    }
  });

  it('supports people quick views, office identities and stable numeric sorts', () => {
    const world = createWorld('人物名录筛选');
    for (const item of world.characters) item.influence = 50;
    const baseState = createRosterDiscoveryState();

    const rulers = projectRosterCollection(world, 'people', {
      ...baseState,
      filters: { identity: 'ruler' },
    });
    expect(rulers.items.length).toBeGreaterThan(0);
    expect(rulers.items.every((item) => item.discovery?.filters.identity === 'ruler')).toBe(true);

    let actionWorld = createWorld('人物名录本季行动');
    for (let turn = 0; turn < 8; turn += 1) actionWorld = advanceWorld(actionWorld);
    const actionable = projectRosterCollection(actionWorld, 'people', {
      ...baseState,
      quickView: 'actionable',
    });
    expect(actionable.items.length).toBeGreaterThan(0);
    expect(actionable.items.length).toBeLessThan(actionable.totalCount);
    expect(actionable.items.every((item) => item.discovery?.quickViews.includes('actionable'))).toBe(true);

    const influence = projectRosterCollection(world, 'people', {
      ...baseState,
      sort: 'influence',
    });
    expect(influence.items.map((item) => item.id)).toEqual(
      influence.items.map((item) => item.id).slice().sort((left, right) => left.localeCompare(right)),
    );
    expectDescending(influence.items, 'influence');
  });

  it('filters polity wars and sorts polity and family measures', () => {
    const world = createWorld('势力名录筛选');
    const [attacker, defender] = world.polities;
    world.wars.push({
      id: 'war_roster_fixture',
      kind: 'interstate',
      attackerId: attacker.id,
      defenderId: defender.id,
      startedTurn: world.turn,
      endedTurn: null,
      active: true,
      attackerScore: 0,
      defenderScore: 0,
      reason: '名录测试战事',
      lastBattleTurn: -1,
      goal: '边境',
      targetRegionIds: [],
      exhaustion: 0,
    });
    const baseState = createRosterDiscoveryState();
    const atWar = projectRosterCollection(world, 'polities', {
      ...baseState,
      filters: { war: 'at-war' },
    });
    expect(new Set(atWar.items.map((item) => item.id))).toEqual(new Set([attacker.id, defender.id]));

    const population = projectRosterCollection(world, 'polities', { ...baseState, sort: 'population' });
    expectDescending(population.items, 'population');
    const familyPower = projectRosterCollection(world, 'families', {
      ...baseState,
      sort: 'politicalInfluence',
    });
    expectDescending(familyPower.items, 'politicalInfluence');
  });

  it('treats armies and fleets uniformly for kind, food coverage and sorting', () => {
    const world = createWorld('混合军势名录');
    const army = world.armies[0];
    const fleet = world.fleets[0];
    expect(army).toBeDefined();
    expect(fleet).toBeDefined();
    army.food = army.soldiers * 0.25;
    fleet.food = fleet.sailors * 1.25;
    const baseState = createRosterDiscoveryState();

    const armies = projectRosterCollection(world, 'military', {
      ...baseState,
      filters: { kind: 'army' },
    });
    expect(armies.items.length).toBeGreaterThan(0);
    expect(armies.items.every((item) => item.discovery?.filters.kind === 'army')).toBe(true);
    const fleets = projectRosterCollection(world, 'military', {
      ...baseState,
      filters: { kind: 'fleet' },
    });
    expect(fleets.items.length).toBeGreaterThan(0);
    expect(fleets.items.every((item) => item.discovery?.filters.kind === 'fleet')).toBe(true);

    const strained = projectRosterCollection(world, 'military', {
      ...baseState,
      filters: { supply: 'strained' },
    });
    expect(strained.items.some((item) => item.id === army.id)).toBe(true);
    expect(strained.items.every((item) => item.discovery?.filters.supply === 'strained')).toBe(true);
    const ready = projectRosterCollection(world, 'military', {
      ...baseState,
      filters: { supply: 'ready' },
    });
    expect(ready.items.some((item) => item.id === fleet.id)).toBe(true);
    expect(ready.items.every((item) => item.discovery?.filters.supply === 'ready')).toBe(true);

    const supplyOrder = projectRosterCollection(world, 'military', { ...baseState, sort: 'supply' });
    expectAscending(supplyOrder.items, 'supply');

    army.food = army.soldiers * 2;
    army.supply = 20;
    army.morale = 60;
    fleet.food = fleet.sailors * 2;
    fleet.repairNeed = 80;
    fleet.morale = 60;
    const operationalOnly = projectRosterCollection(world, 'military');
    expect(operationalOnly.items.find((item) => item.id === army.id)).toMatchObject({
      alert: false,
      discovery: { filters: { supply: 'ready' } },
    });
    expect(operationalOnly.items.find((item) => item.id === fleet.id)).toMatchObject({
      alert: false,
      discovery: { filters: { supply: 'ready' } },
    });
  });

  it('uses the shared polity population definition including fielded sailors', () => {
    const world = createWorld('列国人口口径');
    const polity = world.polities[0];
    const expected = world.regions
      .filter((item) => item.controllerId === polity.id)
      .reduce((sum, item) => sum + item.population, 0)
      + world.personalForces
        .filter((force) => world.characters.find((person) => person.id === force.ownerId)?.polityId === polity.id)
        .reduce((sum, item) => sum + item.soldiers, 0)
      + world.fleets.filter((item) => item.polityId === polity.id).reduce((sum, item) => sum + item.sailors, 0);

    expect(polityPopulation(world, polity.id)).toBe(expected);
    expect(toCountryInspector(world, polity).population).toBe(expected);
    expect(projectRosterCollection(world, 'polities').items.find((item) => item.id === polity.id)?.discovery?.sortValues.population).toBe(expected);
    expect(worldPopulation(world)).toBe(
      world.regions.reduce((sum, item) => sum + item.population, 0)
      + world.personalForces.reduce((sum, item) => sum + item.soldiers, 0)
      + world.fleets.reduce((sum, item) => sum + item.sailors, 0),
    );
  });

  it('never decodes a cold archive block while building roster views', () => {
    const world = createWorld('名录不读冷卷');
    world.turn = 80;
    world.year = 21;
    world.season = '春';
    compactWorldArchive(world);
    const coldBlock = world.archiveSystem.blocks[0];
    expect(coldBlock).toBeDefined();
    if (!coldBlock) return;
    coldBlock.payloadBase64 = `!${coldBlock.payloadBase64.slice(1)}`;
    clearWorldArchiveDecodeCache();

    expect(() => projectRosterDirectory(world)).not.toThrow();
    expect(archiveDecodeCacheEntryCount()).toBe(0);
  });

  it('never promotes Situation bookkeeping as a clickable roster event', () => {
    const world = advanceWorld(createWorld('名录只讲具体史事'));
    const person = world.characters.find((item) => item.alive) ?? world.characters[0];
    const wrappedEventId = 'event_situation_wrapper';
    world.history.push({
      id: wrappedEventId,
      turn: world.turn,
      year: world.year,
      season: world.season,
      category: '政治',
      kind: 'situation_phase_changed',
      title: `${person.name}所在局势转入临界`,
      summary: '这是后台局势包装，不是人物行动。',
      importance: 5,
      actorIds: [person.id],
      polityIds: [person.polityId],
      regionIds: [person.locationRegionId],
      causes: [],
      evidence: [],
      stateDeltas: [],
      sourceFactIds: [],
      situationIds: ['situation_test'],
    });
    if (!world.lastTurn) throw new Error('expected a settled turn report');
    world.lastTurn = {
      ...world.lastTurn,
      eventIds: [...world.lastTurn.eventIds, wrappedEventId],
    };

    const directory = projectRosterDirectory(world);
    const reasons = [
      ...directory.people.items,
      ...directory.polities.items,
      ...directory.families.items,
      ...directory.military.items,
    ].map((item) => item.reason);
    expect(reasons.some((reason) => reason?.target.kind === 'event' && reason.target.id === wrappedEventId)).toBe(false);
    expect(world.history.some((item) => item.id === wrappedEventId)).toBe(true);
  });

  it('maps shell views to roster scopes without hidden state', () => {
    expect(rosterScopeFor('people', 'military')).toBe('people');
    expect(rosterScopeFor('powers', 'families')).toBe('families');
    expect(rosterScopeFor('world', 'polities')).toBeNull();
    expect(rosterScopeFor('chronicle', 'military')).toBeNull();
  });
});
