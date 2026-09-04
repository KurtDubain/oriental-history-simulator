import { settleCharacterDeathState } from '../character-death';
import { emitSimulationFact, projectFactLinks, type BattleFact } from '../facts';
import { keyedRandom } from '../random';
import type { HistoryEvent, StateDelta, WorldState } from '../types';
import type { MutableTurnContext } from '../turn-context-state';
import { addBiography } from '../v02';
import type { V03EventInput } from '../v03-context';

type Participant = NonNullable<BattleFact['payload']['attacker']['participants']>[number];
type Row = { participant: Participant; sideWon: boolean; polityId: string };
type Emit = (input: V03EventInput) => HistoryEvent;
export interface BattleFateChances { death: number; wound: number }
export interface BattleFateResult { characterId: string; outcome: 'none' | 'wounded' | 'died'; factId: string | null }
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function battleFateChances(
  participant: Participant,
  sideWon: boolean,
  health: number,
  caution: number,
  leadership = 50,
): BattleFateChances {
  const loss = participant.losses / Math.max(1, participant.soldiersBefore);
  const routed = participant.soldiersAfter === 0 ? 1 : 0;
  const role = participant.role === 'commander' ? 1 : participant.role === 'deputy' ? .5 : 0;
  return {
    death: clamp(.001 + loss * .055 + (!sideWon ? .009 : 0) + routed * .012 + role * .004
      + (100 - health) * .00008 - caution * .00006 - leadership * .00003, .0005, .055),
    wound: clamp(.018 + loss * .42 + (!sideWon ? .055 : 0) + routed * .075 + role * .024
      + (100 - health) * .00035 - caution * .00045 - leadership * .00012, .008, .42),
  };
}

function participants(fact: BattleFact): Row[] {
  return [
    ...(fact.payload.attacker.participants ?? []).map((participant) => ({ participant, sideWon: fact.payload.attackerWon, polityId: fact.payload.attacker.polityId })),
    ...fact.payload.defenders.flatMap((side) => (side.participants ?? []).map((participant) => ({ participant, sideWon: !fact.payload.attackerWon, polityId: side.polityId }))),
  ];
}

function wound(world: WorldState, context: MutableTurnContext, battle: BattleFact, row: Row, emit: Emit, protectedDeath: boolean): string {
  const person = world.characters.find((item) => item.id === row.participant.characterId)!;
  const before = person.health;
  const loss = row.participant.losses / Math.max(1, row.participant.soldiersBefore);
  person.health = Math.max(5, before - Math.round(6 + loss * 28 + (row.sideWon ? 0 : 4)
    + (row.participant.soldiersAfter ? 0 : 5) + keyedRandom(world.seed, context.turn, 'battle-wound', battle.id, person.id) * 6));
  if (protectedDeath) person.protectedUntilTurn = null;
  const deltas: StateDelta[] = [
    { entityType: 'character', entityId: person.id, field: 'health', before, after: person.health, delta: person.health - before },
    ...(protectedDeath ? [{ entityType: 'character' as const, entityId: person.id, field: 'protectedUntilTurn', before: context.turn, after: null }] : []),
  ];
  const causes = [
    { label: '本人战损', role: '结构' as const, weight: .6, evidence: `${row.participant.soldiersBefore}人中损失${row.participant.losses}人，${row.sideWon ? '随军取胜' : '随败军退却'}` },
    { label: protectedDeath ? '避过死劫' : '负伤', role: '结果' as const, weight: .4, evidence: `${protectedDeath ? '观察者保护耗尽；' : ''}健康${before}→${person.health}` },
  ];
  const fact = emitSimulationFact(world, context, {
    kind: 'character_wounded', category: '军事', importance: row.participant.role === 'commander' || person.renown >= 65 ? 3 : 1,
    actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId], causes, stateDeltas: deltas, sourceFactIds: [battle.id],
    payload: { characterId: person.id, battleFactId: battle.id, warId: battle.payload.warId, regionId: battle.payload.targetRegionId, role: row.participant.role, sideWon: row.sideWon, soldiersBefore: row.participant.soldiersBefore, soldiersAfter: row.participant.soldiersAfter, losses: row.participant.losses, healthBefore: before, healthAfter: person.health, observerProtectionConsumed: protectedDeath },
  });
  const place = world.regions.find((item) => item.id === battle.payload.targetRegionId)?.name ?? '战场';
  const event = emit({
    category: '军事', kind: protectedDeath ? 'observer_protection_triggered' : 'notable_person_wounded',
    title: protectedDeath ? `${person.name}于${place}避过死劫` : `${person.name}负伤`,
    summary: `${person.name}在${place}以本部${row.participant.soldiersBefore}人参战，损失${row.participant.losses}人；${protectedDeath ? '保护耗尽，' : ''}健康由${before}降至${person.health}。`,
    importance: fact.importance, actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId], causes, stateDeltas: deltas, ...projectFactLinks(fact),
  });
  addBiography(person, event, '战阵负伤');
  return fact.id;
}

