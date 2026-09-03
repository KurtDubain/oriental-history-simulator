import { armyOrderPath } from '../sim/military/orders';
import type { ArmyOrderKind, ArmyState, FactionState, SimulationFact, WarState, WorldState } from '../sim/types';

const ORDER_LABEL: Readonly<Record<ArmyOrderKind, string>> = {
  hold: '留守',
  advance: '进攻',
  intercept: '截击',
  reinforce: '增援',
  retreat: '撤退',
};

export interface WarGroupArmyView {
  id: string;
  name: string;
  commanderId: string;
  commander: string;
  deputy: string | null;
  soldiers: number;
  regionId: string;
  region: string;
  order: string;
  posture: string;
  stepsToTarget: number | null;
  nextRegionId: string | null;
  nextRegion: string | null;
  commandDiverged: boolean;
  authorityNote: string;
}

export interface WarGroupPersonView {
  id: string;
  name: string;
  soldiers: number;
  formationId: string;
  formation: string;
  commander: string;
  region: string;
  status: string;
}

export interface WarGroupForceView {
  id: string;
  factionId: string | null;
  name: string;
  shortName: string;
  leaderId: string | null;
  leader: string;
  generalIds: readonly string[];
  generals: readonly string[];
  persons: readonly WarGroupPersonView[];
  armies: readonly WarGroupArmyView[];
  soldiers: number;
  lossesThisTurn: number;
  fronts: readonly string[];
  posture: string;
}

export interface WarSideForceView {
  polityId: string;
  polity: string;
  role: '攻方' | '守方';
  armyCount: number;
  soldiers: number;
  groups: readonly WarGroupForceView[];
}

export interface WarContactView {
  regionId: string;
  region: string;
  attackerArmyId: string;
  attacker: string;
  attackerCommander: string;
  attackerGroup: string;
  defenderArmyIds: readonly string[];
  defenders: string;
  defenderCommanders: string;
  defenderGroups: string;
  steps: number;
}

export interface WarBattleView {
  factId: string;
  eventId: string | null;
  regionId: string;
  region: string;
  attacker: string;
  attackerCommander: string;
  attackerGroup: string;
  defender: string;
  defenderCommanders: string;
  defenderGroups: string;
  attackerBefore: number;
  defenderBefore: number;
  attackerLosses: number;
  defenderLosses: number;
  result: string;
  aftermath: string;
}

export interface WarGroupProjection {
  warId: string;
  title: string;
  durationTurns: number;
  durationLabel: string;
  sides: readonly [WarSideForceView, WarSideForceView];
  mainFront: string;
  contacts: readonly WarContactView[];
  latestBattle: WarBattleView | null;
  armyIds: readonly string[];
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function personName(world: WorldState, id: string | null | undefined): string {
  return world.characters.find((item) => item.id === id)?.name ?? '无名将领';
}

function regionName(world: WorldState, id: string | null | undefined): string {
  return world.regions.find((item) => item.id === id)?.name ?? '战地未详';
}

function compactGroupName(name: string): string {
  return name.length <= 5 ? name : name.replace(/一系$|旧部$/, '').slice(0, 5);
}

/** Actual allegiance owns the army; lawful command is only the fallback. */
export function factionForArmy(world: WorldState, army: ArmyState): FactionState | null {
  const actual = world.characters.find((item) => (
    item.id === army.allegiance.characterId && item.alive && item.polityId === army.polityId
  ));
  const lawful = world.characters.find((item) => (
    item.id === army.commanderId && item.alive && item.polityId === army.polityId
  ));
  const factionId = actual?.factionId ?? lawful?.factionId ?? null;
  return world.factions.find((item) => item.id === factionId && item.active && item.polityId === army.polityId) ?? null;
}

function armyView(world: WorldState, army: ArmyState): WarGroupArmyView {
  const path = armyOrderPath(world, army);
  const nextRegionId = path?.[1] ?? null;
  const target = army.order.targetArmyId
    ? world.armies.find((item) => item.id === army.order.targetArmyId)?.regionId ?? army.order.targetRegionId
    : army.order.targetRegionId;
  const lawful = personName(world, army.commanderId);
  const actual = personName(world, army.allegiance.characterId);
  const commandDiverged = army.commanderId !== army.allegiance.characterId;
  return {
    id: army.id,
    name: army.name,
    commanderId: army.commanderId,
    commander: lawful,
    deputy: army.deputyCommanderId ? personName(world, army.deputyCommanderId) : null,
    soldiers: army.soldiers,
    regionId: army.regionId,
    region: regionName(world, army.regionId),
    order: `${ORDER_LABEL[army.order.kind]}${regionName(world, target ?? army.regionId)}${army.order.status === 'blocked' ? '（受阻）' : ''}`,
    posture: ORDER_LABEL[army.order.kind],
    stepsToTarget: path ? Math.max(0, path.length - 1) : null,
    nextRegionId,
    nextRegion: nextRegionId ? regionName(world, nextRegionId) : null,
    commandDiverged,
    authorityNote: commandDiverged ? `${lawful}掌令，但军中更听${actual}` : `${lawful}掌令，军中同听`,
  };
}

function battleFacts(world: WorldState, warId: string): Extract<SimulationFact, { kind: 'battle' }>[] {
  return world.facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'battle' }> => fact.kind === 'battle' && fact.payload.warId === warId)
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id));
}

