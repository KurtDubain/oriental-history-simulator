import {
  advanceWorld,
  createWorld,
  deserializeWorld,
  readWorldFacts,
  readWorldHistory,
  serializeWorld,
  validateWorld,
  type BattleFact,
  type WorldState,
} from '../src/sim';
import { projectPersonStoryArc } from '../src/view/person-story-arc';
import { createRosterDiscoveryState } from '../src/view/roster-discovery';
import { projectRosterCollection } from '../src/view/roster-adapter';

const coreSeeds = ['乱世一将', '命途审计-甲', '命途审计-乙', '命途审计-丙', '命途审计-丁', '命途审计-戊'];
const heldOutSeeds = ['命途留验-潮汐', '命途留验-山河', '命途留验-朔风', '命途留验-星火'];
const seeds = [...coreSeeds, ...heldOutSeeds];
const turns = 64;
const failures: string[] = [];
const formationSizes: Record<string, number> = {};
const exposure = {
  wounded: { exposed: 0, severe: 0, catastrophic: 0 },
  died: { exposed: 0, severe: 0, catastrophic: 0 },
};
const storyLengths = { one: 0, two: 0, three: 0 };
const totals = {
  battles: 0, participantAppearances: 0, wounded: 0, battleDeaths: 0, diseaseDeaths: 0, naturalDeaths: 0,
  repeatWounds: 0, woundedNextQuarterBattles: 0, recoveredAndReturned: 0, neverReturned: 0,
  scheduledRecoveryQuarterSum: 0, recoveryQuarterSum: 0,
  publicRefusals: 0, refusalsWithConsequence: 0,
  formationsRaised: 0, formationParticipants: 0, partialFactionResponses: 0,
  discoverableDeceased: 0, deceased: 0,
};
const partialResponseExamples: Array<Record<string, unknown>> = [];
const refusalExamples: Array<Record<string, unknown>> = [];
const storySamples: Array<Record<string, unknown>> = [];
const fingerprints = new Map<string, string>();

function participantRows(fact: BattleFact) {
  return [
    ...(fact.payload.attacker.participants ?? []).map((participant) => ({ participant, won: fact.payload.attackerWon })),
    ...fact.payload.defenders.flatMap((side) => (side.participants ?? []).map((participant) => ({ participant, won: !fact.payload.attackerWon }))),
  ];
}

function exposureKind(participant: ReturnType<typeof participantRows>[number]['participant'], won: boolean) {
  const ratio = participant.losses / Math.max(1, participant.soldiersBefore);
  if (participant.soldiersAfter === 0 || ratio >= .48 || (!won && ratio >= .38)) return 'catastrophic' as const;
  if (ratio >= .32 || (!won && ratio >= .24)) return 'severe' as const;
  if (ratio >= .2 && (!won || participant.role !== 'member')) return 'exposed' as const;
  return 'ordinary' as const;
}

function fingerprint(world: WorldState): string {
  return `${world.hash}:${world.factDigest}:${world.historyDigest}`;
}

function rememberNewFormations(previous: WorldState, next: WorldState, seed: string): void {
  const existing = new Set(previous.armies.map((army) => army.id));
  for (const army of next.armies.filter((item) => !existing.has(item.id))) {
    const size = army.participantIds.length;
    formationSizes[size] = (formationSizes[size] ?? 0) + 1;
    const commander = next.characters.find((person) => person.id === army.commanderId);
    if (!commander?.factionId) continue;
    const stayed = next.characters.filter((person) => person.alive && person.polityId === army.polityId
      && person.factionId === commander.factionId && !army.participantIds.includes(person.id)
      && (next.personalForces.find((force) => force.ownerId === person.id)?.soldiers ?? 0) > 0);
    const joined = army.participantIds.filter((id) => next.characters.find((person) => person.id === id)?.factionId === commander.factionId);
    if (!joined.length || !stayed.length) continue;
    totals.partialFactionResponses += 1;
    if (partialResponseExamples.length < 5) partialResponseExamples.push({
      seed, turn: next.turn, commander: commander.name,
      joined: joined.map((id) => next.characters.find((person) => person.id === id)?.name),
      stayed: stayed.slice(0, 3).map((person) => person.name),
    });
  }
}

