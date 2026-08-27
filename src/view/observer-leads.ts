import type { MapOverlay } from '../components/WorldMap';
import type { SituationPhase, SituationState } from '../sim/situations';
import type {
  DiplomacyState,
  DiseaseHostState,
  PolityState,
  RegionState,
  SeaZoneState,
  WarState,
  WorldState,
} from '../sim/types';
import { historyTurnDate } from './v1-history';
import {
  projectSituationSnapshotItem,
  situationOutcomeLabel,
  type SituationParticipantGroupKey,
  type SituationSnapshotItem,
} from './situation-snapshot';
import { projectSituationHistoricalScenes } from './historical-scenes';

export type ObserverLeadSlot = 'person' | 'polity' | 'tension';
export type ObserverLeadStage = '伏线' | '升温' | '临界' | '回响';
export type ObserverLeadTargetKind = 'person' | 'country' | 'region' | 'outbreak' | 'seaZone';
export type ObserverLeadSource = 'situation' | 'fallback';
export type ObserverLeadDisplayMode = 'tracking' | 'resolution_echo' | 'fallback';
export type ObserverLeadArbitrationReason =
  | 'situation_priority'
  | 'legacy_fallback'
  | 'minimum_tenure'
  | 'critical_challenger_pending'
  | 'fallback_challenger_pending'
  | 'incumbent_stable'
  | 'critical_challenger'
  | 'fallback_challenger'
  | 'resolution_echo';

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
  source?: ObserverLeadSource;
  situationId?: string | null;
  situationType?: string | null;
  displayMode?: ObserverLeadDisplayMode;
  startedTurn?: number | null;
  startedLabel?: string | null;
  selectedSinceTurn?: number;
  retainThroughTurn?: number;
  trackingTurns?: number;
  recentChange?: string;
  arbitrationReason?: ObserverLeadArbitrationReason;
}

interface RankedLead extends ObserverLead {
  rankScore: number;
  editorial?: {
    situation: SituationState;
    polityIds: readonly string[];
    regionIds: readonly string[];
    characterIds: readonly string[];
  };
}

export interface ObserverLeadContinuityEntry {
  slot: ObserverLeadSlot;
  leadId: string;
  situationId: string | null;
  selectedSinceTurn: number;
  retainThroughTurn: number;
  challengerId: string | null;
  challengerAheadTurns: number;
  decision: ObserverLeadArbitrationReason;
}

export interface ObserverLeadContinuityState {
  version: 1;
  worldSeed: string;
  lastTurn: number;
  lastWorldHash: string;
  slots: ObserverLeadContinuityEntry[];
}

export interface ObserverLeadProjection {
  version: 2;
  leads: ObserverLead[];
  continuity: ObserverLeadContinuityState;
}

export const OBSERVER_LEAD_MIN_TENURE_TURNS = 3;
export const OBSERVER_LEAD_CRITICAL_MARGIN = 20;
export const OBSERVER_LEAD_CHALLENGER_TURNS = 2;
export const OBSERVER_LEAD_RESOLUTION_ECHO_TURNS = 1;
export const OBSERVER_LEAD_VISIBILITY_THRESHOLD = 40;
export const OBSERVER_LEAD_FALLBACK_MARGIN = 8;

const LEAD_SLOTS: readonly ObserverLeadSlot[] = ['person', 'polity', 'tension'];
const SITUATION_SLOT_BY_TYPE: Readonly<Record<string, ObserverLeadSlot>> = {
  military_power_crisis: 'person',
  inheritance_crisis: 'polity',
  war_progress: 'tension',
};

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

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function situationStage(phase: SituationPhase, resolvedEcho: boolean): ObserverLeadStage {
  if (resolvedEcho) return '回响';
  if (phase === 'critical') return '临界';
  if (phase === 'active') return '升温';
  return '伏线';
}

function participant(
  item: SituationSnapshotItem,
  key: SituationParticipantGroupKey,
): { id: string; label: string } | null {
  return item.participants.find((group) => group.key === key)?.entities[0] ?? null;
}

