import type { CountryInspectorData, SystemInspectorData } from '../components/Inspector';
import type { ArchiveDossier } from '../components/HistoricalArchive';
import type { PolityState, WorldState } from '../sim/types';
import { readWorldHistory } from '../sim/archive';
import {
  calculateFactionPowerLedger,
  recentFactionPowerMovements,
} from '../sim/politics/power-ledger';
import { projectCourt } from './court-projection';
import { projectHistoricalScenes } from './historical-scenes';
import {
  character,
  compact,
  eventArchiveRecord,
  family,
  livingCharacter,
  polity,
  polityPopulation,
  region,
  scopedHistory,
  toHistoricalSceneView,
  toPowerMovementView,
  toPowerResourceView,
  uniqueArchiveLinks,
  worldDiplomacy,
  worldFactions,
} from './dossier-adapter-shared';

export function toCountryInspector(world: WorldState, item: PolityState): CountryInspectorData {
  const owned = world.regions.filter((candidate) => candidate.controllerId === item.id);
  const ruler = livingCharacter(world, item.rulerId);
  const capital = region(world, item.capitalRegionId);
  const enemies = world.wars
    .filter((war) => war.active && (war.attackerId === item.id || war.defenderId === item.id))
    .map((war) => polity(world, war.attackerId === item.id ? war.defenderId : war.attackerId)?.name)
    .filter((name): name is string => Boolean(name));
  const rulingFamily = family(world, item.rulingFamilyId);
  const factions = worldFactions(world)
    .filter((faction) => faction.polityId === item.id && faction.active !== false)
    .map((faction) => ({ faction, ledger: calculateFactionPowerLedger(world, faction) }))
    .sort((a, b) => b.ledger.total - a.ledger.total || a.faction.id.localeCompare(b.faction.id));
  const activeCourt = projectCourt(world, item.id, 'active');
  const courtPositionByFactionId = new Map(activeCourt.factionPositions.map((position) => [position.factionId, position]));
  const powerholders = activeCourt.seats.map((seat) => ({
    id: seat.holderId,
    name: seat.holder,
    office: seat.office,
    influence: seat.factionId ? courtPositionByFactionId.get(seat.factionId)?.power ?? seat.rank : seat.rank,
    faction: seat.factionName ?? undefined,
    standing: seat.accessLabel,
  }));
  const courtScenes = projectHistoricalScenes(
    world,
    world.facts.filter((fact) => (
      fact.polityIds.includes(item.id)
      && fact.turn >= Math.max(0, world.turn - 16)
      && ['agency_support_resolved', 'agency_intent_submitted', 'agency_intent_resolved', 'local_governance_resolved', 'appointment_started', 'appointment_ended', 'faction_lifecycle', 'faction_relation_changed', 'court_action_resolved'].includes(fact.kind)
    )),
    3,
    'active',
  ).map(toHistoricalSceneView);
  const diplomacy = worldDiplomacy(world)
    .filter((relation) => relation.polityAId === item.id || relation.polityBId === item.id)
    .map((relation) => {
      const isA = relation.polityAId === item.id;
      const otherId = isA ? relation.polityBId : relation.polityAId;
      return {
        polityId: otherId,
        polity: polity(world, otherId)?.name ?? '无名政权',
        status: relation.status,
        trust: relation.trust,
        threat: isA ? relation.threatAtoB : relation.threatBtoA,
        grievance: relation.grievance,
        tradeDependency: relation.tradeDependency,
      };
    })
    .sort((a, b) => (a.status === '战争' ? -1 : 0) - (b.status === '战争' ? -1 : 0) || b.threat - a.threat);
  const maritimeAssets: SystemInspectorData['links'] = [
    ...world.fleets.filter((fleet) => fleet.polityId === item.id).map((fleet) => ({ id: fleet.id, kind: 'fleet' as const, label: fleet.name, detail: `${fleet.mission} · 战备${Math.round(fleet.readiness)}`, value: fleet.warships + fleet.transports + fleet.patrolShips })),
    ...world.ports.filter((port) => world.regions.find((candidate) => candidate.id === port.regionId)?.controllerId === item.id).slice(0, 4).flatMap((port) => { const portRegion = region(world, port.regionId); return portRegion ? [{ id: portRegion.id, kind: 'region' as const, label: portRegion.name, detail: `港口${port.level}级 · 吞吐${compact.format(port.throughput)}`, value: port.level }] : []; }),
  ];
  const inspector: CountryInspectorData = {
    id: item.id,
    name: item.name,
    ruler: ruler?.name ?? '君位空悬',
    rulerId: ruler?.id,
    capital: capital?.name ?? '流亡政权',
    government: [item.governmentForm, item.dynastyName].filter(Boolean).join(' · '),
    rulingFamily: rulingFamily?.name,
    rulingFamilyId: rulingFamily?.id ?? null,
    population: polityPopulation(world, item.id),
    treasury: Math.max(0, item.treasury),
    food: owned.reduce((sum, candidate) => sum + candidate.food, 0),
    regionCount: owned.length,
    legitimacy: item.legitimacy,
    centralAuthority: item.authority,
    administration: item.administration,
    courtInfluence: item.courtInfluence,
    atWarWith: enemies,
    factions: factions.map(({ faction, ledger }) => ({
      id: faction.id,
      name: faction.name,
      kind: faction.kind,
      leaderId: faction.leaderId,
      leader: character(world, faction.leaderId)?.name ?? '领袖不详',
      power: ledger.total,
      cohesion: faction.cohesion,
      agenda: faction.agenda,
      resources: ledger.resources.slice(0, 10).map((resource) => toPowerResourceView(world, resource)),
      categories: ledger.categories.filter((category) => category.value > 0).map((category) => ({
        key: category.category,
        label: category.label,
        value: category.value,
        maximum: category.maximum,
      })),
      recentMovement: recentFactionPowerMovements(world, faction, 1).map((movement) => toPowerMovementView(world, movement))[0] ?? null,
    })),
    powerholders,
    diplomacy,
    tradeRevenue: item.tradeRevenue,
    navalBudget: item.navalBudget,
    maritimeOrientation: item.maritimeOrientation,
    maritimeAssets,
    courtScenes,
    court: activeCourt,
    history: scopedHistory(world, (event) => event.polityIds.includes(item.id)),
    status: !item.alive
      ? '该政权已退出当代政治。'
      : enemies.length
        ? `正与${enemies.join('、')}交战。`
        : item.warWeariness > 50
          ? '长期动员正在侵蚀财政与服从。'
          : '政令与财政尚能维持日常统治。',
  };
  let completeCourt: ReturnType<typeof projectCourt> | null = null;
  Object.defineProperty(inspector, 'court', {
    enumerable: true,
    configurable: false,
    get: () => {
      completeCourt ??= projectCourt(world, item.id, 'all');
      return completeCourt;
    },
  });
  return inspector;
}

