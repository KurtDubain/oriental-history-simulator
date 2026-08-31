import type {
  ArmyState,
  CharacterState,
  CommitmentState,
  FactionState,
  FamilyState,
  OfficeAppointment,
  PolityState,
  RelationshipState,
  WorldState,
} from '../types';
import type { SimulationFact } from '../facts';
import type {
  SituationCandidateObservation,
  SituationDetector,
  SituationEvidenceRef,
  SituationOutcomeOption,
  SituationParticipants,
  SituationSignal,
  SituationSignalRole,
  SituationTemplate,
  SituationWatchSignal,
} from './types';

export const MILITARY_POWER_CRISIS_TYPE = 'military_power_crisis';

export const MILITARY_POWER_CRISIS_TEMPLATE: SituationTemplate = {
  type: MILITARY_POWER_CRISIS_TYPE,
  titleKey: 'situation.military_power_crisis',
  // Eight-seed natural-world calibration keeps routine command pressure in the
  // candidate registry; only sustained upper-tail pressure becomes a crisis.
  formationThreshold: 62,
  activeEnterThreshold: 65,
  activeExitThreshold: 56,
  criticalEnterThreshold: 80,
  criticalExitThreshold: 70,
  resolutionThreshold: 20,
  formationConfirmTurns: 2,
  phaseConfirmTurns: 2,
  coolingConfirmTurns: 2,
  resolveAfterBelowTurns: 3,
  reformationCooldownTurns: 8,
  maxTensionRisePerTurn: 18,
  maxTensionFallPerTurn: 14,
};

const RECENT_COMMITMENT_TURNS = 16;
const MAX_PARTICIPANT_ARMIES = 4;
const MAX_SUPPORTERS = 6;
const MAX_OPPONENTS = 4;
const MAX_SOURCE_FACTS = 6;
const MAX_SIGNAL_REFS = 4;

type CommandRole = 'commander' | 'deputy';

interface CommandPosition {
  army: ArmyState;
  role: CommandRole;
}

export interface MilitaryPowerCrisisIndex {
  charactersById: ReadonlyMap<string, CharacterState>;
  politiesById: ReadonlyMap<string, PolityState>;
  familiesById: ReadonlyMap<string, FamilyState>;
  relationshipsByPair: ReadonlyMap<string, RelationshipState>;
  factions: readonly FactionState[];
  commitments: readonly CommitmentState[];
  offices: readonly OfficeAppointment[];
  armies: readonly ArmyState[];
  totalSoldiersByPolity: ReadonlyMap<string, number>;
}

export interface MilitaryPowerCrisisSignal extends SituationSignal {
  label: string;
  evidence: string;
  sourceFactIds: readonly string[];
}

export interface MilitaryPowerCrisisWatchSignal extends SituationWatchSignal {
  label: string;
}

export interface MilitaryPowerCrisisStartSnapshot {
  turn: number;
  actorId: string;
  polityId: string;
  primaryArmyId: string | null;
  commandRole: CommandRole;
  soldiersInReach: number;
  politySoldiers: number;
  ambition: number;
  loyalty: number;
  centralAuthority: number;
  rulerTrust: number | null;
  rulerGrievance: number | null;
  familyMobilization: number;
}

/**
 * Extended, human-auditable detector output. The base fields are consumed by
 * the Situation reducer; the aliases keep the detector independently
 * inspectable while Phase B UI/projector work is still in progress.
 */
export interface MilitaryPowerCrisisCandidate extends SituationCandidateObservation {
  type: typeof MILITARY_POWER_CRISIS_TYPE;
  candidateKey: string;
  title: string;
  hasExecutableActor: boolean;
  participants: SituationParticipants;
  executableActorIds: readonly string[];
  signals: readonly MilitaryPowerCrisisSignal[];
  structureSignals: readonly MilitaryPowerCrisisSignal[];
  triggerSignals: readonly MilitaryPowerCrisisSignal[];
  inhibitorSignals: readonly MilitaryPowerCrisisSignal[];
  sourceFactIds: readonly string[];
  nextWatch: MilitaryPowerCrisisWatchSignal;
  nextWatchSignal: MilitaryPowerCrisisWatchSignal;
  startSnapshot: MilitaryPowerCrisisStartSnapshot;
  possibleOutcomes: readonly SituationOutcomeOption[];
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[], maximum = Number.POSITIVE_INFINITY): string[] {
  return [...new Set(values)].sort(stableCompare).slice(0, maximum);
}

function relationKey(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

function indexRef(
  entityType: string,
  entityId: string,
  field: string,
  value: string | number | boolean | null,
): SituationEvidenceRef {
  return { kind: 'index', entityType, entityId, field, value };
}

function factRefs(factIds: readonly string[]): SituationEvidenceRef[] {
  return uniqueSorted(factIds, MAX_SOURCE_FACTS).map((factId) => ({ kind: 'fact', factId }));
}

function makeSignal(
  key: string,
  role: SituationSignalRole,
  contribution: number,
  label: string,
  evidence: string,
  refs: readonly SituationEvidenceRef[],
  sourceFactIds: readonly string[] = [],
): MilitaryPowerCrisisSignal {
  return {
    key,
    role,
    contribution: rounded(clamp(contribution, -30, 30)),
    label,
    evidence,
    refs: refs.slice(0, MAX_SIGNAL_REFS),
    sourceFactIds: uniqueSorted(sourceFactIds, MAX_SOURCE_FACTS),
  };
}

function sortedMap<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map([...items].sort((left, right) => stableCompare(left.id, right.id)).map((item) => [item.id, item]));
}

