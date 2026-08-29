import type {
  InspectorRecord,
  RegionInspectorData,
  SystemInspectorData,
} from '../components/Inspector';
import type {
  HistoryEvent,
  RegionState,
  WorldState,
} from '../sim/types';

const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;

function turnLabel(turn: number) {
  const safeTurn = Math.max(0, Number.isFinite(turn) ? Math.floor(turn) : 0);
  return `第 ${Math.floor(safeTurn / 4) + 1} 年 · ${SEASON_NAMES[safeTurn % 4]}`;
}

function polity(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.polities.find((candidate) => candidate.id === id);
}

function character(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.characters.find((candidate) => candidate.id === id);
}

function region(world: WorldState, id: string | null | undefined) {
  if (!id) return undefined;
  return world.regions.find((candidate) => candidate.id === id);
}

function historyRecord(item: HistoryEvent): InspectorRecord {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    eventId: item.id,
    importance: item.importance,
  };
}

function scopedHistory(
  world: WorldState,
  predicate: (event: HistoryEvent) => boolean,
  limit = 8,
) {
  return world.history.filter(predicate).slice(-limit).reverse().map(historyRecord);
}

function foodSafetyRatio(item: RegionState) {
  return item.food / Math.max(1, item.population);
}

function systemHistory(world: WorldState, entityType: string, id: string): InspectorRecord[] {
  return scopedHistory(world, (event) => event.stateDeltas.some((delta) => delta.entityType === entityType && delta.entityId === id)
    || event.causes.some((cause) => cause.refs?.some((ref) => ref.entityType === entityType && ref.entityId === id)));
}

