import { describe, expect, it } from 'vitest';

import {
  advanceWorldBy,
  createWorld,
  serializeWorld,
  type BiographyFact,
  type CharacterState,
  type HistoryEvent,
  type SimulationFact,
  type WorldState,
} from '../sim';
import { toPersonArchive, toPersonExperienceRecords, toPersonInspector, toSystemInspector } from './adapters';

function rejectedCommandFixture(seed: string) {
  const world = advanceWorldBy(createWorld(seed), 1);
  const army = world.armies.find((item) => item.deputyCommanderId !== null);
  const deputy = world.characters.find((item) => item.id === army?.deputyCommanderId);
  const polity = world.polities.find((item) => item.id === army?.polityId);
  if (!army || !deputy || !polity) throw new Error('请令测试需要一支有副将的军团');

  const goalId = `agency-goal-resolved-view:${seed}`;
  const planId = `agency-plan-resolved-view:${seed}`;
  const actor = {
    characterId: deputy.id,
    coreDesireKinds: ['power', 'renown'],
    goal: {
      id: goalId,
      type: 'secure_independent_command',
      targetArmyId: army.id,
      targetPolityId: polity.id,
      createdTurn: world.turn,
      lastReviewedTurn: world.turn,
      status: 'active',
      resolvedTurn: null,
      closureReason: null,
      sourceFactIds: [],
    },
    plan: {
      id: planId,
      templateVersion: 1,
      goalId,
      status: 'active',
      currentStepIndex: 4,
      steps: [
        { id: `${planId}:merit`, action: 'earn_merit', order: 1, status: 'completed', evidence: '已有战功' },
        { id: `${planId}:patron`, action: 'seek_patronage', order: 2, status: 'completed', evidence: '已有提携' },
        { id: `${planId}:support`, action: 'build_military_support', order: 3, status: 'completed', evidence: '已有军望' },
        { id: `${planId}:family`, action: 'seek_family_backing', order: 4, status: 'completed', evidence: '已有家门背书' },
        { id: `${planId}:request`, action: 'request_independent_command', order: 5, status: 'blocked', evidence: '本次未准' },
      ],
    },
    attemptOrdinal: 1,
    nextEligibleIntentTurn: world.turn + 8,
    lastResolutionFactId: `fact-command-resolved-view:${seed}`,
    lastReviewedTurn: world.turn,
  } satisfies WorldState['agencyDecisionSystem']['actors'][number];
  const submittedId = `fact-command-submitted-view:${seed}`;
  const resolvedId = actor.lastResolutionFactId;
  const eventId = `event-command-resolved-view:${seed}`;
  const submitted = {
    id: submittedId,
    turn: world.turn,
    year: world.year,
    season: world.season,
    kind: 'agency_intent_submitted',
    category: '军事',
    importance: 1,
    actorIds: [deputy.id, army.commanderId, polity.rulerId],
    polityIds: [polity.id],
    regionIds: [army.regionId],
    causes: [],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      actorId: deputy.id,
      goalId: actor.goal.id,
      goalType: 'secure_independent_command',
      goalCreatedTurn: actor.goal.createdTurn,
      planId: actor.plan.id,
      planStepId: `${actor.plan.id}:step:request_independent_command`,
      action: 'request_independent_command',
      attemptOrdinal: 1,
      targetArmyId: army.id,
      polityId: polity.id,
      currentCommanderId: army.commanderId,
      appointingAuthorityId: polity.rulerId,
    },
  } satisfies Extract<SimulationFact, { kind: 'agency_intent_submitted' }>;
  const resolved = {
    ...submitted,
    id: resolvedId,
    kind: 'agency_intent_resolved',
    importance: 2,
    sourceFactIds: [submittedId],
    payload: {
      submissionFactId: submittedId,
      actorId: deputy.id,
      goalId: actor.goal.id,
      planId: actor.plan.id,
      planStepId: submitted.payload.planStepId,
      action: 'request_independent_command',
      attemptOrdinal: 1,
      targetArmyId: army.id,
      polityId: polity.id,
      previousCommanderId: army.commanderId,
      appointingAuthorityId: polity.rulerId,
      outcome: 'rejected',
      reasonCode: 'court_risk',
      retryAfterTurn: world.turn + 8,
      checks: [
        { kind: 'permission', passed: true, value: 100, threshold: 100, comparison: 'at_least' },
        { kind: 'resource', passed: true, value: 80, threshold: 34, comparison: 'at_least' },
        {
          kind: 'relationship',
          passed: true,
          value: 75,
          threshold: 40,
          comparison: 'at_least',
          components: [
            { source: 'commander_patronage', value: 18, passed: false },
            { source: 'ruler_patronage', value: 22, passed: false },
            { source: 'family_backing', value: 75, passed: true },
          ],
        },
        { kind: 'risk', passed: false, value: 70, threshold: 55, comparison: 'at_most' },
      ],
      decisionScore: 61,
      decisionThreshold: 48,
    },
  } satisfies Extract<SimulationFact, { kind: 'agency_intent_resolved' }>;
  const sourceEvent = {
    id: eventId,
    turn: resolved.turn,
    year: resolved.year,
    season: resolved.season,
    category: '军事',
    kind: 'command_request_rejected',
    title: `${deputy.name}所请独立军令未获准许`,
    summary: `${deputy.name}的请令经朝廷考量后未获准许。`,
    importance: 2,
    actorIds: [...resolved.actorIds],
    polityIds: [polity.id],
    regionIds: [army.regionId],
    causes: [],
    evidence: [],
    stateDeltas: [],
    sourceFactIds: [submittedId, resolvedId],
    situationIds: [],
  } satisfies HistoryEvent;

  world.facts.push(submitted, resolved);
  world.history.push(sourceEvent);
  world.agencyDecisionSystem = {
    version: 1,
    reviewedThroughTurn: world.turn - 1,
    actors: [actor],
  };
  return { world, army, deputy, actor, resolved, sourceEvent };
}

