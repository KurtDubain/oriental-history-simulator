import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld, advanceWorld, advanceWorldDetailed, readWorldFacts, serializeWorld, deserializeWorld, validateWorld } from '../src/sim';
import { encodeWorldFile } from '../src/persistence/storage';
import { canApproachTarget, executableWarTarget } from '../src/sim/military/orders';
import { projectPersonStoryArc, personShortBiography } from '../src/view/person-story-arc';
import { projectRosterDirectory } from '../src/view/roster-adapter';

// Registered before rule changes. These are hold-outs, not plot or casualty quotas.
const seeds = ['石塘暮钟-留验壬', '霜野渡鸦-留验癸', '海岑旧驿-留验子', '青陂远帆-留验丑',
  '山城薄暮-留验寅', '柳渡残照-留验卯', '云桥秋水-留验辰', '雪庭归雁-留验巳'];
const dir = process.argv[2], parity = Number(process.argv[3] ?? -1);
mkdirSync(dir, { recursive: true });
for (const [index, seed] of seeds.entries()) {
  if (parity >= 0 && index % 2 !== parity) continue;
  const profile = index % 2 ? 'contest-v01' : 'private-v03';
  let world = createWorld(seed, profile), peak = 0;
  const elderly: unknown[] = [], declarations: unknown[] = [], errors: unknown[] = [], checkpoints: unknown[] = [];
  const quarterly: unknown[] = [];
  for (let turn = 1; turn <= 400; turn++) {
    const before = world, started = performance.now();
    const advanced = advanceWorldDetailed(world); world = advanced.world;
    peak = Math.max(peak, ...world.polities.map(p => p.controlledRegionIds.length));
    for (const a of world.armies) {
      const p = world.characters.find(c => c.id === a.commanderId)!;
      if (p?.age >= 80) elderly.push({ turn, id: p.id, age: p.age, health: p.health });
    }
    for (const f of world.facts.filter(f => f.turn === world.lastTurn!.turn && f.kind === 'war_started')) {
      if (f.kind !== 'war_started') continue;
      declarations.push({ fact: f, previousQuarterHash: before.hash,
        // Boundary observation, not falsely labelled exact intra-quarter military power.
        atQuarterStart: before.armies.filter(a => f.polityIds.includes(a.polityId)).map(a => ({
          id: a.id, polity: a.polityId, region: a.regionId, soldiers: a.soldiers, supply: a.supply,
          order: a.order, executableTarget: executableWarTarget(before, a.polityId,
            a.polityId === f.payload.attackerId ? f.payload.defenderId : f.payload.attackerId, a.id),
          targets: f.regionIds.map(id => ({ id, approachable: canApproachTarget(before, a, id) })),
        })),
        afterOrders: world.armies.filter(a => a.order.warId === f.payload.warId).map(a => ({ id: a.id, region: a.regionId, order: a.order })),
      });
    }
    quarterly.push({ turn, timings: advanced.timings, ms: performance.now() - started,
      lowAuthority: world.polities.filter(p => p.alive && p.authority < 15).map(p => ({
        id: p.id, name: p.name, authority: p.authority, legitimacy: p.legitimacy, treasury: p.treasury,
        regions: p.controlledRegionIds.length, armies: world.armies.filter(a => a.polityId === p.id).map(a => ({
          id: a.id, soldiers: a.soldiers, morale: a.morale, supply: a.supply, order: a.order.kind, allegiance: a.allegiance,
        })),
      })),
    });
    if (turn % 40 === 0) {
      const problems = validateWorld(world); if (problems.length) errors.push({ turn, problems });
      checkpoints.push({ turn, hash: world.hash });
      console.log(JSON.stringify({ dir, index, turn, errors: problems.length }));
    }
  }
  const facts = readWorldFacts(world), battles = facts.filter(f => f.kind === 'battle');
  const ended = world.wars.filter(w => !w.active), wounds = facts.filter(f => f.kind === 'character_wounded');
  const deaths = facts.filter(f => f.kind === 'character_death' && f.payload.cause === 'battle');
  const begin = performance.now(), roster = projectRosterDirectory(world).people.items;
  const coldRosterMs = performance.now() - begin;
  const stories = world.characters.filter(p => !p.alive).map(p => ({ id: p.id, name: p.name,
    reason: roster.find(r => r.id === p.id)?.reason, story: projectPersonStoryArc(world, p),
    biography: personShortBiography(world, p, projectPersonStoryArc(world, p)),
  }));
  writeFileSync(`${dir}/${index}.json`, JSON.stringify({ seed, profile, hash: world.hash, peak,
    final: world.polities.filter(p => p.alive).map(p => ({ name: p.name, regions: p.controlledRegionIds.length })),
    wars: world.wars.length, ended: ended.length, empty: ended.filter(w => !battles.some(b => b.payload.warId === w.id)).length,
    battles: battles.map(b => ({ id: b.id, turn: b.turn, payload: b.payload,
      terrain: world.regions.find(r => r.id === b.payload.targetRegionId)?.terrain })),
    deaths, wounds, elderly, declarations, quarterly, checkpoints, errors, coldRosterMs, stories,
    replay: advanceWorld(deserializeWorld(serializeWorld(world))).hash === advanceWorld(world).hash,
  }));
  writeFileSync(`${dir}/${index}.portable.json`, encodeWorldFile(serializeWorld(world)));
}