export function buildMilitaryPowerCrisisIndex(world: WorldState): MilitaryPowerCrisisIndex {
  const totalSoldiersByPolity = new Map<string, number>();
  for (const army of [...world.armies].sort((left, right) => stableCompare(left.id, right.id))) {
    totalSoldiersByPolity.set(
      army.polityId,
      (totalSoldiersByPolity.get(army.polityId) ?? 0) + Math.max(0, army.soldiers),
    );
  }
  return {
    charactersById: sortedMap(world.characters),
    politiesById: sortedMap(world.polities),
    familiesById: sortedMap(world.families),
    relationshipsByPair: new Map([...world.relationships]
      .sort((left, right) => stableCompare(left.id, right.id))
      .map((relationship) => [relationKey(relationship.sourceId, relationship.targetId), relationship])),
    factions: [...world.factions].sort((left, right) => stableCompare(left.id, right.id)),
    commitments: [...world.commitments].sort((left, right) => stableCompare(left.id, right.id)),
    offices: [...world.offices].sort((left, right) => stableCompare(left.id, right.id)),
    armies: [...world.armies].sort((left, right) => stableCompare(left.id, right.id)),
    totalSoldiersByPolity,
  };
}

function militaryOfficeFor(
  index: MilitaryPowerCrisisIndex,
  characterId: string,
  armyId: string,
  role: CommandRole,
): OfficeAppointment | undefined {
  const expectedKind = role === 'commander' ? '军团主帅' : '军团副将';
  return index.offices.find((office) => (
    office.active
    && office.holderId === characterId
    && office.armyId === armyId
    && office.kind === expectedKind
  ));
}

function relevantMilitaryOrders(
  index: Readonly<MilitaryPowerCrisisIndex>,
  actorId: string,
  polityId: string,
  turn: number,
): CommitmentState[] {
  const orderRank = (commitment: CommitmentState): number => {
    const promisor = commitment.promisorId === actorId;
    if (promisor && commitment.status === '背约') return 0;
    if (promisor && commitment.status === '生效') return 1;
    if (promisor && commitment.status === '履约') return 2;
    if (!promisor && commitment.status === '背约') return 3;
    return 4;
  };
  return index.commitments
    .filter((commitment) => (
      commitment.kind === '军令'
      && commitment.polityIds.includes(polityId)
      && (commitment.promisorId === actorId || commitment.promiseeId === actorId)
      && (
        commitment.status === '生效'
        || (
          commitment.resolvedTurn !== null
          && turn - commitment.resolvedTurn <= RECENT_COMMITMENT_TURNS
        )
      )
    ))
    .sort((left, right) => (
      orderRank(left) - orderRank(right)
      || (right.resolvedTurn ?? right.madeTurn) - (left.resolvedTurn ?? left.madeTurn)
      || stableCompare(left.id, right.id)
    ))
    .slice(0, 1);
}

function battleParticipation(fact: SimulationFact, actorId: string): { role: CommandRole; won: boolean } | null {
  if (fact.kind !== 'battle') return null;
  const forces = [fact.payload.attacker, ...fact.payload.defenders];
  const force = forces.find((item) => item.commanderId === actorId || item.deputyCommanderId === actorId);
  if (!force) return null;
  const attackerSide = force.armyId === fact.payload.attacker.armyId;
  return {
    role: force.commanderId === actorId ? 'commander' : 'deputy',
    won: attackerSide ? fact.payload.attackerWon : !fact.payload.attackerWon,
  };
}

function relationshipContribution(relationship: RelationshipState): number {
  return clamp(
    relationship.grievance * 0.11
      + Math.max(0, 50 - relationship.trust) * 0.12
      - relationship.gratitude * 0.08
      - Math.max(0, relationship.affinity - 55) * 0.05
      - relationship.fear * 0.035,
    -12,
    14,
  );
}