function auditWorld(world: WorldState, seed: string): void {
  const violations = validateWorld(world);
  if (violations.length) failures.push(`${seed}: ${violations[0]?.code} ${violations[0]?.message}`);
  const facts = readWorldFacts(world);
  const history = readWorldHistory(world);
  const battles = facts.filter((fact): fact is BattleFact => fact.kind === 'battle');
  const battleById = new Map(battles.map((fact) => [fact.id, fact]));
  totals.battles += battles.length;
  totals.participantAppearances += battles.reduce((sum, battle) => sum + participantRows(battle).length, 0);
  const battleRows = battles.flatMap((battle) => participantRows(battle).map((row) => ({ ...row, battle })));
  const woundsByPerson = new Map<string, Extract<typeof facts[number], { kind: 'character_wounded' }>[]>()
  for (const fact of facts) {
    if (fact.kind === 'character_wounded') {
      totals.wounded += 1;
      totals.scheduledRecoveryQuarterSum += (fact.payload.recoveryUntilTurn ?? fact.turn + 2) - fact.turn;
      woundsByPerson.set(fact.payload.characterId, [...(woundsByPerson.get(fact.payload.characterId) ?? []), fact]);
      const battle = battleById.get(fact.payload.battleFactId);
      const row = battle && participantRows(battle).find((item) => item.participant.characterId === fact.payload.characterId);
      const kind = row && exposureKind(row.participant, row.won);
      if (!row || kind === 'ordinary') failures.push(`${seed}: ${fact.id} 负伤没有可核验的高风险战场暴露`);
      else exposure.wounded[kind] += 1;
      const nextQuarterBattle = battleRows.some((item) => item.battle.turn === fact.turn + 1
        && item.participant.characterId === fact.payload.characterId);
      if (nextQuarterBattle) {
        totals.woundedNextQuarterBattles += 1;
        failures.push(`${seed}: ${fact.payload.characterId} 负伤后下一季仍参战`);
      }
      const returned = battleRows.filter((item) => item.battle.turn > fact.turn
        && item.participant.characterId === fact.payload.characterId)
        .sort((left, right) => left.battle.turn - right.battle.turn || left.battle.id.localeCompare(right.battle.id))[0];
      if (returned) {
        const rest = returned.battle.turn - fact.turn - 1;
        totals.recoveredAndReturned += 1;
        totals.recoveryQuarterSum += rest;
        if (returned.battle.turn < (fact.payload.recoveryUntilTurn ?? fact.turn + 2)) {
          failures.push(`${seed}: ${fact.payload.characterId} 在休养期结束前复出`);
        }
      } else totals.neverReturned += 1;
    }
    if (fact.kind === 'character_death') {
      if (fact.payload.cause === 'battle') {
        totals.battleDeaths += 1;
        const battle = fact.payload.battleFactId ? battleById.get(fact.payload.battleFactId) : undefined;
        const row = battle && participantRows(battle).find((item) => item.participant.characterId === fact.payload.characterId);
        const kind = row && exposureKind(row.participant, row.won);
        if (!row || kind === 'ordinary') failures.push(`${seed}: ${fact.id} 战死没有可核验的高风险战场暴露`);
        else exposure.died[kind] += 1;
      } else if (fact.payload.cause === 'disease' || (!fact.payload.cause && fact.payload.diseaseId)) totals.diseaseDeaths += 1;
      else totals.naturalDeaths += 1;
    }
    if (fact.kind === 'expedition_response') {
      if (fact.payload.outcome === 'refused') {
        totals.publicRefusals += 1;
        const consequences = fact.stateDeltas.filter((delta) => delta.entityType === 'relationship' && delta.delta !== 0);
        if (consequences.length) totals.refusalsWithConsequence += 1;
        else failures.push(`${seed}: ${fact.id} 公开拒令没有关系后果`);
        if (refusalExamples.length < 5) refusalExamples.push({ seed, turn: fact.turn, reason: fact.payload.reason, consequences });
      }
    }
  }
  for (const wounds of woundsByPerson.values()) {
    const ordered = wounds.sort((left, right) => left.turn - right.turn || left.id.localeCompare(right.id));
    totals.repeatWounds += Math.max(0, ordered.length - 1);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.turn < (ordered[index - 1]!.payload.recoveryUntilTurn ?? ordered[index - 1]!.turn + 2)) {
        failures.push(`${seed}: ${ordered[index]!.payload.characterId} 休养中重复负伤`);
      }
    }
  }

  const raised = history.filter((event) => event.kind === 'army_raised');
  totals.formationsRaised += raised.length;
  totals.formationParticipants += raised.reduce((sum, event) => sum + event.actorIds.length, 0);
  for (const person of world.characters) {
    const arc = projectPersonStoryArc(world, person);
    if (arc.length === 1) storyLengths.one += 1;
    if (arc.length === 2) storyLengths.two += 1;
    if (arc.length === 3) storyLengths.three += 1;
    if (arc.length > 3) failures.push(`${seed}: ${person.id} 人物故事超过三段`);
    if (!person.alive && arc.length && arc.at(-1)?.phase !== 'ending') failures.push(`${seed}: ${person.id} 故人故事未以结局收束`);
    if (arc.some((beat) => !beat.sourceFactIds.length)) failures.push(`${seed}: ${person.id} 人物故事存在无来源段落`);
    if (arc.length && storySamples.length < 12 && !storySamples.some((sample) => sample.length === arc.length)) {
      storySamples.push({ seed, person: person.name, alive: person.alive, length: arc.length,
        beats: arc.map((beat) => ({ date: beat.dateLabel, label: beat.phaseLabel, title: beat.title, summary: beat.summary })) });
    }
  }
  const deceased = world.characters.filter((person) => !person.alive);
  totals.deceased += deceased.length;
  const departed = projectRosterCollection(world, 'people', { ...createRosterDiscoveryState('people'), quickView: 'deceased' });
  const departedIds = new Set(departed.items.map((item) => item.id));
  for (const person of deceased) if (departedIds.has(person.id)) totals.discoverableDeceased += 1;
  if (deceased.some((person) => !departedIds.has(person.id))) failures.push(`${seed}: 故人筛选漏掉退场人物`);
  const sample = deceased[0];
  if (sample) {
    const search = projectRosterCollection(world, 'people', { ...createRosterDiscoveryState('people'), quickView: 'all', query: sample.name });
    if (!search.items.some((item) => item.id === sample.id)) failures.push(`${seed}: 无法按姓名重新找到${sample.name}`);
  }
  for (const person of world.characters) {
    const memberships = world.armies.filter((army) => army.participantIds.includes(person.id));
    if (memberships.length > 1) failures.push(`${seed}: ${person.id} 同时参加${memberships.length}支编队`);
  }
}

