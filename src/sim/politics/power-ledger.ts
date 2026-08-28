import type {
  CharacterState,
  FactionState,
  OfficeAppointment,
  SimulationFact,
  WorldState,
} from '../types';

export type PoliticalPowerCategory =
  | 'central_office'
  | 'regional_office'
  | 'military_command'
  | 'family_backing'
  | 'member_renown'
  | 'alliance_support'
  | 'cohesion';

export interface PoliticalPowerEvidenceRef {
  entityType: 'character' | 'family' | 'faction' | 'office' | 'army' | 'fleet' | 'relationship' | 'fact';
  entityId: string;
  field: string;
}

export interface PoliticalPowerResource {
  id: string;
  category: PoliticalPowerCategory;
  label: string;
  detail: string;
  value: number;
  characterIds: readonly string[];
  regionIds: readonly string[];
  evidence: readonly PoliticalPowerEvidenceRef[];
}

export interface PoliticalPowerCategoryAccount {
  category: PoliticalPowerCategory;
  label: string;
  value: number;
  maximum: number;
  resources: readonly PoliticalPowerResource[];
}

export interface FactionPowerLedger {
  factionId: string;
  polityId: string;
  total: number;
  categories: readonly PoliticalPowerCategoryAccount[];
  resources: readonly PoliticalPowerResource[];
}

export interface PoliticalPowerMovement {
  id: string;
  turn: number;
  direction: 'gained' | 'held' | 'lost';
  label: string;
  detail: string;
  factId: string;
  characterIds: readonly string[];
}

export interface CharacterPowerPosition {
  characterId: string;
  factionId: string | null;
  total: number;
  standing: '势单力薄' | '已有根基' | '握有实权' | '举足轻重';
  resources: readonly PoliticalPowerResource[];
  recentMovements: readonly PoliticalPowerMovement[];
}

const CATEGORY_META: Readonly<Record<PoliticalPowerCategory, { label: string; maximum: number }>> = {
  central_office: { label: '中枢席位', maximum: 22 },
  regional_office: { label: '地方任官', maximum: 14 },
  military_command: { label: '军令', maximum: 22 },
  family_backing: { label: '家门与财富', maximum: 13 },
  member_renown: { label: '人物声望', maximum: 13 },
  alliance_support: { label: '盟派支持', maximum: 6 },
  cohesion: { label: '内部凝聚', maximum: 10 },
};

const CATEGORY_ORDER: readonly PoliticalPowerCategory[] = [
  'central_office',
  'regional_office',
  'military_command',
  'family_backing',
  'member_renown',
  'alliance_support',
  'cohesion',
];