function familyMobilizationScore(
  family: FamilyState | undefined,
  actor: CharacterState,
  index: Readonly<MilitaryPowerCrisisIndex>,
): { score: number; supportingIds: string[]; refs: SituationEvidenceRef[]; explanation: string } {
  if (!family?.active) {
    return {
      score: 0,
      supportingIds: [],
      refs: [indexRef('character', actor.id, 'familyId', actor.familyId || null)],
      explanation: '没有可核验的活跃家族资源',
    };
  }
  const head = index.charactersById.get(family.headId);
  const headRelation = head && head.id !== actor.id
    ? index.relationshipsByPair.get(relationKey(head.id, actor.id))
    : undefined;
  const livingMilitaryMembers = family.memberIds
    .map((id) => index.charactersById.get(id))
    .filter((member): member is CharacterState => Boolean(
      member?.alive
      && member.id !== actor.id
      && (member.commandingArmyId || member.deputyExperience >= 18),
    ))
    .sort((left, right) => stableCompare(left.id, right.id));
  const resourceBase = family.prestige * 0.22
    + family.politicalInfluence * 0.25
    + family.traditions.military * 0.28
    + Math.min(100, family.wealth / 3) * 0.1;
  const controlFactor = family.headId === actor.id
    ? 1
    : headRelation
      ? clamp((headRelation.trust + headRelation.affinity + headRelation.gratitude - headRelation.grievance) / 180, 0, 1)
      : 0.25;
  const score = clamp(resourceBase * controlFactor + livingMilitaryMembers.length * 5, 0, 100);
  const supporters = [
    ...(family.headId !== actor.id && head?.alive && controlFactor >= 0.5 ? [family.headId] : []),
    ...livingMilitaryMembers.map((member) => member.id),
  ];
  const refs: SituationEvidenceRef[] = [
    indexRef('family', family.id, 'headId', family.headId),
    indexRef('family', family.id, 'prestige', family.prestige),
    indexRef('family', family.id, 'politicalInfluence', family.politicalInfluence),
    indexRef('family', family.id, 'traditions.military', family.traditions.military),
    indexRef('family', family.id, 'wealth', family.wealth),
  ];
  if (headRelation) refs.push(indexRef('relationship', headRelation.id, 'trust', headRelation.trust));
  return {
    score,
    supportingIds: uniqueSorted(supporters, MAX_SUPPORTERS),
    refs,
    explanation: family.headId === actor.id
      ? `本人为家主，可直接调动家族资源；可动员度${Math.round(score)}`
      : `家族资源需经家主与亲族关系转化；可动员度${Math.round(score)}`,
  };
}

function possibleOutcomes(
  pressure: number,
  actor: CharacterState,
  polity: PolityState,
  hasExecutableActor: boolean,
  hasBrokenOrder: boolean,
): SituationOutcomeOption[] {
  const normalize = (value: number): number => Math.round(clamp(value));
  return [
    { key: 'appeased_or_promoted', confidence: normalize(actor.loyalty * 0.45 + polity.authority * 0.25 + (100 - pressure) * 0.2) },
    { key: 'recalled_or_reassigned', confidence: normalize(polity.authority * 0.45 + actor.caution * 0.25 + pressure * 0.15) },
    { key: 'order_refused', confidence: normalize((100 - actor.loyalty) * 0.35 + actor.insubordination * 0.3 + (hasBrokenOrder ? 25 : 0)) },
    { key: 'court_purge', confidence: normalize(polity.authority * 0.28 + actor.ambition * 0.2 + pressure * 0.28) },
    { key: 'armed_breakaway', confidence: normalize(hasExecutableActor ? pressure * 0.48 + actor.ambition * 0.25 + (100 - actor.loyalty) * 0.2 : pressure * 0.2) },
  ].sort((left, right) => right.confidence - left.confidence || stableCompare(left.key, right.key));
}

function buildResolutionCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<MilitaryPowerCrisisIndex> },
  fact: SimulationFact,
  actor: CharacterState,
  polity: PolityState,
  outcomeKey: 'actor_died' | 'command_removed',
  primaryArmyId: string | null,
  commandRole: CommandRole,
): MilitaryPowerCrisisCandidate {
  const scopeKey = `${polity.id}:${actor.id}`;
  const candidateKey = `${MILITARY_POWER_CRISIS_TYPE}:${scopeKey}`;
  const outcomeSignal = makeSignal(
    outcomeKey,
    'outcome',
    -30,
    outcomeKey === 'actor_died' ? '军权主体死亡' : '军职已经解除',
    outcomeKey === 'actor_died'
      ? `${actor.name}死亡，已不能继续执行军令或控制军团`
      : `${actor.name}的军职已由任命终止事实解除，且当前没有剩余陆军职位`,
    [{ kind: 'fact', factId: fact.id }],
    [fact.id],
  );
  const nextWatch: MilitaryPowerCrisisWatchSignal = {
    key: outcomeKey === 'actor_died' ? 'watch_command_succession' : 'watch_post_command_settlement',
    label: outcomeKey === 'actor_died'
      ? '观察军团由谁接掌，以及旧有军中与家族网络流向何处'
      : '观察解除军职后是否出现安置、清洗、再任命或余部追随',
    refs: [{ kind: 'fact', factId: fact.id }],
  };
  return {
    type: MILITARY_POWER_CRISIS_TYPE,
    scopeKey,
    candidateKey,
    title: `${actor.name}与${polity.shortName}军权`,
    pressure: 0,
    hasExecutableActor: false,
    participants: {
      coreCharacterIds: [actor.id],
      supportingCharacterIds: [],
      opposingCharacterIds: [],
      familyIds: actor.familyId ? [actor.familyId] : [],
      factionIds: [],
      polityIds: [polity.id],
      regionIds: uniqueSorted(fact.regionIds, 4),
      armyIds: primaryArmyId ? [primaryArmyId] : [],
      fleetIds: [],
    },
    executableActorIds: [],
    signals: [outcomeSignal],
    structureSignals: [],
    triggerSignals: [],
    inhibitorSignals: [],
    sourceFactIds: [fact.id],
    nextWatch,
    nextWatchSignal: nextWatch,
    startSnapshot: {
      turn: context.turn,
      actorId: actor.id,
      polityId: polity.id,
      primaryArmyId,
      commandRole,
      soldiersInReach: 0,
      politySoldiers: context.index.totalSoldiersByPolity.get(polity.id) ?? 0,
      ambition: actor.ambition,
      loyalty: actor.loyalty,
      centralAuthority: polity.authority,
      rulerTrust: null,
      rulerGrievance: null,
      familyMobilization: 0,
    },
    possibleOutcomes: [],
    resolution: { outcomeKey, resultFactIds: [fact.id] },
    importance: Math.max(40, fact.importance * 20),
    visibility: Math.max(50, fact.importance * 20),
  };
}