function situationQuestion(item: SituationSnapshotItem, state: SituationState, resolvedEcho: boolean): string {
  if (resolvedEcho) {
    const outcome = situationOutcomeLabel(state.resolution?.outcomeKey ?? '');
    return `${item.title}如何以“${outcome}”收束？`;
  }
  const core = participant(item, 'coreCharacterIds')?.label ?? '这名将领';
  const polity = participant(item, 'polityIds')?.label ?? '该政权';
  if (item.type === 'military_power_crisis') {
    return `${core}手中的军权，会归于朝廷还是孕育新的势力？`;
  }
  if (item.type === 'inheritance_crisis') {
    return `${polity}的继承秩序，会安稳落定还是引发权力重组？`;
  }
  return `${item.title.replace(/的战争进程$/u, '')}，战局会如何收束？`;
}

function situationTarget(
  world: WorldState,
  state: SituationState,
  item: SituationSnapshotItem,
  slot: ObserverLeadSlot,
): ObserverLeadTarget | null {
  if (slot === 'person') {
    const person = participant(item, 'coreCharacterIds')
      ?? participant(item, 'supportingCharacterIds')
      ?? participant(item, 'opposingCharacterIds');
    return person ? { kind: 'person', id: person.id } : null;
  }
  if (state.type === 'war_progress') {
    const attackerId = world.wars.find((war) => war.id === state.scopeKey)?.attackerId;
    if (attackerId) return { kind: 'country', id: attackerId };
  }
  const polity = participant(item, 'polityIds');
  if (polity) return { kind: 'country', id: polity.id };
  const region = participant(item, 'regionIds');
  return region ? { kind: 'region', id: region.id } : null;
}

function situationEvidence(
  world: WorldState,
  item: SituationSnapshotItem,
  state: SituationState,
  resolvedEcho: boolean,
): readonly [string, string] {
  const scene = projectSituationHistoricalScenes(world, state, 1)[0];
  if (scene) {
    return [
      `${scene.dateLabel} · ${scene.title}`,
      scene.result || scene.summary,
    ];
  }
  if (resolvedEcho) {
    return [
      `结案结果 · ${situationOutcomeLabel(state.resolution?.outcomeKey ?? '')}`,
      item.latestChange ? `${historyTurnDate(item.latestChange.turn).label} · ${item.latestChange.label}` : '结果事实已经封存',
    ];
  }
  const labels = item.evidence
    .filter((entry) => entry.role !== 'outcome')
    .map((entry) => entry.label)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 2);
  if (labels.length < 2) labels.push(`${item.phaseLabel}阶段 · 张力${item.tension}`);
  if (labels.length < 2) labels.push('结构信号仍在持续');
  return [labels[0], labels[1]];
}

function situationRecentChange(item: SituationSnapshotItem): string {
  if (!item.latestChange) return `自${historyTurnDate(item.startedTurn).label}起持续积累，最近没有新的阶段转折`;
  return `${historyTurnDate(item.latestChange.turn).label} · ${item.latestChange.label}`;
}

function situationRank(state: SituationState, item: SituationSnapshotItem, order: number): number {
  const phase = item.phase === 'critical' ? 15 : item.phase === 'active' ? 7 : 0;
  const momentum = Math.max(-10, Math.min(10, item.momentum)) * 0.2;
  return item.tension * 0.45
    + state.importance * 0.25
    + state.visibility * 0.15
    + phase
    + momentum
    - order / 10_000;
}

