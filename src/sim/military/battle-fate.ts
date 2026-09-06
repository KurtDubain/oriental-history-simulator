import { settleCharacterDeathState } from '../character-death';
import { emitSimulationFact, projectFactLinks, type BattleFact } from '../facts';
import { keyedRandom } from '../random';
import type { HistoryEvent, StateDelta, WorldState } from '../types';
import type { MutableTurnContext } from '../turn-context-state';
import { addBiography } from '../v02';
import type { V03EventInput } from '../v03-context';
import { battleRecoveryStatus, isBattleReadyCharacter } from './battle-readiness';
import { detachPersonalForce, personalForce } from './personal-forces';

type Participant = NonNullable<BattleFact['payload']['attacker']['participants']>[number];
type Row = { participant: Participant; sideWon: boolean; polityId: string };
type Emit = (input: V03EventInput) => HistoryEvent;
type Exposure = 'ordinary' | 'exposed' | 'severe' | 'catastrophic';
export interface BattleFateChances { death: number; wound: number; severity: number; exposure: Exposure }
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function exposureLabel(severity: number): Exposure {
  if (severity > .72) return 'catastrophic';
  if (severity > .48) return 'severe';
  if (severity > .24) return 'exposed';
  return 'ordinary';
}

export function battleFateChances(
  participant: Participant,
  sideWon: boolean,
  health: number,
  caution: number,
  leadership = 50,
): BattleFateChances {
  const loss = clamp(participant.losses / Math.max(1, participant.soldiersBefore), 0, 1);
  const role = participant.role === 'commander' ? 1 : participant.role === 'deputy' ? .6 : .25;
  const protection = caution / 100 * .11 + leadership / 100 * .08;
  const severity = clamp(Math.pow(loss, 1.45) * .82
    + (sideWon ? 0 : .07 + loss * .2)
    + (participant.soldiersAfter === 0 ? .24 : 0)
    + role * loss * .08
    + (1 - health / 100) * loss * .16
    - protection * loss, 0, 1);
  const danger = severity * severity;
  return {
    death: clamp(Math.pow(danger, 1.65) * (.038 + role * .012 + (1 - health / 100) * .02), 0, .055),
    wound: clamp(Math.pow(danger, .82) * (.31 + role * .04 + (1 - health / 100) * .06), 0, .38),
    severity,
    exposure: exposureLabel(severity),
  };
}

function participants(fact: BattleFact): Row[] {
  return [
    ...(fact.payload.attacker.participants ?? []).map((participant) => ({ participant, sideWon: fact.payload.attackerWon, polityId: fact.payload.attacker.polityId })),
    ...fact.payload.defenders.flatMap((side) => (side.participants ?? []).map((participant) => ({ participant, sideWon: !fact.payload.attackerWon, polityId: side.polityId }))),
  ];
}

/** Old saves and same-turn state are both repaired from authoritative wound Facts; no recovery ledger is kept. */
export function releaseUnavailableFormationMembers(world: WorldState): number {
  let released = 0;
  for (const character of world.characters) {
    if (!character.alive || !character.commandingArmyId && !personalForce(world, character.id)?.formationId) continue;
    if (isBattleReadyCharacter(world, character)) continue;
    const armyId = personalForce(world, character.id)?.formationId;
    detachPersonalForce(world, character.id, '撤退');
    if (character.commandingArmyId === armyId) character.commandingArmyId = null;
    released += 1;
  }
  return released;
}

function recoveryRegion(world: WorldState, battle: BattleFact, row: Row): string {
  return world.polities.find((polity) => polity.id === row.polityId)?.capitalRegionId ?? battle.payload.targetRegionId;
}

