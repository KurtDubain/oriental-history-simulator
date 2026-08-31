import {
  COMMODITIES,
  advanceWorld,
  advanceWorldBy,
  createWorld,
  readWorldHistory,
  serializeWorld,
  validateWorld,
  type CommodityKind,
  type WorldState,
} from '../src/sim';

const DEFAULT_SEEDS = ['北辰海图', '潮生商路', '孤城疫年', '秋水迁徙'];
const seeds = (process.env.V03_AUDIT_SEEDS?.split(',').map((seed) => seed.trim()).filter(Boolean)
  ?? DEFAULT_SEEDS);
const turns = Math.max(1, Number.parseInt(process.env.V03_AUDIT_TURNS ?? '80', 10));
const determinismTurns = Math.max(1, Number.parseInt(
  process.env.V03_AUDIT_DETERMINISM_TURNS ?? String(Math.min(turns, 32)),
  10,
));
const maximumP95Milliseconds = Math.max(1, Number(process.env.V03_AUDIT_MAX_P95_MS ?? '250'));
const maximumSaveMiB = Math.max(1, Number(process.env.V03_AUDIT_MAX_SAVE_MIB ?? '16'));

interface AuditSample {
  seed: string;
  finalHash: string;
  livingPolities: number;
  fleets: number;
  activeCorridors: number;
  tradeShipments: number;
  seaShipments: number;
  migrationFlows: number;
  migrationPeople: number;
  outbreakEvents: number;
  diseaseImportEvents: number;
  importedExposures: number;
  practicePrototypes: number;
  tradeTreatyEvents: number;
  tributeEvents: number;
  peaceEvents: number;
  maritimePowers: string[];
  saveMiB: number;
}

const failures: string[] = [];
const timings: number[] = [];
const samples: AuditSample[] = [];

function fail(seed: string, turn: number, message: string): void {
  failures.push(`${seed}@${turn}: ${message}`);
}

function totalPopulation(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.population, 0)
    + world.armies.reduce((sum, army) => sum + army.soldiers, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.sailors, 0);
}

function totalFood(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.food, 0)
    + world.armies.reduce((sum, army) => sum + army.food, 0)
    + world.fleets.reduce((sum, fleet) => sum + fleet.food, 0)
    + world.navalOperations
      .filter((operation) => operation.stage !== '完成' && operation.stage !== '失败')
      .reduce((sum, operation) => sum + operation.foodLoaded, 0);
}

function totalWealth(world: WorldState): number {
  return world.regions.reduce((sum, region) => sum + region.wealth, 0)
    + world.polities.reduce((sum, polity) => sum + polity.treasury, 0);
}

function totalCommodity(world: WorldState, commodity: CommodityKind): number {
  if (commodity === '粮食') return totalFood(world);
  return world.regions.reduce((sum, region) => sum + region.goods[commodity], 0);
}

function assertOpeningWorld(world: WorldState): void {
  if (world.schemaVersion !== 4 || world.mapContentVersion !== 'v03-82') {
    fail(world.seed, world.turn, `新世界版本错误 ${world.schemaVersion}/${world.mapContentVersion}`);
  }
  if (world.regions.length !== 82 || world.seaZones.length !== 10
    || world.polities.length !== 8 || world.characters.length !== 192) {
    fail(
      world.seed,
      world.turn,
      `开局规模错误 regions=${world.regions.length}, sea=${world.seaZones.length}, polities=${world.polities.length}, characters=${world.characters.length}`,
    );
  }
  if (world.fleets.length === 0) fail(world.seed, world.turn, '开局没有任何真实舰队');
}

