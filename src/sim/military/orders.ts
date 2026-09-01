import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import { stableCompare } from '../random';
import type {
  ArmyOrderDirective,
  ArmyOrderReason,
  ArmyOrderState,
  ArmyState,
  StateDelta,
  WarState,
  WorldState,
} from '../types';

type OrderPlan = Omit<ArmyOrderDirective, 'issuedTurn' | 'lastReviewedTurn' | 'provenance'>;

const ORDER_LABELS = {
  hold: '固守',
  advance: '进军',
  intercept: '截击',
  reinforce: '驰援',
  retreat: '撤退',
} as const;

const ORDER_REASON_LABELS: Readonly<Record<ArmyOrderReason, string>> = {
  peace_garrison: '战事已息，留营守备',
  war_goal: '奉命夺取本战目标',
  enemy_approach: '敌军已经逼近',
  frontline_support: '友军需要接应',
  defend_war_goal: '本方战守要地受威胁',
  amphibious_landing: '陆路不通，改由水师送登陆岸',
  low_readiness: '军粮或军心不足以续战',
  target_invalid: '原定目标已经失效',
};

export function pathBetween(
  world: WorldState,
  startId: string,
  goalId: string,
  allowedControllers?: ReadonlySet<string>,
): string[] | null {
  if (startId === goalId) return [startId];
  const queue = [startId];
  const parent = new Map<string, string | null>([[startId, null]]);
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    const current = world.regions.find((region) => region.id === currentId);
    if (!current) continue;
    for (const neighborId of [...current.neighbors].sort(stableCompare)) {
      if (parent.has(neighborId)) continue;
      const neighbor = world.regions.find((region) => region.id === neighborId);
      if (!neighbor || (allowedControllers && !allowedControllers.has(neighbor.controllerId))) continue;
      parent.set(neighborId, currentId);
      if (neighborId === goalId) {
        const path = [goalId];
        let cursor: string | null = currentId;
        while (cursor) {
          path.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighborId);
    }
  }
  return null;
}

function directive(order: ArmyOrderState): ArmyOrderDirective {
  const { sourceFactId: _sourceFactId, ...result } = order;
  void _sourceFactId;
  return { ...result };
}

function samePlan(order: ArmyOrderState, next: OrderPlan): boolean {
  const tracksSameArmy = order.targetArmyId !== null && order.targetArmyId === next.targetArmyId;
  return order.kind === next.kind
    && order.warId === next.warId
    && order.issuerId === next.issuerId
    // Intercept and reinforcement paths follow the target army's live region.
    // Reissuing the same order whenever that army moves would reset issuedTurn
    // every quarter and make the order impossible to execute.
    && (tracksSameArmy || order.targetRegionId === next.targetRegionId)
    && order.targetArmyId === next.targetArmyId
    && order.status === next.status
    && order.reasonCode === next.reasonCode;
}

function pathLength(
  world: WorldState,
  army: ArmyState,
  regionId: string,
  allowed: ReadonlySet<string>,
): number {
  return pathBetween(world, army.regionId, regionId, allowed)?.length ?? Number.POSITIVE_INFINITY;
}

function enemyIdFor(war: WarState, polityId: string): string {
  return war.attackerId === polityId ? war.defenderId : war.attackerId;
}

function seaDistanceBetweenPorts(world: WorldState, originRegionId: string, targetRegionId: string): number {
  const originZoneIds = world.portLinks
    .filter((link) => link.regionId === originRegionId)
    .map((link) => link.seaZoneId)
    .sort(stableCompare);
  const targetZoneIds = new Set(world.portLinks
    .filter((link) => link.regionId === targetRegionId)
    .map((link) => link.seaZoneId));
  if (originZoneIds.some((zoneId) => targetZoneIds.has(zoneId))) return 0;
  const queue = originZoneIds.map((zoneId) => ({ zoneId, distance: 0 }));
  const visited = new Set(originZoneIds);
  while (queue.length > 0) {
    const current = queue.shift() as { zoneId: string; distance: number };
    const adjacent = world.seaLanes
      .flatMap((lane) => lane.fromSeaZoneId === current.zoneId
        ? [lane.toSeaZoneId]
        : lane.toSeaZoneId === current.zoneId ? [lane.fromSeaZoneId] : [])
      .sort(stableCompare);
    for (const zoneId of adjacent) {
      if (visited.has(zoneId)) continue;
      if (targetZoneIds.has(zoneId)) return current.distance + 1;
      visited.add(zoneId);
      queue.push({ zoneId, distance: current.distance + 1 });
    }
  }
  return Number.POSITIVE_INFINITY;
}