function situationCandidate(
  world: WorldState,
  state: SituationState,
  item: SituationSnapshotItem,
  order: number,
  resolvedEcho: boolean,
): RankedLead | null {
  const slot = SITUATION_SLOT_BY_TYPE[state.type];
  if (!slot) return null;
  const target = situationTarget(world, state, item, slot);
  if (!target) return null;
  const label = slot === 'person' ? '人物线' : slot === 'polity' ? '国势线' : '天下矛盾';
  return {
    id: `lead-situation:${state.id}`,
    slot,
    label,
    question: situationQuestion(item, state, resolvedEcho),
    evidence: situationEvidence(world, item, state, resolvedEcho),
    nextSignal: item.nextSignal.label,
    stage: situationStage(item.phase, resolvedEcho),
    tension: item.tension,
    target,
    overlay: state.type === 'war_progress' ? 'war' : state.type === 'military_power_crisis' ? 'conflict' : 'political',
    source: 'situation',
    situationId: state.id,
    situationType: state.type,
    displayMode: resolvedEcho ? 'resolution_echo' : 'tracking',
    startedTurn: state.startedTurn,
    startedLabel: historyTurnDate(state.startedTurn).label,
    recentChange: situationRecentChange(item),
    arbitrationReason: resolvedEcho ? 'resolution_echo' : 'situation_priority',
    rankScore: situationRank(state, item, order),
    editorial: {
      situation: state,
      polityIds: [...state.participants.polityIds],
      regionIds: [...state.participants.regionIds],
      characterIds: [
        ...state.participants.coreCharacterIds,
        ...state.participants.supportingCharacterIds,
        ...state.participants.opposingCharacterIds,
      ],
    },
  };
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  if (!left.length || !right.length) return false;
  const rightIds = new Set(right);
  return left.some((id) => rightIds.has(id));
}

function diversityPenalty(leads: readonly RankedLead[]): number {
  let penalty = 0;
  for (let leftIndex = 0; leftIndex < leads.length; leftIndex += 1) {
    const left = leads[leftIndex].editorial;
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < leads.length; rightIndex += 1) {
      const right = leads[rightIndex].editorial;
      if (!right) continue;
      if (left.situation.type === right.situation.type) penalty += 12;
      if (intersects(left.polityIds, right.polityIds)) penalty += 18;
      if (intersects(left.regionIds, right.regionIds)) penalty += 10;
      if (intersects(left.characterIds, right.characterIds)) penalty += 8;
    }
  }
  return penalty;
}

type CandidateLists = Record<ObserverLeadSlot, RankedLead[]>;

function selectLeadCombination(
  lists: CandidateLists,
  forced: ReadonlyMap<ObserverLeadSlot, RankedLead> = new Map(),
): Record<ObserverLeadSlot, RankedLead> {
  const choices = (slot: ObserverLeadSlot): RankedLead[] => {
    const fixed = forced.get(slot);
    return fixed ? [fixed] : lists[slot];
  };
  let best: { leads: [RankedLead, RankedLead, RankedLead]; score: number; key: string } | null = null;
  for (const person of choices('person')) {
    for (const polity of choices('polity')) {
      for (const tension of choices('tension')) {
        const leads: [RankedLead, RankedLead, RankedLead] = [person, polity, tension];
        const score = leads.reduce((sum, lead) => sum + lead.rankScore, 0) - diversityPenalty(leads);
        const key = leads.map((lead) => lead.id).join('|');
        if (!best || score > best.score || (score === best.score && stableCompare(key, best.key) < 0)) {
          best = { leads, score, key };
        }
      }
    }
  }
  if (!best) throw new Error('Observer lead candidate lists must never be empty');
  return { person: best.leads[0], polity: best.leads[1], tension: best.leads[2] };
}

function effectiveRank(
  candidate: RankedLead,
  slot: ObserverLeadSlot,
  selected: Readonly<Record<ObserverLeadSlot, RankedLead>>,
): number {
  const others = LEAD_SLOTS.filter((other) => other !== slot).map((other) => selected[other]);
  const addedPenalty = diversityPenalty([candidate, ...others]) - diversityPenalty(others);
  return candidate.rankScore - addedPenalty;
}

function legacyCandidates(world: WorldState): Record<ObserverLeadSlot, RankedLead> {
  return {
    person: { ...derivePersonLead(world), source: 'fallback', situationId: null, situationType: null, displayMode: 'fallback' },
    polity: { ...derivePolityLead(world), source: 'fallback', situationId: null, situationType: null, displayMode: 'fallback' },
    tension: { ...deriveTensionLead(world), source: 'fallback', situationId: null, situationType: null, displayMode: 'fallback' },
  };
}