export function toCountryArchive(world: WorldState, item: PolityState): ArchiveDossier {
  const inspector = toCountryInspector(world, item);
  const ruler = character(world, item.rulerId);
  const rulingFamily = family(world, item.rulingFamilyId);
  const records = readWorldHistory(world).filter((event) => event.polityIds.includes(item.id)).map(eventArchiveRecord);
  const factionSentence = inspector.court?.summary
    ?? (inspector.factions?.length
      ? `${inspector.factions.map((faction) => `${faction.name}主张${faction.agenda}`).join('；')}。其中${inspector.factions[0].name}权势最盛。`
      : '朝中尚未形成足以被史家命名的稳定派系，权力更多系于具体官职与个人。');
  const diplomacySentence = inspector.diplomacy?.length
    ? inspector.diplomacy.map((relation) => `与${relation.polity}${relation.status}`).join('，') + '。'
    : '现存记录中未见稳定联盟、朝贡或公开敌对关系。';
  return {
    id: item.id,
    kind: 'country',
    eyebrow: '国家史 · 政权本纪',
    title: `${item.name}本纪`,
    subtitle: `${inspector.government ?? '政体未详'} · ${item.alive ? '当代政权' : '已亡政权'}`,
    lead: `${item.name}的兴衰并非由一场战役或一位君主独自决定。领地、财政、合法性与朝中人物的选择，共同写成了这一政权的历史。`,
    facts: [
      { label: '国主', value: inspector.ruler }, { label: '都城', value: inspector.capital },
      { label: '领地', value: `${inspector.regionCount} 郡` }, { label: '府库', value: compact.format(Number(item.treasury) || 0) },
      { label: '合法性', value: String(Math.round(item.legitimacy)) }, { label: '中央权威', value: String(Math.round(item.authority)) },
    ],
    chapters: [
      { id: 'foundation', title: '立国之本', paragraphs: [`${item.name}以${inspector.capital}为中枢，现掌${inspector.regionCount}地。${inspector.status ?? ''}`, `宗主门第为${rulingFamily?.name ?? '未定'}；行政能力为${Math.round(item.administration)}，朝廷控制为${Math.round(item.courtInfluence ?? 0)}。`] },
      { id: 'court', title: '朝局与权臣', paragraphs: [factionSentence, inspector.powerholders?.length ? `当下最具影响的人物包括${inspector.powerholders.map((person) => `${person.name}（${person.office}）`).join('、')}。` : '朝廷尚无可确考的权力中枢人物。'] },
      { id: 'diplomacy', title: '邦交与威胁', paragraphs: [diplomacySentence, item.warWeariness > 50 ? `战争疲惫已达${Math.round(item.warWeariness)}，继续动员将侵蚀财政与服从。` : '长期动员尚未成为压倒性的国内负担。'] },
    ],
    records,
    links: uniqueArchiveLinks([
      ruler ? { id: ruler.id, kind: 'person', label: ruler.name, detail: '当代君主' } : null,
      rulingFamily ? { id: rulingFamily.id, kind: 'family', label: rulingFamily.name, detail: '宗主家族' } : null,
      ...(inspector.powerholders ?? []).map((person) => ({ id: person.id, kind: 'person' as const, label: person.name, detail: person.office })),
      ...(inspector.diplomacy ?? []).slice(0, 4).map((relation) => ({ id: relation.polityId, kind: 'country' as const, label: relation.polity, detail: relation.status })),
    ]).slice(0, 10),
  };
}