const CATEGORY_RESOURCE_CAP: Readonly<Record<PoliticalPowerCategory, number>> = {
  central_office: 8,
  regional_office: 12,
  military_command: 12,
  family_backing: 8,
  member_renown: 5,
  alliance_support: 2,
  cohesion: 1,
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function activeOfficeResources(
  world: WorldState,
  faction: FactionState,
  members: readonly CharacterState[],
): PoliticalPowerResource[] {
  const memberIds = new Set(members.map((member) => member.id));
  const result: PoliticalPowerResource[] = [];
  const offices = world.offices
    .filter((office) => office.active && office.polityId === faction.polityId && memberIds.has(office.holderId))
    .sort((left, right) => left.kind.localeCompare(right.kind, 'zh-CN') || stableCompare(left.id, right.id));
  const holderName = (office: OfficeAppointment) => world.characters.find((item) => item.id === office.holderId)?.name ?? '无名人物';
  for (const office of offices) {
    if (office.kind === '地方长官') {
      const place = world.regions.find((region) => region.id === office.regionId)?.name ?? '属地';
      result.push({
        id: `office:${office.id}`,
        category: 'regional_office',
        label: `${place}长官`,
        detail: `${holderName(office)}实际治理${place}`,
        value: 5 + Math.min(3, office.rank * 0.45),
        characterIds: [office.holderId],
        regionIds: office.regionId ? [office.regionId] : [],
        evidence: [{ entityType: 'office', entityId: office.id, field: 'active' }],
      });
      continue;
    }
    if (office.kind === '军团主帅' || office.kind === '军团副将') {
      const army = world.armies.find((item) => item.id === office.armyId);
      result.push({
        id: `office:${office.id}`,
        category: 'military_command',
        label: `${army?.name ?? '军团'}${office.kind === '军团主帅' ? '军令' : '副将席位'}`,
        detail: `${holderName(office)}${office.kind === '军团主帅' ? `统率${Math.round(army?.soldiers ?? 0)}兵` : '身处军令递补序列'}`,
        value: office.kind === '军团主帅'
          ? 9 + Math.min(5, (army?.soldiers ?? 0) / 3_500)
          : 4 + Math.min(2, office.rank * 0.25),
        characterIds: [office.holderId],
        regionIds: army ? [army.regionId] : [],
        evidence: [
          { entityType: 'office', entityId: office.id, field: 'active' },
          ...(army ? [{ entityType: 'army' as const, entityId: army.id, field: office.kind === '军团主帅' ? 'commanderId' : 'deputyCommanderId' }] : []),
        ],
      });
      continue;
    }
    if (office.kind === '水师提督' || office.kind === '水师副将') {
      const fleet = world.fleets.find((item) => item.id === office.fleetId);
      result.push({
        id: `office:${office.id}`,
        category: 'military_command',
        label: `${fleet?.name ?? '水师'}${office.kind === '水师提督' ? '提督权' : '副将席位'}`,
        detail: `${holderName(office)}${office.kind === '水师提督' ? '掌握舰队调遣' : '身处水师递补序列'}`,
        value: office.kind === '水师提督' ? 9 : 4,
        characterIds: [office.holderId],
        regionIds: fleet?.portRegionId ? [fleet.portRegionId] : [],
        evidence: [
          { entityType: 'office', entityId: office.id, field: 'active' },
          ...(fleet ? [{ entityType: 'fleet' as const, entityId: fleet.id, field: office.kind === '水师提督' ? 'commanderId' : 'deputyCommanderId' }] : []),
        ],
      });
      continue;
    }
    const officeValue = office.kind === '君主'
      ? 14
      : office.kind === '宰辅' || office.kind === '枢密使'
        ? 10
        : 3 + Math.min(3, office.rank * 0.35);
    result.push({
      id: `office:${office.id}`,
      category: 'central_office',
      label: office.kind,
      detail: `${holderName(office)}占据朝廷正式席位`,
      value: officeValue,
      characterIds: [office.holderId],
      regionIds: [],
      evidence: [{ entityType: 'office', entityId: office.id, field: 'active' }],
    });
  }
  return result;
}

function familyResources(world: WorldState, members: readonly CharacterState[]): PoliticalPowerResource[] {
  const byFamily = new Map<string, CharacterState[]>();
  for (const member of members) {
    const familyMembers = byFamily.get(member.familyId) ?? [];
    familyMembers.push(member);
    byFamily.set(member.familyId, familyMembers);
  }
  return [...byFamily.entries()].flatMap(([familyId, represented]) => {
    const family = world.families.find((item) => item.id === familyId && item.active);
    if (!family) return [];
    const headInside = represented.some((member) => member.id === family.headId);
    const value = 1.5
      + family.prestige * 0.025
      + family.politicalInfluence * 0.03
      + Math.min(2.5, family.wealth / 240)
      + (headInside ? 1.5 : 0);
    return [{
      id: `family:${family.id}`,
      category: 'family_backing' as const,
      label: family.name,
      detail: `${represented.map((member) => member.name).slice(0, 2).join('、')}${represented.length > 2 ? `等${represented.length}人` : ''}把家望与家产带入派中`,
      value,
      characterIds: represented.map((member) => member.id).sort(stableCompare),
      regionIds: [],
      evidence: [
        { entityType: 'family' as const, entityId: family.id, field: 'prestige' },
        { entityType: 'family' as const, entityId: family.id, field: 'politicalInfluence' },
        { entityType: 'family' as const, entityId: family.id, field: 'wealth' },
      ],
    }];
  }).sort((left, right) => right.value - left.value || stableCompare(left.id, right.id));
}

function renownResources(members: readonly CharacterState[]): PoliticalPowerResource[] {
  return [...members]
    .sort((left, right) => right.influence - left.influence || right.renown - left.renown || stableCompare(left.id, right.id))
    .slice(0, 5)
    .map((member) => ({
      id: `renown:${member.id}`,
      category: 'member_renown' as const,
      label: member.name,
      detail: `个人影响${Math.round(member.influence)}、声望${Math.round(member.renown)}`,
      value: 1 + member.influence * 0.035 + member.renown * 0.02,
      characterIds: [member.id],
      regionIds: [],
      evidence: [
        { entityType: 'character' as const, entityId: member.id, field: 'influence' },
        { entityType: 'character' as const, entityId: member.id, field: 'renown' },
      ],
    }));
}

function allianceResources(world: WorldState, faction: FactionState): PoliticalPowerResource[] {
  return faction.alliedFactionIds.flatMap((id) => {
    const ally = world.factions.find((item) => item.id === id && item.active && item.polityId === faction.polityId);
    if (!ally) return [];
    return [{
      id: `alliance:${ally.id}`,
      category: 'alliance_support' as const,
      label: `${ally.name}盟约`,
      detail: `${ally.memberIds.length}名成员登记为朝中盟派`,
      value: 2.5 + Math.min(2.5, ally.memberIds.length * 0.35) + ally.cohesion * 0.015,
      characterIds: [ally.leaderId],
      regionIds: [],
      evidence: [
        { entityType: 'faction' as const, entityId: faction.id, field: 'alliedFactionIds' },
        { entityType: 'faction' as const, entityId: ally.id, field: 'leaderId' },
      ],
    }];
  }).sort((left, right) => stableCompare(left.id, right.id));
}

function scaleCategoryResources(
  category: PoliticalPowerCategory,
  resources: readonly PoliticalPowerResource[],
): PoliticalPowerCategoryAccount {
  const meta = CATEGORY_META[category];
  const retained = [...resources]
    .sort((left, right) => right.value - left.value || stableCompare(left.id, right.id))
    .slice(0, CATEGORY_RESOURCE_CAP[category]);
  const rawTotal = retained.reduce((sum, resource) => sum + Math.max(0, resource.value), 0);
  const scale = rawTotal > meta.maximum ? meta.maximum / rawTotal : 1;
  const scaled = retained
    .map((resource) => ({ ...resource, value: rounded(resource.value * scale) }))
    .sort((left, right) => right.value - left.value || stableCompare(left.id, right.id));
  return {
    category,
    label: meta.label,
    value: rounded(Math.min(meta.maximum, scaled.reduce((sum, resource) => sum + resource.value, 0))),
    maximum: meta.maximum,
    resources: scaled,
  };
}

/**
 * Authoritative POL01 account. It only reads current offices and concrete
 * assets; the legacy faction.power value is deliberately not an input.
 */
export function calculateFactionPowerLedger(world: WorldState, faction: FactionState): FactionPowerLedger {
  const memberIds = new Set(faction.memberIds);
  const members = world.characters
    .filter((character) => character.alive && character.polityId === faction.polityId && memberIds.has(character.id))
    .sort((left, right) => stableCompare(left.id, right.id));
  const resources: PoliticalPowerResource[] = [
    ...activeOfficeResources(world, faction, members),
    ...familyResources(world, members),
    ...renownResources(members),
    ...allianceResources(world, faction),
    {
      id: `cohesion:${faction.id}`,
      category: 'cohesion',
      label: '派内协同行事',
      detail: `当前凝聚${Math.round(faction.cohesion)}，只代表内部协同，不冒充官职或地盘`,
      value: clamp(faction.cohesion, 0, 100) * 0.1,
      characterIds: [...members.map((member) => member.id)],
      regionIds: [],
      evidence: [{ entityType: 'faction', entityId: faction.id, field: 'cohesion' }],
    },
  ];
  const categories = CATEGORY_ORDER.map((category) => (
    scaleCategoryResources(category, resources.filter((resource) => resource.category === category))
  ));
  const boundedResources = categories.flatMap((category) => category.resources);
  return {
    factionId: faction.id,
    polityId: faction.polityId,
    total: Math.round(clamp(categories.reduce((sum, category) => sum + category.value, 0))),
    categories,
    resources: boundedResources,
  };
}

export function refreshFactionPowerLedgers(world: WorldState, polityId?: string): void {
  for (const faction of world.factions
    .filter((item) => item.active && (!polityId || item.polityId === polityId))
    .sort((left, right) => stableCompare(left.id, right.id))) {
    faction.power = calculateFactionPowerLedger(world, faction).total;
  }
}

function agencyMovement(world: WorldState, fact: SimulationFact): PoliticalPowerMovement | null {
  if (fact.kind === 'agency_support_resolved') {
    const actor = world.characters.find((item) => item.id === fact.payload.actorId)?.name ?? '该人物';
    const target = fact.payload.targetKind === 'army_officers'
      ? `${world.armies.find((item) => item.id === fact.payload.targetArmyId)?.name ?? fact.payload.targetArmyName ?? '旧日所部'}将校`
      : world.characters.find((item) => item.id === fact.payload.targetId)?.name ?? '所请之人';
    const direction = fact.payload.outcome === 'secured' ? 'gained' : 'held';
    return {
      id: `movement:${fact.id}`,
      turn: fact.turn,
      direction,
      label: fact.payload.outcome === 'secured' ? '取得明确支持' : '争取支持未成',
      detail: fact.payload.outcome === 'secured'
        ? `${actor}已获得${target}的明确支持`
        : `${actor}争取${target}相助，${fact.payload.outcome === 'deferred' ? '对方仍在观望' : '对方没有应允'}`,
      factId: fact.id,
      characterIds: [fact.payload.actorId, fact.payload.targetId].filter((id, index, all) => all.indexOf(id) === index),
    };
  }
  if (fact.kind === 'local_governance_resolved') {
    const actor = world.characters.find((item) => item.id === fact.payload.actorId)?.name ?? '该长官';
    const region = world.regions.find((item) => item.id === fact.payload.regionId)?.name ?? '所治州域';
    const enacted = fact.payload.outcome === 'enacted';
    return {
      id: `movement:${fact.id}`,
      turn: fact.turn,
      direction: enacted ? 'gained' : 'held',
      label: enacted
        ? fact.payload.action === 'open_granary' ? '赈济地方' : '减赋安民'
        : '施政所请未行',
      detail: enacted
        ? `${actor}${fact.payload.action === 'open_granary' ? `在${region}开仓赈济` : `为${region}减免本季赋`}`
        : `${actor}为${region}所请${fact.payload.action === 'open_granary' ? '赈济' : '减赋'}没有在本季施行`,
      factId: fact.id,
      characterIds: [fact.payload.actorId],
    };
  }
  if (fact.kind !== 'agency_intent_resolved') return null;
  const actor = world.characters.find((item) => item.id === fact.payload.actorId)?.name ?? '该副将';
  const army = world.armies.find((item) => item.id === fact.payload.targetArmyId)?.name ?? fact.payload.targetArmyName ?? '旧日所部';
  if (fact.payload.institutionResponse === 'command_granted') {
    return { id: `movement:${fact.id}`, turn: fact.turn, direction: 'gained', label: '取得军令', detail: `${actor}获准接掌${army}`, factId: fact.id, characterIds: [fact.payload.actorId] };
  }
  if (fact.payload.institutionResponse === 'appeased') {
    return { id: `movement:${fact.id}`, turn: fact.turn, direction: 'gained', label: '受朝廷安抚', detail: `${actor}未得军令，但获得名位与礼遇`, factId: fact.id, characterIds: [fact.payload.actorId] };
  }
  if (fact.payload.institutionResponse === 'curbed') {
    return { id: `movement:${fact.id}`, turn: fact.turn, direction: 'lost', label: '军职被撤', detail: `${actor}请令未准，并失去${army}副将席位`, factId: fact.id, characterIds: [fact.payload.actorId] };
  }
  return { id: `movement:${fact.id}`, turn: fact.turn, direction: 'held', label: '军令未变', detail: `${actor}所请军令未获准，现有军令格局未变`, factId: fact.id, characterIds: [fact.payload.actorId] };
}

export function recentFactionPowerMovements(
  world: WorldState,
  faction: FactionState,
  maximum = 3,
): PoliticalPowerMovement[] {
  const memberIds = new Set(faction.memberIds);
  return world.facts
    .flatMap((fact) => {
      const movement = agencyMovement(world, fact);
      return movement && movement.characterIds.some((id) => memberIds.has(id)) ? [movement] : [];
    })
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id))
    .slice(0, maximum);
}