function personLeadForId(world: WorldState, id: string): RankedLead | null {
  const person = world.characters.find((item) => item.id === id && item.alive && item.age >= 16);
  if (!person) return null;
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
  const tension = rounded(rankScore);
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
    source: 'fallback',
    situationId: null,
    situationType: null,
    displayMode: 'fallback',
    rankScore,
  };
}

function polityLeadForId(world: WorldState, id: string): RankedLead | null {
  const polity = world.polities.find((item) => item.id === id && item.alive);
  if (!polity) return null;
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
  const tension = rounded(rankScore);
  const faction = world.factions
    .filter((item) => item.active && item.polityId === polity.id)
    .sort((left, right) => right.power * right.cohesion - left.power * left.cohesion || stableCompare(left.id, right.id))[0];
  const enemyId = war ? (war.attackerId === polity.id ? war.defenderId : war.attackerId) : null;
  const question = war
    ? `${polity.name}能否撑过与${polityName(world, enemyId ?? '')}的战争？`
    : successionPressure >= 58
      ? `${polity.name}能否安稳度过下一次权力交接？`
      : polity.legitimacy < 58 || polity.authority < 55
        ? `${polity.name}的朝廷还能压住地方吗？`
        : `${polity.name}会继续兴盛，还是先从内部失衡？`;
  const secondEvidence = war
    ? `战争疲惫${Math.round(polity.warWeariness)} · 战争耗竭${Math.round(war.exhaustion)}`
    : successionPressure >= 58
      ? `${ruler?.name ?? '君位空悬'} · ${ruler ? `${ruler.age}岁 · 健康${Math.round(ruler.health)}` : '继承未定'}`
      : faction
        ? `${faction.name} · 势力${Math.round(faction.power)} · 凝聚${Math.round(faction.cohesion)}`
        : `行政${Math.round(polity.administration)} · 疲惫${Math.round(polity.warWeariness)}`;
  const nextSignal = war
    ? '留意会战、首府失守与求和'
    : successionPressure >= 58
      ? '留意君主健康、摄政与继承安排'
      : polity.authority < 55
        ? '留意地方拒令、权臣与派系行动'
        : '留意财政、行政与边疆动荡的同步变化';
  return {
    id: `lead-polity:${polity.id}`,
    slot: 'polity',
    label: '国势线',
    question,
    evidence: [`合法性${Math.round(polity.legitimacy)} · 权威${Math.round(polity.authority)}`, secondEvidence],
    nextSignal,
    stage: stageFor(tension),
    tension,
    target: { kind: 'country', id: polity.id },
    overlay: war ? 'war' : 'political',
    source: 'fallback',
    situationId: null,
    situationType: null,
    displayMode: 'fallback',
    rankScore,
  };
}

function legacyCandidateForId(world: WorldState, entry: ObserverLeadContinuityEntry): RankedLead | null {
  if (entry.slot === 'person' && entry.leadId.startsWith('lead-person:')) {
    return personLeadForId(world, entry.leadId.slice('lead-person:'.length));
  }
  if (entry.slot === 'polity' && entry.leadId.startsWith('lead-polity:')) {
    return polityLeadForId(world, entry.leadId.slice('lead-polity:'.length));
  }
  if (entry.slot !== 'tension') return null;
  const sources: Array<[string, () => RankedLead | null]> = [
    ['lead-tension-war:', () => {
      const id = entry.leadId.slice('lead-tension-war:'.length);
      const war = world.wars.find((item) => item.id === id && item.active);
      return war ? warLead(world, war) : null;
    }],
    ['lead-tension-outbreak:', () => {
      const id = entry.leadId.slice('lead-tension-outbreak:'.length);
      const infection = world.infections.find((item) => item.id === id && item.exposed + item.infectious > 0);
      return infection ? outbreakLead(world, infection) : null;
    }],
    ['lead-tension-diplomacy:', () => {
      const id = entry.leadId.slice('lead-tension-diplomacy:'.length);
      const relation = world.diplomacy.find((item) => item.id === id);
      const bothSidesAlive = relation
        ? world.polities.some((item) => item.id === relation.polityAId && item.alive)
          && world.polities.some((item) => item.id === relation.polityBId && item.alive)
        : false;
      return relation && bothSidesAlive ? diplomacyLead(world, relation) : null;
    }],
    ['lead-tension-sea:', () => {
      const id = entry.leadId.slice('lead-tension-sea:'.length);
      const zone = world.seaZones.find((item) => item.id === id);
      return zone ? seaLead(zone) : null;
    }],
    ['lead-tension-region:', () => {
      const id = entry.leadId.slice('lead-tension-region:'.length);
      const region = world.regions.find((item) => item.id === id);
      return region ? regionLead(region) : null;
    }],
  ];
  for (const [prefix, project] of sources) {
    if (!entry.leadId.startsWith(prefix)) continue;
    const candidate = project();
    return candidate ? {
      ...candidate,
      source: 'fallback',
      situationId: null,
      situationType: null,
      displayMode: 'fallback',
    } : null;
  }
  return null;
}

