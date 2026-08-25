import { FAMILY_NAMES, GIVEN_NAMES } from './data';
import { keyedChance, keyedInt, keyedRandom, stableCompare, stableHash } from './random';
import type {
  BackgroundPersonState,
  CharacterState,
  CommitmentKind,
  CommitmentState,
  DiplomacyState,
  EventCause,
  FactionKind,
  FactionState,
  FamilyState,
  HistoryEvent,
  MemoryKind,
  OfficeAppointment,
  PolityState,
  RelationshipState,
  Season,
  StateDelta,
  WorldState,
} from './types';

interface V02TurnContext {
  turn: number;
  year: number;
  season: Season;
  events: HistoryEvent[];
}

interface V02EventInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  evidence?: string[];
  stateDeltas?: StateDelta[];
}

type EmitEvent = (input: V02EventInput) => HistoryEvent;

const MAX_MEMORIES_PER_RELATIONSHIP = 8;
const MAX_BIOGRAPHY_FACTS = 80;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lifeStage(age: number, alive: boolean): CharacterState['lifeStage'] {
  if (!alive) return '已故';
  if (age < 8) return '幼年';
  if (age < 16) return '成长';
  if (age < 30) return '成年';
  if (age < 60) return '盛年';
  return '衰老';
}

function livingAdults(world: WorldState, polityId?: string): CharacterState[] {
  return world.characters
    .filter((character) => character.alive && character.age >= 16 && (!polityId || character.polityId === polityId))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function addBiography(
  character: CharacterState,
  event: HistoryEvent,
  kind: string,
  summary = event.summary,
  importance = event.importance,
): void {
  if (character.biography.some((fact) => fact.eventId === event.id && fact.kind === kind)) return;
  character.biography.push({
    id: `${character.id}:bio:${event.id}:${kind}`,
    turn: event.turn,
    kind,
    summary,
    importance,
    eventId: event.id,
  });
  if (character.biography.length > MAX_BIOGRAPHY_FACTS) {
    character.biography.splice(0, character.biography.length - MAX_BIOGRAPHY_FACTS);
  }
  character.biographyDigest = stableHash(character.biography);
}

function createFamily(world: WorldState, founder: CharacterState, parentFamilyId: string | null = null, branchName: string | null = null): FamilyState {
  world.counters.family += 1;
  const family: FamilyState = {
    id: `f_${String(world.counters.family).padStart(4, '0')}`,
    name: branchName ? `${founder.familyName}氏·${branchName}` : `${founder.familyName}氏`,
    familyName: founder.familyName,
    polityId: founder.polityId,
    founderId: founder.id,
    headId: founder.id,
    parentFamilyId,
    branchName,
    foundedTurn: world.turn,
    memberIds: [founder.id],
    prestige: clamp(18 + founder.renown * 0.55 + founder.influence * 0.25),
    wealth: Math.max(0, Math.round(founder.personalWealth * 3)),
    politicalInfluence: clamp(founder.influence),
    traditions: {
      political: clamp((founder.governance + founder.cunning) / 2),
      military: clamp((founder.leadership + founder.merit) / 2),
      commercial: clamp(20 + founder.personalWealth),
      scholarly: clamp((founder.governance + founder.cunning) / 2),
    },
    marriageAllianceFamilyIds: [],
    active: true,
    extinctTurn: null,
  };
  world.families.push(family);
  founder.familyId = family.id;
  return family;
}

function syncFamilyMembers(world: WorldState): void {
  for (const family of world.families) family.memberIds = [];
  for (const character of world.characters) {
    let family = world.families.find((item) => item.id === character.familyId);
    if (!family) {
      family = world.families
        .filter((item) => item.polityId === character.polityId && item.familyName === character.familyName)
        .sort((left, right) => stableCompare(left.id, right.id))[0];
      if (!family) family = createFamily(world, character);
      character.familyId = family.id;
    }
    if (!family.memberIds.includes(character.id)) family.memberIds.push(character.id);
  }
  for (const family of world.families) {
    family.memberIds.sort(stableCompare);
    const currentHead = world.characters.find((character) => (
      character.id === family.headId && character.alive && character.familyId === family.id
    ));
    if (!currentHead) {
      const successorId = family.memberIds
        .map((id) => world.characters.find((character) => character.id === id))
        .filter((character): character is CharacterState => Boolean(character?.alive))
        .sort((left, right) => (
          right.influence - left.influence
          || right.renown - left.renown
          || right.age - left.age
          || stableCompare(left.id, right.id)
        ))[0]?.id;
      if (successorId) {
        family.headId = successorId;
        family.active = true;
        family.extinctTurn = null;
      } else {
        family.active = false;
        family.extinctTurn ??= world.turn;
      }
    }
  }
}

function ensureRelationship(world: WorldState, sourceId: string, targetId: string): RelationshipState {
  if (sourceId === targetId) throw new Error(`Self relationship is forbidden: ${sourceId}`);
  let relation = world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
  if (relation) return relation;
  world.counters.relationship += 1;
  relation = {
    id: `rel_${String(world.counters.relationship).padStart(5, '0')}`,
    sourceId,
    targetId,
    kinship: '无',
    affinity: keyedInt(world.seed, 35, 65, 'relationship', sourceId, targetId, 'affinity'),
    trust: keyedInt(world.seed, 30, 62, 'relationship', sourceId, targetId, 'trust'),
    fear: 0,
    grievance: 0,
    gratitude: 0,
    lastInteractionTurn: world.turn,
    memories: [],
  };
  world.relationships.push(relation);
  return relation;
}

function remember(
  world: WorldState,
  sourceId: string,
  targetId: string,
  kind: MemoryKind,
  impact: number,
  summary: string,
  eventId: string,
): void {
  if (sourceId === targetId) return;
  const relation = ensureRelationship(world, sourceId, targetId);
  relation.lastInteractionTurn = world.turn;
  relation.memories.push({ turn: world.turn, kind, impact, summary, eventId });
  if (relation.memories.length > MAX_MEMORIES_PER_RELATIONSHIP) relation.memories.shift();
  if (kind === '背叛' || kind === '羞辱' || kind === '竞争') {
    relation.grievance = Math.round(clamp(relation.grievance + Math.abs(impact)));
    relation.trust = Math.round(clamp(relation.trust - Math.abs(impact) * 0.65));
  } else {
    relation.gratitude = Math.round(clamp(relation.gratitude + Math.abs(impact) * 0.6));
    relation.trust = Math.round(clamp(relation.trust + Math.abs(impact) * 0.45));
    relation.affinity = Math.round(clamp(relation.affinity + Math.abs(impact) * 0.25));
  }
}

function createCommitment(
  world: WorldState,
  kind: CommitmentKind,
  promisorId: string,
  promiseeId: string,
  polityIds: string[],
  terms: string,
  eventId: string,
  dueTurn: number | null,
  trustStake: number,
): CommitmentState {
  world.counters.commitment += 1;
  const commitment: CommitmentState = {
    id: `commit_${String(world.counters.commitment).padStart(5, '0')}`,
    kind,
    promisorId,
    promiseeId,
    polityIds: [...new Set(polityIds)].sort(stableCompare),
    terms,
    madeTurn: world.turn,
    dueTurn,
    status: '生效',
    resolvedTurn: null,
    eventId,
    resolutionEventId: null,
    trustStake,
  };
  world.commitments.push(commitment);
  return commitment;
}

function resolveCommitment(
  world: WorldState,
  commitment: CommitmentState,
  status: '履约' | '背约' | '失效',
  event: HistoryEvent,
): void {
  commitment.status = status;
  commitment.resolvedTurn = world.turn;
  commitment.resolutionEventId = event.id;
  if (status === '失效') return;
  if (!world.characters.some((character) => character.id === commitment.promisorId)) return;
  if (!world.characters.some((character) => character.id === commitment.promiseeId)) return;
  remember(
    world,
    commitment.promiseeId,
    commitment.promisorId,
    status === '背约' ? '背叛' : '恩义',
    status === '背约' ? commitment.trustStake : Math.max(4, commitment.trustStake * 0.6),
    event.summary,
    event.id,
  );
}

export function recordDiplomaticCommitmentBreach(
  world: WorldState,
  commitmentIds: readonly string[],
  breakerId: string,
  injuredId: string,
  event: HistoryEvent,
): void {
  for (const commitment of world.commitments.filter((item) => (
    commitmentIds.includes(item.id) && item.status === '生效' && item.kind === '外交盟约'
  ))) {
    commitment.status = '背约';
    commitment.resolvedTurn = world.turn;
    commitment.resolutionEventId = event.id;
    remember(
      world,
      injuredId,
      breakerId,
      '背叛',
      commitment.trustStake,
      `${breakerId}违背“${commitment.terms}”：${event.summary}`,
      event.id,
    );
  }
}

function diplomacyId(leftId: string, rightId: string): string {
  return `dip:${[leftId, rightId].sort(stableCompare).join(':')}`;
}

export function getDiplomacy(world: WorldState, leftId: string, rightId: string): DiplomacyState | undefined {
  const id = diplomacyId(leftId, rightId);
  return world.diplomacy.find((item) => item.id === id);
}

function ensureDiplomacyPairs(world: WorldState): void {
  const ordered = [...world.polities].sort((left, right) => stableCompare(left.id, right.id));
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      const polityA = ordered[left] as PolityState;
      const polityB = ordered[right] as PolityState;
      if (getDiplomacy(world, polityA.id, polityB.id)) continue;
      world.diplomacy.push({
        id: diplomacyId(polityA.id, polityB.id),
        polityAId: polityA.id,
        polityBId: polityB.id,
        status: '中立',
        threatAtoB: 20,
        threatBtoA: 20,
        trust: keyedInt(world.seed, 30, 62, 'diplomacy', polityA.id, polityB.id, 'trust'),
        grievance: keyedInt(world.seed, 0, 18, 'diplomacy', polityA.id, polityB.id, 'grievance'),
        culturalAffinity: keyedInt(world.seed, 38, 82, 'diplomacy', polityA.id, polityB.id, 'culture'),
        tradeDependency: keyedInt(world.seed, 8, 45, 'diplomacy', polityA.id, polityB.id, 'trade'),
        allianceUntilTurn: null,
        marriageIds: [],
        lastChangedTurn: world.turn,
        tradeAgreementUntilTurn: null,
        tributePayerId: null,
        tributePerTurn: 0,
        treatyEventIds: [],
      });
    }
  }
  world.diplomacy.sort((left, right) => stableCompare(left.id, right.id));
}

function factionKindFor(character: CharacterState): FactionKind {
  if (character.politicalClass === '宗室' || character.politicalClass === '外戚') return '宗室';
  if (character.politicalClass === '军门' || character.commandingArmyId || character.commandingFleetId) return '军门';
  if (character.politicalClass === '地方豪强' || character.governedRegionId) return '地方';
  if (character.politicalClass === '士族') return '士族';
  return '官僚';
}

function factionAgenda(kind: FactionKind): FactionState['agenda'] {
  if (kind === '军门') return '对外战争';
  if (kind === '地方') return '地方自治';
  if (kind === '宗室') return '维持秩序';
  if (kind === '士族') return '休养生息';
  return '扩张权势';
}

