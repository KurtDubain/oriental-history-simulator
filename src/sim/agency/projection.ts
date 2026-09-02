import { keyedInt, stableCompare } from '../random';
import type {
  CharacterState,
  FamilyState,
  SimulationFact,
  WorldState,
} from '../types';

export const ROOT_DESIRES = [
  'power',
  'renown',
  'family',
  'wealth',
  'safety',
  'loyalty',
  'learning',
  'revenge',
] as const;

export type RootDesire = (typeof ROOT_DESIRES)[number];

export const ROOT_DESIRE_LABELS: Readonly<Record<RootDesire, string>> = {
  power: '权力',
  renown: '功名',
  family: '家族',
  wealth: '财富',
  safety: '安全',
  loyalty: '忠义',
  learning: '学问',
  revenge: '复仇',
};

export type DesireSourceKind = 'origin' | 'personality' | 'family' | 'experience' | 'seed';

export interface DesireSource {
  kind: DesireSourceKind;
  contribution: number;
  summary: string;
  sourceFactIds: readonly string[];
}

export interface DesireAxisProjection {
  kind: RootDesire;
  label: string;
  weight: number;
  rank: number;
  core: boolean;
  sources: readonly DesireSource[];
}

export interface DesirePressureProjection {
  kind: RootDesire;
  label: string;
  intensity: number;
  summary: string;
  sourceFactIds: readonly string[];
}

export interface CharacterDesireProjection {
  version: 1;
  authority: 'projection';
  characterId: string;
  projectedTurn: number;
  axes: readonly DesireAxisProjection[];
  coreDesireKinds: readonly RootDesire[];
  pressures: readonly DesirePressureProjection[];
}

interface ExperienceSummary {
  battleCount: number;
  appointmentCount: number;
  marriageCount: number;
  situationCount: number;
  practiceCount: number;
  atWar: boolean;
  maxGrievance: number;
  trustInRuler: number;
  factIds: readonly string[];
}

