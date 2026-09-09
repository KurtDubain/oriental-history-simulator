import { readFileSync, writeFileSync } from 'node:fs';
import { deserializeWorld, readWorldFacts, readWorldHistory } from '../src/sim';
const results = [];
for (const file of [...Array.from({ length: 10 }, (_, i) => `output/history-maintenance-v1.29.5/after/${i}.portable.json`), 'output/playwright/ordinary-v1296/world-T400.json']) {
  const parsed = JSON.parse(readFileSync(file, 'utf8')), world = deserializeWorld(JSON.stringify(parsed.world ?? parsed));
  const facts = readWorldFacts(world), battles = facts.filter(f => f.kind === 'battle');
  const byId = new Map(facts.map(f => [f.id, f]));
  const roots = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return []; seen.add(id);
    const f = byId.get(id); return f?.kind === 'battle' ? [f.id] : f?.sourceFactIds.flatMap(id => roots(id, seen)) ?? [];
  };
  const capitalChanges = readWorldHistory(world).flatMap(e => e.stateDeltas.filter(d => d.entityType === 'polity' && d.field === 'capitalRegionId')
    .map(d => ({ turn:e.turn, battleIds:e.sourceFactIds.flatMap(id=>roots(id)), delta:d }))).reverse();
  const territoryChanges = facts.filter(f => f.kind === 'territory_control_changed').reverse();
  const captures = new Set(facts.filter(f => f.kind === 'territory_control_changed' && f.payload.reason === 'battle_capture').flatMap(f => f.sourceFactIds.flatMap(id => roots(id))));
  const groups: Record<string, { battles: number; wins: number; ratio: number }> = {};
  const streaks = new Map<string, number>(); let maxStreak = 0;
  const captureStreaks = new Map<string, {war:string;turn:number;places:Set<string>}>(); let maxCaptureStreak = 0;
  for (const b of battles) {
    const p = b.payload, terrain = world.regions.find(r => r.id === p.targetRegionId)?.terrain;
    let defendingPolity = world.regions.find(r=>r.id===p.targetRegionId)?.controllerId;
    for(const f of territoryChanges) if(f.payload.regionId===p.targetRegionId && f.id>b.id) defendingPolity=f.payload.previousControllerId;
    let capital = world.polities.find(n=>n.id===defendingPolity)?.capitalRegionId;
    for(const c of capitalChanges) if(c.delta.entityId===defendingPolity && (c.turn>b.turn
      || c.turn===b.turn && c.battleIds.some(id=>id>=b.id))) capital=String(c.delta.before);
    const standing = p.defenders.some(d => d.soldiersBefore > 0);
    for (const key of [standing ? 'standing' : 'militiaOnly', `terrain:${terrain}`, ...(capital===p.targetRegionId ? ['capitalAtBattle'] : [])]) {
      const g = groups[key] ??= { battles: 0, wins: 0, ratio: 0 };
      g.battles++; g.wins += Number(p.attackerWon); g.ratio += p.attackerPower / Math.max(1,p.defenderPower);
    }
    const n = p.attackerWon ? (streaks.get(p.attacker.armyId) ?? 0) + 1 : 0;
    streaks.set(p.attacker.armyId, n); maxStreak = Math.max(maxStreak,n);
    if (!p.attackerWon || !captures.has(b.id)) { captureStreaks.delete(p.attacker.armyId); continue; }
    const prior = captureStreaks.get(p.attacker.armyId);
    const current = prior && prior.war === p.warId && b.turn - prior.turn <= 4 ? prior : {war:p.warId,turn:b.turn,places:new Set<string>()};
    current.turn = b.turn; current.places.add(p.targetRegionId); captureStreaks.set(p.attacker.armyId,current);
    maxCaptureStreak = Math.max(maxCaptureStreak,current.places.size);
  }
  results.push({ seed: world.seed, groups, maxStreak, maxCaptureStreak });
}
writeFileSync('output/tragedy-v1.29.7/eleven-battle-review.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