function buildCandidate(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<MilitaryPowerCrisisIndex> },
  actor: CharacterState,
  polity: PolityState,
  positions: readonly CommandPosition[],
): MilitaryPowerCrisisCandidate | null {
  const { index } = context;
  const orderedPositions = [...positions].sort((left, right) => (
    (left.role === 'commander' ? 0 : 1) - (right.role === 'commander' ? 0 : 1)
    || right.army.soldiers - left.army.soldiers
    || stableCompare(left.army.id, right.army.id)
  ));
  const primary = orderedPositions[0];
  const ruler = index.charactersById.get(polity.rulerId);
  if (!primary || !ruler || actor.id === ruler.id) return null;

  const structureSignals: MilitaryPowerCrisisSignal[] = [];
  const triggerSignals: MilitaryPowerCrisisSignal[] = [];
  const inhibitorSignals: MilitaryPowerCrisisSignal[] = [];
  const add = (signal: MilitaryPowerCrisisSignal): void => {
    if (signal.role === 'trigger') triggerSignals.push(signal);
    else if (signal.role === 'inhibitor') inhibitorSignals.push(signal);
    else structureSignals.push(signal);
  };

  const mainPositions = orderedPositions.filter((position) => position.role === 'commander');
  const deputyPositions = orderedPositions.filter((position) => position.role === 'deputy');
  const soldiersInReach = mainPositions.reduce((sum, position) => sum + position.army.soldiers, 0);
  const politySoldiers = index.totalSoldiersByPolity.get(polity.id) ?? 0;
  const armyShare = soldiersInReach / Math.max(1, politySoldiers);
  const office = militaryOfficeFor(index, actor.id, primary.army.id, primary.role);
  const deputyFooting = actor.deputyExperience * 0.4 + actor.merit * 0.35 + actor.renown * 0.25;
  const commandContribution = primary.role === 'commander'
    ? 10 + clamp(armyShare * 16, 2, 16) + (office ? 2 : 0)
    : 4 + clamp((deputyFooting - 25) * 0.12, 0, 9) + (office ? 2 : 0);
  add(makeSignal(
    primary.role === 'commander' ? 'actual_army_command' : 'deputy_command_position',
    'capability',
    commandContribution,
    primary.role === 'commander' ? '实际主帅军令' : '副将军中位置',
    primary.role === 'commander'
      ? `${actor.name}当前实际统率${mainPositions.length}支军团，直接掌握${soldiersInReach}兵，占本国陆军${Math.round(armyShare * 100)}%`
      : `${actor.name}是${primary.army.name}登记副将；副将经验${actor.deputyExperience}、战功${actor.merit}、声望${actor.renown}`,
    primary.role === 'commander'
      ? [
        indexRef('army', primary.army.id, 'commanderId', actor.id),
        indexRef('character', actor.id, 'commandingArmyId', actor.commandingArmyId),
        indexRef('character', actor.id, 'directSoldiers', soldiersInReach),
        indexRef('polity', polity.id, 'totalArmySoldiers', politySoldiers),
      ]
      : [
        indexRef('army', primary.army.id, 'deputyCommanderId', actor.id),
        indexRef('office', office?.id ?? `missing:${actor.id}:${primary.army.id}`, 'active', Boolean(office)),
        indexRef('character', actor.id, 'deputyExperience', actor.deputyExperience),
        indexRef('character', actor.id, 'merit', actor.merit),
      ],
  ));

  if (actor.ambition >= 50) {
    add(makeSignal(
      'high_ambition', 'structural', clamp((actor.ambition - 45) * 0.28, 0, 15),
      '权位野心', `野心${actor.ambition}提高争取独立军令或抗拒削权的动机`,
      [indexRef('character', actor.id, 'ambition', actor.ambition)],
    ));
  } else {
    add(makeSignal(
      'low_ambition', 'inhibitor', -clamp((50 - actor.ambition) * 0.16, 1, 8),
      '野心有限', `野心${actor.ambition}抑制夺取更高军权的动机`,
      [indexRef('character', actor.id, 'ambition', actor.ambition)],
    ));
  }

  if (actor.loyalty <= 62) {
    add(makeSignal(
      'weak_loyalty', 'structural', clamp((68 - actor.loyalty) * 0.3, 1, 18),
      '忠诚松动', `忠诚${actor.loyalty}降低服从朝廷与现有军令链的约束`,
      [indexRef('character', actor.id, 'loyalty', actor.loyalty)],
    ));
  } else {
    add(makeSignal(
      'strong_loyalty', 'inhibitor', -clamp((actor.loyalty - 58) * 0.22, 1, 10),
      '忠诚约束', `忠诚${actor.loyalty}抑制拒令、割据和叛乱`,
      [indexRef('character', actor.id, 'loyalty', actor.loyalty)],
    ));
  }

  if (polity.authority <= 60) {
    add(makeSignal(
      'weak_central_authority', 'structural', clamp((66 - polity.authority) * 0.32, 1, 20),
      '中央权威不足', `中央权威${polity.authority}使召还、换帅与军饷控制更难执行`,
      [indexRef('polity', polity.id, 'authority', polity.authority)],
    ));
  } else {
    add(makeSignal(
      'strong_central_authority', 'inhibitor', -clamp((polity.authority - 56) * 0.22, 1, 11),
      '中央仍能制军', `中央权威${polity.authority}提高召还、调任和制裁的可信度`,
      [indexRef('polity', polity.id, 'authority', polity.authority)],
    ));
  }

  const actorToRuler = index.relationshipsByPair.get(relationKey(actor.id, ruler.id));
  const rulerToActor = index.relationshipsByPair.get(relationKey(ruler.id, actor.id));
  const ministerPressure = actorToRuler ? relationshipContribution(actorToRuler) : 0;
  const courtSuspicion = rulerToActor
    ? clamp(
      rulerToActor.grievance * 0.09 + rulerToActor.fear * 0.07
        + Math.max(0, 48 - rulerToActor.trust) * 0.1 - rulerToActor.gratitude * 0.06,
      -8,
      13,
    )
    : 0;
  const courtRelationshipContribution = clamp(ministerPressure + courtSuspicion, -18, 22);
  const courtRelationshipRole: SituationSignalRole = courtRelationshipContribution < 0
    ? 'inhibitor'
    : courtSuspicion >= 5
      ? 'trigger'
      : 'structural';
  add(makeSignal(
    actorToRuler || rulerToActor ? 'ruler_court_relationship' : 'ruler_court_relationship_unrecorded',
    courtRelationshipRole,
    courtRelationshipContribution,
    !actorToRuler && !rulerToActor
      ? '君臣关系尚无记录'
      : courtRelationshipContribution > 0
        ? '君臣互疑'
        : '君臣关系缓和',
    !actorToRuler && !rulerToActor
      ? '没有可核验的有向关系记录，因此不把未知关系计作敌意或信任'
      : `将领对君主${actorToRuler ? `信任${actorToRuler.trust}、积怨${actorToRuler.grievance}` : '无记录'}；君主对将领${rulerToActor ? `信任${rulerToActor.trust}、畏惧${rulerToActor.fear}、积怨${rulerToActor.grievance}` : '无记录'}`,
    [
      ...(actorToRuler ? [
        indexRef('relationship', actorToRuler.id, 'trust', actorToRuler.trust),
        indexRef('relationship', actorToRuler.id, 'grievance', actorToRuler.grievance),
      ] : [indexRef('character', actor.id, 'polityId', actor.polityId)]),
      ...(rulerToActor ? [
        indexRef('relationship', rulerToActor.id, 'trust', rulerToActor.trust),
        indexRef('relationship', rulerToActor.id, 'fear', rulerToActor.fear),
      ] : [indexRef('polity', polity.id, 'rulerId', ruler.id)]),
    ],
  ));

  const directCommander = primary.role === 'deputy'
    ? index.charactersById.get(primary.army.commanderId)
    : undefined;
  const chainRelation = directCommander
    ? index.relationshipsByPair.get(relationKey(actor.id, directCommander.id))
    : undefined;
  if (chainRelation) {
    const contribution = relationshipContribution(chainRelation) * 0.9;
    add(makeSignal(
      'chain_of_command_relationship', contribution > 0 ? 'trigger' : 'inhibitor', contribution,
      contribution > 0 ? '主副将失和' : '主副将互信',
      `对主帅信任${chainRelation.trust}、积怨${chainRelation.grievance}、感激${chainRelation.gratitude}`,
      [
        indexRef('relationship', chainRelation.id, 'trust', chainRelation.trust),
        indexRef('relationship', chainRelation.id, 'grievance', chainRelation.grievance),
      ],
    ));
  }

  const orders = relevantMilitaryOrders(index, actor.id, polity.id, context.turn);
  let activeExecutableOrder: CommitmentState | undefined;
  let hasBrokenOrder = false;
  for (const order of orders) {
    const isPromisor = order.promisorId === actor.id;
    const recentResolution = order.resolvedTurn !== null
      && context.turn - order.resolvedTurn <= RECENT_COMMITMENT_TURNS;
    if (isPromisor && order.status === '生效') {
      activeExecutableOrder = order;
      const duePressure = order.dueTurn !== null && order.dueTurn <= context.turn + 4 ? 3 : 0;
      add(makeSignal(
        'active_military_order', 'structural', 3 + duePressure,
        '生效军令', `${actor.name}仍须履行军令；其状态提供了可执行的服从或拒令节点`,
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'promiseeId', order.promiseeId),
          indexRef('commitment', order.id, 'dueTurn', order.dueTurn),
        ],
      ));
    } else if (isPromisor && order.status === '背约' && recentResolution) {
      hasBrokenOrder = true;
      add(makeSignal(
        'military_order_breached', 'trigger', clamp(17 - Math.max(0, context.turn - (order.resolvedTurn ?? context.turn)) * 0.7, 6, 17),
        '近期拒令或背约', `${actor.name}已使军令承诺进入背约状态`,
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'resolvedTurn', order.resolvedTurn),
        ],
      ));
    } else if (isPromisor && order.status === '履约' && recentResolution) {
      add(makeSignal(
        'military_order_fulfilled', 'inhibitor', -clamp(9 - Math.max(0, context.turn - (order.resolvedTurn ?? context.turn)) * 0.4, 2, 9),
        '近期履行军令', `${actor.name}近期履约，提供了真实的服从证据`,
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'resolvedTurn', order.resolvedTurn),
        ],
      ));
    } else if (!isPromisor && order.status === '背约' && recentResolution) {
      add(makeSignal(
        'subordinate_order_breached', 'trigger', 5,
        '麾下军令链破裂', '麾下副将近期背约，主帅对军团的实际控制受到挑战',
        [
          indexRef('commitment', order.id, 'status', order.status),
          indexRef('commitment', order.id, 'promisorId', order.promisorId),
        ],
      ));
    }
  }

  // The detector contract receives the current turn buffer. Rechecking turn here
  // prevents an accidental archive input from turning an old battle into a new trigger.
  const currentFacts = context.facts.filter((fact) => fact.turn === context.turn);
  const battleFacts = currentFacts
    .map((fact) => ({ fact, participation: battleParticipation(fact, actor.id) }))
    .filter((item): item is { fact: SimulationFact & { kind: 'battle' }; participation: { role: CommandRole; won: boolean } } => (
      item.fact.kind === 'battle' && item.participation !== null
    ));
  if (battleFacts.length > 0) {
    const wins = battleFacts.filter((item) => item.participation.won).length;
    const losses = battleFacts.length - wins;
    const contribution = clamp(battleFacts.length * 1.5 + (wins - losses) * 2.5, -6, 13);
    add(makeSignal(
      'recent_battle_record', contribution >= 0 ? 'trigger' : 'inhibitor', contribution,
      contribution >= 0 ? '近期战功与军望' : '近期败绩',
      `本季有${battleFacts.length}场可核验会战，${wins}胜${losses}负`,
      factRefs(battleFacts.map((item) => item.fact.id)),
      battleFacts.map((item) => item.fact.id),
    ));
  }

  const appointmentFacts = currentFacts.filter((fact) => (
    (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
    && fact.payload.holderId === actor.id
    && (fact.payload.officeKind === '军团主帅' || fact.payload.officeKind === '军团副将')
  ));
  const endedAppointments = appointmentFacts.filter((fact) => fact.kind === 'appointment_ended');
  const startedAppointments = appointmentFacts.filter((fact) => fact.kind === 'appointment_started');
  if (endedAppointments.length > 0) {
    add(makeSignal(
      'recent_command_removed', 'trigger', 8,
      '近期削去军职', '任命事实记录显示军职近期终止，可能触发拒绝召还、安抚或清洗',
      factRefs(endedAppointments.map((fact) => fact.id)),
      endedAppointments.map((fact) => fact.id),
    ));
  } else if (startedAppointments.length > 0) {
    add(makeSignal(
      'recent_command_granted', 'trigger', 4,
      '近期授予军职', '任命事实记录显示军权刚刚扩大，朝廷与将领尚在重新校准关系',
      factRefs(startedAppointments.map((fact) => fact.id)),
      startedAppointments.map((fact) => fact.id),
    ));
  }

  const currentArmies = orderedPositions.map((position) => position.army);
  const readiness = currentArmies.reduce((sum, army) => (
    sum + army.morale * 0.35 + army.training * 0.28 + army.supply * 0.22 + army.experience * 0.15
  ), 0) / Math.max(1, currentArmies.length);
  const readinessContribution = clamp((readiness - 42) * 0.12, -6, 8);
  add(makeSignal(
    'army_operational_readiness', readinessContribution >= 0 ? 'capability' : 'inhibitor', readinessContribution,
    readinessContribution >= 0 ? '军团具备行动能力' : '军团战备不足',
    `相关军团综合战备${Math.round(readiness)}；战备只代表行动能力，不等同于个人忠诚`,
    [
      indexRef('army', primary.army.id, 'morale', primary.army.morale),
      indexRef('army', primary.army.id, 'training', primary.army.training),
      indexRef('army', primary.army.id, 'supply', primary.army.supply),
      indexRef('army', primary.army.id, 'experience', primary.army.experience),
    ],
  ));

  const actorFactions = index.factions.filter((faction) => (
    faction.active
    && faction.polityId === polity.id
    && (faction.id === actor.factionId || faction.leaderId === actor.id || faction.memberIds.includes(actor.id))
  ));
  const bestPoliticalFaction = [...actorFactions].sort((left, right) => (
    right.power * right.cohesion - left.power * left.cohesion || stableCompare(left.id, right.id)
  ))[0];
  if (bestPoliticalFaction) {
    const factionSupport = bestPoliticalFaction.power * bestPoliticalFaction.cohesion / 100;
    add(makeSignal(
      'military_network_support', 'capability', clamp(factionSupport * 0.13, 1, 13),
      '政治网络支持', `${bestPoliticalFaction.name}权势${bestPoliticalFaction.power}、凝聚${bestPoliticalFaction.cohesion}`,
      [
        indexRef('faction', bestPoliticalFaction.id, 'power', bestPoliticalFaction.power),
        indexRef('faction', bestPoliticalFaction.id, 'cohesion', bestPoliticalFaction.cohesion),
        indexRef('faction', bestPoliticalFaction.id, 'leaderId', bestPoliticalFaction.leaderId),
      ],
    ));
  }

  const family = index.familiesById.get(actor.familyId);
  const familySupport = familyMobilizationScore(family, actor, index);
  if (familySupport.score >= 20) {
    add(makeSignal(
      'family_mobilization_capacity', 'capability', clamp((familySupport.score - 12) * 0.12, 1, 11),
      '家族可动员支撑', familySupport.explanation, familySupport.refs,
    ));
  } else {
    add(makeSignal(
      'weak_family_base', 'inhibitor', -clamp((25 - familySupport.score) * 0.16, 1, 6),
      '家族支撑有限', `${familySupport.explanation}；这不是家族已经表态支持的证据`, familySupport.refs,
    ));
  }

  const signals = [...structureSignals, ...triggerSignals, ...inhibitorSignals];
  const pressure = Math.round(clamp(8 + signals.reduce((sum, signal) => sum + signal.contribution, 0)));
  const hasMainCommand = mainPositions.some((position) => position.army.soldiers > 0);
  const hasExecutableActor = hasMainCommand || Boolean(activeExecutableOrder && deputyPositions.length > 0);
  const supporters = uniqueSorted([
    ...familySupport.supportingIds,
    ...(bestPoliticalFaction
      ? bestPoliticalFaction.memberIds.filter((id) => id !== actor.id && index.charactersById.get(id)?.alive)
      : []),
    ...mainPositions.flatMap((position) => {
      const deputyId = position.army.deputyCommanderId;
      if (!deputyId) return [];
      const deputyRelation = index.relationshipsByPair.get(relationKey(deputyId, actor.id));
      return deputyRelation && deputyRelation.trust + deputyRelation.gratitude >= 90 && deputyRelation.grievance < 35
        ? [deputyId]
        : [];
    }),
  ], MAX_SUPPORTERS);
  const opponents = uniqueSorted([
    ruler.id,
    ...(directCommander ? [directCommander.id] : []),
  ].filter((id) => id !== actor.id), MAX_OPPONENTS);
  const participants: SituationParticipants = {
    coreCharacterIds: [actor.id],
    supportingCharacterIds: supporters,
    opposingCharacterIds: opponents,
    familyIds: family?.active ? [family.id] : [],
    factionIds: bestPoliticalFaction ? [bestPoliticalFaction.id] : [],
    polityIds: [polity.id],
    regionIds: uniqueSorted(orderedPositions.map((position) => position.army.regionId), 4),
    armyIds: uniqueSorted(orderedPositions.map((position) => position.army.id), MAX_PARTICIPANT_ARMIES),
    fleetIds: [],
  };
  const sourceFactIds = uniqueSorted(signals.flatMap((signal) => signal.sourceFactIds), MAX_SOURCE_FACTS);
  const nextWatch = (() => {
    if (activeExecutableOrder) {
      return {
        key: 'watch_military_order_resolution',
        label: '观察这道军令会被履行、拒绝，还是随升迁而解除',
        refs: [indexRef('commitment', activeExecutableOrder.id, 'status', activeExecutableOrder.status)],
      } satisfies MilitaryPowerCrisisWatchSignal;
    }
    if (primary.role === 'deputy') {
      return {
        key: 'watch_independent_command',
        label: '观察副将是否获得独立军令、积累新战功或与主帅失和',
        refs: [
          indexRef('army', primary.army.id, 'commanderId', primary.army.commanderId),
          indexRef('army', primary.army.id, 'deputyCommanderId', primary.army.deputyCommanderId),
          indexRef('character', actor.id, 'merit', actor.merit),
        ],
      } satisfies MilitaryPowerCrisisWatchSignal;
    }
    if (polity.authority <= 60 || rulerToActor) {
      return {
        key: 'watch_recall_or_refusal',
        label: '观察朝廷是否召还、调任或安抚主帅，以及主帅是否服从',
        refs: [
          indexRef('polity', polity.id, 'authority', polity.authority),
          indexRef('army', primary.army.id, 'commanderId', primary.army.commanderId),
          ...(rulerToActor ? [indexRef('relationship', rulerToActor.id, 'trust', rulerToActor.trust)] : []),
        ],
      } satisfies MilitaryPowerCrisisWatchSignal;
    }
    return {
      key: 'watch_command_and_army_support',
      label: '观察军职是否变化，以及战功、政治网络和家族可动员支撑是否继续扩大',
      refs: [
        indexRef('army', primary.army.id, 'commanderId', primary.army.commanderId),
        indexRef('character', actor.id, 'merit', actor.merit),
        indexRef('polity', polity.id, 'authority', polity.authority),
      ],
    } satisfies MilitaryPowerCrisisWatchSignal;
  })();
  const scopeKey = `${polity.id}:${actor.id}`;
  const candidateKey = `${MILITARY_POWER_CRISIS_TYPE}:${scopeKey}`;
  return {
    type: MILITARY_POWER_CRISIS_TYPE,
    scopeKey,
    candidateKey,
    title: `${actor.name}与${polity.shortName}军权`,
    pressure,
    hasExecutableActor,
    participants,
    executableActorIds: hasExecutableActor ? [actor.id] : [],
    signals,
    structureSignals,
    triggerSignals,
    inhibitorSignals,
    sourceFactIds,
    nextWatch,
    nextWatchSignal: nextWatch,
    startSnapshot: {
      turn: context.turn,
      actorId: actor.id,
      polityId: polity.id,
      primaryArmyId: primary.army.id,
      commandRole: primary.role,
      soldiersInReach,
      politySoldiers,
      ambition: actor.ambition,
      loyalty: actor.loyalty,
      centralAuthority: polity.authority,
      rulerTrust: actorToRuler?.trust ?? null,
      rulerGrievance: actorToRuler?.grievance ?? null,
      familyMobilization: Math.round(familySupport.score),
    },
    possibleOutcomes: possibleOutcomes(pressure, actor, polity, hasExecutableActor, hasBrokenOrder),
    importance: Math.round(clamp(35 + pressure * 0.65)),
    visibility: Math.round(clamp(30 + pressure * 0.55 + (sourceFactIds.length > 0 ? 8 : 0))),
    resolution: null,
  };
}

