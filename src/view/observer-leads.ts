import type { MapOverlay } from '../components/WorldMap';
import type {
  DiplomacyState,
  DiseaseHostState,
  PolityState,
  RegionState,
  SeaZoneState,
  WarState,
  WorldState,
} from '../sim/types';

export type ObserverLeadSlot = 'person' | 'polity' | 'tension';
export type ObserverLeadStage = '伏线' | '升温' | '临界';
export type ObserverLeadTargetKind = 'person' | 'country' | 'region' | 'outbreak' | 'seaZone';

export interface ObserverLeadTarget {
  kind: ObserverLeadTargetKind;
  id: string;
}

export interface ObserverLead {
  id: string;
  slot: ObserverLeadSlot;
  label: string;
  question: string;
  evidence: readonly [string, string];
  nextSignal: string;
  stage: ObserverLeadStage;
  tension: number;
  target: ObserverLeadTarget;
  overlay: MapOverlay;
}

interface RankedLead extends ObserverLead {
  rankScore: number;
}

const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(clamp(value));
}

function stageFor(tension: number): ObserverLeadStage {
  if (tension >= 78) return '临界';
  if (tension >= 58) return '升温';
  return '伏线';
}

function polityName(world: WorldState, id: string): string {
  return world.polities.find((item) => item.id === id)?.name ?? '未知政权';
}

function regionName(world: WorldState, id: string): string {
  return world.regions.find((item) => item.id === id)?.name ?? '未知之地';
}

function sortedByRank<T extends { rankScore: number; id: string }>(items: T[]): T[] {
  return items.sort((left, right) => right.rankScore - left.rankScore || left.id.localeCompare(right.id));
}

function derivePersonLead(world: WorldState): RankedLead {
  const rulerIds = new Set(world.polities.filter((item) => item.alive).map((item) => item.rulerId));
  const candidates = world.characters.filter((item) => item.alive && item.age >= 16);
  const pool = candidates.filter((item) => !rulerIds.has(item.id));
  const eligible = pool.length ? pool : candidates.length ? candidates : world.characters;
  const ranked = eligible.map((person) => {
    const commandWeight = person.commandingArmyId || person.commandingFleetId ? 9 : person.role === '将领' ? 5 : 0;
    const ambitionGap = clamp(person.ambition - person.loyalty + 50);
    const rankScore = person.rebellionReadiness * 0.28
      + person.ambition * 0.2
      + (100 - person.loyalty) * 0.13
      + person.influence * 0.16
      + ambitionGap * 0.09
      + person.renown * 0.05
      + (100 - person.caution) * 0.04
      + commandWeight;
    return { person, rankScore };
  });
  const winner = sortedByRank(ranked.map(({ person, rankScore }) => ({ id: person.id, person, rankScore })))[0];
  const person = winner?.person ?? world.characters[0];
  if (!person) {
    const region = world.regions[0];
    return {
      id: `lead-person-fallback:${region?.id ?? 'world'}`,
      slot: 'person',
      label: '人物线',
      question: '下一位改变时代的人会从哪里出现？',
      evidence: ['当世暂无记名人物', '地方仍在积累机会'],
      nextSignal: '留意新人物被推到历史前台',
      stage: '伏线',
      tension: 32,
      target: { kind: 'region', id: region?.id ?? '' },
      overlay: 'political',
      rankScore: 32,
    };
  }

  const tension = rounded(winner.rankScore);
  const openlyRestive = person.rebellionReadiness >= 45
    || (person.rebellionReadiness >= 28 && person.ambition - person.loyalty >= 24);
  const commandsForces = Boolean(person.commandingArmyId || person.commandingFleetId || person.role === '将领');
  const question = openlyRestive
    ? `${person.name}会不会走向自立？`
    : commandsForces
      ? `${person.name}会成为名将，还是新的军阀？`
      : `${person.name}能否把野心变成权位？`;
  const nextSignal = openlyRestive
    ? '留意拒令、割据或公开举兵'
    : commandsForces
      ? '留意新战功、主帅更替与军心归属'
      : '留意升迁、结盟与朝堂权力转移';
  const position = person.commandingArmyId
    ? '掌军在手'
    : person.commandingFleetId
      ? '统领水师'
      : `${person.role} · 影响${Math.round(person.influence)}`;

  return {
    id: `lead-person:${person.id}`,
    slot: 'person',
    label: '人物线',
    question,
    evidence: [
      `野心${Math.round(person.ambition)} · 忠诚${Math.round(person.loyalty)}`,
      `${position} · 叛意${Math.round(person.rebellionReadiness)}`,
    ],
    nextSignal,
    stage: stageFor(tension),
    tension,
    target: { kind: 'person', id: person.id },
    overlay: openlyRestive ? 'conflict' : 'political',
    rankScore: winner.rankScore,
  };
}