function ensureFactions(world: WorldState, polityId: string): void {
  const adults = livingAdults(world, polityId);
  if (adults.length === 0) return;
  const groups = new Map<FactionKind, CharacterState[]>();
  for (const character of adults) {
    const kind = factionKindFor(character);
    const list = groups.get(kind) ?? [];
    list.push(character);
    groups.set(kind, list);
  }
  for (const faction of world.factions.filter((item) => item.active && item.polityId === polityId && !groups.has(item.kind))) {
    faction.active = false;
    faction.endedTurn = world.turn;
    faction.alliedFactionIds = [];
    for (const other of world.factions) other.alliedFactionIds = other.alliedFactionIds.filter((id) => id !== faction.id);
  }
  for (const kind of [...groups.keys()].sort(stableCompare)) {
    const members = groups.get(kind) as CharacterState[];
    let faction = world.factions.find((item) => item.active && item.polityId === polityId && item.kind === kind);
    const leader = [...members].sort((left, right) => (
      right.influence - left.influence
      || right.renown - left.renown
      || right.cunning - left.cunning
      || stableCompare(left.id, right.id)
    ))[0] as CharacterState;
    if (!faction) {
      world.counters.faction += 1;
      faction = {
        id: `fac_${String(world.counters.faction).padStart(4, '0')}`,
        polityId,
        name: `${leader.familyName}氏${kind}派`,
        kind,
        leaderId: leader.id,
        memberIds: [],
        power: 0,
        cohesion: keyedInt(world.seed, 42, 72, 'faction', polityId, kind, 'cohesion'),
        agenda: factionAgenda(kind),
        alliedFactionIds: [],
        lastActionTurn: -100,
        active: true,
        endedTurn: null,
      };
      world.factions.push(faction);
    }
    faction.leaderId = leader.id;
    faction.memberIds = members.map((item) => item.id).sort(stableCompare);
    const averageInfluence = members.reduce((sum, member) => sum + member.influence, 0) / members.length;
    const officePower = members.reduce((sum, member) => (
      sum + (member.role === '君主' ? 22 : member.commandingArmyId || member.commandingFleetId ? 16 : member.governedRegionId ? 10 : 3)
    ), 0);
    faction.power = Math.round(clamp(averageInfluence * 0.62 + officePower + members.length * 2));
    faction.cohesion = Math.round(clamp(faction.cohesion + (members.length >= 2 ? 0.2 : -0.5)));
  }
}

function appendBackgroundPerson(world: WorldState, regionId: string, id: string, birthTurn: number, initialOpportunity: number): void {
  const region = world.regions.find((candidate) => candidate.id === regionId);
  if (!region) throw new Error(`Cannot create background cohort in missing region ${regionId}`);
  const familyName = FAMILY_NAMES[keyedInt(world.seed, 0, FAMILY_NAMES.length - 1, 'background', id, 'family')] as string;
  const givenName = GIVEN_NAMES[keyedInt(world.seed, 0, GIVEN_NAMES.length - 1, 'background', id, 'given')] as string;
  const classRoll = keyedInt(world.seed, 0, 4, 'background', id, 'class');
  const politicalClass: BackgroundPersonState['politicalClass'] = classRoll === 0
    ? '地方豪强'
    : classRoll === 1
      ? '军门'
      : classRoll === 2
        ? '士族'
        : '官僚';
  world.backgroundPeople.push({
    id,
    polityId: region.controllerId,
    regionId: region.id,
    familyName,
    givenName,
    sex: keyedChance(world.seed, 0.42, 'background', id, 'sex') ? '女' : '男',
    birthTurn,
    politicalClass,
    potential: {
      leadership: keyedInt(world.seed, 28, 88, 'background', id, 'leadership'),
      governance: keyedInt(world.seed, 28, 88, 'background', id, 'governance'),
      cunning: keyedInt(world.seed, 28, 90, 'background', id, 'cunning'),
    },
    opportunity: initialOpportunity,
    promotedCharacterId: null,
    promotedTurn: null,
  });
}

function createBackgroundPopulation(world: WorldState): void {
  if (world.backgroundPeople.length > 0) return;
  for (const region of [...world.regions].sort((left, right) => stableCompare(left.id, right.id))) {
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const id = `bg:${region.id}:${ordinal}`;
      const age = keyedInt(world.seed, 16, 42, 'background', id, 'age');
      appendBackgroundPerson(
        world,
        region.id,
        id,
        world.turn - age * 4,
        keyedInt(world.seed, 5, 45, 'background', id, 'opportunity'),
      );
    }
  }
}

function maintainBackgroundCohorts(world: WorldState, turn: number): void {
  world.backgroundPeople = world.backgroundPeople.filter((person) => (
    person.promotedCharacterId !== null || Math.floor((turn - person.birthTurn) / 4) <= 80
  ));
  for (const person of world.backgroundPeople.filter((candidate) => candidate.promotedCharacterId === null)) {
    const age = Math.floor((turn - person.birthTurn) / 4);
    if (age >= 12) person.opportunity = Math.round(clamp(person.opportunity + 1));
  }
  for (const region of [...world.regions].sort((left, right) => stableCompare(left.id, right.id))) {
    let unpromoted = world.backgroundPeople.filter((person) => (
      person.regionId === region.id && person.promotedCharacterId === null
    )).length;
    let ordinal = 1;
    while (unpromoted < 4) {
      let id = `bg:${region.id}:born:${turn}:${ordinal}`;
      while (world.backgroundPeople.some((person) => person.id === id)) {
        ordinal += 1;
        id = `bg:${region.id}:born:${turn}:${ordinal}`;
      }
      appendBackgroundPerson(world, region.id, id, turn, 0);
      unpromoted += 1;
      ordinal += 1;
    }
  }
}

export function promoteBackgroundPerson(
  world: WorldState,
  polity: PolityState,
  purpose: 'regency-ward',
  forcedFamily?: string,
): CharacterState;
export function promoteBackgroundPerson(
  world: WorldState,
  polity: PolityState,
  purpose: string,
  forcedFamily?: string,
): CharacterState | null;
export function promoteBackgroundPerson(
  world: WorldState,
  polity: PolityState,
  purpose: string,
  forcedFamily?: string,
): CharacterState | null {
  createBackgroundPopulation(world);
  const wardRegency = purpose === 'regency-ward';
  if (wardRegency) maintainBackgroundCohorts(world, world.turn);
  const minimumAge = wardRegency ? 0 : 16;
  let stub = world.backgroundPeople
    .filter((person) => (
      person.promotedCharacterId === null
      && person.polityId === polity.id
      && Math.floor((world.turn - person.birthTurn) / 4) >= minimumAge
      && Math.floor((world.turn - person.birthTurn) / 4) <= 75
    ))
    .sort((left, right) => (
      (wardRegency ? Math.floor((world.turn - right.birthTurn) / 4) * 100 : 0)
      - (wardRegency ? Math.floor((world.turn - left.birthTurn) / 4) * 100 : 0)
      || (right.opportunity + right.potential.leadership + right.potential.governance + right.potential.cunning)
      - (left.opportunity + left.potential.leadership + left.potential.governance + left.potential.cunning)
      || stableCompare(left.id, right.id)
    ))[0];
  if (!stub) {
    const regionId = polity.capitalRegionId ?? polity.controlledRegionIds[0];
    if (!regionId) throw new Error(`Cannot promote a background person for landless polity ${polity.id}`);
    stub = world.backgroundPeople
      .filter((person) => (
        person.promotedCharacterId === null
        && Math.floor((world.turn - person.birthTurn) / 4) >= minimumAge
        && Math.floor((world.turn - person.birthTurn) / 4) <= 75
      ))
      .sort((left, right) => (
        (right.opportunity + right.potential.leadership + right.potential.governance + right.potential.cunning)
        - (left.opportunity + left.potential.leadership + left.potential.governance + left.potential.cunning)
        || stableCompare(left.id, right.id)
      ))[0];
    if (stub) {
      // The person already existed in the bounded background cohort; only their
      // place of opportunity changes. Birth time and potential remain immutable.
      stub.polityId = polity.id;
      stub.regionId = regionId;
    } else {
      const occupiedRulers = new Set(world.polities.filter((item) => item.alive).map((item) => item.rulerId));
      const fallback = livingAdults(world, polity.id)
        .filter((character) => !character.commandingArmyId && !character.commandingFleetId && !character.governedRegionId && !occupiedRulers.has(character.id))
        .sort((left, right) => right.leadership + right.governance - left.leadership - left.governance || stableCompare(left.id, right.id))[0];
      if (fallback) return fallback;
      if (!wardRegency) return null;
      let ordinal = 1;
      let id = `bg:${regionId}:born:${world.turn}:ward:${ordinal}`;
      while (world.backgroundPeople.some((person) => person.id === id)) {
        ordinal += 1;
        id = `bg:${regionId}:born:${world.turn}:ward:${ordinal}`;
      }
      appendBackgroundPerson(world, regionId, id, world.turn, 0);
      stub = world.backgroundPeople.find((person) => person.id === id) as BackgroundPersonState;
    }
  }
  world.counters.character += 1;
  const id = `c_${String(world.counters.character).padStart(3, '0')}`;
  const familyName = forcedFamily ?? stub.familyName;
  let givenName = stub.givenName;
  if (world.characters.some((character) => character.name === `${familyName}${givenName}`)) givenName = `${givenName}·${world.counters.character}`;
  const age = Math.max(minimumAge, Math.floor((world.turn + 1 - stub.birthTurn) / 4));
  const character: CharacterState = {
    id,
    name: `${familyName}${givenName}`,
    familyName,
    givenName,
    sex: stub.sex,
    age,
    alive: true,
    deathTurn: null,
    polityId: polity.id,
    locationRegionId: stub.regionId,
    role: '廷臣',
    governedRegionId: null,
    commandingArmyId: null,
    commandingFleetId: null,
    leadership: stub.potential.leadership,
    governance: stub.potential.governance,
    cunning: stub.potential.cunning,
    ambition: keyedInt(world.seed, 18, 88, 'promotion', stub.id, purpose, 'ambition'),
    loyalty: keyedInt(world.seed, forcedFamily ? 58 : 32, 90, 'promotion', stub.id, purpose, 'loyalty'),
    caution: keyedInt(world.seed, 22, 88, 'promotion', stub.id, purpose, 'caution'),
    rebellionReadiness: 0,
    renown: Math.round(clamp(stub.opportunity * 0.25)),
    birthTurn: stub.birthTurn,
    adultTurn: age >= 16 ? stub.birthTurn + 16 * 4 : null,
    lifeStage: lifeStage(age, true),
    familyId: '',
    parentIds: [],
    spouseIds: [],
    politicalClass: forcedFamily || wardRegency ? '宗室' : stub.politicalClass,
    influence: Math.round(clamp(8 + stub.opportunity * 0.35)),
    personalWealth: Math.round(clamp(5 + stub.opportunity * 0.2)),
    merit: purpose.includes('commander') ? 12 : 0,
    deputyExperience: 0,
    insubordination: 0,
    biography: [],
    biographyDigest: stableHash([]),
    tier: '背景晋升',
    sourceStubId: stub.id,
    health: 100,
    activeDiseaseId: null,
    protectedUntilTurn: null,
  };
  stub.promotedCharacterId = character.id;
  stub.promotedTurn = world.turn;
  world.characters.push(character);
  syncFamilyMembers(world);
  return character;
}