function groupsForSide(
  world: WorldState,
  armies: readonly ArmyState[],
  facts: readonly Extract<SimulationFact, { kind: 'battle' }>[],
): WarGroupForceView[] {
  const latestTurn = world.lastTurn?.turn ?? world.turn;
  const buckets = new Map<string, { faction: FactionState | null; persons: WarGroupPersonView[]; armies: ArmyState[] }>();
  const armyById = new Map(armies.map((army) => [army.id, army]));
  for (const force of world.personalForces) {
    const army = force.formationId ? armyById.get(force.formationId) : undefined;
    const character = world.characters.find((item) => item.id === force.ownerId);
    if (!army || !character || force.soldiers <= 0) continue;
    const faction = world.factions.find((item) => item.id === character.factionId && item.active && item.polityId === army.polityId) ?? null;
    const key = faction?.id ?? `unaffiliated:${army.polityId}`;
    const bucket = buckets.get(key) ?? { faction, persons: [], armies: [] };
    bucket.persons.push({
      id: character.id,
      name: character.name,
      soldiers: force.soldiers,
      formationId: army.id,
      formation: army.name,
      commander: personName(world, army.commanderId),
      region: regionName(world, army.regionId),
      status: force.status,
    });
    buckets.set(key, bucket);
  }
  for (const army of armies) {
    const faction = factionForArmy(world, army);
    const key = faction?.id ?? `unaffiliated:${army.polityId}`;
    const bucket = buckets.get(key) ?? { faction, persons: [], armies: [] };
    bucket.armies.push(army);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([id, bucket]) => {
    const formationIds = new Set(bucket.persons.map((person) => person.formationId));
    const views = bucket.armies.map((army) => armyView(world, army));
    const postureCounts = new Map<string, number>();
    for (const person of bucket.persons) {
      const army = armyById.get(person.formationId);
      const posture = army ? ORDER_LABEL[army.order.kind] : '留守';
      postureCounts.set(posture, (postureCounts.get(posture) ?? 0) + person.soldiers);
    }
    const posture = [...postureCounts].sort((left, right) => right[1] - left[1] || stableCompare(left[0], right[0]))[0]?.[0] ?? '留守';
    const generalIds = bucket.persons.map((person) => person.id).sort(stableCompare);
    const fronts = [...new Set([...formationIds].map((armyId) => {
      const view = armyView(world, armyById.get(armyId)!);
      return view.nextRegion ?? view.region;
    }))].sort(stableCompare);
    const lossesThisTurn = facts.filter((fact) => fact.turn === latestTurn).reduce((sum, fact) => (
      sum + [fact.payload.attacker, ...fact.payload.defenders].flatMap((side) => side.participants ?? [])
        .filter((participant) => generalIds.includes(participant.characterId))
        .reduce((subtotal, participant) => subtotal + participant.losses, 0)
    ), 0);
    return {
      id,
      factionId: bucket.faction?.id ?? null,
      name: bucket.faction?.name ?? '未归集团',
      shortName: compactGroupName(bucket.faction?.name ?? '无系'),
      leaderId: bucket.faction?.leaderId ?? null,
      leader: bucket.faction ? personName(world, bucket.faction.leaderId) : '暂无首领',
      generalIds,
      generals: generalIds.map((characterId) => personName(world, characterId)),
      persons: bucket.persons.sort((left, right) => right.soldiers - left.soldiers || stableCompare(left.id, right.id)),
      armies: views.sort((left, right) => right.soldiers - left.soldiers || stableCompare(left.id, right.id)),
      soldiers: bucket.persons.reduce((sum, person) => sum + person.soldiers, 0),
      lossesThisTurn,
      fronts,
      posture,
    };
  }).sort((left, right) => right.soldiers - left.soldiers || stableCompare(left.id, right.id));
}