function wound(
  world: WorldState,
  context: MutableTurnContext,
  battle: BattleFact,
  row: Row,
  severity: number,
  emit: Emit,
  protectedDeath: boolean,
): void {
  const person = world.characters.find((item) => item.id === row.participant.characterId)!;
  const before = person.health;
  const loss = row.participant.losses / Math.max(1, row.participant.soldiersBefore);
  const variation = keyedRandom(world.seed, context.turn, 'battle-recovery', battle.id, person.id);
  const recoveryQuarters = Math.max(1, Math.ceil(.4 + severity * 4.2 + variation * 3.2));
  const recoveryUntilTurn = context.turn + recoveryQuarters;
  const formationId = personalForce(world, person.id)?.formationId ?? null;
  person.health = Math.max(5, before - Math.round(7 + severity * 28 + loss * 8
    + (row.sideWon ? 0 : 2) + keyedRandom(world.seed, context.turn, 'battle-wound', battle.id, person.id) * 4));
  if (protectedDeath) person.protectedUntilTurn = null;
  detachPersonalForce(world, person.id, '撤退');
  if (person.commandingArmyId === formationId) person.commandingArmyId = null;
  person.locationRegionId = recoveryRegion(world, battle, row);
  const deltas: StateDelta[] = [
    { entityType: 'character', entityId: person.id, field: 'health', before, after: person.health, delta: person.health - before },
    ...(formationId ? [{ entityType: 'character' as const, entityId: person.id, field: 'personalForce.formationId', before: formationId, after: null }] : []),
    ...(protectedDeath ? [{ entityType: 'character' as const, entityId: person.id, field: 'protectedUntilTurn', before: context.turn, after: null }] : []),
  ];
  const causes = [
    { label: '战场暴露', role: '结构' as const, weight: .6, evidence: `本部${row.participant.soldiersBefore}损失${row.participant.losses}，${row.participant.soldiersAfter === 0 ? '余部溃散' : row.sideWon ? '胜势中遇险' : '败退中遇险'}` },
    { label: protectedDeath ? '避过死劫' : '退营休养', role: '结果' as const, weight: .4, evidence: `健康${before}→${person.health}，休养至第${recoveryUntilTurn}季` },
  ];
  const fact = emitSimulationFact(world, context, {
    kind: 'character_wounded', category: '军事', importance: row.participant.role === 'commander' || person.renown >= 65 ? 3 : 2,
    actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId, person.locationRegionId], causes, stateDeltas: deltas, sourceFactIds: [battle.id],
    payload: { characterId: person.id, battleFactId: battle.id, warId: battle.payload.warId,
      regionId: battle.payload.targetRegionId, role: row.participant.role, sideWon: row.sideWon,
      soldiersBefore: row.participant.soldiersBefore, soldiersAfter: row.participant.soldiersAfter,
      losses: row.participant.losses, healthBefore: before, healthAfter: person.health,
      observerProtectionConsumed: protectedDeath, recoveryUntilTurn },
  });
  const place = world.regions.find((item) => item.id === battle.payload.targetRegionId)?.name ?? '战场';
  const event = emit({
    category: '军事', kind: protectedDeath ? 'observer_protection_triggered' : 'notable_person_wounded',
    title: protectedDeath ? `${person.name}于${place}避过死劫` : `${person.name}负伤退营`,
    summary: `${person.name}在${place}以本部${row.participant.soldiersBefore}人参战，损失${row.participant.losses}人；健康由${before}降至${person.health}，现已退出编队休养。`,
    importance: fact.importance, actorIds: [person.id], polityIds: [row.polityId], regionIds: fact.regionIds,
    causes, stateDeltas: deltas, ...projectFactLinks(fact),
  });
  addBiography(person, event, '战阵负伤');
}

function die(world: WorldState, context: MutableTurnContext, battle: BattleFact, row: Row, emit: Emit): void {
  const person = world.characters.find((item) => item.id === row.participant.characterId);
  if (!person?.alive) return;
  const health = person.health;
  const settled = settleCharacterDeathState(world, person.id, context.turn);
  if (!settled) return;
  context.population.demobilized += settled.demobilized;
  const deltas: StateDelta[] = [
    { entityType: 'character', entityId: person.id, field: 'alive', before: true, after: false },
    ...(settled.forceBefore ? [{ entityType: 'character' as const, entityId: person.id, field: 'personalForce.soldiers', before: settled.forceBefore, after: 0, delta: -settled.forceBefore }] : []),
    ...(settled.demobilized && settled.forceRegionPopulationBefore !== null && settled.forceRegionId ? [{ entityType: 'region' as const, entityId: settled.forceRegionId, field: 'population', before: settled.forceRegionPopulationBefore, after: settled.forceRegionPopulationBefore + settled.demobilized, delta: settled.demobilized }] : []),
  ];
  const causes = [
    { label: '高危战局', role: '结构' as const, weight: .6, evidence: `${row.participant.soldiersBefore}人中损失${row.participant.losses}人，${row.sideWon ? '胜势中遇险' : '败退中遇险'}` },
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
    summary: `${person.name}率本部${row.participant.soldiersBefore}人陷入重创战局，损失${row.participant.losses}人后阵亡；职位、兵权与余部已于本季结算。`,
    importance: fact.importance, actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId], causes, stateDeltas: deltas, ...projectFactLinks(fact),
  });
  addBiography(person, event, '战死');
}

export function resolveBattleFates(world: WorldState, context: MutableTurnContext, battle: BattleFact, emit: Emit): void {
  for (const row of participants(battle)) {
    const person = world.characters.find((item) => item.id === row.participant.characterId);
    if (!person?.alive || battleRecoveryStatus(world, person.id, context.turn).recovering) continue;
    const chances = battleFateChances(row.participant, row.sideWon, person.health, person.caution, person.leadership);
    if (chances.death + chances.wound === 0) continue;
    const roll = keyedRandom(world.seed, context.turn, 'battle-fate', battle.id, person.id);
    const protectedDeath = roll < chances.death && person.protectedUntilTurn !== null && person.protectedUntilTurn >= context.turn;
    const outcome = roll < chances.death ? protectedDeath ? 'wounded' : 'died' : roll < chances.death + chances.wound ? 'wounded' : 'none';
    if (outcome === 'died') die(world, context, battle, row, emit);
    else if (outcome === 'wounded') wound(world, context, battle, row, chances.severity, emit, protectedDeath);
  }
}