function polityFactionPressure(world: WorldState, polity: PolityState): number {
  return world.factions
    .filter((item) => item.active && item.polityId === polity.id)
    .reduce((maximum, item) => Math.max(maximum, item.power * (0.45 + item.cohesion / 180)), 0);
}

function polityUnrest(world: WorldState, polity: PolityState): number {
  const regions = world.regions.filter((item) => item.controllerId === polity.id);
  if (!regions.length) return 100;
  return regions.reduce((sum, item) => sum + item.unrest, 0) / regions.length;
}

function activeWarForPolity(world: WorldState, id: string): WarState | undefined {
  return world.wars.find((item) => item.active && (item.attackerId === id || item.defenderId === id));
}

function derivePolityLead(world: WorldState): RankedLead {
  const alive = world.polities.filter((item) => item.alive);
  const eligible = alive.length ? alive : world.polities;
  const ranked = eligible.map((polity) => {
    const ruler = world.characters.find((item) => item.id === polity.rulerId);
    const successionPressure = ruler
      ? clamp((ruler.age - 48) * 1.8 + (100 - ruler.health) * 0.36)
      : 88;
    const factionPressure = polityFactionPressure(world, polity);
    const unrest = polityUnrest(world, polity);
    const war = activeWarForPolity(world, polity.id);
    const rankScore = (100 - polity.legitimacy) * 0.24
      + (100 - polity.authority) * 0.22
      + (100 - polity.administration) * 0.1
      + polity.warWeariness * 0.13
      + successionPressure * 0.13
      + factionPressure * 0.1
      + unrest * 0.08
      + (war ? 12 : 0);
    return { id: polity.id, polity, ruler, successionPressure, factionPressure, war, rankScore };
  });
  const winner = sortedByRank(ranked)[0];
  const polity = winner?.polity ?? world.polities[0];
  if (!polity) {
    const region = world.regions[0];
    return {
      id: `lead-polity-fallback:${region?.id ?? 'world'}`,
      slot: 'polity',
      label: '国势线',
      question: '下一座朝廷会在何处形成？',
      evidence: ['天下暂无成形政权', '地方秩序仍在重组'],
      nextSignal: '留意新政权建立与首都出现',
      stage: '临界',
      tension: 88,
      target: { kind: 'region', id: region?.id ?? '' },
      overlay: 'political',
      rankScore: 88,
    };
  }

  const tension = rounded(winner.rankScore);
  const ruler = winner.ruler;
  const faction = world.factions
    .filter((item) => item.active && item.polityId === polity.id)
    .sort((left, right) => right.power * right.cohesion - left.power * left.cohesion || left.id.localeCompare(right.id))[0];
  const war = winner.war;
  const enemyId = war ? (war.attackerId === polity.id ? war.defenderId : war.attackerId) : null;
  const question = war
    ? `${polity.name}能否撑过与${polityName(world, enemyId ?? '')}的战争？`
    : winner.successionPressure >= 58
      ? `${polity.name}能否安稳度过下一次权力交接？`
      : polity.legitimacy < 58 || polity.authority < 55
        ? `${polity.name}的朝廷还能压住地方吗？`
        : `${polity.name}会继续兴盛，还是先从内部失衡？`;
  const secondEvidence = war
    ? `战争疲惫${Math.round(polity.warWeariness)} · 战争耗竭${Math.round(war.exhaustion)}`
    : winner.successionPressure >= 58
      ? `${ruler?.name ?? '君位空悬'} · ${ruler ? `${ruler.age}岁 · 健康${Math.round(ruler.health)}` : '继承未定'}`
      : faction
        ? `${faction.name} · 势力${Math.round(faction.power)} · 凝聚${Math.round(faction.cohesion)}`
        : `行政${Math.round(polity.administration)} · 疲惫${Math.round(polity.warWeariness)}`;
  const nextSignal = war
    ? '留意会战、首府失守与求和'
    : winner.successionPressure >= 58
      ? '留意君主健康、摄政与继承安排'
      : polity.authority < 55
        ? '留意地方拒令、权臣与派系行动'
        : '留意财政、行政与边疆动荡的同步变化';

  return {
    id: `lead-polity:${polity.id}`,
    slot: 'polity',
    label: '国势线',
    question,
    evidence: [
      `合法性${Math.round(polity.legitimacy)} · 权威${Math.round(polity.authority)}`,
      secondEvidence,
    ],
    nextSignal,
    stage: stageFor(tension),
    tension,
    target: { kind: 'country', id: polity.id },
    overlay: war ? 'war' : 'political',
    rankScore: winner.rankScore,
  };
}