function processPendingBackgroundPromotions(world: WorldState, emit: EmitEvent): void {
  for (const character of world.characters.filter((item) => item.sourceStubId && item.biography.length === 0)) {
    const stub = world.backgroundPeople.find((item) => item.id === character.sourceStubId);
    if (!stub) continue;
    const event = emit({
      category: '政治',
      kind: 'background_promoted',
      title: `${character.name}进入史册`,
      summary: `${character.name}原是${world.regions.find((region) => region.id === stub.regionId)?.name ?? '地方'}背景人口中的潜在人才，因职位缺口、机会与既定潜能被提升为具名人物。`,
      importance: 2,
      actorIds: [character.id],
      polityIds: [character.polityId],
      regionIds: [character.locationRegionId],
      causes: [
        { label: '背景潜能', role: '结构', weight: 0.3, evidence: `统率${stub.potential.leadership}、治理${stub.potential.governance}、谋略${stub.potential.cunning}在世界创建时已固定` },
        { label: '职位缺口', role: '触发', weight: 0.28, evidence: '统治或军队出现无人可任的真实职位缺口' },
        { label: '机会积累', role: '条件', weight: 0.22, evidence: `机会值${stub.opportunity}` },
        { label: '核心晋升', role: '结果', weight: 0.2, evidence: `${stub.id}→${character.id}；背景记录保留并链接` },
      ],
      stateDeltas: [{ entityType: 'character', entityId: character.id, field: 'tier', before: '背景', after: '背景晋升' }],
    });
    addBiography(character, event, '背景晋升');
  }
}

function updateCoreTiers(world: WorldState): void {
  const living = world.characters.filter((character) => character.alive);
  const coreIds = new Set(living
    .sort((left, right) => {
      const score = (character: CharacterState): number => character.influence + character.renown + character.merit
        + (character.role === '君主' ? 100 : character.commandingArmyId || character.commandingFleetId ? 55 : character.governedRegionId ? 35 : 0);
      return score(right) - score(left) || stableCompare(left.id, right.id);
    })
    .slice(0, 240)
    .map((character) => character.id));
  for (const character of world.characters) {
    if (!character.alive || !coreIds.has(character.id)) character.tier = '配角';
    else if (character.sourceStubId) character.tier = '背景晋升';
    else character.tier = '核心';
  }
}

export function ensureV02PolitySystems(world: WorldState, polityId: string): void {
  syncFamilyMembers(world);
  createBackgroundPopulation(world);
  for (const background of world.backgroundPeople.filter((person) => person.promotedCharacterId === null)) {
    const region = world.regions.find((item) => item.id === background.regionId);
    if (region) background.polityId = region.controllerId;
  }
  const polity = world.polities.find((item) => item.id === polityId);
  if (polity && !polity.rulingFamilyId) {
    const ruler = world.characters.find((character) => character.id === polity.rulerId);
    polity.rulingFamilyId = ruler?.familyId ?? null;
  }
  ensureFactions(world, polityId);
  ensureDiplomacyPairs(world);
}

export function establishRulingFamilyBranch(world: WorldState, polity: PolityState, ruler: CharacterState): void {
  const previousFamilyId = ruler.familyId || null;
  const branchName = world.regions.find((region) => region.id === polity.capitalRegionId)?.name ?? polity.shortName;
  const branch = createFamily(world, ruler, previousFamilyId, branchName);
  polity.rulingFamilyId = branch.id;
  for (const background of world.backgroundPeople.filter((person) => (
    person.promotedCharacterId === null && person.regionId === polity.capitalRegionId
  ))) background.polityId = polity.id;
  syncFamilyMembers(world);
  ensureFactions(world, polity.id);
}

export function createV02WorldSystems(world: WorldState, foundingEventId: string): void {
  // Initial rulers define a concrete lineage; unrelated same-surname courtiers get distinct IDs.
  for (const polity of [...world.polities].sort((left, right) => stableCompare(left.id, right.id))) {
    const members = world.characters
      .filter((character) => character.polityId === polity.id)
      .sort((left, right) => stableCompare(left.id, right.id));
    const ruler = members.find((character) => character.id === polity.rulerId) as CharacterState;
    const rulingFamily = createFamily(world, ruler);
    polity.rulingFamilyId = rulingFamily.id;
    for (const character of members) {
      character.birthTurn = -character.age * 4;
      character.adultTurn = character.age >= 16 ? -(character.age - 16) * 4 : null;
      character.lifeStage = lifeStage(character.age, character.alive);
      if (character.id !== ruler.id) {
        if (character.familyName === ruler.familyName) character.familyId = rulingFamily.id;
        else createFamily(world, character);
      }
      character.biography = [{
        id: `${character.id}:bio:${foundingEventId}:introduced`,
        turn: 0,
        kind: 'introduced',
        summary: `${character.name}以${character.role}身份进入纪年。`,
        importance: character.role === '君主' ? 4 : 1,
        eventId: foundingEventId,
      }];
      character.biographyDigest = stableHash(character.biography);
    }
  }
  syncFamilyMembers(world);
  createBackgroundPopulation(world);
  for (const family of world.families) {
    const head = world.characters.find((character) => character.id === family.headId);
    for (const memberId of family.memberIds.filter((id) => id !== family.headId).slice(0, 4)) {
      const member = world.characters.find((character) => character.id === memberId);
      if (!head || !member) continue;
      const outward = ensureRelationship(world, head.id, member.id);
      const inward = ensureRelationship(world, member.id, head.id);
      outward.kinship = '宗族';
      inward.kinship = '宗族';
      outward.trust = Math.max(outward.trust, 58);
      inward.trust = Math.max(inward.trust, 58);
    }
  }
  for (const polity of world.polities) ensureFactions(world, polity.id);
  ensureDiplomacyPairs(world);
  syncOfficeAppointments(world, 0);
}

function applyMarriage(
  world: WorldState,
  left: CharacterState,
  right: CharacterState,
  diplomatic: boolean,
  emit: EmitEvent,
): HistoryEvent {
  left.spouseIds = [...new Set([...left.spouseIds, right.id])].sort(stableCompare);
  right.spouseIds = [...new Set([...right.spouseIds, left.id])].sort(stableCompare);
  const leftFamily = world.families.find((family) => family.id === left.familyId);
  const rightFamily = world.families.find((family) => family.id === right.familyId);
  if (leftFamily && rightFamily && leftFamily.id !== rightFamily.id) {
    leftFamily.marriageAllianceFamilyIds = [...new Set([...leftFamily.marriageAllianceFamilyIds, rightFamily.id])].sort(stableCompare);
    rightFamily.marriageAllianceFamilyIds = [...new Set([...rightFamily.marriageAllianceFamilyIds, leftFamily.id])].sort(stableCompare);
    leftFamily.prestige = Math.round(clamp(leftFamily.prestige + 2));
    rightFamily.prestige = Math.round(clamp(rightFamily.prestige + 2));
  }
  const event = emit({
    category: diplomatic ? '外交' : '政治',
    kind: diplomatic ? 'diplomatic_marriage' : 'marriage',
    title: `${left.name}与${right.name}结为婚盟`,
    summary: diplomatic
      ? `${left.name}与${right.name}的婚姻连接了两个政权与家族，信任因此获得可追溯的制度担保。`
      : `${left.name}与${right.name}结为夫妇，两个家族形成互助与继承关系。`,
    importance: diplomatic ? 4 : 2,
    actorIds: [left.id, right.id],
    polityIds: [left.polityId, right.polityId],
    regionIds: [left.locationRegionId, right.locationRegionId],
    causes: [
      { label: '适婚条件', role: '条件', weight: 0.25, evidence: `双方年龄${left.age}/${right.age}且此前无配偶` },
      { label: '家族利益', role: '结构', weight: 0.3, evidence: `${leftFamily?.name ?? left.familyName}与${rightFamily?.name ?? right.familyName}互补声望与影响` },
      { label: diplomatic ? '国家信任' : '关系亲和', role: '选择', weight: 0.3, evidence: diplomatic ? '婚盟服务于国家间信任与安全' : '双方人格、年龄和家族网络相容' },
      { label: '婚盟结果', role: '结果', weight: 0.15, evidence: '配偶与家族联盟关系已写入权威状态' },
    ],
    stateDeltas: [
      { entityType: 'character', entityId: left.id, field: 'spouseIds', before: null, after: right.id },
      { entityType: 'character', entityId: right.id, field: 'spouseIds', before: null, after: left.id },
    ],
  });
  for (const [source, target] of [[left, right], [right, left]] as const) {
    const relation = ensureRelationship(world, source.id, target.id);
    relation.kinship = '配偶';
    remember(world, source.id, target.id, '婚盟', 24, event.summary, event.id);
    addBiography(source, event, event.kind);
  }
  createCommitment(
    world,
    '婚盟',
    left.id,
    right.id,
    [left.polityId, right.polityId],
    '维持婚姻与两族互助，不以婚盟掩护敌对行动',
    event.id,
    null,
    diplomatic ? 24 : 16,
  );
  return event;
}

function childCount(world: WorldState, characterId: string): number {
  return world.characters.filter((character) => character.parentIds.includes(characterId)).length;
}

