import {
  advanceWorld,
  createWorld,
  readWorldFacts,
  readWorldHistory,
  validateWorld,
  type BattleFact,
  type WorldState,
} from '../src/sim';
import { projectPersonStoryArc } from '../src/view/person-story-arc';

const seeds = [
  '乱世一将', '命途审计-甲', '命途审计-乙', '命途审计-丙', '命途审计-丁',
  '命途审计-戊', '命途审计-己', '命途审计-庚', '命途审计-辛', '命途审计-壬',
];
const turns = 64;
const failures: string[] = [];
const fateByRole = {
  commander: { appearances: 0, wounded: 0, died: 0 },
  deputy: { appearances: 0, wounded: 0, died: 0 },
  member: { appearances: 0, wounded: 0, died: 0 },
};
const totals = {
  battles: 0,
  wounded: 0,
  battleDeaths: 0,
  diseaseDeaths: 0,
  naturalDeaths: 0,
  publicRefusals: 0,
  formationsRaised: 0,
  formationParticipants: 0,
  storyEligible: 0,
  storyTwoPlus: 0,
  storyFour: 0,
  compressedBattleBeats: 0,
  compressedBattleSources: 0,
};

function participantRows(fact: BattleFact) {
  return [
    ...(fact.payload.attacker.participants ?? []),
    ...fact.payload.defenders.flatMap((side) => side.participants ?? []),
  ];
}

function auditWorld(world: WorldState, seed: string): void {
  const violations = validateWorld(world);
  if (violations.length) failures.push(`${seed}: ${violations[0]?.code} ${violations[0]?.message}`);
  const facts = readWorldFacts(world);
  const history = readWorldHistory(world);
  const battles = facts.filter((fact): fact is BattleFact => fact.kind === 'battle');
  const battleById = new Map(battles.map((fact) => [fact.id, fact]));
  totals.battles += battles.length;
  for (const battle of battles) {
    for (const participant of participantRows(battle)) fateByRole[participant.role].appearances += 1;
  }
  for (const fact of facts) {
    if (fact.kind === 'character_wounded') {
      totals.wounded += 1;
      fateByRole[fact.payload.role].wounded += 1;
      const battle = battleById.get(fact.payload.battleFactId);
      if (!battle || !participantRows(battle).some((item) => item.characterId === fact.payload.characterId)) {
        failures.push(`${seed}: ${fact.id} 负伤者未在来源战役参战`);
      }
    }
    if (fact.kind === 'character_death') {
      if (fact.payload.cause === 'battle') {
        totals.battleDeaths += 1;
        const battle = fact.payload.battleFactId ? battleById.get(fact.payload.battleFactId) : undefined;
        const participant = battle && participantRows(battle).find((item) => item.characterId === fact.payload.characterId);
        if (!participant) failures.push(`${seed}: ${fact.id} 战死者未在来源战役参战`);
        else fateByRole[participant.role].died += 1;
      } else if (fact.payload.cause === 'disease' || (fact.payload.cause === undefined && fact.payload.diseaseId)) {
        totals.diseaseDeaths += 1;
      } else {
        totals.naturalDeaths += 1;
      }
    }
    if (fact.kind === 'expedition_response' && fact.payload.outcome === 'refused') totals.publicRefusals += 1;
  }
  const raised = history.filter((event) => event.kind === 'army_raised');
  totals.formationsRaised += raised.length;
  totals.formationParticipants += raised.reduce((sum, event) => sum + event.actorIds.length, 0);
  for (const person of world.characters) {
    const arc = projectPersonStoryArc(world, person);
    if (person.biography.length >= 3) {
      totals.storyEligible += 1;
      if (arc.length >= 2) totals.storyTwoPlus += 1;
      if (arc.length === 4) totals.storyFour += 1;
    }
    for (const beat of arc.filter((item) => item.id.startsWith('person-story:battles:'))) {
      totals.compressedBattleBeats += 1;
      totals.compressedBattleSources += beat.sourceFactIds.length;
    }
    if (arc.some((beat) => beat.sourceFactIds.length + beat.sourceEventIds.length === 0)) {
      failures.push(`${seed}: ${person.id} 人物故事存在无来源段落`);
    }
  }
  for (const person of world.characters) {
    const memberships = world.armies.filter((army) => army.participantIds.includes(person.id));
    if (memberships.length > 1) failures.push(`${seed}: ${person.id} 同时参加${memberships.length}支编队`);
  }
}

let luStory: ReturnType<typeof projectPersonStoryArc> = [];
let luState: Record<string, unknown> = {};
let luFingerprint = '';
for (const seed of seeds) {
  let world = createWorld(seed);
  for (let turn = 0; turn < turns; turn += 1) world = advanceWorld(world);
  auditWorld(world, seed);
  if (seed === '乱世一将') {
    const lu = world.characters.find((person) => person.id === 'c_098');
    if (lu) {
      luFingerprint = `${world.hash}:${world.factDigest}:${world.historyDigest}`;
      luStory = projectPersonStoryArc(world, lu);
      luState = {
        name: lu.name,
        alive: lu.alive,
        health: lu.health,
        soldiers: world.personalForces.find((force) => force.ownerId === lu.id)?.soldiers ?? 0,
        commandingArmyId: lu.commandingArmyId,
      };
    }
  }
}

let luReplay = createWorld('乱世一将');
for (let turn = 0; turn < turns; turn += 1) luReplay = advanceWorld(luReplay);
const deterministicReplayExact = `${luReplay.hash}:${luReplay.factDigest}:${luReplay.historyDigest}` === luFingerprint;
if (!deterministicReplayExact) failures.push('乱世一将 T64 重放不一致');
if (totals.battles === 0 || totals.wounded === 0 || totals.battleDeaths === 0) failures.push('长程样本未同时产生战斗、负伤与战死');
if (totals.battleDeaths > totals.wounded) failures.push('战死数不应超过负伤数');
const output = {
  seeds: seeds.length,
  turns,
  totals,
  fateByRole,
  rates: {
    battleDeathPerAppearance: Object.values(fateByRole).reduce((sum, item) => sum + item.appearances, 0)
      ? totals.battleDeaths / Object.values(fateByRole).reduce((sum, item) => sum + item.appearances, 0)
      : 0,
    woundPerAppearance: Object.values(fateByRole).reduce((sum, item) => sum + item.appearances, 0)
      ? totals.wounded / Object.values(fateByRole).reduce((sum, item) => sum + item.appearances, 0)
      : 0,
    averageFormationSize: totals.formationsRaised ? totals.formationParticipants / totals.formationsRaised : 0,
    storyTwoPlusCoverage: totals.storyEligible ? totals.storyTwoPlus / totals.storyEligible : 0,
  },
  luState,
  luStory,
  deterministicReplayExact,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