function buildLeadCandidates(
  world: WorldState,
  previousEntries: readonly ObserverLeadContinuityEntry[] = [],
): {
  lists: CandidateLists;
  allById: Map<string, RankedLead>;
} {
  const legacy = legacyCandidates(world);
  const lists: CandidateLists = {
    person: [legacy.person],
    polity: [legacy.polity],
    tension: [legacy.tension],
  };
  const allById = new Map<string, RankedLead>(LEAD_SLOTS.map((slot) => [legacy[slot].id, legacy[slot]]));
  for (const entry of previousEntries) {
    if (entry.situationId) continue;
    const retained = legacyCandidateForId(world, entry);
    if (retained) allById.set(retained.id, retained);
  }
  const phaseOrder: Record<SituationPhase, number> = { critical: 0, active: 1, emerging: 2 };
  const openStates = world.situationSystem.situations
    .filter((state) => state.status === 'open' && state.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD)
    .sort((left, right) => (
      phaseOrder[left.phase] - phaseOrder[right.phase]
      || right.importance - left.importance
      || right.tension - left.tension
      || left.startedTurn - right.startedTurn
      || stableCompare(left.id, right.id)
    ));
  openStates.forEach((state, order) => {
    const item = projectSituationSnapshotItem(state, world);
    const candidate = situationCandidate(world, state, item, order, false);
    if (!candidate) return;
    lists[candidate.slot].unshift(candidate);
    allById.set(candidate.id, candidate);
  });
  world.situationSystem.situations
    .filter((state) => state.status === 'resolved'
      && state.resolvedTurn !== null
      && state.visibility >= OBSERVER_LEAD_VISIBILITY_THRESHOLD
      && world.turn - state.resolvedTurn >= 0
      && world.turn - state.resolvedTurn <= OBSERVER_LEAD_RESOLUTION_ECHO_TURNS)
    .forEach((state, order) => {
      const candidate = situationCandidate(world, state, projectSituationSnapshotItem(state, world), order, true);
      if (candidate) allById.set(candidate.id, candidate);
    });
  for (const slot of LEAD_SLOTS) {
    lists[slot].sort((left, right) => right.rankScore - left.rankScore || stableCompare(left.id, right.id));
    if (lists[slot].some((candidate) => candidate.source === 'situation')) {
      lists[slot] = lists[slot].filter((candidate) => candidate.source === 'situation');
    }
  }
  return { lists, allById };
}

function cloneContinuity(state: ObserverLeadContinuityState): ObserverLeadContinuityState {
  return { ...state, slots: state.slots.map((entry) => ({ ...entry })) };
}

