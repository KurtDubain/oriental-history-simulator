import { advanceWorld, createWorld, validateWorld } from '../src/sim';

const initial = createWorld('V0.3接线冒烟');
const initialViolations = validateWorld(initial);
console.log(JSON.stringify({
  phase: 'initial',
  regions: initial.regions.length,
  seaZones: initial.seaZones.length,
  polities: initial.polities.length,
  characters: initial.characters.length,
  fleets: initial.fleets.length,
  violations: initialViolations.slice(0, 12),
}, null, 2));

let next = initial;
let nextViolations = initialViolations;
let failedTurn: number | null = null;
for (let index = 0; index < 24; index += 1) {
  next = advanceWorld(next);
  nextViolations = validateWorld(next);
  if (nextViolations.length > 0) {
    failedTurn = next.turn;
    break;
  }
}
console.log(JSON.stringify({
  phase: 'quarter-run',
  turn: next.turn,
  failedTurn,
  shipments: next.lastTurn?.trade.shipments.length,
  corridors: next.tradeCorridors.length,
  migration: next.lastTurn?.migration,
  health: next.lastTurn?.health,
  seaUsageProblems: next.lastTurn?.logistics.seaUsage.map((usage) => ({
    edgeId: usage.edgeId,
    capacity: usage.capacity,
    definedCapacity: next.seaLanes.find((lane) => lane.id === usage.edgeId)?.capacity ?? next.portLinks.find((link) => link.id === usage.edgeId)?.capacity,
    reserved: usage.reserved,
    missingFlows: usage.flowIds.filter((id) => !next.lastTurn?.trade.shipments.some((shipment) => shipment.id === id)),
  })).filter((usage) => usage.missingFlows.length > 0 || usage.capacity !== usage.definedCapacity || usage.reserved > usage.capacity),
  violations: nextViolations.slice(0, 20),
}, null, 2));

if (initialViolations.length > 0 || nextViolations.length > 0) process.exitCode = 1;
