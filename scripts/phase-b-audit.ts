import {
  advanceWorldDetailed,
  createWorld,
  deserializeWorld,
  measureFullValidation,
  measureRuntimeValidation,
  serializeWorld,
  stableHash,
  type SimulationFact,
  type WorldState,
} from '../src/sim';

const seeds = process.env.PHASE_B_AUDIT_SEEDS?.split(',').map((seed) => seed.trim()).filter(Boolean)
  ?? ['军权春秋', '春战副将', '同源世界', '沧海一粟', '赤潮', '归档校验', '副将立功', '北境军令'];
const turns = Math.max(8, Number.parseInt(process.env.PHASE_B_AUDIT_TURNS ?? '80', 10));

const REQUIRED_SITUATION_TYPES = ['military_power_crisis', 'inheritance_crisis', 'war_progress'] as const;
const OPEN_BUDGETS: Readonly<Record<(typeof REQUIRED_SITUATION_TYPES)[number], number>> = {
  military_power_crisis: 5,
  inheritance_crisis: 3,
  war_progress: 4,
};

interface SituationTypeTransitions {
  formed: number;
  phaseChanged: number;
  resolved: number;
  outcomes: Record<string, number>;
}

interface SituationSequenceEntry {
  turn: number;
  ids: string[];
  digest: string;
}

interface AuditRun {
  world: WorldState;
  sequence: SituationSequenceEntry[];
  maxOpen: number;
  maxCandidates: number;
  maxOpenByType: Record<string, number>;
  maxCandidatesByType: Record<string, number>;
  transitionsByType: Record<string, SituationTypeTransitions>;
  failures: string[];
}

function emptyTransitions(): SituationTypeTransitions {
  return { formed: 0, phaseChanged: 0, resolved: 0, outcomes: {} };
}