export function toSystemInspector(world: WorldState, kind: SystemInspectorData['kind'], id: string): SystemInspectorData | null {
  if (kind === 'seaZone') {
    const item = world.seaZones.find((candidate) => candidate.id === id);
    if (!item) return null;
    const controller = polity(world, item.controllerId);
    return { id, kind, name: item.name, subtitle: `${item.climate} · ${item.contested ? '列舰相争' : controller?.name ?? '无主海域'}`, summary: item.contested ? '多方投射在此交叠，护航、封锁与补给均承受额外风险。' : '海域控制尚有主次，商船流量与风浪共同塑造其价值。', facts: [{ label: '主导', value: controller?.name ?? '无' }, { label: '港口', value: `${item.portRegionIds.length}处` }, { label: '船流', value: compact.format(item.traffic) }, { label: '相邻海域', value: item.adjacentSeaZoneIds.length }], meters: [{ label: '风暴风险', value: item.stormRisk }, { label: '海盗压力', value: item.piracy }], links: item.portRegionIds.slice(0, 6).flatMap((regionId) => { const portRegion = region(world, regionId); return portRegion ? [{ id: portRegion.id, kind: 'region' as const, label: portRegion.name, detail: '通海港口', value: portRegion.portLevel }] : []; }), history: systemHistory(world, 'seaZone', id) };
  }
  if (kind === 'army') {
    const item = world.armies.find((candidate) => candidate.id === id);
    if (!item) return null;
    const owner = polity(world, item.polityId);
    const commander = character(world, item.commanderId);
    const deputy = character(world, item.deputyCommanderId);
    const stationed = region(world, item.regionId);
    const summary = item.supply < 35
      ? '粮道已很吃紧；继续行军或交战，减员会先于正面溃败到来。'
      : item.morale < 40
        ? '军心不稳；主帅威望、近期胜负和补给将决定这支军团能否维持建制。'
        : item.training >= 70 && item.experience >= 60
          ? '这是一支训练与战阵经验俱佳的常备军，真正的限制来自粮道、主帅和战场位置。'
          : '军团的战力由兵力、训练、军心与补给共同决定，人数并不等同于胜算。';
    return {
      id,
      kind,
      name: item.name,
      subtitle: `${owner?.name ?? '无属'} · ${stationed?.name ?? '驻地不详'}`,
      summary,
      facts: [
        { label: '主帅', value: commander?.name ?? '无帅' },
        { label: '副将', value: deputy?.name ?? '暂缺' },
        { label: '兵力', value: compact.format(item.soldiers) },
        { label: '军粮', value: compact.format(item.food) },
        { label: '本营', value: region(world, item.originRegionId)?.name ?? '不详' },
        { label: '最近移动', value: item.lastMovedTurn < 0 ? '尚未移营' : item.lastMovedTurn === world.turn ? '本季' : turnLabel(item.lastMovedTurn) },
      ],
      meters: [
        { label: '士气', value: item.morale },
        { label: '训练', value: item.training },
        { label: '战阵经验', value: item.experience },
        { label: '补给', value: item.supply },
      ],
      links: [
        commander ? { id: commander.id, kind: 'person' as const, label: commander.name, detail: '军团主帅' } : null,
        deputy ? { id: deputy.id, kind: 'person' as const, label: deputy.name, detail: '军团副将' } : null,
        stationed ? { id: stationed.id, kind: 'region' as const, label: stationed.name, detail: '当前驻地' } : null,
        owner ? { id: owner.id, kind: 'country' as const, label: owner.name, detail: '所属政权' } : null,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      history: systemHistory(world, 'army', id),
    };
  }
  if (kind === 'fleet') {
    const item = world.fleets.find((candidate) => candidate.id === id);
    if (!item) return null;
    const commander = character(world, item.commanderId);
    const zone = world.seaZones.find((candidate) => candidate.id === item.seaZoneId);
    return { id, kind, name: item.name, subtitle: `${polity(world, item.polityId)?.name ?? '无属'} · ${item.mission}`, summary: item.repairNeed > 55 ? '船体与索具急需入港修整，继续远航会迅速失去在场能力。' : '舰队以港口、粮饷和航海实践维持海上任务。', facts: [{ label: '主将', value: commander?.name ?? '无帅' }, { label: '所在', value: zone?.name ?? region(world, item.portRegionId)?.name ?? '航行中' }, { label: '战船', value: item.warships }, { label: '运输船', value: item.transports }, { label: '水手', value: compact.format(item.sailors) }, { label: '军粮', value: compact.format(item.food) }], meters: [{ label: '战备', value: item.readiness }, { label: '士气', value: item.morale }, { label: '修理需求', value: item.repairNeed }], links: [{ id: item.homePortRegionId, kind: 'region' as const, label: region(world, item.homePortRegionId)?.name ?? '母港', detail: '舰队母港' }, ...(zone ? [{ id: zone.id, kind: 'seaZone' as const, label: zone.name, detail: '当前海域' }] : [])], history: systemHistory(world, 'fleet', id) };
  }
  if (kind === 'tradeCorridor') {
    const item = world.tradeCorridors.find((candidate) => candidate.id === id);
    if (!item) return null;
    const from = region(world, item.originRegionId);
    const to = region(world, item.destinationRegionId);
    return { id, kind, name: `${from?.name ?? '起地'}—${to?.name ?? '讫地'}`, subtitle: `${item.commodity}商路 · ${item.active ? '通行中' : '已中断'}`, summary: item.risk >= 60 ? '损耗、劫掠或封锁正在侵蚀这条商路的利润。' : '货物与货款沿实际容量往来，利润进入港口、家族与政权账户。', facts: [{ label: '当季流量', value: compact.format(item.lastVolume) }, { label: '累计流量', value: compact.format(item.rollingVolume) }, { label: '累计利润', value: compact.format(item.rollingProfit) }, { label: '路径段', value: item.pathEdgeIds.length }], meters: [{ label: '通行风险', value: item.risk }], links: [from ? { id: from.id, kind: 'region' as const, label: from.name, detail: '货源地' } : null, to ? { id: to.id, kind: 'region' as const, label: to.name, detail: '到岸市场' } : null].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)), history: systemHistory(world, 'tradeCorridor', id) };
  }
  if (kind === 'practice') {
    const item = world.practices.find((candidate) => candidate.id === id);
    if (!item) return null;
    const states = world.practiceStates.filter((state) => state.practiceId === id && state.lostTurn === null).sort((a, b) => b.adoption - a.adoption);
    const stateIds = new Set(states.map((state) => state.id));
    const history = scopedHistory(world, (event) => event.stateDeltas.some((delta) => delta.entityType === 'practice' && (delta.entityId === id || stateIds.has(delta.entityId)))
      || event.causes.some((cause) => cause.refs?.some((ref) => ref.entityType === 'practice' && (ref.entityId === id || stateIds.has(ref.entityId)))));
    return { id, kind, name: item.name, subtitle: `${item.category}实践 · 自然发现与传播`, summary: item.description, facts: [{ label: '掌握地区', value: states.length }, { label: '最高采用', value: Math.round(states[0]?.adoption ?? 0) }, { label: '作用强度', value: Math.round(item.effectStrength) }, { label: '遗产基线', value: states.some((state) => state.legacyBaseline) ? '含旧档' : '否' }], meters: [{ label: '最高掌握', value: states[0]?.mastery ?? 0 }, { label: '最高采用', value: states[0]?.adoption ?? 0 }], links: states.slice(0, 6).flatMap((state) => { const knownRegion = region(world, state.regionId); return knownRegion ? [{ id: knownRegion.id, kind: 'region' as const, label: knownRegion.name, detail: `掌握 ${Math.round(state.mastery)} · 采用 ${Math.round(state.adoption)}`, value: Math.round(state.adoption) }] : []; }), history };
  }
  if (kind === 'outbreak') {
    const item = world.infections.find((candidate) => candidate.id === id);
    if (!item) return null;
    const pathogen = world.pathogens.find((candidate) => candidate.id === item.pathogenId);
    const hostLabel = item.hostKind === 'region' ? region(world, item.hostId)?.name : item.hostKind === 'fleet' ? world.fleets.find((candidate) => candidate.id === item.hostId)?.name : world.armies.find((candidate) => candidate.id === item.hostId)?.name;
    return { id, kind, name: pathogen?.name ?? '未识之疫', subtitle: `${hostLabel ?? '未知宿主'} · ${item.infectious > 0 ? '传播中' : '病势已息'}`, summary: item.infectious > 0 ? '当前感染来自本地接触与已记录的人员流动，不会跨越无接触的地域。' : '活跃病例已归零，但康复、免疫与传播记忆仍保留在档案中。', facts: [{ label: '易感', value: compact.format(item.susceptible) }, { label: '潜伏', value: compact.format(item.exposed) }, { label: '染病', value: compact.format(item.infectious) }, { label: '康复', value: compact.format(item.recovered) }, { label: '输入来源', value: item.recentSources.length }], meters: [{ label: '历史峰值', value: Math.min(100, item.peakInfectious / Math.max(1, item.susceptible + item.exposed + item.infectious + item.recovered) * 100) }], links: item.hostKind === 'region' ? [{ id: item.hostId, kind: 'region' as const, label: hostLabel ?? '疫区', detail: '当前宿主地区' }] : [], history: systemHistory(world, 'infection', id) };
  }
  const shipment = world.lastTurn?.trade.shipments.find((item) => item.id === id && item.kind === '迁徙');
  if (!shipment) return null;
  const from = region(world, shipment.originRegionId);
  const to = region(world, shipment.destinationRegionId);
  return { id, kind: 'migration', name: `${from?.name ?? '故土'}迁往${to?.name ?? '新地'}`, subtitle: `${shipment.status} · 当季人口流`, summary: shipment.peopleLost > 0 ? '途中风险造成了可核验的人员损失，幸存者已按到达与落籍分别入账。' : '迁徙沿已接受的路线容量发生，只改变人口所在，不凭空增减世界人口。', facts: [{ label: '启程', value: compact.format(shipment.peopleDeparted) }, { label: '抵达', value: compact.format(shipment.peopleArrived) }, { label: '途中死亡', value: compact.format(shipment.peopleLost) }, { label: '接触量', value: compact.format(shipment.contactVolume) }], links: [from ? { id: from.id, kind: 'region' as const, label: from.name, detail: '迁出地' } : null, to ? { id: to.id, kind: 'region' as const, label: to.name, detail: '目的地' } : null].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)), history: systemHistory(world, 'migration', id) };
}

