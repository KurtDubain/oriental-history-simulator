import { describe, expect, it } from 'vitest';
import { advanceWorldBy, computeWorldHash, createWorld, deserializeWorld, serializeWorld, stableHash } from '../sim';
import { compactWorldArchive, readWorldFacts } from '../sim/archive';
import type { BattleFact, SimulationFact } from '../sim/facts';
import { projectHistoricalScenes, projectSituationHistoricalScenes, projectFactNarrative } from './historical-scenes';
import { personHistoryEvidence, projectPersonStoryArc } from './person-story-arc';
import { isContinuousRulerSeat, continuousRulerSeatIds } from '../sim/facts/projector';
import { refreshObserverWatch, watchItemForSelection } from './observer-selection';
import { projectSituationDetail } from './situation-detail';
import { deriveObserverLeadProjection } from './observer-leads';
import { toPersonExperienceRecords } from './person-dossier-adapter';

function fixture() {
  const world = createWorld('历史表达受控');
  const armies = world.armies.slice(0, 3);
  const region = world.regions.find(r => r.id === armies[0].regionId)!;
  const battle = (n: number, won: boolean, regionId = region.id): BattleFact => {
    const army = armies[n % armies.length];
    const snapshot = (a: typeof army) => ({ armyId: a.id, polityId: a.polityId, commanderId: a.commanderId,
      deputyCommanderId: a.deputyCommanderId, soldiersBefore: 500, soldiersAfter: 450, losses: 50,
      moraleBefore: 80, moraleAfter: 70, trainingBefore: 70, supplyBefore: 80,
      participants: [{ characterId: a.commanderId, soldiersBefore: 500, soldiersAfter: 450, losses: 50,
        factionId: null, formationCommanderId: a.commanderId, role: 'commander' as const }] });
    return { id: `fact_battle_0${n}`, turn: 23, year: 6, season: '冬', kind: 'battle', category: '军事', importance: 5,
      actorIds: [army.commanderId, armies[(n + 1) % 3].commanderId], polityIds: [army.polityId], regionIds: [regionId], causes: [], stateDeltas: [], sourceFactIds: [],
      payload: { warId: 'war_sequence', targetRegionId: regionId, routeId: world.routes[0].id, attackerWon: won,
        attackerPower: 1, defenderPower: 1, militiaLosses: 7, attacker: snapshot(army), defenders: [snapshot(armies[(n + 1) % 3])] } };
  };
  const transfer = (n: number, source: BattleFact): SimulationFact => ({ ...source, id: `fact_capture_${n}`,
    kind: 'territory_control_changed', sourceFactIds: [source.id], payload: { warId: source.payload.warId,
      regionId: source.payload.targetRegionId, previousControllerId: armies[1].polityId,
      nextControllerId: armies[0].polityId, reason: 'battle_capture' } });
  return { world, armies, region, battle, transfer };
}

