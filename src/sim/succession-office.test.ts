import { describe, expect, it } from 'vitest';
import { createWorld, maintainArmies, resolveVacantRulers } from './engine';
import { settleCharacterDeathState } from './character-death';
import { createTurnContext, totalWorldPopulation } from './turn-context-state';
import { syncOfficeAppointments, trustedForOffice } from './v02';
import { processV03Maritime } from './v03-ocean';
import { selectExpeditionResponses } from './military/expedition-response';
import type { HistoryEvent, WorldState } from './types';

function succession() {
  const world = createWorld('继承同池夹具');
  const polity = world.polities[0];
  const old = world.characters.find(p => p.id === polity.rulerId)!;
  const [adult, minor, minister] = world.characters.filter(p => p.polityId === polity.id && p.id !== old.id);
  world.characters = world.characters.filter(p => p.polityId !== polity.id || [old, adult, minor, minister].includes(p));
  world.offices = []; world.factions = []; world.armies = []; world.fleets = [];
  for (const p of [adult, minor, minister]) {
    p.commandingArmyId = p.commandingFleetId = p.governedRegionId = null;
    p.parentIds = [old.id]; p.spouseIds = []; p.familyId = old.familyId;
    p.governance = p.cunning = p.renown = p.loyalty = 10;
    p.age = 30;
  }
  minister.parentIds = []; minister.familyId = '';
  minor.age = 10; minor.lifeStage = '成长';
  adult.governance = adult.cunning = adult.renown = adult.loyalty = 95;
  settleCharacterDeathState(world, old.id, world.turn);
  return { world, polity, old, adult, minor, minister };
}

describe('succession compares eligible adults and regency proposals together', () => {
  it('does not bypass an equally related adult with clearly stronger actual support', () => {
    const { world, polity, adult, minor } = succession();
    world.offices = [{ id: 'supported-office', polityId: polity.id, holderId: adult.id, kind: '宰辅',
      regionId: polity.capitalRegionId, armyId: null, rank: 90, appointedTurn: 0, endedTurn: null, active: true }];
    const context = createTurnContext(world);
    resolveVacantRulers(world, context);
    expect(polity.rulerId).toBe(adult.id);
    const event = context.events.find(e => e.kind === 'succession')!;
    expect(event.actorIds).not.toContain(minor.id);
    expect(event.causes.find(c => c.role === '选择')?.evidence).toContain('总分');
    // A rejected regency proposal must not lend its governor's ability or actor to the winner.
    expect(event.actorIds).toEqual([adult.id, world.characters.find(p => !p.alive && p.polityId === polity.id)!.id].sort());
  });

  it('still lets a better supported legitimate minor win with a real adult regent', () => {
    const { world, polity, adult, minor, minister } = succession();
    adult.parentIds = []; adult.familyId = '';
    minor.governance = minor.cunning = minor.renown = 80;
    minister.governance = minister.cunning = minister.loyalty = minister.influence = 100;
    const context = createTurnContext(world);
    resolveVacantRulers(world, context);
    expect(polity.rulerId).toBe(minor.id);
    const event = context.events.find(e => e.kind === 'regency')!;
    expect(event.actorIds).toContain(minister.id);
    expect(event.causes.find(c => c.role === '选择')?.evidence).toContain('总分');
  });

  it('compares all eligible minors by the same score, not a separate age/influence preselection', () => {
    const { world, polity, adult, minor, minister } = succession();
    adult.age = 14; adult.influence = 100;
    adult.governance = adult.cunning = adult.renown = adult.loyalty = 0;
    minor.influence = 0; minor.age = 7;
    minor.governance = minor.cunning = minor.renown = minor.loyalty = 90;
    minister.parentIds = []; minister.familyId = '';
    resolveVacantRulers(world, createTurnContext(world));
    expect(polity.rulerId).toBe(minor.id);
  });

  it('does not enthrone a minor without regency resources; the existing dissolution fallback remains', () => {
    const { world, polity, adult, minister, minor } = succession();
    adult.alive = minister.alive = false;
    for (const stub of world.backgroundPeople) stub.birthTurn = world.turn;
    const context = createTurnContext(world);
    resolveVacantRulers(world, context);
    expect(polity.rulerId).not.toBe(minor.id);
    expect(polity.alive).toBe(false);
    expect(context.events.some(e => e.kind === 'polity_dissolved')).toBe(true);
  });

  it('keeps the registered-background regent fallback when no named adult candidate survives', () => {
    const { world, polity, adult, minister, minor } = succession();
    adult.alive = minister.alive = false;
    const stub = world.backgroundPeople.find(p => p.polityId === polity.id && !p.promotedCharacterId)!;
    for (const p of world.backgroundPeople) p.birthTurn = world.turn;
    stub.birthTurn = -100;
    const context = createTurnContext(world);
    resolveVacantRulers(world, context);
    expect(polity.rulerId).toBe(minor.id);
    const regent = world.characters.find(p => p.sourceStubId === stub.id)!;
    expect(regent.age).toBeGreaterThanOrEqual(16);
    const event = context.events.find(e => e.kind === 'regency')!;
    expect(event.actorIds).toContain(regent.id);
    expect(event.causes.find(c => c.role === '选择')?.evidence).toContain('背景候补');
  });
});