function createChild(world: WorldState, parents: readonly [CharacterState, CharacterState], emit: EmitEvent): CharacterState {
  const parentFamilies = parents
    .map((parent) => world.families.find((family) => family.id === parent.familyId))
    .filter((family): family is FamilyState => Boolean(family))
    .sort((left, right) => right.prestige - left.prestige || stableCompare(left.id, right.id));
  const family = parentFamilies[0] as FamilyState;
  world.counters.character += 1;
  const id = `c_${String(world.counters.character).padStart(3, '0')}`;
  const start = keyedInt(world.seed, 0, GIVEN_NAMES.length - 1, world.turn, 'birth', id, 'given');
  let givenName = GIVEN_NAMES[start] as string;
  for (let offset = 0; offset < GIVEN_NAMES.length; offset += 1) {
    const candidate = GIVEN_NAMES[(start + offset) % GIVEN_NAMES.length] as string;
    if (!world.characters.some((character) => character.name === `${family.familyName}${candidate}`)) {
      givenName = candidate;
      break;
    }
  }
  const average = (field: 'leadership' | 'governance' | 'cunning' | 'ambition' | 'loyalty' | 'caution'): number => (
    Math.round(clamp((parents[0][field] + parents[1][field]) / 2 + keyedInt(world.seed, -10, 10, world.turn, 'birth', id, field)))
  );
  const polityId = parents[0].polityId === parents[1].polityId
    ? parents[0].polityId
    : (
      world.polities.find((polity) => polity.alive && polity.rulingFamilyId === family.id)?.id
      ?? world.polities.find((polity) => polity.alive && polity.id === family.polityId)?.id
      ?? parents.find((parent) => world.polities.some((polity) => polity.alive && polity.id === parent.polityId))?.polityId
      ?? parents[0].polityId
    );
  const child: CharacterState = {
    id,
    name: `${family.familyName}${givenName}`,
    familyName: family.familyName,
    givenName,
    sex: keyedChance(world.seed, 0.48, world.turn, 'birth', id, 'sex') ? '女' : '男',
    age: 0,
    alive: true,
    deathTurn: null,
    polityId,
    locationRegionId: parents.find((parent) => parent.polityId === polityId)?.locationRegionId ?? parents[0].locationRegionId,
    role: '廷臣',
    governedRegionId: null,
    commandingArmyId: null,
    commandingFleetId: null,
    leadership: average('leadership'),
    governance: average('governance'),
    cunning: average('cunning'),
    ambition: average('ambition'),
    loyalty: average('loyalty'),
    caution: average('caution'),
    rebellionReadiness: 0,
    renown: 0,
    birthTurn: world.turn,
    adultTurn: null,
    lifeStage: '幼年',
    familyId: family.id,
    parentIds: parents.map((parent) => parent.id).sort(stableCompare),
    spouseIds: [],
    politicalClass: parents.some((parent) => parent.politicalClass === '宗室') ? '宗室' : parents[0].politicalClass,
    influence: 0,
    personalWealth: 0,
    merit: 0,
    deputyExperience: 0,
    insubordination: 0,
    biography: [],
    biographyDigest: stableHash([]),
    tier: '核心',
    sourceStubId: null,
    health: 100,
    activeDiseaseId: null,
    protectedUntilTurn: null,
  };
  world.characters.push(child);
  const event = emit({
    category: '人口',
    kind: 'character_born',
    title: `${child.name}出生`,
    summary: `${child.name}生于${family.name}，其天赋受父母禀赋与个体差异共同塑造。具名出生是人口群体中的叙事标记，不重复增加州域人口。`,
    importance: child.politicalClass === '宗室' ? 2 : 1,
    actorIds: [child.id, ...child.parentIds],
    polityIds: [...new Set(parents.map((parent) => parent.polityId))],
    regionIds: [child.locationRegionId],
    causes: [
      { label: '婚姻关系', role: '结构', weight: 0.3, evidence: `${parents[0].name}与${parents[1].name}是登记配偶` },
      { label: '生育阶段', role: '条件', weight: 0.25, evidence: `父母年龄${parents[0].age}/${parents[1].age}，已有子女${childCount(world, parents[0].id) - 1}` },
      { label: '年度生育判定', role: '触发', weight: 0.2, evidence: `种子、年份与父母ID独立寻址的生育判定通过` },
      { label: '谱系归属', role: '结果', weight: 0.25, evidence: `${child.name}归入${family.name}，双亲ID已写入` },
    ],
    stateDeltas: [
      { entityType: 'character', entityId: child.id, field: 'alive', before: false, after: true },
      { entityType: 'family', entityId: family.id, field: 'memberCount', before: family.memberIds.length, after: family.memberIds.length + 1, delta: 1 },
    ],
  });
  addBiography(child, event, '出生');
  for (const parent of parents) {
    addBiography(parent, event, '子嗣出生', `${parent.name}迎来子嗣${child.name}。`, 2);
    const parentToChild = ensureRelationship(world, parent.id, child.id);
    const childToParent = ensureRelationship(world, child.id, parent.id);
    parentToChild.kinship = '子女';
    childToParent.kinship = '父母';
    remember(world, parent.id, child.id, '亲情', 18, event.summary, event.id);
    remember(world, child.id, parent.id, '亲情', 18, event.summary, event.id);
  }
  syncFamilyMembers(world);
  return child;
}

function processDeathsAndAdulthood(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  const deathEvents = context.events.filter((event) => event.kind === 'character_death');
  for (const event of deathEvents) {
    const deceased = world.characters.find((character) => character.id === event.actorIds[0]);
    if (!deceased) continue;
    addBiography(deceased, event, '逝世');
    const family = world.families.find((item) => item.id === deceased.familyId);
    if (!family) continue;
    const oldHeadId = family.headId;
    const wasHead = oldHeadId === deceased.id;
    const livingMembers = family.memberIds
      .map((id) => world.characters.find((character) => character.id === id))
      .filter((character): character is CharacterState => Boolean(character?.alive));
    const inheritor = [...livingMembers]
      .sort((left, right) => {
        const directLeft = left.parentIds.includes(deceased.id) ? 1 : 0;
        const directRight = right.parentIds.includes(deceased.id) ? 1 : 0;
        const spouseLeft = left.spouseIds.includes(deceased.id) ? 1 : 0;
        const spouseRight = right.spouseIds.includes(deceased.id) ? 1 : 0;
        return directRight - directLeft
          || spouseRight - spouseLeft
          || Number(right.age >= 16) - Number(left.age >= 16)
          || right.influence - left.influence
          || right.age - left.age
          || stableCompare(left.id, right.id);
      })[0];
    const successor = wasHead
      ? [...livingMembers].sort((left, right) => (
        Number(right.age >= 16) - Number(left.age >= 16)
        || Number(right.parentIds.includes(deceased.id)) - Number(left.parentIds.includes(deceased.id))
        || right.influence - left.influence
        || right.renown - left.renown
        || stableCompare(left.id, right.id)
      ))[0]
      : undefined;
    const estate = deceased.personalWealth;
    const inheritorWealthBefore = inheritor?.personalWealth ?? 0;
    const familyWealthBefore = family.wealth;
    if (inheritor) inheritor.personalWealth += estate;
    else family.wealth += estate;
    deceased.personalWealth = 0;
    if (successor) family.headId = successor.id;
    if (!wasHead && estate === 0) continue;
    const stateDeltas: StateDelta[] = [
      { entityType: 'character', entityId: deceased.id, field: 'personalWealth', before: estate, after: 0, delta: -estate },
    ];
    if (inheritor) {
      stateDeltas.push({
        entityType: 'character',
        entityId: inheritor.id,
        field: 'personalWealth',
        before: inheritorWealthBefore,
        after: inheritor.personalWealth,
        delta: estate,
      });
    } else if (estate > 0) {
      stateDeltas.push({
        entityType: 'family',
        entityId: family.id,
        field: 'wealth',
        before: familyWealthBefore,
        after: family.wealth,
        delta: estate,
      });
    }
    if (wasHead && successor) {
      stateDeltas.unshift({ entityType: 'family', entityId: family.id, field: 'headId', before: oldHeadId, after: successor.id });
    }
    const inheritanceEvent = emit({
      category: '政治',
      kind: wasHead ? 'family_inheritance' : 'estate_inheritance',
      title: wasHead
        ? successor ? `${successor.name}承继${family.name}` : `${family.name}家主之位暂缺`
        : inheritor ? `${inheritor.name}承接${deceased.name}遗产` : `${deceased.name}遗产归入${family.name}`,
      summary: wasHead
        ? `${deceased.name}身后，${successor?.name ?? '宗族'}依谱系、年龄与家族影响承接家主职责；私人产业另按直系、配偶与宗族次序处置。`
        : `${deceased.name}身后，其私人产业按直系、配偶与宗族次序由${inheritor?.name ?? family.name}承接。`,
      importance: wasHead ? family.prestige >= 60 ? 3 : 2 : estate >= 40 ? 2 : 1,
      actorIds: [deceased.id, ...(successor ? [successor.id] : []), ...(inheritor ? [inheritor.id] : [])],
      polityIds: [successor?.polityId ?? inheritor?.polityId ?? deceased.polityId],
      regionIds: [successor?.locationRegionId ?? inheritor?.locationRegionId ?? deceased.locationRegionId],
      causes: [
        { label: wasHead ? '家主空缺' : '成员逝世', role: '触发', weight: 0.25, evidence: `${deceased.name}于本年去世` },
        { label: '谱系资格', role: '结构', weight: 0.35, evidence: inheritor?.parentIds.includes(deceased.id) ? '遗产承接者是直系子女' : inheritor?.spouseIds.includes(deceased.id) ? '遗产承接者是配偶' : '直系不足，按宗族资序处置' },
        { label: '家族影响', role: '条件', weight: 0.2, evidence: `家族声望${Math.round(family.prestige)}、政治影响${Math.round(family.politicalInfluence)}` },
        { label: '继承结果', role: '结果', weight: 0.2, evidence: `私人产业${estate}完整转入${inheritor?.name ?? family.name}${successor ? `；家主为${successor.name}` : ''}` },
      ],
      stateDeltas,
    });
    if (successor) addBiography(successor, inheritanceEvent, '继任家主');
    if (inheritor && inheritor.id !== successor?.id) addBiography(inheritor, inheritanceEvent, '承接遗产');
  }

  for (const character of world.characters.filter((item) => item.alive)) {
    const previousStage = character.lifeStage;
    character.lifeStage = lifeStage(character.age, true);
    if (character.age !== 16 || character.adultTurn !== null) continue;
    character.adultTurn = context.turn;
    const event = emit({
      category: '政治',
      kind: 'character_adult',
      title: `${character.name}成年`,
      summary: `${character.name}完成成长阶段，开始具备任官、婚姻与独立政治选择的资格。`,
      importance: character.politicalClass === '宗室' ? 2 : 1,
      actorIds: [character.id, ...character.parentIds],
      polityIds: [character.polityId],
      regionIds: [character.locationRegionId],
      causes: [
        { label: '年龄门槛', role: '条件', weight: 0.55, evidence: '人物年满16岁' },
        { label: '成长经历', role: '结构', weight: 0.25, evidence: `出身${character.politicalClass}，家族传统影响其能力与欲望` },
        { label: '资格变化', role: '结果', weight: 0.2, evidence: `${previousStage}→成年，可进入婚姻与官职候选池` },
      ],
      stateDeltas: [
        { entityType: 'character', entityId: character.id, field: 'adultTurn', before: null, after: context.turn },
      ],
    });
    addBiography(character, event, '成年');
  }
}

function processLocalMarriages(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  let marriagesFormed = 0;
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    if (marriagesFormed >= 2) break;
    const candidates = livingAdults(world, polity.id)
      .filter((character) => character.age >= 18 && character.age <= 48 && character.spouseIds.length === 0 && character.politicalClass !== '宗室');
    const pairs: Array<{ left: CharacterState; right: CharacterState; score: number }> = [];
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        const a = candidates[left] as CharacterState;
        const b = candidates[right] as CharacterState;
        if (a.familyId === b.familyId || a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) continue;
        const ageGap = Math.abs(a.age - b.age);
        const score = 78 - ageGap * 2
          + (a.influence + b.influence) * 0.12
          + (a.loyalty + b.loyalty) * 0.08
          + keyedRandom(world.seed, context.turn, 'marriage', a.id, b.id) * 8;
        pairs.push({ left: a, right: b, score });
      }
    }
    const pair = pairs.sort((left, right) => right.score - left.score || stableCompare(left.left.id, right.left.id))[0];
    if (pair && pair.score >= 72) {
      applyMarriage(world, pair.left, pair.right, false, emit);
      marriagesFormed += 1;
    }
  }
}

function processBirths(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  const seen = new Set<string>();
  const couples: Array<readonly [CharacterState, CharacterState]> = [];
  for (const character of world.characters.filter((item) => item.alive && item.age >= 18 && item.age <= 44)) {
    for (const spouseId of character.spouseIds) {
      const spouse = world.characters.find((item) => item.id === spouseId && item.alive && item.age >= 18 && item.age <= 55);
      if (!spouse) continue;
      const key = [character.id, spouse.id].sort(stableCompare).join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      couples.push([character, spouse]);
    }
  }
  for (const parents of couples.sort((left, right) => stableCompare(left[0].id, right[0].id))) {
    const count = Math.max(childCount(world, parents[0].id), childCount(world, parents[1].id));
    const eligibleParent = parents.find((parent) => parent.age <= 44);
    if (!eligibleParent || count >= 4) continue;
    const chance = clamp(0.22 - count * 0.035 - Math.max(0, eligibleParent.age - 34) * 0.008, 0.04, 0.22);
    if (!keyedChance(world.seed, chance, context.turn, 'birth', parents[0].id, parents[1].id)) continue;
    createChild(world, parents, emit);
  }
}