const ORIGIN_MODIFIERS: Readonly<Record<CharacterState['politicalClass'], Partial<Record<RootDesire, number>>>> = {
  '宗室': { power: 12, family: 10, loyalty: 6, safety: 2 },
  '官僚': { renown: 8, loyalty: 6, learning: 8, power: 3 },
  '士族': { family: 8, wealth: 4, learning: 12, renown: 3 },
  '地方豪强': { power: 5, family: 10, wealth: 8, safety: 4 },
  '军门': { power: 8, renown: 12, loyalty: 4, safety: -2 },
  '外戚': { power: 10, family: 12, safety: 6, loyalty: 2 },
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function centered(value: number, scale: number): number {
  return (value - 50) * scale;
}

function uniqueStable(values: readonly string[], limit = values.length): readonly string[] {
  return [...new Set(values)].sort(stableCompare).slice(0, limit);
}

function factMentionsCharacter(fact: SimulationFact, characterId: string): boolean {
  if (fact.kind === 'battle') {
    const forces = [fact.payload.attacker, ...fact.payload.defenders];
    return forces.some((force) => force.commanderId === characterId
      || force.deputyCommanderId === characterId || force.allegianceCharacterId === characterId);
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return fact.payload.holderId === characterId;
  }
  if (fact.kind === 'character_death') return fact.payload.characterId === characterId;
  if (fact.kind === 'marriage') {
    return fact.payload.leftCharacterId === characterId || fact.payload.rightCharacterId === characterId;
  }
  return fact.actorIds.includes(characterId);
}

function summarizeExperience(world: WorldState, character: CharacterState): ExperienceSummary {
  const recentFacts: SimulationFact[] = [];
  const oldestTurn = Math.max(0, world.turn - 16);
  for (let index = world.facts.length - 1; index >= 0 && recentFacts.length < 12; index -= 1) {
    const fact = world.facts[index] as SimulationFact;
    if (fact.turn < oldestTurn) break;
    if (factMentionsCharacter(fact, character.id)) recentFacts.push(fact);
  }
  recentFacts.reverse();
  const rulerId = world.polities.find((polity) => polity.id === character.polityId)?.rulerId ?? '';
  const rulerRelation = world.relationships.find((relationship) => (
    relationship.sourceId === character.id && relationship.targetId === rulerId
  ));
  const outgoing = world.relationships.filter((relationship) => relationship.sourceId === character.id);
  return {
    battleCount: recentFacts.filter((fact) => fact.kind === 'battle').length,
    appointmentCount: recentFacts.filter((fact) => fact.kind === 'appointment_started' || fact.kind === 'appointment_ended').length,
    marriageCount: recentFacts.filter((fact) => fact.kind === 'marriage').length,
    situationCount: recentFacts.filter((fact) => fact.kind === 'situation_milestone').length,
    practiceCount: world.practiceStates.filter((state) => state.carrierCharacterIds.includes(character.id)).length,
    atWar: world.wars.some((war) => war.active && (war.attackerId === character.polityId || war.defenderId === character.polityId)),
    maxGrievance: outgoing.reduce((maximum, relationship) => Math.max(maximum, relationship.grievance), 0),
    trustInRuler: rulerRelation?.trust ?? Math.round(character.loyalty * 0.7),
    factIds: uniqueStable(recentFacts.map((fact) => fact.id), 12),
  };
}

function personalityContribution(character: CharacterState, kind: RootDesire): number {
  if (kind === 'power') return centered(character.ambition, 0.42) + centered(character.cunning, 0.08);
  if (kind === 'renown') return centered(character.ambition, 0.18) + centered(Math.max(character.leadership, character.governance), 0.16);
  if (kind === 'family') return centered(character.loyalty, 0.12) + (character.spouseIds.length > 0 ? 3 : 0);
  if (kind === 'wealth') return centered(character.ambition, 0.08) + centered(character.cunning, 0.08);
  if (kind === 'safety') return centered(character.caution, 0.42) + centered(100 - character.health, 0.12);
  if (kind === 'loyalty') return centered(character.loyalty, 0.48) - centered(character.ambition, 0.08);
  if (kind === 'learning') return centered((character.governance + character.cunning) / 2, 0.28) + centered(character.caution, 0.06);
  return centered(character.cunning, 0.08) + centered(100 - character.loyalty, 0.08);
}

function familyContribution(family: FamilyState | undefined, kind: RootDesire): number {
  if (!family) return kind === 'family' ? -10 : 0;
  if (kind === 'power') return centered(family.traditions.political, 0.13) + centered(family.politicalInfluence, 0.06);
  if (kind === 'renown') return centered(family.traditions.military, 0.12) + centered(family.prestige, 0.05);
  if (kind === 'family') return Math.min(14, 3 + family.memberIds.length * 1.5 + family.marriageAllianceFamilyIds.length * 2);
  if (kind === 'wealth') return centered(family.traditions.commercial, 0.14) + centered(family.wealth, 0.05);
  if (kind === 'safety') return Math.min(8, family.memberIds.length * 0.8);
  if (kind === 'loyalty') return centered(family.traditions.political, 0.05);
  if (kind === 'learning') return centered(family.traditions.scholarly, 0.16);
  return 0;
}

function experienceContribution(
  character: CharacterState,
  experience: ExperienceSummary,
  kind: RootDesire,
): number {
  if (kind === 'power') return centered(character.influence, 0.1) + Math.min(8, experience.appointmentCount * 2);
  if (kind === 'renown') return centered(character.renown, 0.1) + Math.min(14, character.merit * 0.12 + character.deputyExperience * 0.16 + experience.battleCount * 3);
  if (kind === 'family') return Math.min(8, character.parentIds.length + character.spouseIds.length * 2 + experience.marriageCount * 2);
  if (kind === 'wealth') return centered(character.personalWealth, 0.12);
  if (kind === 'safety') return (experience.atWar ? 8 : 0) + (character.activeDiseaseId ? 12 : 0) + centered(100 - character.health, 0.18);
  if (kind === 'loyalty') return centered(experience.trustInRuler, 0.12) - Math.min(10, character.insubordination * 0.18);
  if (kind === 'learning') return Math.min(12, experience.practiceCount * 4 + experience.situationCount);
  return Math.min(24, experience.maxGrievance * 0.24);
}

function experienceSummary(kind: RootDesire, experience: ExperienceSummary): string {
  if (kind === 'renown') return `近四年参战${experience.battleCount}次，任免${experience.appointmentCount}次`;
  if (kind === 'revenge') return `当前最深怨隙为${Math.round(experience.maxGrievance)}`;
  if (kind === 'safety') return experience.atWar ? '所属政权正在交战' : '所属政权眼下无战事';
  if (kind === 'learning') return `正在承载${experience.practiceCount}项地方实践`;
  if (kind === 'family') return `近四年婚姻事实${experience.marriageCount}条`;
  return `近四年有${experience.factIds.length}条相关事实`;
}

function personalitySummary(kind: RootDesire): string {
  if (kind === 'power') return '性情偏向主动争取';
  if (kind === 'renown') return '看重才干被人承认';
  if (kind === 'family') return '重视亲近之人的归属';
  if (kind === 'wealth') return '习惯为自己积攒余地';
  if (kind === 'safety') return '行事谨慎，也看重退路';
  if (kind === 'loyalty') return '忠诚与责任感';
  if (kind === 'learning') return '善于思量，也肯下功夫';
  return '不轻易忘记受过的亏欠';
}

export function projectCharacterDesires(world: WorldState, characterId: string): CharacterDesireProjection {
  const character = world.characters.find((item) => item.id === characterId);
  if (!character) throw new Error(`Unknown character ${characterId}`);
  const family = world.families.find((item) => item.id === character.familyId);
  const experience = summarizeExperience(world, character);
  const axes = ROOT_DESIRES.map((kind) => {
    const origin = ORIGIN_MODIFIERS[character.politicalClass][kind] ?? 0;
    const personality = personalityContribution(character, kind);
    const familyValue = familyContribution(family, kind);
    const experienceValue = experienceContribution(character, experience, kind);
    const seeded = keyedInt(world.seed, -7, 7, 'agency', 'desire-v1', character.id, kind);
    const sources: DesireSource[] = [
      { kind: 'origin', contribution: Math.round(origin), summary: `${character.politicalClass}出身`, sourceFactIds: [] },
      { kind: 'personality', contribution: Math.round(personality), summary: personalitySummary(kind), sourceFactIds: [] },
      { kind: 'family', contribution: Math.round(familyValue), summary: family ? `${family.name}的传统与处境` : '没有可用家族支持', sourceFactIds: [] },
      { kind: 'experience', contribution: Math.round(experienceValue), summary: experienceSummary(kind, experience), sourceFactIds: experience.factIds },
      { kind: 'seed', contribution: seeded, summary: '成年前形成的个人倾向', sourceFactIds: [] },
    ];
    return {
      kind,
      label: ROOT_DESIRE_LABELS[kind],
      weight: clamp(50 + sources.reduce((sum, source) => sum + source.contribution, 0)),
      rank: 0,
      core: false,
      sources,
    } satisfies DesireAxisProjection;
  }).sort((left, right) => right.weight - left.weight || stableCompare(left.kind, right.kind));
  const ranked = axes.map((axis, index): DesireAxisProjection => ({ ...axis, rank: index + 1, core: index < 2 }));
  const pressures = ranked
    .map((axis): DesirePressureProjection => {
      const source = axis.sources.find((item) => item.kind === 'experience') as DesireSource;
      return {
        kind: axis.kind,
        label: axis.label,
        intensity: Math.max(0, source.contribution),
        summary: source.summary,
        sourceFactIds: source.sourceFactIds,
      };
    })
    .filter((pressure) => pressure.intensity >= 4)
    .sort((left, right) => right.intensity - left.intensity || stableCompare(left.kind, right.kind))
    .slice(0, 4);
  return {
    version: 1,
    authority: 'projection',
    characterId: character.id,
    projectedTurn: world.turn,
    axes: ranked,
    coreDesireKinds: ranked.slice(0, 2).map((axis) => axis.kind),
    pressures,
  };
}