function officers() {
  const world = createWorld('正式军职信任夹具');
  const fleet = world.fleets[0];
  const polity = world.polities.find(p => p.id === fleet.polityId)!;
  const former = world.polities.find(p => p.id !== polity.id)!;
  const person = world.characters.find(p => p.id === former.rulerId)!;
  const commander = world.characters.find(p => p.id === fleet.commanderId)!;
  const ruler = world.characters.find(p => p.id === polity.rulerId)!;
  former.alive = false; former.eliminatedTurn = world.turn;
  person.polityId = polity.id; person.role = '廷臣'; person.loyalty = 31;
  person.leadership = person.cunning = 100; person.governance = 100; person.health = 100;
  person.commandingArmyId = person.commandingFleetId = person.governedRegionId = null;
  world.characters = [person, commander, ruler];
  world.armies = []; world.fleets = [fleet]; fleet.deputyCommanderId = null;
  world.relationships = []; world.wars = []; world.navalOperations = [];
  world.shipbuildingProjects = []; world.backgroundPeople = [];
  world.personalForces = world.personalForces.filter(f => world.characters.some(p => p.id === f.ownerId));
  for (const f of world.personalForces) f.formationId = null;
  for (const p of world.polities) p.treasury = 0; // No unrelated new projects/armies.
  const region = world.regions.find(r => r.id === fleet.homePortRegionId)!;
  region.population = 100000; region.food = 1000000;
  return { world, polity, former, person, commander, ruler, fleet, region };
}

function trust(world: WorldState, sourceId: string, targetId: string, strength = 80) {
  world.relationships.push({ id: `rel:${sourceId}:${targetId}`, sourceId, targetId, kinship: '无', affinity: 0,
    fear: 0, trust: strength, gratitude: 20, grievance: 0, memories: [], lastInteractionTurn: world.turn });
}

function maritime(world: WorldState) {
  const context = createTurnContext(world);
  processV03Maritime(world, context, input => {
    const event = { ...input, id: `test_event_${++world.counters.event}`, turn: world.turn, year: world.year,
      season: world.season, actorIds: input.actorIds ?? [], polityIds: input.polityIds ?? [], regionIds: input.regionIds ?? [],
      stateDeltas: input.stateDeltas ?? [], sourceFactIds: input.sourceFactIds ?? [], situationIds: input.situationIds ?? [],
      evidence: input.evidence ?? input.causes.map(c => c.evidence) } as HistoryEvent;
    context.events.push(event); return event;
  }, () => { throw new Error('No landing belongs in this office fixture'); });
  syncOfficeAppointments(world, world.turn, context);
  return context;
}