function processFamilyBranches(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  if (context.year % 12 !== 0) return;
  syncFamilyMembers(world);
  const eligible = world.families
    .filter((family) => family.memberIds.length >= 8 && family.prestige >= 48)
    .map((family) => {
      const candidate = family.memberIds
        .map((id) => world.characters.find((character) => character.id === id))
        .filter((character): character is CharacterState => Boolean(
          character?.alive
          && character.age >= 24
          && character.id !== family.headId
          && Boolean(character.governedRegionId),
        ))
        .sort((left, right) => right.ambition - left.ambition || right.influence - left.influence || stableCompare(left.id, right.id))[0];
      return { family, candidate };
    })
    .filter((item): item is { family: FamilyState; candidate: CharacterState } => Boolean(item.candidate))
    .sort((left, right) => right.candidate.ambition - left.candidate.ambition || stableCompare(left.family.id, right.family.id));
  const selection = eligible[0];
  if (!selection || selection.candidate.ambition < 62) return;
  const region = world.regions.find((item) => item.id === selection.candidate.governedRegionId);
  if (!region) return;
  const oldFamilyId = selection.family.id;
  const branch = createFamily(world, selection.candidate, selection.family.id, region.name);
  const minorChildren = world.characters.filter((character) => (
    character.alive && character.age < 16 && character.parentIds.includes(selection.candidate.id)
  ));
  for (const child of minorChildren) child.familyId = branch.id;
  const event = emit({
    category: '政治',
    kind: 'family_branch',
    title: `${selection.family.name}分出${branch.name}`,
    summary: `${selection.candidate.name}长期治理${region.name}，地方产业与政治网络足以形成独立支系。`,
    importance: 3,
    actorIds: [selection.candidate.id, selection.family.headId],
    polityIds: [selection.candidate.polityId],
    regionIds: [region.id],
    causes: [
      { label: '宗族规模', role: '结构', weight: 0.24, evidence: `本家共有${selection.family.memberIds.length}名具名成员` },
      { label: '地方根基', role: '条件', weight: 0.28, evidence: `${selection.candidate.name}掌握${region.name}治理网络` },
      { label: '个人意愿', role: '选择', weight: 0.24, evidence: `野心${selection.candidate.ambition}、影响${selection.candidate.influence}` },
      { label: '支系成立', role: '结果', weight: 0.24, evidence: `${branch.name}拥有独立家主、声望与传统` },
    ],
    stateDeltas: [
      { entityType: 'character', entityId: selection.candidate.id, field: 'familyId', before: oldFamilyId, after: branch.id },
      { entityType: 'family', entityId: branch.id, field: 'memberCount', before: 0, after: 1 + minorChildren.length, delta: 1 + minorChildren.length },
    ],
  });
  addBiography(selection.candidate, event, '开创支系');
  syncFamilyMembers(world);
}

function updateFamilyMetrics(world: WorldState): void {
  syncFamilyMembers(world);
  for (const family of world.families) {
    const living = family.memberIds
      .map((id) => world.characters.find((character) => character.id === id))
      .filter((character): character is CharacterState => Boolean(character?.alive));
    if (living.length === 0) {
      family.prestige = Math.round(clamp(family.prestige - 1));
      family.politicalInfluence = Math.round(clamp(family.politicalInfluence - 1));
      continue;
    }
    const officeInfluence = living.reduce((sum, member) => sum + (
      member.role === '君主' ? 12 : member.commandingArmyId || member.commandingFleetId ? 5 : member.governedRegionId ? 4 : 1
    ), 0);
    const averageRenown = living.reduce((sum, member) => sum + member.renown, 0) / living.length;
    family.prestige = Math.round(clamp(family.prestige * 0.96 + averageRenown * 0.025 + officeInfluence * 0.06));
    family.politicalInfluence = Math.round(clamp(family.politicalInfluence * 0.94 + officeInfluence * 0.25));
    family.wealth = Math.max(0, Math.round(family.wealth + living.length * 0.3 + family.traditions.commercial * 0.02));
    const commanders = living.filter((member) => member.commandingArmyId || member.commandingFleetId || member.deputyExperience > 0);
    if (commanders.length > 0) {
      const military = commanders.reduce((sum, member) => sum + member.leadership + member.merit, 0) / (commanders.length * 2);
      family.traditions.military = Math.round(clamp(family.traditions.military * 0.97 + military * 0.03));
    }
    const governors = living.filter((member) => member.governedRegionId || member.role === '君主');
    if (governors.length > 0) {
      const political = governors.reduce((sum, member) => sum + member.governance + member.cunning, 0) / (governors.length * 2);
      family.traditions.political = Math.round(clamp(family.traditions.political * 0.97 + political * 0.03));
    }
  }
}

function processDueCommitments(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  if (context.season !== '冬') return;
  for (const commitment of world.commitments.filter((item) => item.status === '生效')) {
    if (commitment.kind === '婚盟') {
      const left = world.characters.find((character) => character.id === commitment.promisorId);
      const right = world.characters.find((character) => character.id === commitment.promiseeId);
      if (left?.alive && right?.alive && left.spouseIds.includes(right.id)) continue;
      const event = emit({
        category: '政治',
        kind: 'commitment_ended',
        title: '婚盟承诺终止',
        summary: '婚盟因配偶死亡或婚姻关系消失而失效，既有记忆仍留在人物与家族史中。',
        importance: 1,
        actorIds: [commitment.promisorId, commitment.promiseeId],
        polityIds: commitment.polityIds,
        causes: [
          { label: '既有承诺', role: '结构', weight: 0.35, evidence: `${commitment.id}自第${commitment.madeTurn}回合生效` },
          { label: '关系终止', role: '触发', weight: 0.4, evidence: '至少一方死亡或配偶引用已不存在' },
          { label: '承诺失效', role: '结果', weight: 0.25, evidence: '状态生效→失效，未判定为背约' },
        ],
        stateDeltas: [{ entityType: 'commitment', entityId: commitment.id, field: 'status', before: '生效', after: '失效' }],
      });
      resolveCommitment(world, commitment, '失效', event);
      continue;
    }
    if (commitment.dueTurn === null || commitment.dueTurn > context.turn || commitment.kind === '军令') continue;
    const event = emit({
      category: commitment.kind === '外交盟约' ? '外交' : '政治',
      kind: 'commitment_fulfilled',
      title: `${commitment.kind}承诺履行`,
      summary: `${commitment.promisorId}与${commitment.promiseeId}在约定期限内维持“${commitment.terms}”，承诺转化为可追溯的信任记忆。`,
      importance: commitment.kind === '外交盟约' ? 3 : 2,
      actorIds: [commitment.promisorId, commitment.promiseeId],
      polityIds: commitment.polityIds,
      causes: [
        { label: '承诺条款', role: '结构', weight: 0.35, evidence: commitment.terms },
        { label: '期限届满', role: '触发', weight: 0.25, evidence: `约定第${commitment.dueTurn}回合复核` },
        { label: '履约记录', role: '结果', weight: 0.4, evidence: `承诺${commitment.id}未出现背约事件` },
      ],
      stateDeltas: [{ entityType: 'commitment', entityId: commitment.id, field: 'status', before: '生效', after: '履约' }],
    });
    resolveCommitment(world, commitment, '履约', event);
  }
}

export function processV02Society(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  processPendingBackgroundPromotions(world, emit);
  processDueCommitments(world, context, emit);
  if (context.season !== '冬') return;
  maintainBackgroundCohorts(world, context.turn);
  processDeathsAndAdulthood(world, context, emit);
  processLocalMarriages(world, context, emit);
  processBirths(world, context, emit);
  processFamilyBranches(world, context, emit);
  updateFamilyMetrics(world);
  updateCoreTiers(world);
  for (const relation of world.relationships) {
    relation.grievance = Math.round(clamp(relation.grievance - 0.4));
    relation.gratitude = Math.round(clamp(relation.gratitude - 0.25));
    relation.fear = Math.round(clamp(relation.fear - 0.2));
  }
}

function actionRecentlyRecorded(character: CharacterState, kind: string, turn: number, cooldown: number): boolean {
  return character.biography.some((fact) => fact.kind === kind && turn - fact.turn < cooldown);
}

