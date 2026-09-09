import { readFileSync, writeFileSync } from 'node:fs';
import { deserializeWorld, readWorldFacts } from '../src/sim';

const root = 'output/history-maintenance-v1.29.5';
const rows = [];
for (let index = 0; index < 10; index++) {
  const versions = ['before', 'after'].map(version => {
    const data = JSON.parse(readFileSync(`${root}/${version}/${index}.json`, 'utf8'));
    const saved = JSON.parse(readFileSync(`${root}/${version}/${index}.portable.json`, 'utf8'));
    const world = deserializeWorld(JSON.stringify(saved.world ?? saved));
    const facts = readWorldFacts(world);
    // Correct the initial audit's death-age back-calculation using the recorded birth turn.
    const exposures = data.exposures.map((e: { characterId: string; turn: number }) => ({ ...e,
      age: Math.floor((e.turn - world.characters.find(p => p.id === e.characterId)!.birthTurn) / 4) }));
    return { version, seed: data.seed, profile: data.profile, hash: data.hash, wars: data.wars,
      ended: data.endedWars, emptyEnded: data.emptyEndedWars, activeUnfought: data.activeWithoutBattle,
      battles: data.battles, attackerWins: data.attackerWins, wounded: data.wounds.length, battleDeaths: data.deaths.length,
      maximumTerritory: data.maximumTerritory, finalTerritory: data.finalTerritory,
      seniorExposure65to79: exposures.filter((e: { age: number }) => e.age >= 65 && e.age < 80).length,
      seniorExposure80plus: exposures.filter((e: { age: number }) => e.age >= 80).length,
      elderlyCommandQuarters: data.elderlyCommand.length,
      elderlyCommandFullHealthQuarters: data.elderlyCommand.filter((e: { health: number }) => e.health === 100).length,
      recovery: data.wounds.map((f: { id: string; turn: number; payload: { characterId: string; recoveryUntilTurn?: number } }) => ({
        fact: f.id, prescribedQuarters: (f.payload.recoveryUntilTurn ?? f.turn + 2) - f.turn,
        nextBattleTurn: exposures.find((e: { characterId: string; turn: number }) => e.characterId === f.payload.characterId && e.turn > f.turn)?.turn ?? null,
        subsequentAppointments: facts.filter(a => a.kind === 'appointment_started' && a.turn > f.turn && a.turn <= f.turn + 8
          && a.payload.holderId === f.payload.characterId).map(a => a.id),
      })),
      recoveryViolations: data.recoveryViolations, validatorErrors: data.errors, savedContinuationEqual: data.replay,
    };
  });
  rows.push({ index, heldOut: index >= 2, versions });
}
writeFileSync(`${root}/comparison.json`, JSON.stringify(rows, null, 2));
let markdown = '# 两条验证路径：百年新规则对照\n\n旧史显示另见 frozen/*.json；下表不要求旧人物复演原命运。甲乙等八组已在修改前登记。\n\n';
markdown += '|种子/地图|版本|战争/已停/未战停战|在战未战|交战/攻胜|负伤/战死|最大领土峰值|65–79/80+参战人次|校验失败采样|存读续推|\n|---|---|---|---|---|---|---|---|---|---|\n';
for (const row of rows) for (const v of row.versions) markdown += `|${v.seed} / ${v.profile}|${v.version}|${v.wars}/${v.ended}/${v.emptyEnded}|${v.activeUnfought}|${v.battles}/${v.attackerWins}|${v.wounded}/${v.battleDeaths}|${v.maximumTerritory}|${v.seniorExposure65to79}/${v.seniorExposure80plus}|${v.validatorErrors.length}|${v.savedContinuationEqual}|\n`;
markdown += '\n校验每40季采样，不能据此声称每季均无异常；完整错误与伤后复战间隔在 comparison.json。军中高龄仅用于统计，不是退休门槛。未再参战不等于未康复。\n';
writeFileSync(`${root}/COMPARISON.md`, markdown);
console.log(markdown);