function auditQuarter(before: WorldState, world: WorldState, commodityBefore: Record<CommodityKind, number>): void {
  const report = world.lastTurn;
  if (!report) {
    fail(world.seed, world.turn, '推进后缺少季度报告');
    return;
  }
  const expectedPopulation = report.population.start + report.population.births
    - report.population.civilianDeaths - report.population.militaryDeaths;
  const expectedFood = report.food.start + report.food.produced - report.food.civilianConsumed
    - report.food.armyConsumed - report.food.spoiled - report.food.warDestroyed;
  const expectedWealth = report.wealth.start + report.wealth.produced
    - report.wealth.householdConsumed - report.wealth.warDestroyed;
  if (report.population.start !== totalPopulation(before)
    || report.population.end !== expectedPopulation
    || report.population.end !== totalPopulation(world)) {
    fail(world.seed, world.turn, `人口账不平 ${report.population.start}→${report.population.end}/${expectedPopulation}`);
  }
  if (report.food.start !== totalFood(before)
    || report.food.end !== expectedFood
    || report.food.end !== totalFood(world)) {
    fail(world.seed, world.turn, `粮食账不平 ${report.food.start}→${report.food.end}/${expectedFood}`);
  }
  if (report.wealth.start !== totalWealth(before)
    || report.wealth.end !== expectedWealth
    || report.wealth.end !== totalWealth(world)) {
    fail(world.seed, world.turn, `财富账不平 ${report.wealth.start}→${report.wealth.end}/${expectedWealth}`);
  }
  if (report.migration.departed !== report.migration.arrived + report.migration.travelDeaths) {
    fail(world.seed, world.turn, '迁徙人口不满足 departed = arrived + deaths');
  }
  const migrationIds = report.trade.shipments.filter((shipment) => shipment.kind === '迁徙').map((shipment) => shipment.id);
  if (JSON.stringify(report.migration.flowIds) !== JSON.stringify(migrationIds)) {
    fail(world.seed, world.turn, '迁徙账本与实际Shipment集合不一致');
  }

  for (const commodity of COMMODITIES.filter((item) => item !== '粮食')) {
    const expected = commodityBefore[commodity]
      + (report.trade.produced[commodity] ?? 0)
      - (report.trade.consumed[commodity] ?? 0)
      - (report.trade.lost[commodity] ?? 0);
    const actual = totalCommodity(world, commodity);
    if (report.trade.stockStart[commodity] !== commodityBefore[commodity]
      || report.trade.stockEnd[commodity] !== actual) {
      fail(world.seed, world.turn, `${commodity}商品快照与季度账本不一致`);
    }
    if (actual !== expected) fail(world.seed, world.turn, `${commodity}商品账不平 ${actual}/${expected}`);
  }

  const shipmentIds = new Set<string>();
  for (const shipment of report.trade.shipments) {
    if (shipmentIds.has(shipment.id)) fail(world.seed, world.turn, `重复Shipment ${shipment.id}`);
    shipmentIds.add(shipment.id);
    if (shipment.acceptedAmount !== shipment.deliveredAmount + shipment.lostAmount + shipment.raidedAmount) {
      fail(world.seed, world.turn, `${shipment.id}货量不守恒`);
    }
    if (shipment.peopleDeparted !== shipment.peopleArrived + shipment.peopleLost) {
      fail(world.seed, world.turn, `${shipment.id}人数不守恒`);
    }
    for (const leg of shipment.legs) {
      const capacity = world.routes.find((route) => route.id === leg.edgeId)?.supplyCapacity
        ?? world.seaLanes.find((lane) => lane.id === leg.edgeId)?.capacity
        ?? world.portLinks.find((link) => link.id === leg.edgeId)?.capacity;
      if (capacity === undefined || leg.capacityUsed < 0 || leg.capacityUsed > capacity) {
        fail(world.seed, world.turn, `${shipment.id}使用未知或超额运力 ${leg.edgeId}`);
      }
    }
  }
  if (report.trade.shipments.length > 512) fail(world.seed, world.turn, '季度Shipment超过512上限');
  if (world.tradeCorridors.length > 160) fail(world.seed, world.turn, '商路超过160上限');
  for (const usage of report.logistics.routeUsage) {
    if (usage.reserved < 0 || usage.reserved > usage.capacity) {
      fail(world.seed, world.turn, `共享运力超额 ${usage.reserved}/${usage.capacity}`);
    }
  }
  for (const usage of report.logistics.seaUsage) {
    const laneCapacity = world.seaLanes.find((lane) => lane.id === usage.edgeId)?.capacity;
    const linkCapacity = world.portLinks.find((link) => link.id === usage.edgeId)?.capacity;
    const physicalMaximum = laneCapacity !== undefined ? Math.floor(laneCapacity * 1.05) : linkCapacity;
    if (physicalMaximum === undefined
      || !Number.isSafeInteger(usage.capacity)
      || !Number.isSafeInteger(usage.reserved)
      || usage.capacity < 0
      || usage.reserved < 0
      || usage.capacity > physicalMaximum
      || usage.reserved > physicalMaximum) {
      fail(world.seed, world.turn, `动态海运快照越过物理上限 ${usage.edgeId} ${usage.reserved}/${usage.capacity}/${physicalMaximum ?? 'missing'}`);
    }
  }
  for (const region of world.regions) {
    if (region.refugeePopulation < 0 || region.refugeePopulation > region.population) {
      fail(world.seed, world.turn, `${region.id}流民不是人口有效子集`);
    }
  }
  for (const infection of world.infections) {
    const hostPopulation = infection.hostKind === 'region'
      ? world.regions.find((region) => region.id === infection.hostId)?.population
      : infection.hostKind === 'army'
        ? world.armies.find((army) => army.id === infection.hostId)?.soldiers
        : world.fleets.find((fleet) => fleet.id === infection.hostId)?.sailors;
    const compartments = infection.susceptible + infection.exposed + infection.infectious + infection.recovered;
    if (hostPopulation === undefined || compartments !== hostPopulation) {
      fail(world.seed, world.turn, `${infection.id} SEIR分舱与宿主规模不一致 ${compartments}/${hostPopulation ?? 'missing'}`);
    }
  }
}