describe('same history, faithful reading', () => {
  it('reads the T12 relocation history consistently through leads, cases and person archives', () => {
    const world = advanceWorldBy(createWorld('寒江照铁-戌时'), 12);
    const before = serializeWorld(world), facts = readWorldFacts(world);
    const ids = continuousRulerSeatIds(facts);
    expect(ids.size).toBeGreaterThan(0);
    for (const s of world.situationSystem.situations.filter(s => s.type === 'inheritance_crisis')) {
      expect(projectSituationHistoricalScenes(world,s,100).flatMap(s=>s.sourceFactIds).some(id=>ids.has(id))).toBe(false);
      expect(projectSituationDetail(world,s).evidence.some(f=>ids.has(f.id))).toBe(false);
    }
    expect(deriveObserverLeadProjection(world).leads.flatMap(l=>l.primarySourceFactIds).some(id=>ids.has(id))).toBe(false);
    for (const fact of facts.filter(f=>ids.has(f.id))) {
      if (fact.kind !== 'appointment_ended' && fact.kind !== 'appointment_started') continue;
      const person = world.characters.find(p=>p.id===fact.payload.holderId)!;
      expect(projectFactNarrative(world,fact,ids.has(fact.id)).title).not.toMatch(/去职|卸任|退位/);
      expect(projectPersonStoryArc(world,person).flatMap(b=>b.sourceFactIds)).not.toContain(fact.id);
      expect(toPersonExperienceRecords(world,person).some(r=>r.id.endsWith(fact.id) && /去职|卸任|退位/.test(r.title))).toBe(false);
    }
    expect(serializeWorld(world)).toBe(before);
  });
  it.each([[false, false, true], [true, false, false], [false, false, false]])('keeps the complete ordered battle sequence %j', (...wins) => {
    const { world, armies, battle, transfer } = fixture();
    const battles = wins.map((won, i) => battle(i, won));
    const changes = wins.some(Boolean) ? [transfer(0, battles[wins.lastIndexOf(true)])] : [];
    const facts = [...battles, ...changes];
    world.facts.push(...facts);
    const before = serializeWorld(world);
    const [scene] = projectHistoricalScenes(world, [...facts].reverse().concat(battles[0]), 10);
    expect(scene.title).toContain('接连3战');
    for (const a of armies) expect(scene.summary).toContain(world.characters.find(p => p.id === a.commanderId)!.name);
    expect(scene.summary.indexOf('第1战')).toBeLessThan(scene.summary.indexOf('第2战'));
    expect(scene.summary.indexOf('第2战')).toBeLessThan(scene.summary.indexOf('第3战'));
    expect(scene.sourceFactIds).toHaveLength(facts.length);
    expect(scene.summary.match(/双方军团损失100人，守地民兵损失7人/g)).toHaveLength(3);
    if (changes.length) {
      const causeIndex = wins.lastIndexOf(true) + 1;
      expect(scene.summary.slice(scene.summary.indexOf(`第${causeIndex}战`) + 3).split(/第\d战/)[0]).toContain('此战后');
    } else expect(scene.summary).not.toContain('转入');
    expect(projectHistoricalScenes(world, facts, 10)).toEqual([scene]);
    expect(serializeWorld(world)).toBe(before);
  });

  it('keeps different places and both sides’ victories separate, without invented Event IDs', () => {
    const { world, battle, transfer } = fixture();
    const a = battle(0, true), b = battle(1, false, world.regions.find(r => r.id !== a.payload.targetRegionId)!.id);
    const facts = [a, b, transfer(0, a), transfer(1, b)];
    world.facts.push(...facts);
    const scenes = projectHistoricalScenes(world, facts, 10);
    expect(scenes).toHaveLength(2);
    for (const scene of scenes) {
      const source = scene.sourceFactIds.includes(a.id) ? a : b;
      expect(scene.title).toContain(world.regions.find(r => r.id === source.payload.targetRegionId)!.name);
      expect(scene.sourceFactIds).not.toContain(source === a ? b.id : a.id);
      expect(scene.historyEventIds).toEqual([]);
    }
  });

  it('keeps cold evidence, invalidates same-turn edits, and restores the same reading without mutating history', () => {
    const { world, battle } = fixture();
    const b = battle(0, true), person = world.characters.find(p => p.id === b.payload.attacker.commanderId)!;
    const firstId = world.counters.fact + 1;
    b.id = `fact_${String(firstId + 1).padStart(7, '0')}`;
    world.facts.push(b);
    const first = projectPersonStoryArc(world, person);
    const oldCache = personHistoryEvidence(world);
    b.payload.attackerWon = false;
    expect(personHistoryEvidence(world)).not.toBe(oldCache);
    expect(projectPersonStoryArc(world, person)).not.toEqual(first);
    const renamedCache = personHistoryEvidence(world);
    world.armies[0].name += '新署';
    expect(personHistoryEvidence(world)).not.toBe(renamedCache);
    world.turn = 400; world.year = 101; world.season = '春';
    world.factDigest = world.facts.reduce((digest, fact) => stableHash([digest, fact]), stableHash([]));
    const expected = projectPersonStoryArc(world, person);
    compactWorldArchive(world);
    world.hash = computeWorldHash(world);
    expect(readWorldFacts(world).some(f => f.id === b.id)).toBe(true);
    const before = serializeWorld(world);
    expect(projectPersonStoryArc(world, person)).toEqual(expected);
    expect(serializeWorld(world)).toBe(before);
    // Save validation uses a genuinely settled world, not the synthetic archive time jump above.
    const settled = advanceWorldBy(createWorld('存读经历一致'), 80);
    const remembered = projectPersonStoryArc(settled, settled.characters[0]);
    const restored = deserializeWorld(serializeWorld(settled));
    expect(projectPersonStoryArc(restored, restored.characters[0])).toEqual(remembered);
  });

  it('recognizes relocated throne offices but not an intervening ruler or an actual same-seat return', () => {
    const { world, battle } = fixture();
    const base = battle(0, true), holder = base.payload.attacker.commanderId;
    const office: SimulationFact = { ...base, kind: 'appointment_ended', payload: {
      appointmentId: 'office_old', action: 'ended', officeKind: '君主', holderId: holder,
      polityId: base.payload.attacker.polityId, regionId: world.regions[0].id, armyId: null, fleetId: null, rank: 100 } };
    const started: SimulationFact = { ...office, id: 'office_new_fact', kind: 'appointment_started',
      payload: { ...office.payload, action: 'started', appointmentId: 'office_new', regionId: world.regions[1].id } };
    expect(isContinuousRulerSeat(office, [office, started])).toBe(true);
    expect(isContinuousRulerSeat(office, [office, { ...started, payload: { ...started.payload, regionId: office.payload.regionId } }])).toBe(false);
    expect(isContinuousRulerSeat(office, [office, started, { ...started, id: 'intervening', payload: { ...started.payload, holderId: 'other' } }])).toBe(false);
  });

  it('refreshes saved watch descriptions without changing identity or alert intent', () => {
    const { world } = fixture();
    const p = world.characters[0], polity = world.polities[0];
    const watched = { ...watchItemForSelection(world, { kind: 'person', id: p.id })!, alert: true };
    p.age = 87; p.alive = false;
    const fresh = refreshObserverWatch(world, watched);
    expect(fresh).toMatchObject({ id: p.id, kind: 'person', alert: true, detail: '已故 · 享年87岁' });
    const country = watchItemForSelection(world, { kind: 'country', id: polity.id })!;
    polity.controlledRegionIds = [];
    expect(refreshObserverWatch(world, country).detail).toContain('0州域');
    expect(watched.detail).not.toBe(fresh.detail);
  });
});