function factionNamesForFormation(world: WorldState, army: ArmyState): string[] {
  return [...new Set(world.personalForces.flatMap((force) => {
    if (force.formationId !== army.id || force.soldiers <= 0) return [];
    const factionId = world.characters.find((person) => person.id === force.ownerId)?.factionId;
    return [world.factions.find((faction) => faction.id === factionId && faction.active)?.name ?? '未归集团'];
  }))].sort(stableCompare);
}

function warArmies(world: WorldState, war: WarState): ArmyState[] {
  return world.armies.filter((army) => (
    army.soldiers > 0
    && [war.attackerId, war.defenderId].includes(army.polityId)
    && (army.order.warId === war.id || world.navalOperations.some((operation) => operation.warId === war.id && operation.armyId === army.id && !operation.completedTurn))
  )).sort((left, right) => stableCompare(left.id, right.id));
}

function contactsFor(world: WorldState, war: WarState, armies: readonly ArmyState[]): WarContactView[] {
  const result: WarContactView[] = [];
  for (const army of armies) {
    if (!['advance', 'intercept'].includes(army.order.kind)) continue;
    const path = armyOrderPath(world, army);
    if (!path || path.length < 2) continue;
    const enemyId = army.polityId === war.attackerId ? war.defenderId : war.attackerId;
    const pathIndex = new Map(path.map((id, index) => [id, index]));
    const defenders = armies
      .filter((item) => item.polityId === enemyId && pathIndex.has(item.regionId))
      .sort((left, right) => (pathIndex.get(left.regionId) ?? 99) - (pathIndex.get(right.regionId) ?? 99)
        || right.soldiers - left.soldiers || stableCompare(left.id, right.id));
    if (!defenders.length) continue;
    const regionId = defenders[0]?.regionId as string;
    const contactDefenders = defenders.filter((item) => item.regionId === regionId);
    const attackerFactions = factionNamesForFormation(world, army);
    const defenderFactions = [...new Set(contactDefenders.flatMap((item) => factionNamesForFormation(world, item)))].sort(stableCompare);
    result.push({
      regionId,
      region: regionName(world, regionId),
      attackerArmyId: army.id,
      attacker: army.name,
      attackerCommander: personName(world, army.commanderId),
      attackerGroup: attackerFactions.join('、') || '未归集团',
      defenderArmyIds: contactDefenders.map((item) => item.id),
      defenders: contactDefenders.map((item) => item.name).join('、'),
      defenderCommanders: contactDefenders.map((item) => personName(world, item.commanderId)).join('、'),
      defenderGroups: defenderFactions.join('、'),
      steps: Math.max(1, pathIndex.get(regionId) ?? 1),
    });
  }
  return result.sort((left, right) => stableCompare(left.regionId, right.regionId) || stableCompare(left.attackerArmyId, right.attackerArmyId));
}

