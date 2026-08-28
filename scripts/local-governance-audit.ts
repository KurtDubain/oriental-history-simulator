import {
  advanceWorld,
  createWorld,
  validateTurnRuntime,
  validateWorldFull,
  type SimulationFact,
} from '../src/sim';
import { MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN } from '../src/sim/agency/embodied-governance';

const SEEDS = ['河清海晏', '旱涝相仍', '北地流民', '岭南秋税', '海东饥岁', '州府新政'];
const TURNS = 80;

interface Counts {
  total: number;
  enacted: number;
  deferred: number;
  refused: number;
  invalidated: number;
  relief: number;
  levy: number;
  maximumPerTurn: number;
  foodSpent: number;
  treasurySpent: number;
}

const counts: Counts = {
  total: 0,
  enacted: 0,
  deferred: 0,
  refused: 0,
  invalidated: 0,
  relief: 0,
  levy: 0,
  maximumPerTurn: 0,
  foodSpent: 0,
  treasurySpent: 0,
};
const failures: string[] = [];

function localFacts(facts: readonly SimulationFact[]) {
  return facts.filter((fact): fact is Extract<SimulationFact, { kind: 'local_governance_resolved' }> => (
    fact.kind === 'local_governance_resolved'
  ));
}

for (const seed of SEEDS) {
  let world = createWorld(seed);
  const lastActionTurn = new Map<string, number>();
  const lastPolityActionTurn = new Map<string, number>();
  for (let index = 0; index < TURNS; index += 1) {
    const previous = world;
    world = advanceWorld(previous);
    const runtime = validateTurnRuntime(previous, world);
    if (runtime.length) failures.push(`${seed} T${previous.turn}: runtime ${runtime[0]?.code}`);
    const facts = localFacts(world.facts.slice(previous.facts.length));
    counts.maximumPerTurn = Math.max(counts.maximumPerTurn, facts.length);
    if (facts.length > MAX_LOCAL_GOVERNANCE_ACTIONS_PER_TURN) {
      failures.push(`${seed} T${previous.turn}: ${facts.length} local measures exceed capacity`);
    }
    for (const fact of facts) {
      counts.total += 1;
      counts[fact.payload.outcome] += 1;
      if (fact.payload.action === 'open_granary') counts.relief += 1;
      else counts.levy += 1;
      counts.foodSpent += fact.payload.foodSpent;
      counts.treasurySpent += fact.payload.treasurySpent;
      const priorTurn = lastActionTurn.get(fact.payload.actorId);
      const priorPolityTurn = lastPolityActionTurn.get(fact.payload.polityId);
      if (fact.payload.outcome !== 'invalidated') {
        if (priorTurn !== undefined && fact.turn - priorTurn < 4) {
          failures.push(`${seed} ${fact.payload.actorId}: cooldown ${priorTurn}->${fact.turn}`);
        }
        lastActionTurn.set(fact.payload.actorId, fact.turn);
        if (priorPolityTurn !== undefined && fact.turn - priorPolityTurn < 2) {
          failures.push(`${seed} ${fact.payload.polityId}: polity cooldown ${priorPolityTurn}->${fact.turn}`);
        }
        lastPolityActionTurn.set(fact.payload.polityId, fact.turn);
      }
      const linkedEvent = world.history.find((event) => event.sourceFactIds.includes(fact.id));
      if (!linkedEvent || !linkedEvent.actorIds.includes(fact.payload.actorId) || !linkedEvent.regionIds.includes(fact.payload.regionId)) {
        failures.push(`${seed} ${fact.id}: missing concrete Chronicle link`);
      }
      if (fact.payload.outcome === 'enacted' && fact.payload.unrestAfter >= fact.payload.unrestBefore) {
        failures.push(`${seed} ${fact.id}: enacted measure did not reduce unrest`);
      }
      if (fact.payload.action === 'open_granary') {
        const foodDelta = fact.stateDeltas.find((delta) => delta.entityType === 'region' && delta.entityId === fact.payload.regionId && delta.field === 'food');
        if (fact.payload.outcome === 'enacted' && foodDelta?.delta !== -fact.payload.foodSpent) {
          failures.push(`${seed} ${fact.id}: relief food mismatch`);
        }
      } else {
        const treasuryDelta = fact.stateDeltas.find((delta) => delta.entityType === 'polity' && delta.entityId === fact.payload.polityId && delta.field === 'treasury');
        const wealthDelta = fact.stateDeltas.find((delta) => delta.entityType === 'region' && delta.entityId === fact.payload.regionId && delta.field === 'wealth');
        if (fact.payload.outcome === 'enacted' && (treasuryDelta?.delta ?? 0) + (wealthDelta?.delta ?? 0) !== 0) {
          failures.push(`${seed} ${fact.id}: levy wealth mismatch`);
        }
      }
    }
  }
  const full = validateWorldFull(world);
  if (full.length) failures.push(`${seed}: full ${full[0]?.code}`);
}

if (counts.total === 0) failures.push('natural sample produced no local governance measures');
if (counts.enacted === 0) failures.push('natural sample enacted no local governance measures');
if (counts.relief === 0 || counts.levy === 0) failures.push('natural sample did not cover both relief and levy actions');

console.log(JSON.stringify({
  seeds: SEEDS.length,
  turnsPerSeed: TURNS,
  counts,
  averagePerWorldTurn: Number((counts.total / (SEEDS.length * TURNS)).toFixed(3)),
  failures: failures.slice(0, 20),
}, null, 2));

if (failures.length) process.exitCode = 1;