function die(world: WorldState, context: MutableTurnContext, battle: BattleFact, row: Row, emit: Emit): string | null {
  const person = world.characters.find((item) => item.id === row.participant.characterId);
  if (!person?.alive) return null;
  const health = person.health;
  const settled = settleCharacterDeathState(world, person.id, context.turn);
  if (!settled) return null;
  context.population.demobilized += settled.demobilized;
  const deltas: StateDelta[] = [
    { entityType: 'character', entityId: person.id, field: 'alive', before: true, after: false },
    ...(settled.forceBefore ? [{ entityType: 'character' as const, entityId: person.id, field: 'personalForce.soldiers', before: settled.forceBefore, after: 0, delta: -settled.forceBefore }] : []),
    ...(settled.demobilized && settled.forceRegionPopulationBefore !== null && settled.forceRegionId ? [{ entityType: 'region' as const, entityId: settled.forceRegionId, field: 'population', before: settled.forceRegionPopulationBefore, after: settled.forceRegionPopulationBefore + settled.demobilized, delta: settled.demobilized }] : []),
  ];
  const causes = [
    { label: '本人战损', role: '结构' as const, weight: .6, evidence: `${row.participant.soldiersBefore}人中损失${row.participant.losses}人，${row.sideWon ? '胜势中遇险' : '败退中遇险'}` },
    { label: '阵亡结算', role: '结果' as const, weight: .4, evidence: `职位、编队与余部${settled.demobilized}人已在本季结算` },
  ];
  const fact = emitSimulationFact(world, context, {
    kind: 'character_death', category: '军事', importance: settled.role === '君主' || row.participant.role === 'commander' ? 5 : row.participant.role === 'deputy' ? 3 : 2,
    actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId], causes, stateDeltas: deltas, sourceFactIds: [battle.id],
    payload: { characterId: person.id, age: person.age, role: settled.role, health, diseaseId: settled.diseaseId, cause: 'battle', battleFactId: battle.id },
  });
  const place = world.regions.find((item) => item.id === battle.payload.targetRegionId)?.name ?? '战场';
  const event = emit({
    category: '军事', kind: 'character_battle_death', title: `${person.name}阵亡于${place}`,
    summary: `${person.name}率本部${row.participant.soldiersBefore}人参战，损失${row.participant.losses}人后阵亡；职位、兵权与余部已于本季结算。`,
    importance: fact.importance, actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId], causes, stateDeltas: deltas, ...projectFactLinks(fact),
  });
  addBiography(person, event, '战死');
  return fact.id;
}

export function resolveBattleFates(world: WorldState, context: MutableTurnContext, battle: BattleFact, emit: Emit): BattleFateResult[] {
  return participants(battle).flatMap((row) => {
    const person = world.characters.find((item) => item.id === row.participant.characterId);
    if (!person?.alive) return [];
    const chances = battleFateChances(row.participant, row.sideWon, person.health, person.caution, person.leadership);
    const roll = keyedRandom(world.seed, context.turn, 'battle-fate', battle.id, person.id);
    const protectedDeath = roll < chances.death && person.protectedUntilTurn !== null && person.protectedUntilTurn >= context.turn;
    const outcome = roll < chances.death ? protectedDeath ? 'wounded' : 'died' : roll < chances.death + chances.wound ? 'wounded' : 'none';
    const factId = outcome === 'died' ? die(world, context, battle, row, emit)
      : outcome === 'wounded' ? wound(world, context, battle, row, emit, protectedDeath) : null;
    return [{ characterId: person.id, outcome: factId ? outcome : 'none', factId } as BattleFateResult];
  });
}