function latestBattleView(
  world: WorldState,
  fact: Extract<SimulationFact, { kind: 'battle' }> | undefined,
): WarBattleView | null {
  if (!fact) return null;
  const attackerArmy = world.armies.find((item) => item.id === fact.payload.attacker.armyId);
  const attackerFactionNames = [...new Set((fact.payload.attacker.participants ?? [])
    .map((item) => world.factions.find((faction) => faction.id === item.factionId)?.name ?? '未归集团'))].sort(stableCompare);
  const defenderArmies = fact.payload.defenders.map((entry) => world.armies.find((item) => item.id === entry.armyId)).filter((item): item is ArmyState => Boolean(item));
  const defenderFactionNames = [...new Set(fact.payload.defenders.flatMap((entry) => entry.participants ?? [])
    .map((item) => world.factions.find((faction) => faction.id === item.factionId)?.name ?? '未归集团'))].sort(stableCompare);
  const attackerName = attackerArmy?.name ?? fact.payload.attacker.armyId;
  const defenderNames = defenderArmies.length ? defenderArmies.map((item) => item.name).join('、') : '地方守军';
  const won = fact.payload.attackerWon;
  const retreatRegions = [...new Set(defenderArmies.flatMap((army) => (
    army.recentMovement?.turn === fact.turn
    && army.recentMovement.fromRegionId === fact.payload.targetRegionId
    && army.recentMovement.orderKind === 'retreat'
      ? [regionName(world, army.recentMovement.toRegionId)]
      : []
  )))].sort(stableCompare);
  const aftermath = won
    ? `${attackerName}推进至${regionName(world, fact.payload.targetRegionId)}，守军${retreatRegions.length ? `退往${retreatRegions.join('、')}` : fact.payload.defenders.length ? '失去建制或撤离战场' : '未能阻止占领'}`
    : `${attackerName}未能突破，退守原阵地`;
  return {
    factId: fact.id,
    eventId: world.history.find((event) => event.sourceFactIds.includes(fact.id))?.id ?? null,
    regionId: fact.payload.targetRegionId,
    region: regionName(world, fact.payload.targetRegionId),
    attacker: attackerName,
    attackerCommander: personName(world, fact.payload.attacker.commanderId),
    attackerGroup: attackerFactionNames.join('、') || (attackerArmy ? factionNamesForFormation(world, attackerArmy).join('、') : '') || '未归集团',
    defender: defenderNames,
    defenderCommanders: fact.payload.defenders.map((item) => personName(world, item.commanderId)).join('、') || '地方守将',
    defenderGroups: defenderFactionNames.join('、'),
    attackerBefore: fact.payload.attacker.soldiersBefore,
    defenderBefore: fact.payload.defenders.reduce((sum, item) => sum + item.soldiersBefore, 0),
    attackerLosses: fact.payload.attacker.losses,
    defenderLosses: fact.payload.defenders.reduce((sum, item) => sum + item.losses, 0),
    result: won ? '攻方取胜' : '守方守住',
    aftermath,
  };
}

export function projectWarGroups(world: WorldState, warId: string): WarGroupProjection | null {
  const war = world.wars.find((item) => item.id === warId);
  if (!war) return null;
  const armies = warArmies(world, war);
  const facts = battleFacts(world, war.id);
  const side = (polityId: string, role: WarSideForceView['role']): WarSideForceView => {
    const sideArmies = armies.filter((army) => army.polityId === polityId);
    return {
      polityId,
      polity: world.polities.find((item) => item.id === polityId)?.name ?? polityId,
      role,
      armyCount: sideArmies.length,
      soldiers: sideArmies.reduce((sum, army) => sum + army.soldiers, 0),
      groups: groupsForSide(world, sideArmies, facts),
    };
  };
  const fronts = new Map<string, number>();
  for (const army of armies) {
    const path = armyOrderPath(world, army);
    const regionId = path?.[1] ?? army.order.targetRegionId ?? army.regionId;
    fronts.set(regionId, (fronts.get(regionId) ?? 0) + army.soldiers);
  }
  const mainFrontId = [...fronts].sort((left, right) => right[1] - left[1] || stableCompare(left[0], right[0]))[0]?.[0];
  const durationTurns = Math.max(1, (war.active ? world.turn : war.endedTurn ?? world.turn) - war.startedTurn);
  return {
    warId: war.id,
    title: `${world.polities.find((item) => item.id === war.attackerId)?.shortName ?? '攻方'}攻${world.polities.find((item) => item.id === war.defenderId)?.shortName ?? '守方'}`,
    durationTurns,
    durationLabel: `第${durationTurns}季`,
    sides: [side(war.attackerId, '攻方'), side(war.defenderId, '守方')],
    mainFront: regionName(world, mainFrontId),
    contacts: contactsFor(world, war, armies),
    latestBattle: latestBattleView(world, facts[0]),
    armyIds: armies.map((army) => army.id),
  };
}