function warLead(world: WorldState, war: WarState): RankedLead {
  const attacker = polityName(world, war.attackerId);
  const defender = polityName(world, war.defenderId);
  const scoreGap = Math.abs(war.attackerScore - war.defenderScore);
  const tension = rounded(80 + war.exhaustion * 0.12 + Math.max(0, 12 - scoreGap * 0.12));
  return {
    id: `lead-tension-war:${war.id}`,
    slot: 'tension',
    label: '天下矛盾',
    question: `${attacker}与${defender}，谁会先打破僵局？`,
    evidence: [
      `战局 ${Math.round(war.attackerScore)} : ${Math.round(war.defenderScore)}`,
      `${war.goal}之战 · 耗竭${Math.round(war.exhaustion)}`,
    ],
    nextSignal: '留意会战、补给崩溃与议和',
    stage: stageFor(tension),
    tension,
    target: { kind: 'country', id: war.attackerId },
    overlay: 'war',
    rankScore: tension + 25,
  };
}

function outbreakLead(world: WorldState, infection: DiseaseHostState): RankedLead {
  const pathogen = world.pathogens.find((item) => item.id === infection.pathogenId);
  const total = infection.susceptible + infection.exposed + infection.infectious + infection.recovered;
  const active = infection.exposed + infection.infectious;
  const hostRegion = infection.hostKind === 'region'
    ? world.regions.find((item) => item.id === infection.hostId)
    : null;
  const hostName = infection.hostKind === 'region'
    ? regionName(world, infection.hostId)
    : infection.hostKind === 'army'
      ? world.armies.find((item) => item.id === infection.hostId)?.name ?? '行军军团'
      : world.fleets.find((item) => item.id === infection.hostId)?.name ?? '海上船队';
  const prevalence = active / Math.max(1, total) * 100;
  const portPressure = hostRegion?.port ? 8 : 0;
  const sourcePressure = Math.min(12, infection.recentSources.length * 3);
  const raw = 42
    + Math.log10(active + 1) * 6.5
    + prevalence * 1.1
    + (pathogen?.transmissibility ?? 0.5) * 100 * 0.1
    + (pathogen?.fatality ?? 0.02) * 100 * 0.08
    + portPressure
    + sourcePressure;
  const tension = rounded(raw);
  return {
    id: `lead-tension-outbreak:${infection.id}`,
    slot: 'tension',
    label: '天下矛盾',
    question: `${pathogen?.name ?? '疫病'}会从${hostName}继续外溢吗？`,
    evidence: [
      `染病${compact.format(infection.infectious)} · 潜伏${compact.format(infection.exposed)}`,
      `传播${Math.round((pathogen?.transmissibility ?? 0) * 100)}% · 输入来源${infection.recentSources.length}`,
    ],
    nextSignal: hostRegion?.port
      ? '留意港口商旅把病势带向外海'
      : '留意相邻地区、军旅与迁徙输入',
    stage: stageFor(tension),
    tension,
    target: { kind: 'outbreak', id: infection.id },
    overlay: 'disease',
    rankScore: raw + 8,
  };
}