function amphibiousApproach(world: WorldState, army: ArmyState, war: WarState): {
  stagingRegionId: string;
  targetRegionId: string;
} | null {
  const enemyId = enemyIdFor(war, army.polityId);
  const enemy = world.polities.find((polity) => polity.id === enemyId);
  const ownPorts = world.regions
    .filter((region) => region.controllerId === army.polityId && region.port)
    .map((region) => ({
      region,
      landDistance: pathLength(world, army, region.id, new Set([army.polityId])),
      readyFleet: world.fleets.some((fleet) => (
        fleet.polityId === army.polityId
        && fleet.homePortRegionId === region.id
        && fleet.transports * 1_000 >= army.soldiers
      )),
      homeFleet: world.fleets.some((fleet) => (
        fleet.polityId === army.polityId && fleet.homePortRegionId === region.id
      )),
    }))
    .filter(({ landDistance }) => Number.isFinite(landDistance));
  const enemyPorts = world.regions.filter((region) => region.controllerId === enemyId && region.port);
  const goalPorts = enemyPorts.filter((region) => war.targetRegionIds.includes(region.id));
  const targetPorts = goalPorts.length > 0 ? goalPorts : enemyPorts;
  return ownPorts
    .flatMap((origin) => targetPorts.map((target) => ({
      origin,
      target,
      seaDistance: seaDistanceBetweenPorts(world, origin.region.id, target.id),
      targetPriority: (war.targetRegionIds.includes(target.id) ? 80 : 0)
        + (target.id === enemy?.capitalRegionId ? 32 : 0)
        + target.strategicValue * 4 + target.cityLevel * 2,
    })))
    .filter(({ seaDistance }) => Number.isFinite(seaDistance))
    .sort((left, right) => Number(right.origin.readyFleet) - Number(left.origin.readyFleet)
      || Number(right.origin.homeFleet) - Number(left.origin.homeFleet)
      || left.origin.landDistance - right.origin.landDistance
      || left.seaDistance - right.seaDistance
      || right.targetPriority - left.targetPriority
      || stableCompare(left.origin.region.id, right.origin.region.id)
      || stableCompare(left.target.id, right.target.id))
    .map(({ origin, target }) => ({
      stagingRegionId: origin.region.id,
      targetRegionId: target.id,
    }))[0] ?? null;
}