function continuityIsValid(
  world: WorldState,
  previous: ObserverLeadContinuityState | null,
  previousWorldHash: string | null,
): previous is ObserverLeadContinuityState {
  if (!previous || previous.version !== 1 || previous.worldSeed !== world.seed || previous.lastTurn > world.turn) return false;
  if (previous.lastWorldHash === world.hash) return previous.lastTurn === world.turn;
  return previousWorldHash !== null
    && previous.lastWorldHash === previousWorldHash
    && (world.turn === previous.lastTurn || world.turn === previous.lastTurn + 1);
}

function publicLead(candidate: RankedLead, entry: ObserverLeadContinuityEntry, worldTurn: number): ObserverLead {
  const { rankScore: _rankScore, editorial: _editorial, ...lead } = candidate;
  return {
    ...lead,
    source: candidate.source ?? 'fallback',
    situationId: candidate.situationId ?? null,
    situationType: candidate.situationType ?? null,
    displayMode: candidate.displayMode ?? 'fallback',
    startedTurn: candidate.startedTurn ?? null,
    startedLabel: candidate.startedLabel ?? null,
    selectedSinceTurn: entry.selectedSinceTurn,
    retainThroughTurn: entry.retainThroughTurn,
    trackingTurns: Math.max(1, worldTurn - entry.selectedSinceTurn + 1),
    recentChange: candidate.recentChange ?? '旧题源按当前状态重新评估',
    arbitrationReason: entry.decision,
  };
}

function normalizedInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return Math.max(minimum, Math.min(maximum, value));
}

/** Normalizes non-authoritative local observer metadata without accepting arbitrary unbounded input. */
export function normalizeObserverLeadContinuity(value: unknown): ObserverLeadContinuityState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.worldSeed !== 'string' || typeof record.lastWorldHash !== 'string') return null;
  const lastTurn = normalizedInteger(record.lastTurn, 0, Number.MAX_SAFE_INTEGER);
  if (lastTurn === null || !record.worldSeed.trim() || !record.lastWorldHash.trim() || !Array.isArray(record.slots)) return null;
  const slots: ObserverLeadContinuityEntry[] = [];
  const seen = new Set<ObserverLeadSlot>();
  for (const raw of record.slots) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (!LEAD_SLOTS.includes(entry.slot as ObserverLeadSlot) || seen.has(entry.slot as ObserverLeadSlot)) continue;
    if (typeof entry.leadId !== 'string' || !entry.leadId.trim()) continue;
    const selectedSinceTurn = normalizedInteger(entry.selectedSinceTurn, 0, lastTurn);
    const challengerAheadTurns = normalizedInteger(entry.challengerAheadTurns, 0, OBSERVER_LEAD_CHALLENGER_TURNS);
    if (selectedSinceTurn === null || challengerAheadTurns === null) continue;
    const situationId = typeof entry.situationId === 'string' && entry.situationId.trim() ? entry.situationId.slice(0, 180) : null;
    const challengerId = typeof entry.challengerId === 'string' && entry.challengerId.trim() ? entry.challengerId.slice(0, 220) : null;
    const allowedReasons: ObserverLeadArbitrationReason[] = [
      'situation_priority', 'legacy_fallback', 'minimum_tenure', 'critical_challenger_pending',
      'fallback_challenger_pending', 'incumbent_stable', 'critical_challenger',
      'fallback_challenger', 'resolution_echo',
    ];
    const decision = allowedReasons.includes(entry.decision as ObserverLeadArbitrationReason)
      ? entry.decision as ObserverLeadArbitrationReason
      : situationId ? 'incumbent_stable' : 'legacy_fallback';
    const slot = entry.slot as ObserverLeadSlot;
    seen.add(slot);
    slots.push({
      slot,
      leadId: entry.leadId.slice(0, 220),
      situationId,
      selectedSinceTurn,
      retainThroughTurn: selectedSinceTurn + OBSERVER_LEAD_MIN_TENURE_TURNS - 1,
      challengerId,
      challengerAheadTurns: challengerId ? challengerAheadTurns : 0,
      decision,
    });
  }
  if (slots.length !== LEAD_SLOTS.length) return null;
  slots.sort((left, right) => LEAD_SLOTS.indexOf(left.slot) - LEAD_SLOTS.indexOf(right.slot));
  return {
    version: 1,
    worldSeed: record.worldSeed.slice(0, 180),
    lastTurn,
    lastWorldHash: record.lastWorldHash.slice(0, 180),
    slots,
  };
}