export function toRegionInspector(world: WorldState, item: RegionState): RegionInspectorData {
  const owner = polity(world, item.controllerId);
  const governor = world.characters.find(
    (character) => character.alive && character.governedRegionId === item.id,
  );
  const resources = [item.river ? '河运' : null, item.port ? '港口' : null]
    .filter((value): value is string => Boolean(value));
  const related: NonNullable<RegionInspectorData['related']> = [];
  const seaLink = world.portLinks.find((link) => link.regionId === item.id);
  const seaZone = world.seaZones.find((zone) => zone.id === seaLink?.seaZoneId);
  if (seaZone) related.push({ id: seaZone.id, kind: 'seaZone', label: seaZone.name, detail: '相连海域' });
  for (const corridor of world.tradeCorridors.filter((entry) => entry.active && (entry.originRegionId === item.id || entry.destinationRegionId === item.id)).slice(0, 2)) {
    related.push({ id: corridor.id, kind: 'tradeCorridor', label: `${region(world, corridor.originRegionId)?.name ?? '起地'}—${region(world, corridor.destinationRegionId)?.name ?? '讫地'}`, detail: `${corridor.commodity}商路 · 流量${compact.format(corridor.lastVolume)}` });
  }
  for (const infection of world.infections.filter((entry) => entry.hostKind === 'region' && entry.hostId === item.id && entry.infectious > 0).slice(0, 1)) {
    related.push({ id: infection.id, kind: 'outbreak', label: world.pathogens.find((pathogen) => pathogen.id === infection.pathogenId)?.name ?? '地方疫病', detail: `染病 ${compact.format(infection.infectious)}` });
  }
  for (const state of world.practiceStates.filter((entry) => entry.regionId === item.id && entry.mastery > 0 && entry.lostTurn === null).sort((a, b) => b.adoption - a.adoption).slice(0, 2)) {
    const practice = world.practices.find((entry) => entry.id === state.practiceId);
    if (practice) related.push({ id: practice.id, kind: 'practice', label: practice.name, detail: `${practice.category} · 采用${Math.round(state.adoption)}` });
  }
  return {
    id: item.id,
    name: item.name,
    terrain: item.terrain,
    climate: item.climate,
    polityName: owner?.name ?? '无主',
    population: item.population,
    food: `${compact.format(Math.max(0, item.food))} · ${foodSafetyRatio(item).toFixed(1)} 季`,
    cityLevel: `${item.cityLevel} 级`,
    defense: item.defense,
    unrest: item.unrest,
    governor: governor?.name ?? '暂缺',
    resources,
    related,
    summary: item.devastation > 35
      ? '战火留下的破坏仍在压低产出与秩序。'
      : item.unrest > 55
        ? '粮赋与地方秩序正在形成显著压力。'
        : item.port
          ? '港路使这里成为税粮、消息与兵船交汇之地。'
          : '地方生产与统治秩序目前维持在可控范围。',
  };
}