function detectMilitaryPowerCrisis(
  context: { turn: number; facts: readonly SimulationFact[]; index: Readonly<MilitaryPowerCrisisIndex> },
): readonly MilitaryPowerCrisisCandidate[] {
  const positionsByActor = new Map<string, CommandPosition[]>();
  for (const army of context.index.armies) {
    const polity = context.index.politiesById.get(army.polityId);
    if (!polity?.alive) continue;
    const addPosition = (characterId: string | null, role: CommandRole): void => {
      if (!characterId) return;
      const character = context.index.charactersById.get(characterId);
      if (!character?.alive || character.polityId !== polity.id || character.id === polity.rulerId) return;
      const key = `${polity.id}:${character.id}`;
      const positions = positionsByActor.get(key) ?? [];
      positions.push({ army, role });
      positionsByActor.set(key, positions);
    };
    addPosition(army.commanderId, 'commander');
    addPosition(army.deputyCommanderId, 'deputy');
  }

  const candidates: MilitaryPowerCrisisCandidate[] = [];
  for (const key of [...positionsByActor.keys()].sort(stableCompare)) {
    const positions = positionsByActor.get(key) ?? [];
    const actor = context.index.charactersById.get(key.slice(key.indexOf(':') + 1));
    const polity = context.index.politiesById.get(key.slice(0, key.indexOf(':')));
    if (!actor || !polity) continue;
    const candidate = buildCandidate(context, actor, polity, positions);
    if (candidate) candidates.push(candidate);
  }

  const observedScopes = new Set(candidates.map((candidate) => candidate.scopeKey));
  const currentFacts = context.facts
    .filter((fact) => fact.turn === context.turn)
    .sort((left, right) => stableCompare(left.id, right.id));
  for (const fact of currentFacts) {
    if (fact.kind !== 'character_death') continue;
    const actor = context.index.charactersById.get(fact.payload.characterId);
    const hasMilitaryRecord = fact.payload.role === '将领' || context.index.offices.some((office) => (
      office.holderId === fact.payload.characterId
      && (office.kind === '军团主帅' || office.kind === '军团副将')
    ));
    if (!actor || !hasMilitaryRecord) continue;
    const polityId = fact.polityIds[0] ?? actor.polityId;
    const polity = context.index.politiesById.get(polityId);
    if (!polity) continue;
    const scopeKey = `${polity.id}:${actor.id}`;
    if (observedScopes.has(scopeKey)) continue;
    const lastMilitaryOffice = [...context.index.offices]
      .filter((office) => (
        office.holderId === actor.id
        && (office.kind === '军团主帅' || office.kind === '军团副将')
      ))
      .sort((left, right) => right.appointedTurn - left.appointedTurn || stableCompare(left.id, right.id))[0];
    candidates.push(buildResolutionCandidate(
      context,
      fact,
      actor,
      polity,
      'actor_died',
      lastMilitaryOffice?.armyId ?? null,
      lastMilitaryOffice?.kind === '军团副将' ? 'deputy' : 'commander',
    ));
    observedScopes.add(scopeKey);
  }
  for (const fact of currentFacts) {
    if (
      fact.kind !== 'appointment_ended'
      || (fact.payload.officeKind !== '军团主帅' && fact.payload.officeKind !== '军团副将')
    ) continue;
    const actor = context.index.charactersById.get(fact.payload.holderId);
    const polity = context.index.politiesById.get(fact.payload.polityId);
    if (!actor || !polity) continue;
    const scopeKey = `${polity.id}:${actor.id}`;
    if (observedScopes.has(scopeKey) || positionsByActor.has(scopeKey)) continue;
    candidates.push(buildResolutionCandidate(
      context,
      fact,
      actor,
      polity,
      'command_removed',
      fact.payload.armyId,
      fact.payload.officeKind === '军团副将' ? 'deputy' : 'commander',
    ));
    observedScopes.add(scopeKey);
  }
  return candidates.sort((left, right) => (
    right.pressure - left.pressure || stableCompare(left.candidateKey, right.candidateKey)
  ));
}

export const militaryPowerCrisisDetector: SituationDetector<MilitaryPowerCrisisIndex> = {
  id: MILITARY_POWER_CRISIS_TYPE,
  detect: detectMilitaryPowerCrisis,
};

export function detectMilitaryPowerCrisisCandidates(
  world: WorldState,
  facts: readonly SimulationFact[] = [],
): readonly MilitaryPowerCrisisCandidate[] {
  return detectMilitaryPowerCrisis({
    turn: world.turn,
    facts,
    index: buildMilitaryPowerCrisisIndex(world),
  });
}