describe('map object dossiers', () => {
  it('projects a clicked land army into its own commander, location and readiness dossier', () => {
    const world = createWorld('陆军档案');
    const army = world.armies[0];
    const commander = world.characters.find((character) => character.id === army.commanderId);
    const dossier = toSystemInspector(world, 'army', army.id);

    expect(dossier).toMatchObject({ id: army.id, kind: 'army', name: army.name });
    expect(dossier?.facts).toContainEqual({ label: '主帅', value: commander?.name });
    expect(dossier?.facts).toContainEqual({ label: '最近移动', value: '尚未移营' });
    expect(dossier?.meters?.map((meter) => meter.label)).toEqual(['士气', '训练', '战阵经验', '补给']);
    expect(dossier?.links).toContainEqual(expect.objectContaining({ kind: 'person', id: army.commanderId }));
    expect(dossier?.links).toContainEqual(expect.objectContaining({ kind: 'region', id: army.regionId }));
  });
});

describe('person Agency dossier', () => {
  it('shows a bounded natural-language intention without changing the world', () => {
    const world = advanceWorldBy(createWorld('人物所图档案'), 4);
    const person = world.characters.find((character) => character.alive && character.age >= 16) as CharacterState;
    const before = serializeWorld(world);
    const inspector = toPersonInspector(world, person);
    const archive = toPersonArchive(world, person);

    expect(inspector.agency?.availability).toBe('active');
    expect(inspector.agency?.desires).toHaveLength(2);
    expect(inspector.agency?.primaryGoal).toBeTruthy();
    expect(inspector.agency?.secondaryGoals.length).toBeLessThanOrEqual(2);
    expect(inspector.agency?.currentPlanSteps.length).toBeLessThanOrEqual(5);
    expect(inspector.summary).toContain(inspector.agency?.primaryGoal?.label);
    expect(archive.chapters.find((chapter) => chapter.id === 'mind')?.paragraphs.join('')).toContain(
      inspector.agency?.primaryGoal?.label,
    );

    const playerFacing = JSON.stringify(inspector.agency);
    expect(playerFacing).not.toContain('sourceWorldHash');
    expect(playerFacing).not.toContain('authority');
    expect(playerFacing).not.toContain('identityAnchorTurn');
    expect(playerFacing).not.toContain('action');
    expect(serializeWorld(world)).toBe(before);
  });

  it('lets an authoritative command request replace the same-quarter observer comparison', () => {
    const world = advanceWorldBy(createWorld('请令进展档案'), 4);
    const person = world.characters.find((character) => character.alive && character.age >= 16) as CharacterState;
    const before = serializeWorld(world);
    const commandRequest = {
      id: 'request-authoritative',
      stage: 'approved' as const,
      periodLabel: '初元二年 · 夏',
      statusLabel: '军令已授',
      title: `获授北府军军令`,
      summary: '此前请令获准，现已升任北府军主帅。',
      evidence: [
        { tone: 'support' as const, label: '有利', detail: '副将任职与近期战功均有记录' },
        { tone: 'support' as const, label: '有利', detail: '朝廷认可其军中声望' },
      ],
      sourceEventId: world.history.at(-1)?.id ?? null,
    };
    const quarterChoice = {
      periodLabel: '初元二年 · 夏',
      intended: '旧观察账中的请令盘算',
      actual: '旧制任命',
      outcome: 'aligned' as const,
      reason: '这段旧对照不应与权威请令重复出现',
      sourceEventId: world.history.at(-1)?.id ?? null,
    };

    const inspector = toPersonInspector(world, person, { commandRequest, quarterChoice });
    const archive = toPersonArchive(world, person, { commandRequest, quarterChoice });
    const archiveMind = archive.chapters.find((chapter) => chapter.id === 'mind')?.paragraphs.join('') ?? '';

    expect(inspector.agency?.commandRequest).toEqual(commandRequest);
    expect(inspector.agency?.quarterChoice).toBeNull();
    expect(inspector.summary).toContain('获授北府军军令');
    expect(inspector.summary).toContain('现已升任北府军主帅');
    expect(archiveMind).toContain('此前请令获准');
    expect(archiveMind).not.toContain('这些只是当下盘算');
    expect(JSON.stringify(inspector.agency)).not.toMatch(/Intent|Resolver|request_independent_command|threshold|score/i);
    expect(serializeWorld(world)).toBe(before);
  });

  it('automatically reads a C10 command plan and gives it ownership over the old comparison', () => {
    const world = advanceWorldBy(createWorld('权威请令计划投影'), 1);
    const army = world.armies.find((item) => item.deputyCommanderId !== null);
    const deputy = world.characters.find((item) => item.id === army?.deputyCommanderId);
    expect(army).toBeDefined();
    expect(deputy).toBeDefined();
    if (!army || !deputy) return;
    const goalId = 'agency-goal-command-fixture';
    const planId = 'agency-plan-command-fixture';
    const actor = {
      characterId: deputy.id,
      coreDesireKinds: ['power', 'renown'],
      goal: {
        id: goalId,
        type: 'secure_independent_command',
        targetArmyId: army.id,
        targetPolityId: army.polityId,
        createdTurn: 0,
        lastReviewedTurn: 0,
        status: 'active',
        resolvedTurn: null,
        closureReason: null,
        sourceFactIds: [],
      },
      plan: {
        id: planId,
        templateVersion: 1,
        goalId,
        status: 'active',
        currentStepIndex: 0,
        steps: [
          { id: `${planId}:merit`, action: 'earn_merit', order: 1, status: 'available', evidence: '还需更多副将经历或战功' },
          { id: `${planId}:patron`, action: 'seek_patronage', order: 2, status: 'blocked', evidence: '尚未得到可靠提携' },
          { id: `${planId}:support`, action: 'build_military_support', order: 3, status: 'blocked', evidence: '军中影响仍显单薄' },
          { id: `${planId}:family`, action: 'seek_family_backing', order: 4, status: 'blocked', evidence: '家门尚不足以背书' },
          { id: `${planId}:request`, action: 'request_independent_command', order: 5, status: 'blocked', evidence: '尚不能正式请令' },
        ],
      },
      attemptOrdinal: 0,
      nextEligibleIntentTurn: 0,
      lastResolutionFactId: null,
      lastReviewedTurn: 0,
    } satisfies WorldState['agencyDecisionSystem']['actors'][number];
    world.agencyDecisionSystem = { version: 1, reviewedThroughTurn: world.turn - 1, actors: [actor] };

    const inspector = toPersonInspector(world, deputy, {
      quarterChoice: {
        periodLabel: '第 1 年 · 春',
        intended: '旧观察盘算',
        actual: '旧制没有行动',
        outcome: 'unobserved',
        reason: '这段旧对照应由 C10 让位',
        sourceEventId: null,
      },
    });

    expect(inspector.agency?.commandRequest).toMatchObject({
      stage: 'planned',
      statusLabel: '已有此意',
      title: `想独领${army.name}`,
      periodLabel: '起意于第 1 年 · 春',
    });
    expect(inspector.agency?.quarterChoice).toBeNull();
    expect(inspector.agency?.commandRequest?.evidence.length).toBeLessThanOrEqual(3);
    expect(inspector.agency?.commandRequest?.evidence[0]).toEqual(expect.objectContaining({
      tone: 'barrier',
      detail: '尚不能正式请令',
    }));
  });

  it('projects a resolved request from its exact Fact without exposing decision scores', () => {
    const { world, deputy, sourceEvent } = rejectedCommandFixture('权威请令裁定投影');

    const before = JSON.stringify(world);
    const inspector = toPersonInspector(world, deputy, {
      quarterChoice: {
        periodLabel: '旧观察账',
        intended: '旧盘算',
        actual: '旧任命',
        outcome: 'diverged',
        reason: '不得重复展示',
        sourceEventId: sourceEvent.id,
      },
    });
    const requestText = JSON.stringify(inspector.agency?.commandRequest);

    expect(inspector.agency?.commandRequest).toMatchObject({
      stage: 'blocked',
      statusLabel: '此次未准',
      sourceEventId: sourceEvent.id,
    });
    expect(inspector.agency?.commandRequest?.evidence).toContainEqual(expect.objectContaining({
      tone: 'barrier',
      detail: expect.stringContaining('军权过重'),
    }));
    expect(inspector.agency?.quarterChoice).toBeNull();
    expect(requestText).not.toMatch(/decisionScore|decisionThreshold|61|48|Resolver|Intent/i);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('names family backing without inventing support from the ruler or commander', () => {
    const { world, deputy, resolved } = rejectedCommandFixture('请令支持来源');
    const factIndex = world.facts.findIndex((fact) => fact.id === resolved.id);
    const checks = resolved.payload.checks.map((check) => (
      check.kind === 'resource'
        ? { ...check, passed: false, value: 20 }
        : check.kind === 'risk'
          ? { ...check, passed: true, value: 20 }
          : check
    ));
    world.facts[factIndex] = {
      ...resolved,
      payload: {
        ...resolved.payload,
        outcome: 'deferred',
        reasonCode: 'insufficient_record',
        checks,
      },
    };

    const request = toPersonInspector(world, deputy).agency?.commandRequest;
    const evidenceText = request?.evidence.map((item) => item.detail).join('') ?? '';

    expect(request).toMatchObject({ stage: 'blocked', statusLabel: '暂缓授令' });
    expect(evidenceText).toContain('家门声望足以为其背书');
    expect(evidenceText).not.toMatch(/主君|主帅/);
    expect(evidenceText).not.toMatch(/threshold|score|decision|Intent|Resolver/i);
  });

  it('describes an exhausted request as a temporary pause rather than a lost post', () => {
    const { world, army, deputy, actor, sourceEvent } = rejectedCommandFixture('三请未准暂搁');
    world.agencyDecisionSystem = {
      ...world.agencyDecisionSystem,
      actors: [{
        ...actor,
        attemptOrdinal: 3,
        goal: {
          ...actor.goal,
          status: 'invalidated',
          resolvedTurn: world.turn + 1,
          lastReviewedTurn: world.turn + 1,
          closureReason: 'request_exhausted',
        },
      }],
    };

    const request = toPersonInspector(world, deputy).agency?.commandRequest;

    expect(request).toMatchObject({
      stage: 'blocked',
      statusLabel: '暂搁此议',
      title: `请领${army.name}军令之议暂且搁下`,
      sourceEventId: sourceEvent.id,
    });
    expect(request?.summary).toContain('三次请令均未获准');
    expect(request?.summary).toContain('仍可重新起意');
    expect(request?.summary).not.toContain('不再担任');
  });

  it('closes an old rejected request when the person has since died', () => {
    const { world, deputy, actor, sourceEvent } = rejectedCommandFixture('旧请令后身故');
    deputy.alive = false;
    world.agencyDecisionSystem = {
      ...world.agencyDecisionSystem,
      actors: [{
        ...actor,
        goal: {
          ...actor.goal,
          status: 'invalidated',
          resolvedTurn: world.turn + 1,
          lastReviewedTurn: world.turn + 1,
          closureReason: 'actor_dead',
        },
      }],
    };

    const request = toPersonInspector(world, deputy).agency?.commandRequest;
    const playerCopy = [
      request?.periodLabel,
      request?.statusLabel,
      request?.title,
      request?.summary,
      ...(request?.evidence.map((item) => `${item.label}${item.detail}`) ?? []),
    ].join('');

    expect(request).toMatchObject({
      stage: 'blocked',
      statusLabel: '此事已止',
      title: expect.stringContaining('之事已止'),
      sourceEventId: null,
    });
    expect(request?.summary).toContain('人物已经去世');
    expect(request?.summary).not.toContain('朝廷未准');
    expect(request?.sourceEventId).not.toBe(sourceEvent.id);
    expect(playerCopy).not.toMatch(/agency-|fact-|decision|threshold|score|Resolver|Intent/i);
  });

  it('shows a departed deputy\'s current position instead of an old deferral', () => {
    const { world, army, deputy, actor, sourceEvent } = rejectedCommandFixture('旧请令后离任');
    army.deputyCommanderId = null;
    world.agencyDecisionSystem = {
      ...world.agencyDecisionSystem,
      actors: [{
        ...actor,
        goal: {
          ...actor.goal,
          status: 'invalidated',
          resolvedTurn: world.turn + 1,
          lastReviewedTurn: world.turn + 1,
          closureReason: 'position_lost',
        },
      }],
    };

    const request = toPersonInspector(world, deputy).agency?.commandRequest;
    const playerCopy = [
      request?.periodLabel,
      request?.statusLabel,
      request?.title,
      request?.summary,
      ...(request?.evidence.map((item) => `${item.label}${item.detail}`) ?? []),
    ].join('');

    expect(request).toMatchObject({
      stage: 'blocked',
      statusLabel: '已经离任',
      title: `已无从再请领${army.name}军令`,
      sourceEventId: null,
    });
    expect(request?.summary).toContain('已不再担任该军副将');
    expect(request?.summary).not.toContain('本季没有准许');
    expect(request?.sourceEventId).not.toBe(sourceEvent.id);
    expect(playerCopy).not.toMatch(/agency-|fact-|decision|threshold|score|Resolver|Intent/i);
  });

  it('shows an external promotion as the current outcome and links its exact appointment', () => {
    const { world, army, deputy, actor, sourceEvent } = rejectedCommandFixture('旧请令后另途升帅');
    const previousCommanderId = army.commanderId;
    const previousCommander = world.characters.find((item) => item.id === previousCommanderId);
    if (!previousCommander) throw new Error('请令测试需要原任主帅');
    previousCommander.commandingArmyId = null;
    army.commanderId = deputy.id;
    army.deputyCommanderId = previousCommander.id;
    deputy.commandingArmyId = army.id;
    const appointmentEvent = {
      id: 'event-external-command-appointment',
      turn: world.turn + 1,
      year: world.year,
      season: world.season,
      category: '军事',
      kind: 'commander_appointed',
      title: `${deputy.name}受命统领${army.name}`,
      summary: `${deputy.name}经正式任命接掌${army.name}。`,
      importance: 2,
      actorIds: [deputy.id, previousCommander.id],
      polityIds: [army.polityId],
      regionIds: [army.regionId],
      causes: [],
      evidence: [],
      stateDeltas: [{
        entityType: 'army',
        entityId: army.id,
        field: 'commanderId',
        before: previousCommander.id,
        after: deputy.id,
      }],
      sourceFactIds: [],
      situationIds: [],
    } satisfies HistoryEvent;
    world.history.push(appointmentEvent);
    world.agencyDecisionSystem = { ...world.agencyDecisionSystem, actors: [actor] };

    const request = toPersonInspector(world, deputy).agency?.commandRequest;
    const playerCopy = [
      request?.periodLabel,
      request?.statusLabel,
      request?.title,
      request?.summary,
      ...(request?.evidence.map((item) => `${item.label}${item.detail}`) ?? []),
    ].join('');

    expect(request).toMatchObject({
      stage: 'approved',
      statusLabel: '已经掌军',
      title: `现掌${army.name}军令`,
      sourceEventId: appointmentEvent.id,
    });
    expect(request?.summary).toContain('后来经正式任命');
    expect(request?.summary).not.toContain('本季没有准许');
    expect(request?.sourceEventId).not.toBe(sourceEvent.id);
    expect(playerCopy).not.toMatch(/agency-|fact-|decision|threshold|score|Resolver|Intent/i);
  });
});

describe('person experience attribution', () => {
  it('drops a biography row linked to somebody else and makes shared-event attribution explicit', () => {
    const world = advanceWorldBy(createWorld('人物经历归属'), 8);
    const sourceEvent = world.history.find((event) => (
      event.actorIds.length > 0 && event.actorIds.length < world.characters.length
    ));
    expect(sourceEvent).toBeDefined();
    if (!sourceEvent) return;

    const stranger = world.characters.find((character) => !sourceEvent.actorIds.includes(character.id));
    const participant = world.characters.find((character) => sourceEvent.actorIds.includes(character.id));
    expect(stranger).toBeDefined();
    expect(participant).toBeDefined();
    if (!stranger || !participant) return;

    const misplaced: BiographyFact = {
      id: `${stranger.id}:bio:misplaced`,
      turn: sourceEvent.turn,
      kind: '错置经历',
      summary: `${participant.name}完成了这件事。`,
      importance: 3,
      eventId: sourceEvent.id,
      factId: null,
    };
    stranger.biography.push(misplaced);
    expect(toPersonExperienceRecords(world, stranger).some((record) => record.id === misplaced.id)).toBe(false);
    expect(toPersonInspector(world, stranger).experiences?.some((record) => record.id === misplaced.id)).toBe(false);
    expect(toPersonArchive(world, stranger).records.some((record) => record.id === misplaced.id)).toBe(false);

    const sharedEvent = {
      ...sourceEvent,
      id: 'event_person_attribution_fixture',
      turn: world.turn - 1,
      title: `${stranger.name}整顿朝局`,
      summary: `${stranger.name}主持朝议，${participant.name}协理其事。`,
      actorIds: [stranger.id, participant.id],
      sourceFactIds: [],
    };
    // The selected participant is deliberately the second actor even though
    // both names occur in the prose. This used to keep the first actor's
    // viewpoint and still looked pasted into the second actor's dossier.
    world.history.push(sharedEvent);
    const sharedBiography: BiographyFact = {
      id: `${participant.id}:bio:${sharedEvent.id}:related`,
      turn: sharedEvent.turn,
      kind: '卷入朝局',
      summary: sharedEvent.summary,
      importance: 3,
      eventId: sharedEvent.id,
      factId: null,
    };
    participant.biography.push(sharedBiography);
    const projected = toPersonExperienceRecords(world, participant).find((record) => record.id === sharedBiography.id);
    expect(projected?.summary).toBe(`${participant.name}卷中记为「${sharedBiography.kind}」，见于「${sharedEvent.title}」；同卷人物还有${stranger.name}。`);
    expect(projected?.summary.startsWith(stranger.name)).toBe(false);

    const misleadingPrimaryEvent = {
      ...sharedEvent,
      id: 'event_person_attribution_sorted_primary',
      title: `${stranger.name}成为权力中枢`,
      summary: `${stranger.name}凭借官职与家族声望执掌朝局。`,
      actorIds: [participant.id, stranger.id],
    };
    world.history.push(misleadingPrimaryEvent);
    const misleadingPrimaryBiography: BiographyFact = {
      id: `${participant.id}:bio:${misleadingPrimaryEvent.id}:court`,
      turn: misleadingPrimaryEvent.turn,
      kind: '卷入朝局',
      summary: misleadingPrimaryEvent.summary,
      importance: 3,
      eventId: misleadingPrimaryEvent.id,
      factId: null,
    };
    participant.biography.push(misleadingPrimaryBiography);
    const safePrimary = toPersonExperienceRecords(world, participant).find((record) => record.id === misleadingPrimaryBiography.id);
    expect(safePrimary?.summary.startsWith(participant.name)).toBe(true);
    expect(safePrimary?.summary).not.toBe(misleadingPrimaryEvent.summary);

    const eventOnly = {
      ...sharedEvent,
      id: 'event_person_attribution_event_only',
      title: `${stranger.name}重定朝仪`,
    };
    world.history.push(eventOnly);
    const eventOnlyRecord = toPersonExperienceRecords(world, participant).find((record) => record.id === eventOnly.id);
    expect(eventOnlyRecord?.summary).toBe(`${participant.name}直接卷入「${eventOnly.title}」；同卷人物还有${stranger.name}。`);
  });

  it('keeps genuine deputy, appointment and marriage records from a fixed natural world', () => {
    const world = advanceWorldBy(createWorld('春战副将'), 8);

    const deputy = world.characters.find((character) => character.biography.some((entry) => entry.kind === '首次参战' && entry.factId));
    expect(deputy).toBeDefined();
    if (deputy) {
      const firstBattle = deputy.biography.find((entry) => entry.kind === '首次参战' && entry.factId);
      const records = toPersonArchive(world, deputy).records;
      expect(records.some((record) => record.id === firstBattle?.id)).toBe(true);
      const source = world.facts.find((fact) => fact.id === firstBattle?.factId);
      expect(source?.actorIds).toContain(deputy.id);
      if (source?.kind === 'battle') {
        expect([source.payload.attacker, ...source.payload.defenders].some((force) => (
          force.deputyCommanderId === deputy.id || force.commanderId === deputy.id
        ))).toBe(true);
      }
    }

    const appointment = world.facts.find((fact) => fact.kind === 'appointment_started');
    expect(appointment).toBeDefined();
    if (appointment?.kind === 'appointment_started') {
      const holder = world.characters.find((character) => character.id === appointment.payload.holderId) as CharacterState;
      const recordId = `${holder.id}:experience:${appointment.id}`;
      const records = toPersonArchive(world, holder).records;
      expect(records).toContainEqual(expect.objectContaining({
        id: recordId,
        title: `就任${appointment.payload.officeKind}`,
      }));
      expect(records.find((record) => record.id === recordId)?.summary).toContain(holder.name);
    }

    const marriage = world.facts.find((fact) => fact.kind === 'marriage');
    expect(marriage).toBeDefined();
    if (marriage?.kind === 'marriage') {
      const spouse = world.characters.find((character) => character.id === marriage.payload.leftCharacterId) as CharacterState;
      const event = world.history.find((candidate) => candidate.sourceFactIds.includes(marriage.id));
      expect(event?.actorIds).toContain(spouse.id);
      expect(toPersonArchive(world, spouse).records.some((record) => record.eventId === event?.id)).toBe(true);
    }
  });

  it('never projects a record whose linked source does not reference the selected person', () => {
    const world = advanceWorldBy(createWorld('人物经历来源审计'), 20);
    for (const person of world.characters) {
      const biographyById = new Map(person.biography.map((entry) => [entry.id, entry]));
      const eventById = new Map(world.history.map((event) => [event.id, event]));
      const factById = new Map(world.facts.map((fact) => [fact.id, fact]));
      const officeByInitialRecordId = new Map(world.offices
        .filter((office) => office.holderId === person.id)
        .map((office) => [`${person.id}:experience:${office.id}:initial`, office]));

      for (const record of toPersonExperienceRecords(world, person)) {
        const biography = biographyById.get(record.id);
        if (biography) {
          if (biography.eventId) expect(eventById.get(biography.eventId)?.actorIds).toContain(person.id);
          if (biography.factId) expect(factById.get(biography.factId)?.actorIds).toContain(person.id);
          continue;
        }
        const event = eventById.get(record.id);
        if (event) {
          expect(event.actorIds).toContain(person.id);
          continue;
        }
        const appointment = world.facts.find((fact) => (
          (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
          && `${person.id}:experience:${fact.id}` === record.id
        ));
        if (appointment?.kind === 'appointment_started' || appointment?.kind === 'appointment_ended') {
          expect(appointment.actorIds).toContain(person.id);
          expect(appointment.payload.holderId).toBe(person.id);
          continue;
        }
        expect(officeByInitialRecordId.get(record.id)?.holderId).toBe(person.id);
      }
    }
  }, 15_000);
});