function maritimePowers(world: WorldState): string[] {
  return world.polities.filter((polity) => {
    if (!polity.alive) return false;
    const ports = world.regions.filter((region) => region.controllerId === polity.id && region.port).length;
    const fleetPower = world.fleets
      .filter((fleet) => fleet.polityId === polity.id)
      .reduce((sum, fleet) => sum + fleet.warships + fleet.transports + fleet.patrolShips, 0);
    const controlledSea = world.seaZones.filter((zone) => zone.controllerId === polity.id).length;
    const seaTrade = world.tradeCorridors.filter((corridor) => {
      const origin = world.regions.find((region) => region.id === corridor.originRegionId);
      return origin?.controllerId === polity.id
        && corridor.pathEdgeIds.some((edgeId) => world.seaLanes.some((lane) => lane.id === edgeId));
    }).reduce((sum, corridor) => sum + corridor.rollingVolume, 0);
    return ports >= 3 && fleetPower > 0 && seaTrade > 0 && controlledSea > 0;
  }).map((polity) => polity.name);
}

for (const seed of seeds) {
  let world = createWorld(seed);
  assertOpeningWorld(world);
  const openingViolations = validateWorld(world);
  if (openingViolations.length > 0) fail(seed, 0, openingViolations[0]?.message ?? '开局一致性失败');
  let tradeShipments = 0;
  let seaShipments = 0;
  let migrationFlows = 0;
  let migrationPeople = 0;
  let importedExposures = 0;
  for (let index = 0; index < turns; index += 1) {
    const commodityBefore = Object.fromEntries(
      COMMODITIES.map((commodity) => [commodity, totalCommodity(world, commodity)]),
    ) as Record<CommodityKind, number>;
    const before = world;
    const startedAt = performance.now();
    world = advanceWorld(before);
    timings.push(performance.now() - startedAt);
    auditQuarter(before, world, commodityBefore);
    const violations = validateWorld(world);
    if (violations.length > 0) {
      const violation = violations[0];
      let details = '';
      if (violation?.code === 'naval-operation.references' && violation.entityId) {
        const operation = world.navalOperations.find((item) => item.id === violation.entityId);
        if (operation) details = ` ${JSON.stringify({
          stage: operation.stage,
          completedTurn: operation.completedTurn,
          warExists: world.wars.some((war) => war.id === operation.warId),
          armyExists: world.armies.some((army) => army.id === operation.armyId),
          missingFleetIds: operation.fleetIds.filter((id) => !world.fleets.some((fleet) => fleet.id === id)),
          foodLoaded: operation.foodLoaded,
          progress: operation.progress,
        })}`;
      }
      fail(seed, world.turn, `${violation?.code}: ${violation?.message}${details}`);
    }
    tradeShipments += world.lastTurn?.trade.shipments.filter((shipment) => shipment.kind === '贸易').length ?? 0;
    seaShipments += world.lastTurn?.trade.shipments.filter((shipment) => shipment.legs.some((leg) => leg.kind === 'sea-lane')).length ?? 0;
    migrationFlows += world.lastTurn?.migration.flowIds.length ?? 0;
    migrationPeople += world.lastTurn?.migration.departed ?? 0;
    importedExposures += world.lastTurn?.health.importedExposures ?? 0;
  }
  const serialized = serializeWorld(world);
  const saveMiB = Buffer.byteLength(serialized, 'utf8') / 1024 / 1024;
  const powers = maritimePowers(world);
  // Release totals span the whole run, including immutable records that have
  // moved out of the active window into compressed cold-history blocks.
  const fullHistory = readWorldHistory(world);
  if (tradeShipments === 0) fail(seed, world.turn, '没有形成任何实际贸易Shipment');
  if (seaShipments === 0) fail(seed, world.turn, '没有任何Shipment使用海上航道');
  if (migrationFlows === 0 || migrationPeople === 0) fail(seed, world.turn, '没有形成任何实际迁徙Shipment');
  if (!world.fleets.some((fleet) => Boolean(fleet.seaZoneId))) fail(seed, world.turn, '舰队从未形成海上投射');
  if (powers.length === 0) fail(seed, world.turn, '没有形成满足港口+舰队+海贸+海域控制的海洋强权');
  if (saveMiB > maximumSaveMiB) fail(seed, world.turn, `存档${saveMiB.toFixed(2)}MiB超过${maximumSaveMiB}MiB`);
  samples.push({
    seed,
    finalHash: world.hash,
    livingPolities: world.polities.filter((polity) => polity.alive).length,
    fleets: world.fleets.length,
    activeCorridors: world.tradeCorridors.filter((corridor) => corridor.active).length,
    tradeShipments,
    seaShipments,
    migrationFlows,
    migrationPeople,
    outbreakEvents: fullHistory.filter((event) => event.kind === 'outbreak_detected').length,
    diseaseImportEvents: fullHistory.filter((event) => event.kind === 'disease_imported').length,
    importedExposures,
    practicePrototypes: world.practiceStates.filter((practice) => practice.prototypeTurn !== null).length,
    tradeTreatyEvents: fullHistory.filter((event) => event.kind === 'trade_treaty_formed').length,
    tributeEvents: fullHistory.filter((event) => event.kind === 'tribute_imposed').length,
    peaceEvents: fullHistory.filter((event) => event.kind === 'peace').length,
    maritimePowers: powers,
    saveMiB: Number(saveMiB.toFixed(3)),
  });
}