function diplomacyLead(world: WorldState, relation: DiplomacyState): RankedLead {
  const a = polityName(world, relation.polityAId);
  const b = polityName(world, relation.polityBId);
  const maximumThreat = Math.max(relation.threatAtoB, relation.threatBtoA);
  const raw = maximumThreat * 0.34
    + relation.grievance * 0.28
    + (100 - relation.trust) * 0.24
    + (100 - relation.culturalAffinity) * 0.06
    + (relation.status === '联盟' ? 6 : relation.status === '战争' ? 28 : 0);
  const tension = rounded(raw);
  return {
    id: `lead-tension-diplomacy:${relation.id}`,
    slot: 'tension',
    label: '天下矛盾',
    question: relation.status === '联盟'
      ? `${a}与${b}的盟约会先从哪里裂开？`
      : `${a}与${b}会走到开战那一步吗？`,
    evidence: [
      `威胁${Math.round(maximumThreat)} · 积怨${Math.round(relation.grievance)}`,
      `信任${Math.round(relation.trust)} · 贸易依存${Math.round(relation.tradeDependency)}`,
    ],
    nextSignal: relation.status === '联盟'
      ? '留意背约、拒援与贸易中断'
      : '留意边境摩擦、盟友站队与宣战',
    stage: stageFor(tension),
    tension,
    target: { kind: 'country', id: relation.polityAId },
    overlay: 'conflict',
    rankScore: raw,
  };
}

function seaLead(zone: SeaZoneState): RankedLead {
  const raw = 38 + (zone.contested ? 25 : 0) + zone.piracy * 0.2 + Math.min(20, Math.log10(zone.traffic + 1) * 7);
  const tension = rounded(raw);
  return {
    id: `lead-tension-sea:${zone.id}`,
    slot: 'tension',
    label: '天下矛盾',
    question: `${zone.name}会成为下一处海权争夺点吗？`,
    evidence: [
      `航流${compact.format(zone.traffic)} · 海盗${Math.round(zone.piracy)}`,
      `${zone.contested ? '多方争夺' : '海权未定'} · 港口${zone.portRegionIds.length}`,
    ],
    nextSignal: '留意舰队集结、封锁与商路改道',
    stage: stageFor(tension),
    tension,
    target: { kind: 'seaZone', id: zone.id },
    overlay: 'naval',
    rankScore: raw,
  };
}

function regionLead(region: RegionState): RankedLead {
  const foodPressure = region.food < region.population * 0.55 ? 28 : region.food < region.population ? 12 : 0;
  const raw = region.unrest * 0.44 + region.devastation * 0.3 + foodPressure + region.strategicValue * 0.08;
  const tension = rounded(raw);
  return {
    id: `lead-tension-region:${region.id}`,
    slot: 'tension',
    label: '天下矛盾',
    question: `${region.name}的压力会先引发逃亡，还是反抗？`,
    evidence: [
      `动荡${Math.round(region.unrest)} · 破坏${Math.round(region.devastation)}`,
      `粮食可支${(region.food / Math.max(1, region.population)).toFixed(1)}季 · 战略${Math.round(region.strategicValue)}`,
    ],
    nextSignal: '留意缺粮、迁徙与地方军队扩大',
    stage: stageFor(tension),
    tension,
    target: { kind: 'region', id: region.id },
    overlay: foodPressure ? 'food' : 'conflict',
    rankScore: raw,
  };
}

function deriveTensionLead(world: WorldState): RankedLead {
  const candidates: RankedLead[] = [];
  world.wars.filter((item) => item.active).forEach((item) => candidates.push(warLead(world, item)));
  world.infections
    .filter((item) => item.exposed + item.infectious > 0)
    .forEach((item) => candidates.push(outbreakLead(world, item)));
  world.diplomacy
    .filter((item) => world.polities.some((polity) => polity.id === item.polityAId && polity.alive)
      && world.polities.some((polity) => polity.id === item.polityBId && polity.alive))
    .forEach((item) => candidates.push(diplomacyLead(world, item)));
  world.seaZones.forEach((item) => candidates.push(seaLead(item)));
  world.regions.forEach((item) => candidates.push(regionLead(item)));
  return sortedByRank(candidates)[0] ?? regionLead(world.regions[0]);
}

/**
 * Builds a read-only editorial layer from authoritative world state.
 * It intentionally does not retain object references or consume simulation RNG.
 */
export function deriveObserverLeads(world: WorldState): ObserverLead[] {
  return [derivePersonLead(world), derivePolityLead(world), deriveTensionLead(world)].map(({ rankScore: _score, ...lead }) => lead);
}