function standingFor(score: number): CharacterPowerPosition['standing'] {
  if (score >= 60) return '举足轻重';
  if (score >= 40) return '握有实权';
  if (score >= 20) return '已有根基';
  return '势单力薄';
}

export function calculateCharacterPowerPosition(world: WorldState, characterId: string): CharacterPowerPosition {
  const character = world.characters.find((item) => item.id === characterId);
  const faction = character
    ? world.factions.find((item) => item.active && item.polityId === character.polityId && item.memberIds.includes(characterId))
    : undefined;
  const factionResources = faction
    ? calculateFactionPowerLedger(world, faction).resources.filter((resource) => resource.characterIds.includes(characterId))
    : [];
  const supportResources = world.facts
    .filter((fact): fact is Extract<SimulationFact, { kind: 'agency_support_resolved' }> => (
      fact.kind === 'agency_support_resolved'
      && fact.payload.actorId === characterId
      && fact.payload.outcome === 'secured'
      && world.turn - fact.turn <= 16
    ))
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id))
    .slice(0, 3)
    .map((fact): PoliticalPowerResource => {
      const target = fact.payload.targetKind === 'army_officers'
        ? `${world.armies.find((item) => item.id === fact.payload.targetArmyId)?.name ?? fact.payload.targetArmyName ?? '旧日所部'}将校`
        : world.characters.find((item) => item.id === fact.payload.targetId)?.name ?? '所请之人';
      return {
        id: `support:${fact.id}`,
        category: fact.payload.targetKind === 'army_officers' ? 'military_command' : 'alliance_support',
        label: `${target}支持`,
        detail: `第${fact.year}年${fact.season}季明确应允，效力仍在近期请令审查中`,
        value: 3 + fact.payload.strength * 0.04,
        characterIds: [characterId],
        regionIds: [...fact.regionIds],
        evidence: [{ entityType: 'fact', entityId: fact.id, field: 'outcome' }],
      };
    });
  const resources = [...factionResources, ...supportResources]
    .sort((left, right) => right.value - left.value || stableCompare(left.id, right.id))
    .slice(0, 8);
  const total = Math.round(clamp(resources.reduce((sum, resource) => sum + resource.value, 0) * 1.45));
  const movements = world.facts
    .flatMap((fact) => {
      const movement = agencyMovement(world, fact);
      return movement?.characterIds.includes(characterId) ? [movement] : [];
    })
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id))
    .slice(0, 3);
  return {
    characterId,
    factionId: faction?.id ?? null,
    total,
    standing: standingFor(total),
    resources,
    recentMovements: movements,
  };
}