function countByType(items: readonly { type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  return counts;
}

function updatePeaks(peaks: Record<string, number>, counts: Readonly<Record<string, number>>): void {
  for (const [type, count] of Object.entries(counts)) peaks[type] = Math.max(peaks[type] ?? 0, count);
}

function factWarId(fact: SimulationFact): string | null {
  if (fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle') {
    return fact.payload.warId;
  }
  return fact.kind === 'territory_control_changed' ? fact.payload.warId : null;
}

function auditMilestoneFact(world: WorldState, fact: Extract<SimulationFact, { kind: 'situation_milestone' }>): string[] {
  const failures: string[] = [];
  const factById = new Map(world.facts.map((item) => [item.id, item]));
  if (fact.sourceFactIds.length === 0) failures.push(`${fact.id}没有来源事实`);
  for (const sourceFactId of fact.sourceFactIds) {
    const source = factById.get(sourceFactId);
    if (!source || source.turn > fact.turn || source.id === fact.id) {
      failures.push(`${fact.id}引用无效来源${sourceFactId}`);
    }
  }
  const situation = world.situationSystem.situations.find((item) => item.id === fact.payload.situationId);
  if (!situation) {
    failures.push(`${fact.id}指向不存在的局势${fact.payload.situationId}`);
    return failures;
  }
  if (situation.type !== fact.payload.situationType) {
    failures.push(`${fact.id}的类型${fact.payload.situationType}与权威状态${situation.type}不一致`);
  }
  if (!situation.milestoneFactIds.includes(fact.id)) {
    failures.push(`${fact.id}未回挂到${situation.id}的里程碑事实链`);
  }
  if (situation.type === 'war_progress') {
    const war = world.wars.find((item) => item.id === situation.scopeKey);
    if (!war) failures.push(`${fact.id}的战争局势指向不存在的${situation.scopeKey}`);
    if (fact.category !== '军事') failures.push(`${fact.id}的战争局势里程碑没有归入军事类别`);
    const exactWarSources = fact.sourceFactIds
      .map((sourceFactId) => factById.get(sourceFactId))
      .filter((source): source is SimulationFact => Boolean(source))
      .filter((source) => factWarId(source) === situation.scopeKey);
    if (exactWarSources.length === 0) {
      failures.push(`${fact.id}没有引用同一战争${situation.scopeKey}的领域事实`);
    }
    if (war) {
      const participantPolities = new Set(situation.participants.polityIds);
      if (!participantPolities.has(war.attackerId) || !participantPolities.has(war.defenderId)) {
        failures.push(`${fact.id}的战争参与政权与${war.id}攻守双方不一致`);
      }
    }
    if (fact.payload.transition === 'resolved') {
      const endFact = exactWarSources.find((source) => source.kind === 'war_ended');
      if (!endFact) failures.push(`${fact.id}结案没有引用同战争的war_ended事实`);
      else if (endFact.payload.result !== fact.payload.outcomeKey) {
        failures.push(`${fact.id}结案结果${fact.payload.outcomeKey}与${endFact.id}的${endFact.payload.result}不一致`);
      }
    }
  }
  const matchingChange = situation.recentChanges.find((change) => (
    change.turn === fact.turn && change.kind === fact.payload.transition
  ));
  if (!matchingChange) failures.push(`${fact.id}在${situation.id}中没有同季状态转移`);
  if (situation.tension !== fact.payload.tension || situation.momentum !== fact.payload.momentum) {
    failures.push(`${fact.id}的张力或动量与${situation.id}权威状态不一致`);
  }
  if (fact.payload.transition === 'formed') {
    if (situation.status !== 'open' || fact.payload.toPhase !== 'emerging') {
      failures.push(`${fact.id}形成后未对应开放的萌芽局势`);
    }
  } else if (fact.payload.transition === 'phase_changed') {
    if (situation.status !== 'open' || situation.phase !== fact.payload.toPhase) {
      failures.push(`${fact.id}阶段转移与${situation.id}当前阶段不一致`);
    }
  } else if (
    situation.status !== 'resolved'
    || situation.resolution?.outcomeKey !== fact.payload.outcomeKey
  ) {
    failures.push(`${fact.id}结案结果与${situation.id}权威状态不一致`);
  }
  return failures;
}

function auditWarLifecycleFacts(world: WorldState): string[] {
  const failures: string[] = [];
  const starts = world.facts.filter((fact) => fact.kind === 'war_started');
  const ends = world.facts.filter((fact) => fact.kind === 'war_ended');
  for (const war of world.wars) {
    const matchingStarts = starts.filter((fact) => fact.payload.warId === war.id);
    const matchingEnds = ends.filter((fact) => fact.payload.warId === war.id);
    if (matchingStarts.length !== 1) failures.push(`${war.id}应有且仅有一个war_started，实际${matchingStarts.length}`);
    const start = matchingStarts[0];
    if (start && (
      start.turn !== war.startedTurn
      || start.payload.attackerId !== war.attackerId
      || start.payload.defenderId !== war.defenderId
      || start.payload.warKind !== war.kind
    )) failures.push(`${war.id}的war_started与权威战争状态不一致`);
    if (war.active) {
      if (matchingEnds.length !== 0) failures.push(`${war.id}仍在进行却已有war_ended`);
    } else {
      if (matchingEnds.length !== 1) failures.push(`${war.id}已结束但war_ended数量为${matchingEnds.length}`);
      const end = matchingEnds[0];
      if (end && (
        end.turn !== war.endedTurn
        || end.payload.attackerId !== war.attackerId
        || end.payload.defenderId !== war.defenderId
        || end.payload.durationTurns !== Math.max(1, end.turn - war.startedTurn + 1)
      )) failures.push(`${war.id}的war_ended与权威战争状态不一致`);
    }
  }
  for (const fact of [...starts, ...ends]) {
    if (!world.wars.some((war) => war.id === fact.payload.warId)) {
      failures.push(`${fact.id}指向不存在的战争${fact.payload.warId}`);
    }
  }
  return failures;
}

function run(seed: string): AuditRun {
  let world = createWorld(seed);
  let maxOpen = 0;
  let maxCandidates = 0;
  const maxOpenByType: Record<string, number> = Object.fromEntries(
    REQUIRED_SITUATION_TYPES.map((type) => [type, 0]),
  );
  const maxCandidatesByType: Record<string, number> = Object.fromEntries(
    REQUIRED_SITUATION_TYPES.map((type) => [type, 0]),
  );
  const transitionsByType: Record<string, SituationTypeTransitions> = Object.fromEntries(
    REQUIRED_SITUATION_TYPES.map((type) => [type, emptyTransitions()]),
  );
  const seenMilestoneIds = new Set(
    world.facts.filter((fact) => fact.kind === 'situation_milestone').map((fact) => fact.id),
  );
  const sequence: SituationSequenceEntry[] = [];
  const failures: string[] = [];
  for (let index = 0; index < turns; index += 1) {
    const previous = world;
    world = advanceWorldDetailed(world).world;
    const runtime = measureRuntimeValidation(previous, world);
    if (runtime.violations.length > 0) {
      failures.push(`T${world.turn} ${runtime.violations[0]?.code}: ${runtime.violations[0]?.message}`);
    }
    const open = world.situationSystem.situations.filter((situation) => situation.status === 'open');
    const openByType = countByType(open);
    const candidatesByType = countByType(world.situationSystem.candidates);
    maxOpen = Math.max(maxOpen, open.length);
    maxCandidates = Math.max(maxCandidates, world.situationSystem.candidates.length);
    updatePeaks(maxOpenByType, openByType);
    updatePeaks(maxCandidatesByType, candidatesByType);
    if (open.length > 12) failures.push(`T${world.turn}开放局势超过12`);
    for (const [type, budget] of Object.entries(OPEN_BUDGETS)) {
      if ((openByType[type] ?? 0) > budget) {
        failures.push(`T${world.turn}${type}开放局势超过类型预算${budget}`);
      }
    }
    if (world.situationSystem.candidates.length > 64) failures.push(`T${world.turn}候选局势超过64`);
    for (const fact of world.facts) {
      if (fact.kind !== 'situation_milestone' || seenMilestoneIds.has(fact.id)) continue;
      seenMilestoneIds.add(fact.id);
      failures.push(...auditMilestoneFact(world, fact));
      const stats = transitionsByType[fact.payload.situationType]
        ?? (transitionsByType[fact.payload.situationType] = emptyTransitions());
      if (fact.payload.transition === 'formed') stats.formed += 1;
      else if (fact.payload.transition === 'phase_changed') stats.phaseChanged += 1;
      else {
        stats.resolved += 1;
        const outcome = fact.payload.outcomeKey ?? 'dissipated';
        stats.outcomes[outcome] = (stats.outcomes[outcome] ?? 0) + 1;
      }
    }
    sequence.push({
      turn: world.turn,
      ids: open.map((situation) => situation.id),
      digest: stableHash(world.situationSystem),
    });
    if (world.turn % 20 === 0 || index === turns - 1) {
      const full = measureFullValidation(world);
      if (full.violations.length > 0) {
        failures.push(`T${world.turn} ${full.violations[0]?.code}: ${full.violations[0]?.message}`);
      }
    }
  }
  failures.push(...auditWarLifecycleFacts(world));
  return {
    world,
    sequence,
    maxOpen,
    maxCandidates,
    maxOpenByType,
    maxCandidatesByType,
    transitionsByType,
    failures,
  };
}

const failures: string[] = [];
const samples = seeds.map((seed) => {
  const first = run(seed);
  const second = run(seed);
  if (first.world.hash !== second.world.hash
    || serializeWorld(first.world) !== serializeWorld(second.world)
    || JSON.stringify(first.sequence) !== JSON.stringify(second.sequence)) {
    failures.push(`${seed}: 同种子局势序列不确定`);
  }
  failures.push(...first.failures.map((failure) => `${seed}: ${failure}`));

  const splitTurn = Math.floor(turns / 2);
  let resumed = createWorld(seed);
  for (let index = 0; index < splitTurn; index += 1) resumed = advanceWorldDetailed(resumed).world;
  resumed = deserializeWorld(serializeWorld(resumed));
  for (let index = splitTurn; index < turns; index += 1) resumed = advanceWorldDetailed(resumed).world;
  if (resumed.hash !== first.world.hash || serializeWorld(resumed) !== serializeWorld(first.world)) {
    failures.push(`${seed}: 存档边界后局势演化分叉`);
  }

  const firstSituation = first.world.situationSystem.situations[0];
  return {
    seed,
    finalHash: first.world.hash,
    candidatesPeak: first.maxCandidates,
    openPeak: first.maxOpen,
    types: Object.fromEntries(
      [...new Set([
        ...REQUIRED_SITUATION_TYPES,
        ...Object.keys(first.maxCandidatesByType),
        ...Object.keys(first.maxOpenByType),
        ...Object.keys(first.transitionsByType),
      ])].sort().map((type) => [type, {
        candidatesPeak: first.maxCandidatesByType[type] ?? 0,
        openPeak: first.maxOpenByType[type] ?? 0,
        ...(first.transitionsByType[type] ?? emptyTransitions()),
      }]),
    ),
    retainedSituations: first.world.situationSystem.situations.length,
    archivedResolved: first.world.situationSystem.archive.resolvedCount,
    firstSituation: firstSituation ? {
      id: firstSituation.id,
      phase: firstSituation.phase,
      status: firstSituation.status,
      actorId: firstSituation.participants.coreCharacterIds[0] ?? null,
      polityId: firstSituation.participants.polityIds[0] ?? null,
      causalFacts: firstSituation.causalFactIds.length,
      milestoneFacts: firstSituation.milestoneFactIds.length,
      nextWatch: firstSituation.nextWatch.key,
    } : null,
  };
});

for (const type of REQUIRED_SITUATION_TYPES) {
  if (!samples.some((sample) => (sample.types[type]?.formed ?? 0) > 0)) {
    failures.push(`样本中没有自然形成任何${type}`);
  }
}

console.log(JSON.stringify({
  phase: 'B01/B03/B04/B06',
  seeds: seeds.length,
  turnsPerSeed: turns,
  samples,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