for (const seed of seeds) {
  let world = createWorld(seed);
  for (let turn = 0; turn < turns; turn += 1) {
    const previous = world;
    world = advanceWorld(world);
    rememberNewFormations(previous, world, seed);
  }
  fingerprints.set(seed, fingerprint(world));
  auditWorld(world, seed);
}

let replay = createWorld(coreSeeds[0]!);
for (let turn = 0; turn < turns; turn += 1) replay = advanceWorld(replay);
const deterministicReplayExact = fingerprint(replay) === fingerprints.get(coreSeeds[0]);
if (!deterministicReplayExact) failures.push(`${coreSeeds[0]} T64 重放不一致`);

const resumeSeed = heldOutSeeds[0]!;
let resumed = createWorld(resumeSeed);
for (let turn = 0; turn < turns / 2; turn += 1) resumed = advanceWorld(resumed);
resumed = deserializeWorld(serializeWorld(resumed));
for (let turn = turns / 2; turn < turns; turn += 1) resumed = advanceWorld(resumed);
const saveResumeExact = fingerprint(resumed) === fingerprints.get(resumeSeed);
if (!saveResumeExact) failures.push(`${resumeSeed} 存读档后演化不一致`);
if (!totals.battles) failures.push('长程样本没有产生战斗');
if (totals.publicRefusals !== totals.refusalsWithConsequence) failures.push('仍有无关系后果的公开拒令');

const output = {
  sample: { coreSeeds, heldOutSeeds, turns }, totals, exposure, formationSizes, storyLengths,
  rates: {
    woundPerAppearance: totals.participantAppearances ? totals.wounded / totals.participantAppearances : 0,
    battleDeathPerAppearance: totals.participantAppearances ? totals.battleDeaths / totals.participantAppearances : 0,
    woundedNextQuarterParticipation: totals.wounded ? totals.woundedNextQuarterBattles / totals.wounded : 0,
    averageScheduledRecovery: totals.wounded ? totals.scheduledRecoveryQuarterSum / totals.wounded : 0,
    averageRestBeforeReturn: totals.recoveredAndReturned ? totals.recoveryQuarterSum / totals.recoveredAndReturned : 0,
    averageFormationSize: totals.formationsRaised ? totals.formationParticipants / totals.formationsRaised : 0,
  },
  partialResponseExamples, refusalExamples, storySamples: storySamples.slice(0, 3),
  deterministicReplayExact, saveResumeExact, failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