export function processV02Politics(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  for (const polity of world.polities.filter((item) => item.alive).sort((left, right) => stableCompare(left.id, right.id))) {
    ensureFactions(world, polity.id);
    const ruler = world.characters.find((character) => character.id === polity.rulerId && character.alive);
    if (!ruler) continue;
    const factions = world.factions
      .filter((faction) => faction.active && faction.polityId === polity.id && faction.memberIds.length > 0)
      .sort((left, right) => right.power - left.power || stableCompare(left.id, right.id));
    const dominant = factions[0];
    if (!dominant) continue;
    const leader = world.characters.find((character) => character.id === dominant.leaderId && character.alive);
    if (!leader) continue;
    polity.courtInfluence = Math.round(clamp(
      ruler.influence * 0.4 + polity.authority * 0.35 + polity.administration * 0.25 - Math.max(0, dominant.power - 55) * 0.25,
    ));

    if (context.season === '冬' && factions.length >= 2) {
      const partner = factions.find((faction) => (
        faction.id !== dominant.id
        && !dominant.alliedFactionIds.includes(faction.id)
        && faction.cohesion >= 48
      ));
      const partnerLeader = partner
        ? world.characters.find((character) => character.id === partner.leaderId && character.alive)
        : undefined;
      if (partner && partnerLeader && dominant.cohesion + partner.cohesion >= 104) {
        dominant.alliedFactionIds = [...new Set([...dominant.alliedFactionIds, partner.id])].sort(stableCompare);
        partner.alliedFactionIds = [...new Set([...partner.alliedFactionIds, dominant.id])].sort(stableCompare);
        const event = emit({
          category: '政治',
          kind: 'political_alliance',
          title: `${dominant.name}与${partner.name}结盟`,
          summary: `${leader.name}与${partnerLeader.name}围绕朝廷议程交换支持，形成有期限、可履约或背约的政治联盟。`,
          importance: 3,
          actorIds: [leader.id, partnerLeader.id],
          polityIds: [polity.id],
          regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
          causes: [
            { label: '派系并存', role: '结构', weight: 0.28, evidence: `${dominant.name}权力${dominant.power}，${partner.name}权力${partner.power}` },
            { label: '联盟条件', role: '条件', weight: 0.24, evidence: `双方凝聚合计${dominant.cohesion + partner.cohesion}` },
            { label: '交换支持', role: '选择', weight: 0.28, evidence: `议程为“${dominant.agenda}”与“${partner.agenda}”` },
            { label: '承诺成立', role: '结果', weight: 0.2, evidence: '双方派系ID互相登记并建立四年政治承诺' },
          ],
          stateDeltas: [
            { entityType: 'faction', entityId: dominant.id, field: 'alliedFactionIds', before: null, after: partner.id },
            { entityType: 'faction', entityId: partner.id, field: 'alliedFactionIds', before: null, after: dominant.id },
          ],
        });
        createCommitment(world, '政治联盟', leader.id, partnerLeader.id, [polity.id], '在朝廷议程中互相支持且不以清洗夺取盟友席位', event.id, context.turn + 16, 18);
        remember(world, leader.id, partnerLeader.id, '恩义', 10, event.summary, event.id);
        remember(world, partnerLeader.id, leader.id, '恩义', 10, event.summary, event.id);
      }
    }

    if (
      dominant.power >= 66
      && leader.id !== ruler.id
      && context.turn - dominant.lastActionTurn >= 32
      && !actionRecentlyRecorded(leader, '成为权臣', context.turn, 40)
      && context.turn - polity.lastCourtCrisisTurn >= 32
    ) {
      const oldInfluence = leader.influence;
      leader.influence = Math.round(clamp(leader.influence + 3));
      dominant.lastActionTurn = context.turn;
      polity.lastCourtCrisisTurn = context.turn;
      const event = emit({
        category: '政治',
        kind: 'power_broker',
        title: `${leader.name}权倾${polity.shortName}廷`,
        summary: `${leader.name}凭${dominant.name}的官职、家族与成员网络成为权力中枢，君主决策需要其合作。`,
        importance: 3,
        actorIds: [leader.id, ruler.id],
        polityIds: [polity.id],
        regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
        causes: [
          { label: '派系资源', role: '结构', weight: 0.35, evidence: `${dominant.name}权力${dominant.power}、凝聚${dominant.cohesion}` },
          { label: '制度空间', role: '条件', weight: 0.25, evidence: `中央权威${polity.authority}、朝廷控制${polity.courtInfluence}` },
          { label: '领袖能力', role: '选择', weight: 0.25, evidence: `${leader.name}谋略${leader.cunning}、影响${oldInfluence}` },
          { label: '权臣形成', role: '结果', weight: 0.15, evidence: `个人影响${oldInfluence}→${leader.influence}` },
        ],
        stateDeltas: [
          { entityType: 'character', entityId: leader.id, field: 'influence', before: oldInfluence, after: leader.influence, delta: leader.influence - oldInfluence },
        ],
      });
      addBiography(leader, event, '成为权臣');
      remember(world, ruler.id, leader.id, '竞争', 8, event.summary, event.id);
    }

    const relationToRuler = leader.id === ruler.id ? undefined : ensureRelationship(world, leader.id, ruler.id);
    const coupScore = dominant.power * 0.42
      + leader.ambition * 0.25
      + leader.cunning * 0.16
      + (100 - leader.loyalty) * 0.17
      + (100 - polity.authority) * 0.18
      + (relationToRuler?.grievance ?? 0) * 0.1
      - leader.caution * 0.18
      + (keyedRandom(world.seed, context.turn, 'coup', polity.id, leader.id) - 0.5) * 5;
    if (
      leader.id !== ruler.id
      && dominant.power >= 72
      && polity.authority <= 42
      && coupScore >= 92
      && !actionRecentlyRecorded(leader, '发动政变', context.turn, 40)
    ) {
      const oldRulerId = polity.rulerId;
      const sameFamily = leader.familyId === ruler.familyId;
      polity.rulerId = leader.id;
      polity.rulingFamilyId = leader.familyId;
      polity.dynastyName = `${leader.familyName}氏`;
      polity.legitimacy = Math.round(clamp(polity.legitimacy - (sameFamily ? 8 : 20)));
      polity.authority = Math.round(clamp(35 + leader.cunning * 0.28 + dominant.cohesion * 0.18));
      ruler.influence = Math.round(clamp(ruler.influence - 28));
      leader.influence = Math.round(clamp(leader.influence + 16));
      leader.governedRegionId = null;
      dominant.lastActionTurn = context.turn;
      polity.lastCourtCrisisTurn = context.turn;
      const event = emit({
        category: '政治',
        kind: sameFamily ? 'coup' : 'usurpation',
        title: sameFamily ? `${leader.name}宫变夺权` : `${leader.name}篡立新朝`,
        summary: `${leader.name}联合${dominant.name}控制中枢，${ruler.name}失去君位；${sameFamily ? '王朝仍在宗族内部更替' : `国号之下改奉${leader.familyName}氏` }。`,
        importance: 5,
        actorIds: [leader.id, ruler.id, ...dominant.memberIds.slice(0, 4)],
        polityIds: [polity.id],
        regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
        causes: [
          { label: '派系控制', role: '结构', weight: 0.28, evidence: `${dominant.name}权力${dominant.power}、凝聚${dominant.cohesion}` },
          { label: '中央虚弱', role: '条件', weight: 0.22, evidence: `权威${polity.authority}，朝廷控制${polity.courtInfluence}` },
          { label: '夺权动机', role: '选择', weight: 0.25, evidence: `野心${leader.ambition}、忠诚${leader.loyalty}、积怨${relationToRuler?.grievance ?? 0}` },
          { label: '行动触发', role: '触发', weight: 0.1, evidence: `政变效用${coupScore.toFixed(1)}达到92` },
          { label: '君位转移', role: '结果', weight: 0.15, evidence: `${oldRulerId}→${leader.id}` },
        ],
        stateDeltas: [
          { entityType: 'polity', entityId: polity.id, field: 'rulerId', before: oldRulerId, after: leader.id },
          { entityType: 'character', entityId: ruler.id, field: 'influence', before: ruler.influence + 28, after: ruler.influence, delta: -28 },
        ],
      });
      addBiography(leader, event, '发动政变');
      addBiography(ruler, event, '失去君位');
      remember(world, ruler.id, leader.id, '背叛', 34, event.summary, event.id);
      remember(world, leader.id, ruler.id, '竞争', 18, event.summary, event.id);
      continue;
    }

    const purgeScore = ruler.cunning * 0.35 + polity.authority * 0.28 + ruler.caution * 0.12
      + Math.max(0, dominant.power - 60) * 0.4 - leader.loyalty * 0.15;
    if (
      leader.id !== ruler.id
      && dominant.power >= 64
      && polity.authority >= 55
      && purgeScore >= 66
      && context.turn - dominant.lastActionTurn >= 20
    ) {
      const oldPower = dominant.power;
      const oldInfluence = leader.influence;
      leader.governedRegionId = null;
      leader.influence = Math.round(clamp(leader.influence - 16));
      leader.loyalty = Math.round(clamp(leader.loyalty - 18));
      dominant.memberIds = dominant.memberIds.filter((id) => id === leader.id || keyedRandom(world.seed, context.turn, 'purge', dominant.id, id) > 0.35);
      dominant.power = Math.round(clamp(dominant.power - 18));
      dominant.lastActionTurn = context.turn;
      polity.lastCourtCrisisTurn = context.turn;
      const event = emit({
        category: '政治',
        kind: 'purge',
        title: `${ruler.name}清洗${dominant.name}`,
        summary: `${ruler.name}依靠中央权威解除${leader.name}的地方职权并拆散其部分政治网络，但也埋下个人积怨。`,
        importance: 4,
        actorIds: [ruler.id, leader.id],
        polityIds: [polity.id],
        regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
        causes: [
          { label: '派系威胁', role: '结构', weight: 0.3, evidence: `${dominant.name}清洗前权力${oldPower}` },
          { label: '君主能力', role: '条件', weight: 0.25, evidence: `谋略${ruler.cunning}、权威${polity.authority}` },
          { label: '压制选择', role: '选择', weight: 0.25, evidence: `清洗效用${purgeScore.toFixed(1)}达到66` },
          { label: '政治后果', role: '结果', weight: 0.2, evidence: `派系权力${oldPower}→${dominant.power}，领袖影响${oldInfluence}→${leader.influence}` },
        ],
        stateDeltas: [
          { entityType: 'faction', entityId: dominant.id, field: 'power', before: oldPower, after: dominant.power, delta: dominant.power - oldPower },
          { entityType: 'character', entityId: leader.id, field: 'influence', before: oldInfluence, after: leader.influence, delta: leader.influence - oldInfluence },
        ],
      });
      addBiography(leader, event, '遭到清洗');
      remember(world, leader.id, ruler.id, '羞辱', 28, event.summary, event.id);
    }
  }
}

function polityPower(world: WorldState, polityId: string): number {
  return world.armies.filter((army) => army.polityId === polityId).reduce((sum, army) => sum + army.soldiers, 0)
    + world.regions.filter((region) => region.controllerId === polityId).reduce((sum, region) => sum + region.population * 0.018 + region.strategicValue * 700, 0);
}

function commonThreat(world: WorldState, leftId: string, rightId: string): number {
  const candidates = world.polities.filter((polity) => polity.alive && polity.id !== leftId && polity.id !== rightId);
  if (candidates.length === 0) return 0;
  const reference = Math.max(1, (polityPower(world, leftId) + polityPower(world, rightId)) / 2);
  return clamp(Math.max(...candidates.map((polity) => polityPower(world, polity.id) / reference * 50)));
}