/**
 * Produces the bounded Situation-first editorial selection plus non-authoritative continuity metadata.
 * Re-reading the same world/hash is idempotent and never advances challenger streaks.
 */
export function deriveObserverLeadProjection(
  world: WorldState,
  previous: ObserverLeadContinuityState | null = null,
  previousWorldHash: string | null = null,
): ObserverLeadProjection {
  const normalizedPrevious = normalizeObserverLeadContinuity(previous);
  const validPrevious = continuityIsValid(world, normalizedPrevious, previousWorldHash)
    ? normalizedPrevious
    : null;
  const candidates = buildLeadCandidates(world, validPrevious?.slots ?? []);
  const previousBySlot = new Map(validPrevious?.slots.map((entry) => [entry.slot, entry]) ?? []);

  if (validPrevious && validPrevious.lastTurn === world.turn && validPrevious.lastWorldHash === world.hash) {
    const exact = LEAD_SLOTS.map((slot) => ({ entry: previousBySlot.get(slot), candidate: candidates.allById.get(previousBySlot.get(slot)?.leadId ?? '') }));
    if (exact.every((item) => item.entry && item.candidate)) {
      return {
        version: 2,
        leads: exact.map((item) => publicLead(item.candidate as RankedLead, item.entry as ObserverLeadContinuityEntry, world.turn)),
        continuity: cloneContinuity(validPrevious),
      };
    }
  }

  const forced = new Map<ObserverLeadSlot, RankedLead>();
  const pending = new Map<ObserverLeadSlot, { challengerId: string | null; aheadTurns: number; decision: ObserverLeadArbitrationReason }>();
  const unresolved = new Set<ObserverLeadSlot>();
  if (validPrevious) {
    for (const slot of LEAD_SLOTS) {
      const entry = previousBySlot.get(slot);
      if (!entry) continue;
      const incumbent = candidates.allById.get(entry.leadId);
      if (!incumbent) continue;
      if (entry.situationId && incumbent.displayMode === 'resolution_echo') {
        forced.set(slot, incumbent);
        pending.set(slot, { challengerId: null, aheadTurns: 0, decision: 'resolution_echo' });
      } else {
        unresolved.add(slot);
      }
    }
  }

  type LeadEvaluation = {
    slot: ObserverLeadSlot;
    incumbent: RankedLead;
    proposal: RankedLead;
    replace: boolean;
    challengerId: string | null;
    aheadTurns: number;
    decision: ObserverLeadArbitrationReason;
  };

  // Resolve every undecided slot against one shared combination. Retentions are
  // fixed first, then the remaining proposals are recalculated. This prevents a
  // later forced slot from silently changing an earlier accepted lead.
  while (validPrevious && unresolved.size > 0) {
    const contextualSelection = selectLeadCombination(candidates.lists, forced);
    const evaluations: LeadEvaluation[] = [];
    for (const slot of LEAD_SLOTS) {
      if (!unresolved.has(slot)) continue;
      const entry = previousBySlot.get(slot) as ObserverLeadContinuityEntry;
      const incumbent = candidates.allById.get(entry.leadId) as RankedLead;
      const proposal = contextualSelection[slot];
      if (proposal.id === incumbent.id) {
        evaluations.push({
          slot,
          incumbent,
          proposal,
          replace: false,
          challengerId: null,
          aheadTurns: 0,
          decision: 'incumbent_stable',
        });
        continue;
      }
      const minimumTenureComplete = world.turn > entry.retainThroughTurn;
      if (incumbent.source !== 'situation' && proposal.source === 'situation') {
        evaluations.push({
          slot,
          incumbent,
          proposal,
          replace: minimumTenureComplete,
          challengerId: minimumTenureComplete ? null : proposal.id,
          aheadTurns: 0,
          decision: minimumTenureComplete ? 'situation_priority' : 'minimum_tenure',
        });
        continue;
      }
      const margin = effectiveRank(proposal, slot, contextualSelection)
        - effectiveRank(incumbent, slot, contextualSelection);
      const qualifies = incumbent.source === 'situation'
        ? proposal.source === 'situation'
          && proposal.editorial?.situation.phase === 'critical'
          && margin >= OBSERVER_LEAD_CRITICAL_MARGIN
        : proposal.source !== 'situation' && margin >= OBSERVER_LEAD_FALLBACK_MARGIN;
      const consecutive = qualifies
        ? entry.challengerId === proposal.id && validPrevious.lastTurn + 1 === world.turn
          ? Math.min(OBSERVER_LEAD_CHALLENGER_TURNS, entry.challengerAheadTurns + 1)
          : 1
        : 0;
      const replace = qualifies
        && consecutive >= OBSERVER_LEAD_CHALLENGER_TURNS
        && minimumTenureComplete;
      evaluations.push({
        slot,
        incumbent,
        proposal,
        replace,
        challengerId: replace ? null : qualifies ? proposal.id : null,
        aheadTurns: replace ? 0 : consecutive,
        decision: replace
          ? incumbent.source === 'situation' ? 'critical_challenger' : 'fallback_challenger'
          : !minimumTenureComplete
            ? 'minimum_tenure'
            : qualifies
              ? incumbent.source === 'situation' ? 'critical_challenger_pending' : 'fallback_challenger_pending'
              : 'incumbent_stable',
      });
    }

    const retentions = evaluations.filter((evaluation) => !evaluation.replace);
    const resolved = retentions.length > 0 ? retentions : evaluations;
    for (const evaluation of resolved) {
      forced.set(evaluation.slot, evaluation.replace ? evaluation.proposal : evaluation.incumbent);
      pending.set(evaluation.slot, {
        challengerId: evaluation.challengerId,
        aheadTurns: evaluation.aheadTurns,
        decision: evaluation.decision,
      });
      unresolved.delete(evaluation.slot);
    }
  }

  const selected = selectLeadCombination(candidates.lists, forced);

  const slots = LEAD_SLOTS.map((slot): ObserverLeadContinuityEntry => {
    const candidate = selected[slot];
    const prior = previousBySlot.get(slot);
    const same = prior?.leadId === candidate.id;
    const selectedSinceTurn = same ? prior.selectedSinceTurn : world.turn;
    const replacementDecision = pending.get(slot)?.decision;
    const decision = same
      ? pending.get(slot)?.decision ?? (candidate.source === 'situation' ? 'incumbent_stable' : 'legacy_fallback')
      : replacementDecision === 'critical_challenger'
        || replacementDecision === 'fallback_challenger'
        || replacementDecision === 'situation_priority'
        ? replacementDecision
        : candidate.source === 'situation'
          ? 'situation_priority'
          : 'legacy_fallback';
    return {
      slot,
      leadId: candidate.id,
      situationId: candidate.situationId ?? null,
      selectedSinceTurn,
      retainThroughTurn: selectedSinceTurn + OBSERVER_LEAD_MIN_TENURE_TURNS - 1,
      challengerId: same ? pending.get(slot)?.challengerId ?? null : null,
      challengerAheadTurns: same ? pending.get(slot)?.aheadTurns ?? 0 : 0,
      decision,
    };
  });
  const continuity: ObserverLeadContinuityState = {
    version: 1,
    worldSeed: world.seed,
    lastTurn: world.turn,
    lastWorldHash: world.hash,
    slots,
  };
  return {
    version: 2,
    leads: LEAD_SLOTS.map((slot) => publicLead(selected[slot], slots.find((entry) => entry.slot === slot) as ObserverLeadContinuityEntry, world.turn)),
    continuity,
  };
}

/** Builds a stateless Situation-first read-only layer for callers that do not retain UI continuity. */
export function deriveObserverLeads(world: WorldState): ObserverLead[] {
  return deriveObserverLeadProjection(world).leads;
}
