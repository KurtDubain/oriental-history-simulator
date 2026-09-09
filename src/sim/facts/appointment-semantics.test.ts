import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld } from '../index';
import type { AppointmentEndedFact, AppointmentStartedFact, SimulationFact } from './types';
import { isContinuousRulerSeat } from './projector';
import { detectInheritanceCrisisCandidates } from '../situations/inheritance-crisis-detector';

const ended: AppointmentEndedFact = { id: 'end', turn: 4, year: 2, season: '春', kind: 'appointment_ended',
  category: '政治', importance: 4, actorIds: ['ruler'], polityIds: ['state'], regionIds: ['old'], causes: [], stateDeltas: [], sourceFactIds: [],
  payload: { action: 'ended', appointmentId: 'seat-old', holderId: 'ruler', polityId: 'state', officeKind: '君主', regionId: 'old', armyId: null, fleetId: null, rank: 100 } };
const started: AppointmentStartedFact = { ...ended, id: 'start', kind: 'appointment_started',
  payload: { ...ended.payload, action: 'started', appointmentId: 'seat-new', regionId: 'new' } };

describe('continuous ruler appointment semantics', () => {
  it('classifies a same-turn relocation in either fact order without mutating evidence', () => {
    const facts = [ended, started], before = JSON.stringify(facts);
    for (const fact of facts) {
      expect(isContinuousRulerSeat(fact, facts)).toBe(true);
      expect(isContinuousRulerSeat(fact, [...facts].reverse())).toBe(true);
    }
    expect(JSON.stringify(facts)).toBe(before);
  });
  it('retains unpaired dismissal, a later reappointment, another ruler, death, coup and destruction', () => {
    expect(isContinuousRulerSeat(ended, [ended])).toBe(false);
    expect(isContinuousRulerSeat(ended, [ended, { ...started, turn: 5 }])).toBe(false);
    expect(isContinuousRulerSeat(ended, [ended, { ...started, payload: { ...started.payload, regionId: 'old' } }])).toBe(false);
    expect(isContinuousRulerSeat(ended, [ended, started, { ...started, id: 'usurper', payload: { ...started.payload, holderId: 'other' } }])).toBe(false);
    const boundaries: SimulationFact[] = [
      { ...ended, id: 'death', kind: 'character_death', payload: { characterId: 'ruler', cause: 'natural', age: 80, health: 0, role: '君主', diseaseId: null } },
      { ...ended, id: 'succession', stateDeltas: [{ entityType: 'polity', entityId: 'state', field: 'rulerId', before: 'ruler', after: 'other' }] },
      { ...ended, id: 'destruction', stateDeltas: [{ entityType: 'polity', entityId: 'state', field: 'alive', before: true, after: false }] },
      { ...ended, id: 'coup', kind: 'court_action_resolved', payload: {
        action: 'coup', polityId: 'state', actorFactionId: null, targetFactionId: null,
        initiatorId: 'other', targetId: 'ruler', reasonCode: 'palace_transfer', score: 80, threshold: 60,
        rulerBeforeId: 'ruler', rulerAfterId: 'other', affectedFactionIds: [], removedMemberIds: [],
      } },
    ];
    for (const boundary of boundaries) expect(isContinuousRulerSeat(ended, [ended, started, boundary])).toBe(false);
  });
  it('excludes relocation from current succession evidence but retains independent pressure in the natural T12 world', () => {
    let world = createWorld('寒江照铁-戌时', 'private-v03');
    let pairs = 0;
    for (let i = 0; i < 12; i++) {
      world = advanceWorld(world);
      const facts = world.facts.filter(f => f.turn === world.lastTurn!.turn);
      const relocations = facts.filter(f => isContinuousRulerSeat(f, facts));
      pairs += relocations.filter(f => f.kind === 'appointment_ended').length;
      const candidates = detectInheritanceCrisisCandidates({ ...world, turn: world.lastTurn!.turn }, facts);
      for (const candidate of candidates) {
        const trigger = candidate.signals.find(s => s.key === 'current_succession_evidence');
        expect(trigger?.sourceFactIds?.some(id => relocations.some(f => f.id === id)) ?? false).toBe(false);
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
});