export function processV02Diplomacy(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  ensureDiplomacyPairs(world);
  for (const relation of world.diplomacy) {
    const left = world.polities.find((polity) => polity.id === relation.polityAId);
    const right = world.polities.find((polity) => polity.id === relation.polityBId);
    if (!left?.alive || !right?.alive) continue;
    const activeWar = world.wars.some((war) => war.active && (
      (war.attackerId === left.id && war.defenderId === right.id)
      || (war.attackerId === right.id && war.defenderId === left.id)
    ));
    const leftPower = polityPower(world, left.id);
    const rightPower = polityPower(world, right.id);
    relation.threatAtoB = Math.round(clamp(leftPower / Math.max(1, rightPower) * 42 + relation.grievance * 0.18));
    relation.threatBtoA = Math.round(clamp(rightPower / Math.max(1, leftPower) * 42 + relation.grievance * 0.18));
    if (activeWar) {
      relation.status = '战争';
      relation.grievance = Math.round(clamp(relation.grievance + 1));
      relation.trust = Math.round(clamp(relation.trust - 1));
      continue;
    }
    if (relation.status === '战争') {
      relation.status = '中立';
      relation.lastChangedTurn = context.turn;
    }
    if (relation.status === '联盟' && relation.allianceUntilTurn !== null && context.turn >= relation.allianceUntilTurn) {
      const oldStatus = relation.status;
      relation.status = '中立';
      relation.allianceUntilTurn = null;
      relation.lastChangedTurn = context.turn;
      emit({
        category: '外交',
        kind: 'alliance_ended',
        title: `${left.name}与${right.name}盟约期满`,
        summary: '既定盟期结束，双方恢复中立；既有婚姻与历史信任仍被保留。',
        importance: 2,
        actorIds: [left.rulerId, right.rulerId],
        polityIds: [left.id, right.id],
        causes: [
          { label: '盟约期限', role: '触发', weight: 0.55, evidence: `盟约于第${context.turn}回合到期` },
          { label: '外交重估', role: '选择', weight: 0.25, evidence: `当前信任${relation.trust}、共同威胁${Math.round(commonThreat(world, left.id, right.id))}` },
          { label: '状态变化', role: '结果', weight: 0.2, evidence: `${oldStatus}→中立` },
        ],
        stateDeltas: [{ entityType: 'diplomacy', entityId: relation.id, field: 'status', before: oldStatus, after: '中立' }],
      });
    }
    relation.grievance = Math.round(clamp(relation.grievance - 0.25));
    relation.trust = Math.round(clamp(relation.trust + relation.tradeDependency * 0.006 + relation.marriageIds.length * 0.08));
  }

  if (context.season !== '冬') return;
  const neutral = world.diplomacy
    .filter((relation) => relation.status === '中立')
    .map((relation) => {
      const left = world.polities.find((polity) => polity.id === relation.polityAId && polity.alive);
      const right = world.polities.find((polity) => polity.id === relation.polityBId && polity.alive);
      return { relation, left, right, common: left && right ? commonThreat(world, left.id, right.id) : 0 };
    })
    .filter((item): item is { relation: DiplomacyState; left: PolityState; right: PolityState; common: number } => Boolean(item.left && item.right))
    .sort((left, right) => (
      (right.relation.trust + right.common) - (left.relation.trust + left.common)
      || stableCompare(left.relation.id, right.relation.id)
    ));

  for (const candidate of neutral) {
    const { relation, left, right } = candidate;
    if (relation.marriageIds.length > 0 || relation.trust < 48 || relation.grievance > 38) continue;
    const leftCandidate = livingAdults(world, left.id)
      .filter((character) => character.politicalClass === '宗室' && character.age >= 18 && character.age <= 44 && character.spouseIds.length === 0)
      .sort((a, b) => b.influence - a.influence || stableCompare(a.id, b.id))[0];
    const rightCandidate = livingAdults(world, right.id)
      .filter((character) => character.politicalClass === '宗室' && character.age >= 18 && character.age <= 44 && character.spouseIds.length === 0)
      .sort((a, b) => b.influence - a.influence || stableCompare(a.id, b.id))[0];
    if (!leftCandidate || !rightCandidate) continue;
    const event = applyMarriage(world, leftCandidate, rightCandidate, true, emit);
    relation.marriageIds.push(event.id);
    relation.trust = Math.round(clamp(relation.trust + 18));
    relation.grievance = Math.round(clamp(relation.grievance - 10));
    relation.lastChangedTurn = context.turn;
    break;
  }

  for (const candidate of neutral) {
    const { relation, left, right, common } = candidate;
    if (relation.status !== '中立' || relation.trust < 62 || relation.grievance > 28 || common < 54) continue;
    const oldStatus = relation.status;
    relation.status = '联盟';
    relation.allianceUntilTurn = context.turn + 24;
    relation.lastChangedTurn = context.turn;
    const event = emit({
      category: '外交',
      kind: 'alliance_formed',
      title: `${left.name}与${right.name}缔结盟约`,
      summary: `双方因共同威胁、累积信任与现实利益订立六年盟约。`,
      importance: 4,
      actorIds: [left.rulerId, right.rulerId],
      polityIds: [left.id, right.id],
      causes: [
        { label: '共同威胁', role: '结构', weight: 0.3, evidence: `外部威胁指数${Math.round(common)}` },
        { label: '历史信任', role: '条件', weight: 0.25, evidence: `信任${relation.trust}、积怨${relation.grievance}` },
        { label: '贸易婚盟', role: '条件', weight: 0.18, evidence: `贸易依赖${relation.tradeDependency}、婚盟${relation.marriageIds.length}项` },
        { label: '结盟选择', role: '选择', weight: 0.15, evidence: '联合安全收益高于保持中立' },
        { label: '盟约结果', role: '结果', weight: 0.12, evidence: `状态${oldStatus}→联盟，期限24季` },
      ],
      stateDeltas: [{ entityType: 'diplomacy', entityId: relation.id, field: 'status', before: oldStatus, after: '联盟' }],
    });
    const leftRuler = world.characters.find((character) => character.id === left.rulerId);
    const rightRuler = world.characters.find((character) => character.id === right.rulerId);
    if (leftRuler) addBiography(leftRuler, event, '缔结联盟');
    if (rightRuler) addBiography(rightRuler, event, '缔结联盟');
    createCommitment(
      world,
      '外交盟约',
      left.rulerId,
      right.rulerId,
      [left.id, right.id],
      '盟期内互不攻击，并在共同威胁下维持协防',
      event.id,
      relation.allianceUntilTurn,
      28,
    );
    break;
  }
}

export function markWarDiplomacy(world: WorldState, attackerId: string, defenderId: string, turn: number): void {
  ensureDiplomacyPairs(world);
  const relation = getDiplomacy(world, attackerId, defenderId);
  if (!relation) return;
  relation.status = '战争';
  relation.allianceUntilTurn = null;
  relation.trust = Math.round(clamp(relation.trust - 24));
  relation.grievance = Math.round(clamp(relation.grievance + 22));
  relation.lastChangedTurn = turn;
}

export function markPeaceDiplomacy(world: WorldState, leftId: string, rightId: string, turn: number): void {
  const relation = getDiplomacy(world, leftId, rightId);
  if (!relation) return;
  relation.status = '中立';
  relation.lastChangedTurn = turn;
}

function recordTurningPointBiographies(world: WorldState, context: V02TurnContext): void {
  for (const event of context.events.filter((item) => item.importance >= 3 && item.kind !== 'quarter_summary')) {
    for (const actorId of event.actorIds) {
      const actor = world.characters.find((character) => character.id === actorId);
      if (!actor || actor.biography.some((fact) => fact.eventId === event.id)) continue;
      addBiography(actor, event, event.kind);
    }
  }
}

export function processV02MilitaryCareers(world: WorldState, context: V02TurnContext, emit: EmitEvent): void {
  const battleEvents = context.events.filter((event) => event.kind === 'battle');
  for (const battle of battleEvents) {
    const participatingArmies = world.armies.filter((army) => battle.actorIds.includes(army.commanderId));
    for (const army of participatingArmies) {
      const deputy = army.deputyCommanderId
        ? world.characters.find((character) => character.id === army.deputyCommanderId && character.alive)
        : undefined;
      if (!deputy || !battle.actorIds.includes(deputy.id)) continue;
      const before = deputy.merit;
      deputy.deputyExperience = Math.round(clamp(deputy.deputyExperience + 4));
      deputy.merit = Math.round(clamp(deputy.merit + 3));
      deputy.renown = Math.round(clamp(deputy.renown + 1));
      if (!deputy.biography.some((fact) => fact.kind === '首次参战')) {
        addBiography(deputy, battle, '首次参战', `${deputy.name}首次以${army.name}副将身份见于战役记录。`, 2);
      }
      const threshold = [25, 50, 75].find((value) => before < value && deputy.merit >= value);
      if (threshold) {
        const event = emit({
          category: '军事',
          kind: 'deputy_merit',
          title: `${deputy.name}以副将战功显名`,
          summary: `${deputy.name}在连续战役中积累可核验战功，开始具备独立统军的声望与经验。`,
          importance: threshold >= 50 ? 3 : 2,
          actorIds: [deputy.id, army.commanderId],
          polityIds: [army.polityId],
          regionIds: [army.regionId],
          causes: [
            { label: '副将岗位', role: '结构', weight: 0.22, evidence: `${deputy.name}是${army.name}登记副将` },
            { label: '战役经历', role: '条件', weight: 0.3, evidence: `副将经验${deputy.deputyExperience}，本季参与${battle.title}` },
            { label: '能力表现', role: '选择', weight: 0.23, evidence: `统率${deputy.leadership}、谋略${deputy.cunning}` },
            { label: '声望结果', role: '结果', weight: 0.25, evidence: `战功${before}→${deputy.merit}，越过${threshold}门槛` },
          ],
          stateDeltas: [{ entityType: 'character', entityId: deputy.id, field: 'merit', before, after: deputy.merit, delta: deputy.merit - before }],
        });
        addBiography(deputy, event, '副将显名');
      }
    }
  }

  if (context.season !== '冬') {
    recordTurningPointBiographies(world, context);
    return;
  }
  for (const army of [...world.armies].sort((left, right) => stableCompare(left.id, right.id))) {
    const deputy = army.deputyCommanderId
      ? world.characters.find((character) => character.id === army.deputyCommanderId && character.alive)
      : undefined;
    const commander = world.characters.find((character) => character.id === army.commanderId && character.alive);
    const polity = world.polities.find((item) => item.id === army.polityId && item.alive);
    if (!deputy || !commander || !polity) continue;
    let duty = world.commitments.find((commitment) => (
      commitment.kind === '军令'
      && commitment.status === '生效'
      && commitment.promisorId === deputy.id
      && commitment.promiseeId === commander.id
    ));
    if (!duty) {
      const recentDuty = world.commitments.some((commitment) => (
        commitment.kind === '军令'
        && commitment.promisorId === deputy.id
        && commitment.promiseeId === commander.id
        && commitment.resolvedTurn !== null
        && context.turn - commitment.resolvedTurn < 16
      ));
      if (recentDuty) continue;
      const oath = emit({
        category: '军事',
        kind: 'military_oath',
        title: `${deputy.name}受${commander.name}军令`,
        summary: `${deputy.name}承诺在未来四年履行${army.name}副将职责；此承诺可因履职而完成，也可因抗命而破裂。`,
        importance: 1,
        actorIds: [deputy.id, commander.id],
        polityIds: [army.polityId],
        regionIds: [army.regionId],
        causes: [
          { label: '军中职权', role: '结构', weight: 0.35, evidence: `${deputy.name}是${army.name}登记副将` },
          { label: '主帅授令', role: '触发', weight: 0.25, evidence: `${commander.name}拥有军团主帅职权` },
          { label: '服从选择', role: '选择', weight: 0.2, evidence: `忠诚${deputy.loyalty}、谨慎${deputy.caution}` },
          { label: '承诺登记', role: '结果', weight: 0.2, evidence: '军令承诺进入四年履约期' },
        ],
      });
      duty = createCommitment(world, '军令', deputy.id, commander.id, [army.polityId], `履行${army.name}副将职责并服从合法军令`, oath.id, context.turn + 16, 20);
      addBiography(deputy, oath, '受领军令');
      continue;
    }
    const commanderRelation = ensureRelationship(world, deputy.id, commander.id);
    const refusalScore = deputy.ambition * 0.3 + (100 - deputy.loyalty) * 0.28
      + deputy.insubordination * 0.2 + commanderRelation.grievance * 0.25
      + (100 - polity.authority) * 0.12 - deputy.caution * 0.18;
    if (refusalScore >= 72 && !actionRecentlyRecorded(deputy, '抗命', context.turn, 16)) {
      const oldMorale = army.morale;
      deputy.insubordination = Math.round(clamp(deputy.insubordination + 14));
      army.morale = Math.round(clamp(army.morale - 6));
      const event = emit({
        category: '军事',
        kind: 'order_refused',
        title: `${deputy.name}拒绝${commander.name}军令`,
        summary: `${deputy.name}因野心、低忠诚与对主帅的积怨拒绝执行军令，${army.name}士气受损。`,
        importance: 3,
        actorIds: [deputy.id, commander.id],
        polityIds: [army.polityId],
        regionIds: [army.regionId],
        causes: [
          { label: '军中层级', role: '结构', weight: 0.2, evidence: `${deputy.name}是${commander.name}麾下副将` },
          { label: '个人动机', role: '选择', weight: 0.3, evidence: `野心${deputy.ambition}、忠诚${deputy.loyalty}、谨慎${deputy.caution}` },
          { label: '关系记忆', role: '条件', weight: 0.2, evidence: `对主帅积怨${commanderRelation.grievance}、信任${commanderRelation.trust}` },
          { label: '抗命触发', role: '触发', weight: 0.15, evidence: `抗命效用${refusalScore.toFixed(1)}达到72` },
          { label: '军团后果', role: '结果', weight: 0.15, evidence: `士气${oldMorale}→${army.morale}` },
        ],
        stateDeltas: [{ entityType: 'army', entityId: army.id, field: 'morale', before: oldMorale, after: army.morale, delta: army.morale - oldMorale }],
      });
      addBiography(deputy, event, '抗命');
      remember(world, commander.id, deputy.id, '背叛', 18, event.summary, event.id);
      resolveCommitment(world, duty, '背约', event);
      continue;
    }

    const promotionScore = deputy.leadership + deputy.merit * 0.55 + deputy.deputyExperience * 0.35
      - commander.leadership - commander.merit * 0.2 + deputy.loyalty * 0.12;
    const commanderDiscredited = commander.loyalty <= 34
      || army.morale <= 20
      || commanderRelation.grievance >= 58
      || actionRecentlyRecorded(commander, '遭到清洗', context.turn, 12);
    if (
      commanderDiscredited
      && deputy.deputyExperience >= 45
      && deputy.merit >= 38
      && promotionScore >= 32
      && !actionRecentlyRecorded(deputy, '升任主帅', context.turn, 48)
      && !actionRecentlyRecorded(deputy, '退居副将', context.turn, 80)
    ) {
      const oldCommanderId = army.commanderId;
      army.commanderId = deputy.id;
      army.deputyCommanderId = commander.id;
      commander.commandingArmyId = null;
      deputy.commandingArmyId = army.id;
      const event = emit({
        category: '军事',
        kind: 'deputy_promoted',
        title: `${deputy.name}升任${army.name}主帅`,
        summary: `${deputy.name}凭副将战功、经验与统率超过原主帅，获授独立军令；${commander.name}退居副将。`,
        importance: 4,
        actorIds: [deputy.id, commander.id],
        polityIds: [army.polityId],
        regionIds: [army.regionId],
        causes: [
          { label: '副将历练', role: '结构', weight: 0.26, evidence: `副将经验${deputy.deputyExperience}、战功${deputy.merit}` },
          { label: '能力比较', role: '条件', weight: 0.28, evidence: `新帅统率${deputy.leadership}，原帅统率${commander.leadership}` },
          { label: '任命判断', role: '选择', weight: 0.26, evidence: `晋升效用${promotionScore.toFixed(1)}达到32` },
          { label: '军令转移', role: '结果', weight: 0.2, evidence: `${oldCommanderId}→${deputy.id}` },
        ],
        stateDeltas: [{ entityType: 'army', entityId: army.id, field: 'commanderId', before: oldCommanderId, after: deputy.id }],
      });
      addBiography(deputy, event, '升任主帅');
      addBiography(commander, event, '退居副将');
      remember(world, deputy.id, commander.id, '提携', 12, event.summary, event.id);
      resolveCommitment(world, duty, '履约', event);
      continue;
    }

    if (duty.dueTurn !== null && duty.dueTurn <= context.turn) {
      const event = emit({
        category: '军事',
        kind: 'commitment_fulfilled',
        title: `${deputy.name}履行副将军令`,
        summary: `${deputy.name}在约定期内未抗命并持续履职，对${commander.name}的军令承诺转化为信任。`,
        importance: 2,
        actorIds: [deputy.id, commander.id],
        polityIds: [army.polityId],
        regionIds: [army.regionId],
        causes: [
          { label: '军令承诺', role: '结构', weight: 0.35, evidence: duty.terms },
          { label: '履约期限', role: '触发', weight: 0.25, evidence: `第${duty.dueTurn}回合到期` },
          { label: '服从记录', role: '条件', weight: 0.2, evidence: `抗命值${deputy.insubordination}，期间无背约事件` },
          { label: '信任结果', role: '结果', weight: 0.2, evidence: `承诺${duty.id}状态生效→履约` },
        ],
        stateDeltas: [{ entityType: 'commitment', entityId: duty.id, field: 'status', before: '生效', after: '履约' }],
      });
      resolveCommitment(world, duty, '履约', event);
    }
  }
  recordTurningPointBiographies(world, context);
}