function targetForWar(world: WorldState, army: ArmyState, war: WarState): string | null {
  const enemyId = enemyIdFor(war, army.polityId);
  const enemy = world.polities.find((polity) => polity.id === enemyId);
  const allowed = new Set([army.polityId, enemyId]);
  const enemyRegions = world.regions.filter((region) => region.controllerId === enemyId);
  const goalRegions = enemyRegions.filter((region) => war.targetRegionIds.includes(region.id));
  const reachableGoals = goalRegions.filter((region) => (
    Number.isFinite(pathLength(world, army, region.id, allowed))
  ));
  const rankedLandTarget = (candidates: typeof enemyRegions) => candidates
    .map((region) => ({
      id: region.id,
      distance: pathLength(world, army, region.id, allowed),
      priority: (war.targetRegionIds.includes(region.id) ? 80 : 0)
        + (region.id === enemy?.capitalRegionId ? 32 : 0)
        + region.strategicValue * 4 + region.cityLevel * 2,
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance
      || right.priority - left.priority || stableCompare(left.id, right.id))[0]?.id;
  const goalTarget = rankedLandTarget(reachableGoals);
  if (goalTarget) return goalTarget;
  const amphibiousTarget = amphibiousApproach(world, army, war)?.targetRegionId;
  if (goalRegions.length > 0 && amphibiousTarget) return amphibiousTarget;
  return rankedLandTarget(enemyRegions) ?? amphibiousTarget ?? null;
}

function defendedWarGoal(world: WorldState, army: ArmyState, war: WarState): string | null {
  const allowed = new Set([army.polityId]);
  return war.targetRegionIds
    .map((id) => world.regions.find((region) => region.id === id))
    .filter((region): region is WorldState['regions'][number] => region?.controllerId === army.polityId)
    .map((region) => ({ region, distance: pathLength(world, army, region.id, allowed) }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance || stableCompare(left.region.id, right.region.id))[0]?.region.id ?? null;
}

function warForArmy(world: WorldState, army: ArmyState): WarState | null {
  return world.wars
    .filter((war) => war.active && (war.attackerId === army.polityId || war.defenderId === army.polityId))
    .map((war) => {
      const targetId = targetForWar(world, army, war);
      const enemyId = enemyIdFor(war, army.polityId);
      return {
        war,
        distance: targetId ? pathLength(world, army, targetId, new Set([army.polityId, enemyId])) : Number.POSITIVE_INFINITY,
      };
    })
    .sort((left, right) => left.distance - right.distance || stableCompare(left.war.id, right.war.id))[0]?.war ?? null;
}

function retreatTarget(world: WorldState, army: ArmyState): string {
  const polity = world.polities.find((candidate) => candidate.id === army.polityId);
  const allowed = new Set([army.polityId]);
  return world.regions
    .filter((region) => region.controllerId === army.polityId)
    .map((region) => ({
      region,
      distance: pathLength(world, army, region.id, allowed),
      score: (region.id === polity?.capitalRegionId ? 45 : 0) + region.defense * 2
        + Math.min(40, region.food / Math.max(1, region.population) * 12),
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => right.score - left.score || left.distance - right.distance
      || stableCompare(left.region.id, right.region.id))[0]?.region.id ?? army.regionId;
}

function closestEnemyArmy(world: WorldState, army: ArmyState, war: WarState) {
  const enemyId = enemyIdFor(war, army.polityId);
  const allowed = new Set([army.polityId, enemyId]);
  return world.armies
    .filter((candidate) => candidate.polityId === enemyId && !candidate.embarkedOperationId)
    .map((candidate) => ({ candidate, distance: pathLength(world, army, candidate.regionId, allowed) }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance
      || stableCompare(left.candidate.id, right.candidate.id))[0] ?? null;
}

function primaryArmy(world: WorldState, army: ArmyState, war: WarState, targetRegionId: string) {
  const enemyId = enemyIdFor(war, army.polityId);
  const allowed = new Set([army.polityId, enemyId]);
  return world.armies
    .filter((candidate) => candidate.polityId === army.polityId && !candidate.embarkedOperationId)
    .map((candidate) => ({ candidate, distance: pathLength(world, candidate, targetRegionId, allowed) }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance
      || right.candidate.soldiers - left.candidate.soldiers
      || stableCompare(left.candidate.id, right.candidate.id))[0]?.candidate ?? army;
}

function plan(kind: OrderPlan['kind'], army: ArmyState, input: {
  warId?: string | null;
  targetRegionId?: string | null;
  targetArmyId?: string | null;
  status?: OrderPlan['status'];
  reasonCode: ArmyOrderReason;
}): OrderPlan {
  return {
    kind,
    warId: input.warId ?? null,
    issuerId: army.commanderId,
    targetRegionId: input.targetRegionId ?? null,
    targetArmyId: input.targetArmyId ?? null,
    status: input.status ?? 'active',
    reasonCode: input.reasonCode,
  };
}

function desiredPlan(world: WorldState, army: ArmyState): OrderPlan {
  const war = warForArmy(world, army);
  if (!war) return plan('hold', army, { targetRegionId: army.regionId, reasonCode: 'peace_garrison' });
  if (army.supply < 30 || army.morale < 28) {
    const targetRegionId = retreatTarget(world, army);
    return targetRegionId === army.regionId
      ? plan('hold', army, { warId: war.id, targetRegionId, reasonCode: 'low_readiness' })
      : plan('retreat', army, { warId: war.id, targetRegionId, reasonCode: 'low_readiness' });
  }
  const defensiveGoalId = war.defenderId === army.polityId ? defendedWarGoal(world, army, war) : null;
  if (defensiveGoalId) {
    return defensiveGoalId === army.regionId
      ? plan('hold', army, { warId: war.id, targetRegionId: army.regionId, reasonCode: 'defend_war_goal' })
      : plan('reinforce', army, { warId: war.id, targetRegionId: defensiveGoalId, reasonCode: 'defend_war_goal' });
  }
  const targetRegionId = targetForWar(world, army, war);
  if (!targetRegionId) {
    return plan('hold', army, { warId: war.id, targetRegionId: army.regionId, reasonCode: 'target_invalid' });
  }
  const reachable = pathBetween(
    world,
    army.regionId,
    targetRegionId,
    new Set([army.polityId, enemyIdFor(war, army.polityId)]),
  );
  if (!reachable) {
    const approach = amphibiousApproach(world, army, war);
    if (!approach) {
      return plan('hold', army, { warId: war.id, targetRegionId: army.regionId, reasonCode: 'target_invalid' });
    }
    return approach.stagingRegionId === army.regionId
      ? plan('advance', army, {
        warId: war.id,
        targetRegionId: approach.targetRegionId,
        status: 'blocked',
        reasonCode: 'amphibious_landing',
      })
      : plan('advance', army, {
        warId: war.id,
        targetRegionId: approach.stagingRegionId,
        reasonCode: 'amphibious_landing',
      });
  }
  const enemy = closestEnemyArmy(world, army, war);
  if (enemy && enemy.distance <= 3 && army.soldiers >= enemy.candidate.soldiers * 0.72) {
    return plan('intercept', army, {
      warId: war.id,
      targetRegionId: enemy.candidate.regionId,
      targetArmyId: enemy.candidate.id,
      reasonCode: 'enemy_approach',
    });
  }
  const primary = primaryArmy(world, army, war, targetRegionId);
  if (primary.id !== army.id && primary.regionId !== army.regionId) {
    const path = pathBetween(world, army.regionId, primary.regionId, new Set([army.polityId]));
    if (path) return plan('reinforce', army, {
      warId: war.id,
      targetRegionId: primary.regionId,
      targetArmyId: primary.id,
      reasonCode: 'frontline_support',
    });
  }
  return plan('advance', army, {
    warId: war.id,
    targetRegionId,
    status: 'active',
    reasonCode: 'war_goal',
  });
}

function issueOrder(
  world: WorldState,
  context: FactTurnBuffer,
  army: ArmyState,
  nextPlan: OrderPlan,
): void {
  const previous = directive(army.order);
  const next: ArmyOrderDirective = {
    ...nextPlan,
    issuedTurn: context.turn,
    lastReviewedTurn: context.turn,
    provenance: 'fact',
  };
  const previousTarget = previous.targetRegionId
    ? world.regions.find((region) => region.id === previous.targetRegionId)?.name ?? previous.targetRegionId
    : '原地';
  const nextTarget = next.targetRegionId
    ? world.regions.find((region) => region.id === next.targetRegionId)?.name ?? next.targetRegionId
    : '原地';
  const issuerName = world.characters.find((character) => character.id === next.issuerId)?.name ?? '军中主帅';
  const actualName = world.characters.find((character) => character.id === army.allegiance.characterId)?.name ?? issuerName;
  const fact = emitSimulationFact(world, context, {
    kind: 'army_order_changed',
    category: '军事',
    importance: next.kind === 'retreat' || next.kind === 'intercept' ? 2 : 1,
    actorIds: [next.issuerId, army.allegiance.characterId],
    polityIds: [army.polityId],
    regionIds: [army.regionId, ...(next.targetRegionId ? [next.targetRegionId] : [])],
    causes: [
      { label: '下令者', role: '结构', weight: 0.3, evidence: `${issuerName}依法统领${army.name}` },
      { label: '承行者', role: '条件', weight: 0.25, evidence: `${actualName}获军中拥戴${army.allegiance.strength}` },
      { label: '改令缘由', role: '选择', weight: 0.25, evidence: `${previousTarget}方向的旧令因“${ORDER_REASON_LABELS[next.reasonCode]}”而复核` },
      { label: '新令去向', role: '结果', weight: 0.2, evidence: `${ORDER_LABELS[next.kind]}${nextTarget}${next.status === 'blocked' ? '，但道路受阻' : ''}` },
    ],
    stateDeltas: ([
      ['order.kind', previous.kind, next.kind],
      ['order.warId', previous.warId, next.warId],
      ['order.issuerId', previous.issuerId, next.issuerId],
      ['order.targetRegionId', previous.targetRegionId, next.targetRegionId],
      ['order.targetArmyId', previous.targetArmyId, next.targetArmyId],
      ['order.status', previous.status, next.status],
      ['order.reasonCode', previous.reasonCode, next.reasonCode],
    ] as const).filter(([, before, after]) => before !== after).map(([field, before, after]) => ({
      entityType: 'army' as const,
      entityId: army.id,
      field,
      before,
      after,
    } satisfies StateDelta)),
    // The payload already records the superseded directive. Chaining every
    // order Fact to its predecessor would keep an army's entire order history
    // in the hot archive through the current order pin.
    sourceFactIds: [],
    payload: { armyId: army.id, polityId: army.polityId, previous, next },
  });
  army.order = { ...next, sourceFactId: fact.id };
}

export function planArmyOrders(world: WorldState, context: FactTurnBuffer): void {
  for (const army of [...world.armies].sort((left, right) => stableCompare(left.id, right.id))) {
    if (army.embarkedOperationId) {
      const reissued: OrderPlan = {
        kind: army.order.kind,
        warId: army.order.warId,
        issuerId: army.commanderId,
        targetRegionId: army.order.targetRegionId,
        targetArmyId: army.order.targetArmyId,
        status: army.order.status,
        reasonCode: army.order.reasonCode,
      };
      if (!samePlan(army.order, reissued)) issueOrder(world, context, army, reissued);
      else army.order.lastReviewedTurn = context.turn;
      continue;
    }
    const next = desiredPlan(world, army);
    if (samePlan(army.order, next)) {
      army.order.lastReviewedTurn = context.turn;
      continue;
    }
    issueOrder(world, context, army, next);
  }
}

export function issueAmphibiousArmyOrder(
  world: WorldState,
  context: FactTurnBuffer,
  army: ArmyState,
  warId: string,
  targetRegionId: string,
): void {
  const next = plan('advance', army, {
    warId,
    targetRegionId,
    status: 'active',
    reasonCode: 'amphibious_landing',
  });
  if (!samePlan(army.order, next)) issueOrder(world, context, army, next);
  else army.order.lastReviewedTurn = context.turn;
}

export function armyOrderPath(world: WorldState, army: ArmyState): string[] | null {
  const order = army.order;
  if (order.kind === 'hold' || order.status === 'blocked') return null;
  const targetRegionId = order.targetArmyId
    ? world.armies.find((candidate) => candidate.id === order.targetArmyId)?.regionId ?? order.targetRegionId
    : order.targetRegionId;
  if (!targetRegionId) return null;
  if (order.kind === 'retreat' || order.kind === 'reinforce') {
    return pathBetween(world, army.regionId, targetRegionId, new Set([army.polityId]));
  }
  const war = order.warId ? world.wars.find((candidate) => candidate.id === order.warId && candidate.active) : null;
  if (!war) return null;
  return pathBetween(world, army.regionId, targetRegionId, new Set([army.polityId, enemyIdFor(war, army.polityId)]));
}

export function armyOrderIsExecutable(army: ArmyState, warId: string, turn: number): boolean {
  return army.order.warId === warId
    && army.order.kind !== 'hold'
    && army.order.status === 'active'
    && army.order.issuedTurn < turn;
}

export function armyOrderFactIds(armies: readonly ArmyState[]): string[] {
  return [...new Set(armies.flatMap((army) => army.order.sourceFactId ? [army.order.sourceFactId] : []))]
    .sort(stableCompare);
}