if (seeds[0]) {
  const left = advanceWorldBy(createWorld(seeds[0]), determinismTurns);
  const right = advanceWorldBy(createWorld(seeds[0]), determinismTurns);
  if (left.hash !== right.hash || serializeWorld(left) !== serializeWorld(right)) {
    fail(seeds[0], determinismTurns, '同seed重放不确定');
  }
}

const sortedTimings = [...timings].sort((left, right) => left - right);
const p95Index = Math.max(0, Math.ceil(sortedTimings.length * 0.95) - 1);
const p95 = sortedTimings[p95Index] ?? 0;
const maximumSave = samples.reduce((maximum, sample) => Math.max(maximum, sample.saveMiB), 0);
if (samples.reduce((sum, sample) => sum + sample.importedExposures, 0) === 0) {
  failures.push('全局: 多世界样本没有疾病沿实际流量产生任何输入暴露');
}
if (samples.reduce((sum, sample) => sum + sample.diseaseImportEvents, 0) === 0) {
  failures.push('全局: 多世界样本没有疾病沿实际流量输入的史事');
}
if (samples.reduce((sum, sample) => sum + sample.practicePrototypes, 0) === 0) {
  failures.push('全局: 多世界样本没有自然形成任何地方实践原型');
}
if (samples.reduce((sum, sample) => sum + sample.tradeTreatyEvents, 0) === 0) {
  failures.push('全局: 多世界样本没有由真实成交形成任何贸易协定');
}
if (p95 > maximumP95Milliseconds) {
  failures.push(`全局: P95 ${p95.toFixed(3)}ms 超过 ${maximumP95Milliseconds}ms`);
}

console.log(JSON.stringify({
  audit: 'V0.3 multi-seed release gate',
  config: { seeds: seeds.length, turns, determinismTurns, maximumP95Milliseconds, maximumSaveMiB },
  metrics: {
    ticks: timings.length,
    p50Ms: Number((sortedTimings[Math.max(0, Math.ceil(sortedTimings.length * 0.5) - 1)] ?? 0).toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    maxMs: Number((sortedTimings.at(-1) ?? 0).toFixed(3)),
    maximumSaveMiB: maximumSave,
  },
  samples,
  failures: failures.slice(0, 80),
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