function desiredOffices(world: WorldState): Array<Omit<OfficeAppointment, 'id' | 'appointedTurn' | 'endedTurn' | 'active'>> {
  const desired: Array<Omit<OfficeAppointment, 'id' | 'appointedTurn' | 'endedTurn' | 'active'>> = [];
  for (const polity of world.polities.filter((item) => item.alive)) {
    desired.push({ polityId: polity.id, kind: '君主', holderId: polity.rulerId, regionId: polity.capitalRegionId, armyId: null, rank: 100 });
    for (const governor of world.characters.filter((character) => character.alive && character.polityId === polity.id && character.governedRegionId)) {
      desired.push({ polityId: polity.id, kind: '地方长官', holderId: governor.id, regionId: governor.governedRegionId, armyId: null, rank: 55 });
    }
    for (const army of world.armies.filter((item) => item.polityId === polity.id)) {
      desired.push({ polityId: polity.id, kind: '军团主帅', holderId: army.commanderId, regionId: null, armyId: army.id, rank: 70 });
      if (army.deputyCommanderId) desired.push({ polityId: polity.id, kind: '军团副将', holderId: army.deputyCommanderId, regionId: null, armyId: army.id, rank: 48 });
    }
    for (const fleet of (world.fleets ?? []).filter((item) => item.polityId === polity.id)) {
      desired.push({ polityId: polity.id, kind: '水师提督', holderId: fleet.commanderId, regionId: fleet.homePortRegionId, armyId: null, fleetId: fleet.id, rank: 72 });
      if (fleet.deputyCommanderId) desired.push({ polityId: polity.id, kind: '水师副将', holderId: fleet.deputyCommanderId, regionId: fleet.homePortRegionId, armyId: null, fleetId: fleet.id, rank: 50 });
    }
    const occupied = new Set(desired.filter((office) => office.polityId === polity.id).map((office) => office.holderId));
    const court = livingAdults(world, polity.id).filter((character) => !occupied.has(character.id));
    const chancellor = [...court].sort((left, right) => (
      (right.governance + right.cunning + right.influence) - (left.governance + left.cunning + left.influence)
      || stableCompare(left.id, right.id)
    ))[0];
    if (chancellor) {
      desired.push({ polityId: polity.id, kind: '宰辅', holderId: chancellor.id, regionId: polity.capitalRegionId, armyId: null, rank: 82 });
      occupied.add(chancellor.id);
    }
    const marshal = [...court].filter((character) => !occupied.has(character.id)).sort((left, right) => (
      (right.leadership + right.cunning + right.merit) - (left.leadership + left.cunning + left.merit)
      || stableCompare(left.id, right.id)
    ))[0];
    if (marshal) desired.push({ polityId: polity.id, kind: '枢密使', holderId: marshal.id, regionId: polity.capitalRegionId, armyId: null, rank: 80 });
  }
  return desired.sort((left, right) => (
    stableCompare(left.polityId, right.polityId)
    || stableCompare(left.kind, right.kind)
    || stableCompare(left.holderId, right.holderId)
  ));
}

function officeKey(office: Pick<OfficeAppointment, 'polityId' | 'kind' | 'holderId' | 'regionId' | 'armyId' | 'fleetId'>): string {
  return [office.polityId, office.kind, office.holderId, office.regionId ?? '', office.armyId ?? '', office.fleetId ?? ''].join(':');
}

export function syncOfficeAppointments(world: WorldState, turn: number): void {
  for (const background of world.backgroundPeople.filter((person) => person.promotedCharacterId === null)) {
    const controllerId = world.regions.find((region) => region.id === background.regionId)?.controllerId;
    if (controllerId) background.polityId = controllerId;
  }
  for (const polity of world.polities.filter((item) => item.alive)) ensureFactions(world, polity.id);
  const desired = desiredOffices(world);
  const desiredKeys = new Set(desired.map(officeKey));
  for (const office of world.offices.filter((item) => item.active)) {
    if (!desiredKeys.has(officeKey(office))) {
      office.active = false;
      office.endedTurn = turn;
    }
  }
  const activeKeys = new Set(world.offices.filter((office) => office.active).map(officeKey));
  for (const office of desired) {
    if (activeKeys.has(officeKey(office))) continue;
    world.counters.office += 1;
    world.offices.push({
      id: `office_${String(world.counters.office).padStart(5, '0')}`,
      ...office,
      appointedTurn: turn,
      endedTurn: null,
      active: true,
    });
  }
}

// Used only by schema migration: adds V0.2 social state without changing map, population or old history.
export function migrateV01SocialState(world: WorldState): void {
  world.families = [];
  world.relationships = [];
  world.factions = [];
  world.diplomacy = [];
  world.offices = [];
  world.backgroundPeople = [];
  world.commitments = [];
  world.counters.family = 0;
  world.counters.faction = 0;
  world.counters.relationship = 0;
  world.counters.office = 0;
  world.counters.commitment = 0;
  const referenceEventId = world.history[0]?.id ?? null;
  for (const character of world.characters) {
    character.birthTurn = world.turn - character.age * 4;
    character.adultTurn = character.age >= 16 ? world.turn - (character.age - 16) * 4 : null;
    character.lifeStage = lifeStage(character.age, character.alive);
    character.familyId = '';
    character.parentIds = [];
    character.spouseIds = [];
    character.politicalClass = character.role === '君主' ? '宗室' : character.role === '将领' ? '军门' : character.role === '地方长官' ? '地方豪强' : '官僚';
    character.influence = Math.round(clamp(character.renown * 0.5 + (character.role === '君主' ? 40 : character.role === '地方长官' ? 18 : 10)));
    character.personalWealth = Math.round(clamp(8 + character.governance * 0.18));
    character.merit = character.role === '将领' ? Math.round(character.renown * 0.5) : 0;
    character.deputyExperience = 0;
    character.insubordination = 0;
    const legacyEventId = referenceEventId && world.history[0]?.actorIds.includes(character.id) ? referenceEventId : null;
    character.biography = [{
      id: `${character.id}:bio:${legacyEventId ?? 'unrecorded'}:legacy`,
      turn: 0,
      kind: '旧档人物',
      summary: `${character.name}的早年经历来自V0.1史册，迁移没有改写既有历史。`,
      importance: character.role === '君主' ? 3 : 1,
      eventId: legacyEventId,
    }];
    character.biographyDigest = stableHash(character.biography);
    character.tier = '核心';
    character.sourceStubId = null;
  }
  for (const polity of world.polities) {
    polity.rulingFamilyId = null;
    polity.governmentForm = polity.id === 'p_canghai' ? '盟约' : polity.id.startsWith('p_rebel_') ? '军府' : '王朝';
    polity.courtInfluence = 50;
    polity.lastCourtCrisisTurn = -100;
  }
  for (const war of world.wars) {
    war.goal = war.kind === 'rebellion' ? '独立' : '边境';
    war.targetRegionIds = [];
    war.exhaustion = 0;
  }
  // Unlike createV02WorldSystems this deliberately uses the loaded 30-region graph as-is.
  for (const polity of world.polities) {
    const ruler = world.characters.find((character) => character.id === polity.rulerId);
    const members = world.characters.filter((character) => character.polityId === polity.id).sort((a, b) => stableCompare(a.id, b.id));
    if (!ruler && members.length === 0) continue;
    const founder = ruler ?? members[0] as CharacterState;
    const family = createFamily(world, founder);
    polity.rulingFamilyId = family.id;
    for (const character of members) {
      if (character.id === founder.id) continue;
      if (character.familyName === founder.familyName) character.familyId = family.id;
      else createFamily(world, character);
    }
  }
  syncFamilyMembers(world);
  createBackgroundPopulation(world);
  for (const polity of world.polities.filter((item) => item.alive)) ensureFactions(world, polity.id);
  ensureDiplomacyPairs(world);
  syncOfficeAppointments(world, world.turn);
}

// Re-exported only to make intentional data lists discoverable to tools/tests.
export const V02_FAMILY_NAME_POOL = FAMILY_NAMES;
