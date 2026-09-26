import { settleCharacterDeathState } from '../character-death';
import { emitSimulationFact, projectFactLinks, type BattleFact } from '../facts';
import { keyedRandom } from '../random';
import type { ArmyState, HistoryEvent, StateDelta, WorldState } from '../types';
import { addBiography } from '../v02';
import type { V03EventInput, V03TurnContext } from '../v03-context';
import { battleRecoveryStatus, isBattleReadyCharacter, woundRecoveryQuarters } from './battle-readiness';
import { applyFormationLosses, detachPersonalForce, formationForces, personalForce } from './personal-forces';

/** Capture before combat, then settle against the same owners before anyone leaves formation. */
export function battleForceSnapshot(world: WorldState, army: ArmyState, before?: BattleFact['payload']['attacker']): BattleFact['payload']['attacker'] {
  if (before) return {
    ...before, soldiersAfter: army.soldiers, moraleAfter: army.morale, losses: before.soldiersBefore-army.soldiers,
    participants: before.participants!.map(p => {
      const soldiersAfter=personalForce(world,p.characterId)?.soldiers ?? 0;
      return {...p,soldiersAfter,losses:p.soldiersBefore-soldiersAfter};
    }),
  };
  return {
    armyId:army.id, polityId:army.polityId, commanderId:army.commanderId, deputyCommanderId:army.deputyCommanderId,
    allegianceCharacterId:army.allegiance.characterId, allegianceStrength:army.allegiance.strength,
    soldiersBefore:army.soldiers, soldiersAfter:army.soldiers,
    moraleBefore:army.morale, moraleAfter:army.morale, trainingBefore:army.training, supplyBefore:army.supply, losses:0,
    participants:formationForces(world,army).map(f=>({
      characterId:f.ownerId,soldiersBefore:f.soldiers,soldiersAfter:f.soldiers,losses:0,
      factionId:world.characters.find(c=>c.id===f.ownerId)?.factionId ?? null,formationCommanderId:army.commanderId,
      role:f.ownerId===army.commanderId ? 'commander' : f.ownerId===army.deputyCommanderId ? 'deputy' : 'member',
    })),
  };
}

type Participant = NonNullable<BattleFact['payload']['attacker']['participants']>[number];
type Row = { participant: Participant; sideWon: boolean; polityId: string };
type Emit = (input: V03EventInput) => HistoryEvent;
export interface BattleFateChances { death: number; wound: number; severity: number }
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** Shared land/landing resistance: a narrow win is not a casualty shield. */
export function battleLossRate(ownPower: number, opposingPower: number): number {
  const ratio = ownPower / Math.max(1, opposingPower);
  return Math.min(.48, .035 + .49 / (1 + ratio * ratio));
}

/** Count combat losses before wounds, command relief or demobilization change formations. */
export function applyBattleLosses(world: WorldState, armies: ArmyState[], requested: number, context: V03TurnContext): number {
  const actual = applyFormationLosses(world, armies, requested).reduce((sum, loss) => sum + loss.losses, 0);
  context.population.militaryDeaths += actual;
  return actual;
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
  const severity = clamp(Math.pow(loss, 1.45)
    * (.9 + role * .12 + (sideWon ? 0 : .12) + (1 - health / 100) * .45 - protection), 0, 1);
  // Separate death/wound ranges keep survival possible even after extreme losses.
  return { death: Math.min(.38, severity * loss / (loss + .12) * 1.3),
    wound: Math.min(.38, severity * .9), severity };
}

function participants(fact: BattleFact): Row[] {
  return [fact.payload.attacker, ...fact.payload.defenders].flatMap((side, index) =>
    (side.participants ?? []).map(participant => ({participant, sideWon: index === 0 ? fact.payload.attackerWon : !fact.payload.attackerWon, polityId: side.polityId})));
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

function wound(
  world: WorldState,
  context: V03TurnContext,
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
  const recoveryQuarters = woundRecoveryQuarters(person.age, severity, before, variation);
  const recoveryUntilTurn = context.turn + recoveryQuarters;
  const formationId = personalForce(world, person.id)?.formationId ?? null;
  person.health = Math.max(5, before - Math.round(7 + severity * 28 + loss * 8
    + (row.sideWon ? 0 : 2) + keyedRandom(world.seed, context.turn, 'battle-wound', battle.id, person.id) * 4));
  if (protectedDeath) person.protectedUntilTurn = null;
  detachPersonalForce(world, person.id, '撤退');
  if (person.commandingArmyId === formationId) person.commandingArmyId = null;
  person.locationRegionId = world.polities.find((polity) => polity.id === row.polityId)?.capitalRegionId ?? battle.payload.targetRegionId;
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

function die(world: WorldState, context: V03TurnContext, battle: BattleFact, row: Row, emit: Emit): void {
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
    summary: `${person.name}本部${row.participant.soldiersBefore}人参战，损失${row.participant.losses}人，本人在此役阵亡。`,
    importance: fact.importance, actorIds: [person.id], polityIds: [row.polityId], regionIds: [battle.payload.targetRegionId], causes, stateDeltas: deltas, ...projectFactLinks(fact),
  });
  addBiography(person, event, '战死');
}

export function resolveBattleFates(world: WorldState, context: V03TurnContext, battle: BattleFact, emit: Emit): void {
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
