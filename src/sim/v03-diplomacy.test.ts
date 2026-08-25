import { describe, expect, it } from 'vitest';
import { createWorld } from './engine';
import type {
  CommodityStock,
  DiplomacyState,
  HistoryEvent,
  ShipmentRecord,
  WorldState,
} from './types';
import type { V03Emit, V03TurnContext } from './v03-context';
import { processV03Diplomacy, v03DiplomaticPower } from './v03-diplomacy';

const blankStock = (): CommodityStock => ({ 木材: 0, 铁器: 0, 马匹: 0, 盐: 0, 纺织品: 0, 奢侈品: 0 });

function contextFor(world: WorldState, turn = world.turn, season = world.season): V03TurnContext {
  return {
    turn,
    year: Math.floor(turn / 4) + 1,
    season,
    events: [],
    population: { start: 0, births: 0, civilianDeaths: 0, militaryDeaths: 0, recruited: 0, demobilized: 0, end: 0 },
    food: { start: 0, produced: 0, civilianConsumed: 0, armyConsumed: 0, spoiled: 0, warDestroyed: 0, transferred: 0, end: 0 },
    wealth: { start: 0, produced: 0, householdConsumed: 0, warDestroyed: 0, taxed: 0, militaryPayments: 0, end: 0 },
    logistics: { remoteFoodTransferred: 0, routeUsage: [], seaUsage: [] },
    trade: { shipments: [], stockStart: blankStock(), stockEnd: blankStock(), produced: {}, consumed: {}, lost: {}, valueTransferred: 0, tariffsTransferred: 0 },
    migration: { departed: 0, arrived: 0, travelDeaths: 0, settled: 0, flowIds: [] },
    health: { infectiousStart: 0, newExposures: 0, importedExposures: 0, civilianDeaths: 0, militaryDeaths: 0, infectiousEnd: 0, outbreakRegionIds: [] },
    knowledge: { prototypeIds: [], adoptedIds: [], spreadIds: [], lostIds: [] },
    maritime: { fleetIds: [], blockadedPortIds: [], raidedShipmentIds: [], landingOperationIds: [], shipsLost: 0 },
    routeCapacityReserved: {},
    seaCapacityReserved: {},
    commodityStart: {},
  };
}

function emitter(events: HistoryEvent[], context: V03TurnContext): V03Emit {
  return (input) => {
    const event: HistoryEvent = {
      id: `unit_event_${events.length + 1}`,
      turn: context.turn,
      year: context.year,
      season: context.season,
      category: input.category,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      importance: input.importance,
      actorIds: input.actorIds ?? [],
      polityIds: input.polityIds ?? [],
      regionIds: input.regionIds ?? [],
      causes: input.causes,
      evidence: input.evidence ?? input.causes.map((cause) => cause.evidence),
      stateDeltas: input.stateDeltas ?? [],
    };
    events.push(event);
    context.events.push(event);
    return event;
  };
}

function firstRelation(world: WorldState): {
  relation: DiplomacyState;
  left: WorldState['polities'][number];
  right: WorldState['polities'][number];
  leftRegion: WorldState['regions'][number];
  rightRegion: WorldState['regions'][number];
} {
  const relation = world.diplomacy[0] as DiplomacyState;
  const left = world.polities.find((polity) => polity.id === relation.polityAId) as WorldState['polities'][number];
  const right = world.polities.find((polity) => polity.id === relation.polityBId) as WorldState['polities'][number];
  const leftRegion = world.regions.find((region) => region.controllerId === left.id) as WorldState['regions'][number];
  const rightRegion = world.regions.find((region) => region.controllerId === right.id) as WorldState['regions'][number];
  return { relation, left, right, leftRegion, rightRegion };
}

