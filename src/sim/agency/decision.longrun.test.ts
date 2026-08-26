import { expect, it } from 'vitest';
import {
  advanceWorld,
  ARMY_COMMAND_CHANGE_COOLDOWN_TURNS,
  COMMAND_CHANGE_PARTICIPANT_COOLDOWN_TURNS,
  createWorld,
  validateAgencyDecisionSystemState,
} from '../index';

it('keeps natural independent-command decisions present but chronicle-readable over long runs', () => {
  const seeds = [
    '军权春秋',
    '北境军令',
    '沧衡将星',
    '关河旧梦',
    '东海风云',
    '燕云逐鹿',
    '海岱群雄',
    '岭海军门',
  ];
  const rows: Array<{
    seed: string;
    submitted: number;
    executed: number;
    rejected: number;
    deferred: number;
    invalidated: number;
  }> = [];
  for (const seed of seeds) {
    let world = createWorld(seed);
    for (let turn = 0; turn < 80; turn += 1) world = advanceWorld(world);
    expect(validateAgencyDecisionSystemState(world), `${seed}留下了无法回收的目标状态`).toEqual([]);
    const submitted = world.facts.filter((fact) => fact.kind === 'agency_intent_submitted').length;
    const resolutions = world.facts.filter((fact) => fact.kind === 'agency_intent_resolved');
    rows.push({
      seed,
      submitted,
      executed: resolutions.filter((fact) => fact.payload.outcome === 'executed').length,
      rejected: resolutions.filter((fact) => fact.payload.outcome === 'rejected').length,
      deferred: resolutions.filter((fact) => fact.payload.outcome === 'deferred').length,
      invalidated: resolutions.filter((fact) => fact.payload.outcome === 'invalidated').length,
    });
  }
  expect(rows.filter((row) => row.submitted > 0).length).toBeGreaterThanOrEqual(6);
  expect(rows.filter((row) => row.executed > 0).length).toBeGreaterThanOrEqual(5);
  expect(rows.filter((row) => row.rejected + row.deferred > 0).length).toBeGreaterThanOrEqual(4);
  expect(rows.reduce((sum, row) => sum + row.rejected, 0)).toBeGreaterThanOrEqual(8);
  expect(rows.reduce((sum, row) => sum + row.deferred, 0)).toBeGreaterThanOrEqual(4);
  for (const row of rows) {
    expect(row.submitted, `${row.seed}的正式请求过密`).toBeLessThanOrEqual(45);
    expect(row.executed, `${row.seed}的换帅过密`).toBeLessThanOrEqual(20);
    expect(row.invalidated, `${row.seed}提交了本可预先识别的无效请求`).toBeLessThanOrEqual(2);
  }
}, 120_000);

it('keeps decision slots and command succession healthy across a 240-quarter generation', () => {
  let world = createWorld('燕云逐鹿');
  const lateGoalIds = new Set<string>();
  for (let turn = 0; turn < 240; turn += 1) {
    world = advanceWorld(world);
    expect(world.agencyDecisionSystem.actors.length).toBeLessThanOrEqual(64);
    expect(world.agencyDecisionSystem.actors.some((actor) => (
      actor.goal.status === 'active' && actor.attemptOrdinal >= 3
    )), `第${world.turn}回合留下了已尽请求`).toBe(false);
    if (world.turn > 120) {
      for (const actor of world.agencyDecisionSystem.actors) {
        if (actor.goal.createdTurn > 120) lateGoalIds.add(actor.goal.id);
      }
    }
  }

  const lateSubmissions = world.facts.filter((fact) => (
    fact.kind === 'agency_intent_submitted' && fact.turn > 120
  ));
  expect(lateGoalIds.size).toBeGreaterThan(0);
  expect(lateSubmissions.length).toBeGreaterThan(0);
  expect(validateAgencyDecisionSystemState(world)).toEqual([]);

  const executions = world.facts.filter((fact): fact is Extract<
    typeof world.facts[number],
    { kind: 'agency_intent_resolved' }
  > => fact.kind === 'agency_intent_resolved' && fact.payload.outcome === 'executed');
  const lastByArmy = new Map<string, number>();
  const lastByParticipant = new Map<string, number>();
  for (const fact of executions) {
    const previousArmyTurn = lastByArmy.get(fact.payload.targetArmyId);
    if (previousArmyTurn !== undefined) {
      expect(fact.turn - previousArmyTurn).toBeGreaterThanOrEqual(ARMY_COMMAND_CHANGE_COOLDOWN_TURNS);
    }
    lastByArmy.set(fact.payload.targetArmyId, fact.turn);
    for (const participantId of [fact.payload.actorId, fact.payload.previousCommanderId]) {
      const previousParticipantTurn = lastByParticipant.get(participantId);
      if (previousParticipantTurn !== undefined) {
        expect(fact.turn - previousParticipantTurn).toBeGreaterThanOrEqual(
          COMMAND_CHANGE_PARTICIPANT_COOLDOWN_TURNS,
        );
      }
      lastByParticipant.set(participantId, fact.turn);
    }
  }
}, 120_000);
