import { describe, expect, it } from 'vitest';
import { advanceWorld, computeWorldHash, createWorld, deserializeWorld, serializeWorld, stableHash } from './index';
import { releaseRulerSubordination, syncOfficeAppointments } from './v02';
import { createTurnContext } from './turn-context-state';
import { woundRecoveryQuarters } from './military/battle-readiness';
import type { HistoryEvent } from './types';

describe('ruler identity and bounded recovery', () => {
  it('ends an inherited subordinate command without taking the commander’s force or calling it betrayal', () => {
    const world = createWorld('君位与旧军令');
    const army = world.armies.find(a => a.deputyCommanderId)!;
    const ruler = world.characters.find(p => p.id === army.deputyCommanderId)!;
    const polity = world.polities.find(p => p.id === army.polityId)!;
    polity.rulerId = ruler.id;
    const force = world.personalForces.find(f => f.ownerId === ruler.id)!;
    // A legacy save can also retain the same person's naval deputy appointment.
    const fleet = world.fleets[0];
    fleet.deputyCommanderId = ruler.id;
    const sailors = fleet.sailors, admiral = fleet.commanderId;
    const militaryPopulation = world.personalForces.reduce((sum, f) => sum + f.soldiers, 0);
    const people = world.regions.map(r => r.population), location = ruler.locationRegionId;
    const allegiance = structuredClone(world.armies.filter(a => a.id !== army.id).map(a => a.allegiance));
    const relations = JSON.stringify(world.relationships);
    const commitment = { id: 'commitment_test', kind: '军令' as const, promisorId: ruler.id, promiseeId: army.commanderId,
      polityIds: [polity.id], terms: '随军', madeTurn: 0, dueTurn: 16, status: '生效' as const,
      resolvedTurn: null, eventId: world.history[0].id, resolutionEventId: null, trustStake: 10 };
    world.commitments.push(commitment);
    world.counters.commitment++;
    const context = createTurnContext(world);
    const emit: Parameters<typeof releaseRulerSubordination>[2] = input => {
      const event: HistoryEvent = { ...input, id: `event_${++world.counters.event}`, turn: world.turn, year: world.year, season: world.season,
        actorIds: input.actorIds ?? [], polityIds: input.polityIds ?? [], regionIds: input.regionIds ?? [],
        evidence: input.evidence ?? [], stateDeltas: input.stateDeltas ?? [], sourceFactIds: input.sourceFactIds ?? [], situationIds: input.situationIds ?? [] };
      world.history.push(event); context.events.push(event); world.historyDigest = stableHash([world.historyDigest, event]);
      return event;
    };
    const historicalCount = world.history.length;
    releaseRulerSubordination(world, context, emit);
    expect(force.formationId).toBeNull();
    expect(army.participantIds).not.toContain(ruler.id);
    expect(army.deputyCommanderId).toBeNull();
    expect(fleet.deputyCommanderId).toBeNull();
    expect(fleet.sailors).toBe(sailors);
    expect(fleet.commanderId).toBe(admiral);
    expect(commitment.status).toBe('失效');
    expect(commitment.resolutionEventId).toBe(context.events[0].id);
    expect(context.events[0].stateDeltas.some(d => d.entityId === army.id && d.field === 'deputyCommanderId')).toBe(true);
    expect(world.personalForces.reduce((sum, f) => sum + f.soldiers, 0)).toBe(militaryPopulation);
    expect(world.regions.map(r => r.population)).toEqual(people);
    expect(ruler.locationRegionId).toBe(location);
    expect(world.armies.filter(a => a.id !== army.id).map(a => a.allegiance)).toEqual(allegiance);
    expect(JSON.stringify(world.relationships)).toBe(relations);
    releaseRulerSubordination(world, context, emit);
    expect(world.history).toHaveLength(historicalCount + 1);
    syncOfficeAppointments(world, world.turn);
    world.hash = computeWorldHash(world);
    // The helper ran inside T0; the complete T1 settlement owns the next report.
    const next = advanceWorld(advanceWorld(world));
    const restored = deserializeWorld(serializeWorld(next));
    expect(advanceWorld(restored).hash).toBe(advanceWorld(next).hash);
    expect(next.armies.some(a => a.deputyCommanderId === ruler.id)).toBe(false);
    expect(next.commitments.some(c => c.promisorId === ruler.id && c.kind === '军令' && c.status === '生效')).toBe(false);
  });

  it('retains a ruler’s independent command and allows a former ruler of a dead state to serve', () => {
    const world = createWorld('君主亲征边界');
    const army = world.armies.find(a => a.deputyCommanderId)!;
    const polity = world.polities.find(p => p.id === army.polityId)!;
    polity.rulerId = army.commanderId;
    const former = world.polities.find(p => p.id !== polity.id)!;
    former.rulerId = army.deputyCommanderId!; former.alive = false;
    const before = JSON.stringify([world.armies, world.personalForces]);
    releaseRulerSubordination(world, createTurnContext(world), () => { throw new Error('no incompatible identity'); });
    expect(JSON.stringify([world.armies, world.personalForces])).toBe(before);
  });

  it('makes recovery continuously harder with age and severity, never an age-based prohibition', () => {
    for (let age = 16; age < 100; age++) {
      const duration = woundRecoveryQuarters(age, .5, 60, .4);
      const next = woundRecoveryQuarters(age + 1, .5, 60, .4);
      expect(next).toBeGreaterThanOrEqual(duration);
      expect(next - duration).toBeLessThanOrEqual(1);
      expect(duration).toBeLessThan(16);
    }
    expect(woundRecoveryQuarters(85, .8, 35, .2)).toBeGreaterThan(woundRecoveryQuarters(30, .8, 35, .2));
    expect(woundRecoveryQuarters(85, .2, 90, .2)).toBeLessThan(woundRecoveryQuarters(85, .8, 35, .2));
  });
});