describe('formal military appointments use the existing conquered-ruler trust gate', () => {
  it.each(['none', 'reverse', 'commander', 'ruler', 'ordinary', 'too-early', 'low-loyalty', 'boundary', 'trust-boundary', 'no-gratitude'] as const)(
    'checks actual fleet deputy assignment and its office (%s)', mode => {
      const { world, polity, former, person, ruler, commander, fleet } = officers();
      if (mode === 'reverse') trust(world, person.id, ruler.id);
      if (mode === 'commander') trust(world, commander.id, person.id);
      if (mode === 'ruler') trust(world, ruler.id, person.id);
      if (mode === 'trust-boundary') trust(world, ruler.id, person.id, 40);
      if (mode === 'no-gratitude') { trust(world, ruler.id, person.id); world.relationships[0].gratitude = 0; }
      if (mode === 'ordinary') former.rulerId = 'someone-else';
      if (mode === 'too-early') { person.loyalty = 45; world.turn = 7; }
      if (mode === 'low-loyalty') { person.loyalty = 44; world.turn = 8; }
      if (mode === 'boundary') { person.loyalty = 45; world.turn = 8; }
      const allowed = ['ruler', 'ordinary', 'boundary'].includes(mode);
      expect(trustedForOffice(world, polity, person)).toBe(allowed);
      maritime(world);
      expect(fleet.deputyCommanderId).toBe(allowed ? person.id : null);
      expect(world.offices.some(o => o.active && o.fleetId === fleet.id && o.kind === '水师副将' && o.holderId === person.id)).toBe(allowed);
    });

  it.each(['vacancy', 'reception'] as const)('gates fleet command at %s, but permits directed acceptance', mode => {
    const first = officers();
    function prepare(f: ReturnType<typeof officers>, accepted: boolean) {
      f.commander.alive = false;
      if (mode === 'reception') f.fleet.polityId = f.former.id;
      if (accepted) trust(f.world, f.ruler.id, f.person.id);
      maritime(f.world);
    }
    prepare(first, false);
    expect(first.person.commandingFleetId).toBeNull();
    expect(first.world.fleets).toHaveLength(0); // Existing no-officer dissolution, not fabricated personnel.
    const accepted = officers(); prepare(accepted, true);
    expect(accepted.world.fleets[0]?.commanderId).toBe(accepted.person.id);
    expect(accepted.world.offices.some(o => o.active && o.kind === '水师提督' && o.holderId === accepted.person.id)).toBe(true);
  });

  it('keeps completed construction waiting without losing ships or repeating costs, then commissions once eligible', () => {
    const { world, person, commander, ruler, polity, region } = officers();
    commander.alive = false; world.fleets = [];
    world.shipbuildingProjects = [{ id: 'shipproject_00001', polityId: polity.id, portRegionId: region.id,
      targetFleetId: null, warships: 2, transports: 2, patrolShips: 2, timberCommitted: 320,
      ironCommitted: 116, treasurySpent: 600, progress: 99, startedTurn: 0, completedTurn: null, status: '建造中' }];
    const project = world.shipbuildingProjects[0];
    const stock = JSON.stringify(region.goods), population = totalWorldPopulation(world);
    const first = maritime(world);
    expect(project.progress).toBe(100); expect(project.status).toBe('建造中'); expect(project.completedTurn).toBeNull();
    expect(world.fleets).toHaveLength(0); expect(first.events.some(e => e.kind === 'shipbuilding_completed')).toBe(false);
    world.turn++; maritime(world);
    expect(JSON.stringify(region.goods)).toBe(stock); expect(polity.treasury).toBe(0);
    expect(totalWorldPopulation(world)).toBe(population);
    trust(world, ruler.id, person.id);
    world.turn++; const ready = maritime(world);
    expect(project.status).toBe('完成'); expect(project.completedTurn).toBe(world.turn);
    expect(world.fleets).toHaveLength(1);
    expect(world.fleets[0]).toMatchObject({ commanderId: person.id, warships: 2, transports: 2, patrolShips: 2 });
    expect(ready.events.filter(e => e.kind === 'shipbuilding_completed')).toHaveLength(1);
    expect(totalWorldPopulation(world)).toBe(population);
    world.turn++; expect(maritime(world).events.some(e => e.kind === 'shipbuilding_completed')).toBe(false);
  });

  it.each([false, true])('checks actual army deputy replacement without screening existing officers every quarter (accepted=%s)', accepted => {
    const { world, person, polity, commander, ruler, region } = officers();
    world.fleets = []; commander.commandingFleetId = null;
    const template = createWorld('军职编制模板').armies[0];
    const force = world.personalForces.find(f => f.ownerId === commander.id)!;
    force.soldiers = 7000; force.formationId = template.id;
    const army = { ...template, polityId: polity.id, regionId: region.id, commanderId: commander.id,
      deputyCommanderId: null, participantIds: [commander.id], soldiers: 7000, food: 100000 };
    world.armies = [army]; commander.commandingArmyId = army.id;
    if (accepted) trust(world, ruler.id, person.id);
    maintainArmies(world, createTurnContext(world));
    syncOfficeAppointments(world, world.turn);
    expect(army.deputyCommanderId).toBe(accepted ? person.id : null);
    expect(world.offices.some(o => o.active && o.armyId === army.id && o.kind === '军团副将' && o.holderId === person.id)).toBe(accepted);
    if (accepted) {
      expect(army.participantIds).toContain(person.id);
      world.relationships = []; maintainArmies(world, createTurnContext(world));
      expect(army.deputyCommanderId).toBe(person.id);
    }
  });

  it.each([false, true])('separates new-army expedition response from formal deputy eligibility (accepted=%s)', accepted => {
    const { world, person, polity, commander, ruler, region } = officers();
    world.fleets = []; commander.commandingFleetId = null;
    person.locationRegionId = commander.locationRegionId = region.id;
    person.familyId = commander.familyId; person.caution = 0; person.ambition = 100;
    commander.leadership = 100; person.loyalty = 44;
    trust(world, person.id, commander.id, 100);
    for (const f of world.personalForces) { f.formationId = null; f.soldiers = f.ownerId === commander.id ? 100 : 3500; f.readiness = 100; }
    // Find an existing keyed response, not a fixed-seed plot requirement or a mocked selector.
    let selection;
    for (let turn = 0; turn < 8; turn++) {
      world.turn = turn; selection = selectExpeditionResponses(world, polity, commander, region);
      if (selection.participantIds.includes(person.id)) break;
    }
    expect(selection?.participantIds).toContain(person.id);
    if (accepted) trust(world, ruler.id, person.id);
    world.season = '春'; polity.treasury = 1000000;
    // Force the ordinary commander to win, despite the former ruler's talent.
    commander.cunning = commander.loyalty = commander.renown = 100;
    maintainArmies(world, createTurnContext(world));
    syncOfficeAppointments(world, world.turn);
    const army = world.armies.find(a => a.polityId === polity.id)!;
    expect(army).toBeDefined(); expect(army.participantIds).toContain(person.id);
    expect(army.deputyCommanderId === person.id).toBe(accepted);
    expect(world.offices.some(o => o.active && o.holderId === person.id && o.kind === '军团副将')).toBe(accepted);
  });
});