function tradeShipment(originRegionId: string, destinationRegionId: string): ShipmentRecord {
  return {
    id: 'shipment_trade_evidence',
    kind: '贸易',
    commodity: '盐',
    originRegionId,
    destinationRegionId,
    acceptedAmount: 500,
    deliveredAmount: 500,
    lostAmount: 0,
    raidedAmount: 0,
    peopleDeparted: 0,
    peopleArrived: 0,
    peopleLost: 0,
    contactVolume: 500,
    legs: [],
    carrierArmyId: null,
    carrierFleetId: null,
    value: 60_000,
    tariff: 600,
    status: '交付',
  };
}

describe('V0.3 material diplomacy', () => {
  it('forms a trade treaty only from delivered bilateral trade and keeps structured evidence', () => {
    const world = createWorld('v03-diplomacy-trade');
    const { relation, leftRegion, rightRegion } = firstRelation(world);
    relation.tradeDependency = 62;
    relation.trust = 68;
    relation.grievance = 4;
    const context = contextFor(world);
    context.trade.shipments.push(tradeShipment(leftRegion.id, rightRegion.id));
    const events: HistoryEvent[] = [];

    processV03Diplomacy(world, context, emitter(events, context));

    expect(relation.tradeAgreementUntilTurn).toBe(context.turn + 16);
    const formed = events.find((event) => event.kind === 'trade_treaty_formed');
    expect(formed?.causes.every((cause) => (cause.refs?.length ?? 0) > 0)).toBe(true);
    expect(formed?.causes.flatMap((cause) => cause.refs ?? []).some((ref) => ref.entityId === 'shipment_trade_evidence')).toBe(true);

    const counterfactual = createWorld('v03-diplomacy-trade-none');
    const other = firstRelation(counterfactual).relation;
    other.tradeDependency = 90;
    other.trust = 90;
    other.grievance = 0;
    const noTradeContext = contextFor(counterfactual);
    processV03Diplomacy(counterfactual, noTradeContext, emitter([], noTradeContext));
    expect(other.tradeAgreementUntilTurn).toBeNull();
  });

  it('pays tribute as an exactly conserved quarterly treasury transfer and punishes default', () => {
    const world = createWorld('v03-diplomacy-tribute');
    const { relation, left: payer, right: receiver } = firstRelation(world);
    relation.status = '朝贡';
    relation.tributePayerId = payer.id;
    relation.tributePerTurn = 240;
    relation.lastChangedTurn = 0;
    payer.treasury = 1_000;
    receiver.treasury = 2_000;
    const treasuryBefore = payer.treasury + receiver.treasury;
    const context = contextFor(world, 1, '夏');
    const events: HistoryEvent[] = [];

    processV03Diplomacy(world, context, emitter(events, context));

    expect(payer.treasury).toBe(760);
    expect(receiver.treasury).toBe(2_240);
    expect(payer.treasury + receiver.treasury).toBe(treasuryBefore);
    expect(events.some((event) => event.kind === 'tribute_paid')).toBe(true);

    const defaulting = createWorld('v03-diplomacy-default');
    const parties = firstRelation(defaulting);
    parties.relation.status = '朝贡';
    parties.relation.tributePayerId = parties.left.id;
    parties.relation.tributePerTurn = 500;
    parties.relation.lastChangedTurn = 0;
    parties.left.treasury = 120;
    parties.right.treasury = 900;
    const defaultBefore = parties.left.treasury + parties.right.treasury;
    const reputationBefore = parties.left.diplomaticReputation;
    const defaultContext = contextFor(defaulting, 1, '夏');
    const defaultEvents: HistoryEvent[] = [];
    processV03Diplomacy(defaulting, defaultContext, emitter(defaultEvents, defaultContext));
    expect(parties.left.treasury + parties.right.treasury).toBe(defaultBefore);
    expect(parties.relation.status).toBe('中立');
    expect(parties.relation.tributePayerId).toBeNull();
    expect(parties.left.diplomaticReputation).toBeLessThan(reputationBefore);
    expect(defaultEvents.find((event) => event.kind === 'tribute_breached')?.causes.every((cause) => (cause.refs?.length ?? 0) > 0)).toBe(true);
  });

  it('creates and later releases tribute only when causal power and pressure thresholds cross', () => {
    const world = createWorld('v03-diplomacy-formation');
    const { relation, left: strong, right: weak } = firstRelation(world);
    for (const other of world.diplomacy) other.status = other.id === relation.id ? '中立' : '联盟';
    for (const region of world.regions) {
      if (region.controllerId === strong.id) {
        region.population *= 8;
        region.wealth *= 6;
      } else if (region.controllerId === weak.id) {
        region.population = Math.max(1_000, Math.round(region.population * 0.08));
        region.wealth = Math.round(region.wealth * 0.08);
        region.unrest = 90;
      }
    }
    strong.authority = 100;
    weak.authority = 4;
    weak.administration = 4;
    weak.treasury = 0;
    weak.warWeariness = 100;
    relation.threatAtoB = 100;
    const context = contextFor(world, 3, '冬');
    const events: HistoryEvent[] = [];

    expect(v03DiplomaticPower(world, strong.id)).toBeGreaterThan(v03DiplomaticPower(world, weak.id) * 2.15);
    processV03Diplomacy(world, context, emitter(events, context));
    expect(relation.status).toBe('朝贡');
    expect(relation.tributePayerId).toBe(weak.id);
    expect(events.find((event) => event.kind === 'tribute_imposed')?.causes.every((cause) => (cause.refs?.length ?? 0) > 0)).toBe(true);

    // Eight quarters later the former payer has recovered and coercive threat is gone.
    for (const region of world.regions) {
      if (region.controllerId === weak.id) {
        region.population *= 1_000;
        region.wealth *= 1_000;
      } else if (region.controllerId === strong.id) {
        region.population = 1_000;
        region.wealth = 0;
      }
    }
    relation.threatAtoB = 20;
    relation.threatBtoA = 20;
    const releaseContext = contextFor(world, 11, '冬');
    processV03Diplomacy(world, releaseContext, emitter(events, releaseContext));
    expect(relation.status).toBe('中立');
    expect(events.some((event) => event.kind === 'tribute_ended')).toBe(true);
  });

  it('clears a former tribute obligation when war begins and bounds treaty evidence', () => {
    const world = createWorld('v03-diplomacy-war-clears-tribute');
    const { relation, left, right } = firstRelation(world);
    relation.status = '战争';
    relation.tributePayerId = left.id;
    relation.tributePerTurn = 360;
    relation.treatyEventIds = Array.from({ length: 20 }, (_, index) => `old_treaty_${index}`);
    const context = contextFor(world, 4, '春');
    const events: HistoryEvent[] = [];

    processV03Diplomacy(world, context, emitter(events, context));

    expect(relation.status).toBe('战争');
    expect(relation.tributePayerId).toBeNull();
    expect(relation.tributePerTurn).toBe(0);
    expect(relation.treatyEventIds.length).toBeLessThanOrEqual(12);
    expect(relation.treatyEventIds.at(-1)).toBe(events.find((event) => event.kind === 'tribute_ended_by_war')?.id);
    const ended = events.find((event) => event.kind === 'tribute_ended_by_war');
    expect(ended?.polityIds).toEqual(expect.arrayContaining([left.id, right.id]));
    expect(ended?.causes.every((cause) => (cause.refs?.length ?? 0) > 0)).toBe(true);

    for (const item of world.diplomacy) {
      if (item.status === '朝贡') {
        expect([item.polityAId, item.polityBId]).toContain(item.tributePayerId);
        expect(item.tributePerTurn).toBeGreaterThan(0);
      } else {
        expect(item.tributePayerId).toBeNull();
        expect(item.tributePerTurn).toBe(0);
      }
      expect(item.treatyEventIds.length).toBeLessThanOrEqual(12);
    }
  });
});
