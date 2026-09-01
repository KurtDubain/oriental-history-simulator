import type { SimulationFact, StateDelta, WorldState } from '../sim/types';
import type { SituationState } from '../sim/situations';
import { readWorldFacts, readWorldHistory } from '../sim/archive';
import { historyTurnDate } from './v1-history';

export interface FactNarrative {
  title: string;
  summary: string;
}

export interface HistoricalScene {
  id: string;
  turn: number;
  dateLabel: string;
  title: string;
  summary: string;
  result: string;
  shortText: string;
  sourceFactIds: readonly string[];
  historyEventIds: readonly string[];
  actorIds: readonly string[];
  polityIds: readonly string[];
  regionIds: readonly string[];
  importance: number;
}

export type HistoricalSceneReadScope = 'all' | 'active';

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(stableCompare);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
}

function characterName(world: WorldState, id: string): string {
  return world.characters.find((item) => item.id === id)?.name ?? '未载人物';
}

function polityName(world: WorldState, id: string): string {
  const polity = world.polities.find((item) => item.id === id);
  return polity?.shortName || polity?.name || '未载政权';
}

function regionName(world: WorldState, id: string): string {
  return world.regions.find((item) => item.id === id)?.name ?? '未载州域';
}

function factionName(world: WorldState, id: string): string {
  return world.factions.find((item) => item.id === id)?.name ?? '未载派系';
}

function armyName(world: WorldState, id: string, recordedName?: string): string {
  return world.armies.find((item) => item.id === id)?.name ?? recordedName ?? '旧日所部';
}

function factHistoryIds(
  world: WorldState,
  factIds: ReadonlySet<string>,
  readScope: HistoricalSceneReadScope,
): string[] {
  const history = readScope === 'all' ? readWorldHistory(world) : world.history;
  return history
    .filter((event) => event.sourceFactIds.some((id) => factIds.has(id)))
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id))
    .map((event) => event.id)
    .slice(0, 4);
}

function deltaCopy(world: WorldState, delta: StateDelta): string | null {
  const name = delta.entityType === 'character'
    ? characterName(world, delta.entityId)
    : delta.entityType === 'army'
      ? armyName(world, delta.entityId)
      : delta.entityType === 'polity'
        ? polityName(world, delta.entityId)
        : delta.entityType === 'region'
          ? regionName(world, delta.entityId)
          : delta.entityType === 'faction'
            ? factionName(world, delta.entityId)
            : null;
  if (!name) return null;
  const field = delta.field === 'influence'
    ? '影响'
    : delta.field === 'loyalty'
      ? '忠诚'
      : delta.field === 'insubordination'
        ? '抗命心'
        : delta.field === 'power'
          ? '权势'
          : delta.field === 'memberCount'
            ? '成员数'
            : delta.field === 'coreMemberCount'
              ? '核心成员数'
              : null;
  if (field && typeof delta.before === 'number' && typeof delta.after === 'number') {
    return `${name}${field}${Math.round(delta.before)}→${Math.round(delta.after)}`;
  }
  return null;
}

export function projectFactNarrative(world: WorldState, fact: SimulationFact): FactNarrative {
  if (fact.kind === 'war_started') {
    return {
      title: `${polityName(world, fact.payload.attackerId)}向${polityName(world, fact.payload.defenderId)}开战`,
      summary: `以${fact.payload.goal}为目标。${fact.payload.reason}`,
    };
  }
  if (fact.kind === 'war_ended') {
    const winner = fact.payload.winnerId ? polityName(world, fact.payload.winnerId) : null;
    return {
      title: `${polityName(world, fact.payload.attackerId)}与${polityName(world, fact.payload.defenderId)}停战`,
      summary: `${winner ? `${winner}占得上风` : '双方议和'}；攻方战果${compactNumber(fact.payload.attackerScore)}、守方战果${compactNumber(fact.payload.defenderScore)}。${fact.payload.reason}`,
    };
  }
  if (fact.kind === 'battle') {
    const attacker = characterName(world, fact.payload.attacker.commanderId);
    const defenders = fact.payload.defenders.map((item) => characterName(world, item.commanderId)).join('、') || '守军';
    const losses = fact.payload.attacker.losses + fact.payload.defenders.reduce((sum, item) => sum + item.losses, 0);
    return {
      title: `${regionName(world, fact.payload.targetRegionId)}之战`,
      summary: `${attacker}所部与${defenders}交战，${fact.payload.attackerWon ? '攻方取胜' : '守方守住战线'}；双方共损失${compactNumber(losses)}人。`,
    };
  }
  if (fact.kind === 'territory_control_changed') {
    return {
      title: `${regionName(world, fact.payload.regionId)}易手`,
      summary: `${polityName(world, fact.payload.previousControllerId)}失去控制，${polityName(world, fact.payload.nextControllerId)}接管当地。`,
    };
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    const entering = fact.kind === 'appointment_started';
    const place = fact.payload.regionId ? `于${regionName(world, fact.payload.regionId)}` : '';
    const army = fact.payload.armyId ? armyName(world, fact.payload.armyId) : null;
    return {
      title: `${characterName(world, fact.payload.holderId)}${entering ? '受任' : '去职'}`,
      summary: `${entering ? '出任' : '卸下'}${army ? `${army}` : place}${fact.payload.officeKind}，政令出自${polityName(world, fact.payload.polityId)}。`,
    };
  }
  if (fact.kind === 'character_death') {
    return {
      title: `${characterName(world, fact.payload.characterId)}去世`,
      summary: `终年${fact.payload.age}岁，身后身份记为${fact.payload.role}。`,
    };
  }
  if (fact.kind === 'marriage') {
    return {
      title: `${characterName(world, fact.payload.leftCharacterId)}与${characterName(world, fact.payload.rightCharacterId)}成婚`,
      summary: fact.payload.diplomatic ? '双方家族以婚姻联结政权往来。' : '这桩婚姻进入双方家族谱牒。',
    };
  }
  if (fact.kind === 'agency_support_resolved') {
    const target = fact.payload.targetKind === 'army_officers'
      ? `${armyName(world, fact.payload.targetArmyId, fact.payload.targetArmyName)}将校`
      : characterName(world, fact.payload.targetId);
    const result = fact.payload.outcome === 'secured'
      ? '明确答应相助'
      : fact.payload.outcome === 'deferred'
        ? '仍在观望'
        : '没有应允';
    return {
      title: `${characterName(world, fact.payload.actorId)}争取${target}支持`,
      summary: `${target}${result}；这项回应会进入此后的军令审查。`,
    };
  }
  if (fact.kind === 'agency_intent_submitted') {
    return {
      title: `${characterName(world, fact.payload.actorId)}向${polityName(world, fact.payload.polityId)}请领军令`,
      summary: `这是第${fact.payload.attemptOrdinal}次正式请掌${armyName(world, fact.payload.targetArmyId, fact.payload.targetArmyName)}，现任主帅为${characterName(world, fact.payload.currentCommanderId)}。`,
    };
  }
  if (fact.kind === 'agency_intent_resolved') {
    const actor = characterName(world, fact.payload.actorId);
    const army = armyName(world, fact.payload.targetArmyId, fact.payload.targetArmyName);
    if (fact.payload.institutionResponse === 'command_granted') {
      return { title: `${actor}获授${army}军令`, summary: `${polityName(world, fact.payload.polityId)}朝廷准其接掌${army}，${characterName(world, fact.payload.previousCommanderId)}退居副将。` };
    }
    if (fact.payload.institutionResponse === 'appeased') {
      return { title: `${actor}请令未准，朝廷另作安抚`, summary: `朝廷认为其资望尚不足以换帅，没有交出${army}军令，改以名位与礼遇相安。` };
    }
    if (fact.payload.institutionResponse === 'curbed') {
      return { title: `${actor}请令未准并遭削权`, summary: `朝廷把这次请令视作军权风险，撤去其${army}副将之职。` };
    }
    if (fact.payload.outcome === 'deferred') {
      const reason = fact.payload.reasonCode === 'insufficient_record'
        ? '军旅履历不足'
        : fact.payload.reasonCode === 'insufficient_support'
          ? '明确支持不足'
          : '本季另有军令先获处理';
      return { title: `${actor}所请${army}军令暂缓`, summary: `朝廷以${reason}为由留待再议，军令暂未改变。` };
    }
    return { title: `${actor}所请${army}军令未准`, summary: '朝廷没有改变现任主帅与副将的军令次序。' };
  }
  if (fact.kind === 'local_governance_resolved') {
    const actor = characterName(world, fact.payload.actorId);
    const region = regionName(world, fact.payload.regionId);
    if (fact.payload.outcome === 'enacted' && fact.payload.action === 'open_granary') {
      return {
        title: `${actor}在${region}开仓赈济`,
        summary: `实际发出${compactNumber(fact.payload.foodSpent)}石州粮，当地动荡由${Math.round(fact.payload.unrestBefore)}降至${Math.round(fact.payload.unrestAfter)}。`,
      };
    }
    if (fact.payload.outcome === 'enacted') {
      return {
        title: `${actor}为${region}减免本季赋`,
        summary: `国库退回${compactNumber(fact.payload.treasurySpent)}财力，当地动荡由${Math.round(fact.payload.unrestBefore)}降至${Math.round(fact.payload.unrestAfter)}。`,
      };
    }
    const result = fact.payload.outcome === 'deferred'
      ? '朝廷留待再议，本季没有动用粮财'
      : fact.payload.outcome === 'refused'
        ? '朝廷没有准行，本季没有动用粮财'
        : '任所或职权发生变化，原定措施未能进行';
    return {
      title: `${actor}所请${region}${fact.payload.action === 'open_granary' ? '赈济' : '减赋'}未行`,
      summary: `${result}；提出时当地动荡为${Math.round(fact.payload.unrestBefore)}。`,
    };
  }
  if (fact.kind === 'embodied_action_submitted') {
    return {
      title: `${characterName(world, fact.payload.actorId)}定下一件事`,
      summary: '此事已经进入本季人物行动结算，结果由人物当时的身份、资源与关系决定。',
    };
  }
  if (fact.kind === 'embodied_action_resolved') {
    return {
      title: `${characterName(world, fact.payload.actorId)}${fact.payload.outcome === 'succeeded' ? '办成此事' : '尝试此事'}`,
      summary: fact.payload.resultSummary,
    };
  }
  if (fact.kind === 'faction_lifecycle') {
    const created = fact.payload.createdFactionIds.map((id) => factionName(world, id));
    const ended = fact.payload.endedFactionIds.map((id) => factionName(world, id));
    if (fact.payload.transition === 'formed') {
      return { title: `${created.join('、') || '新派'}结成`, summary: `围绕共同议程形成了明确成员与领袖；此后权势得失按这一派系身份记载。` };
    }
    if (fact.payload.transition === 'leader_changed') {
      return {
        title: `${factionName(world, fact.payload.affectedFactionIds[0] ?? '')}更换领袖`,
        summary: `${characterName(world, fact.payload.previousLeaderId ?? '')}离开领袖位置，${characterName(world, fact.payload.nextLeaderId ?? '')}由存续核心成员推为继任者。`,
      };
    }
    if (fact.payload.transition === 'split') {
      return { title: `${factionName(world, fact.payload.affectedFactionIds[0] ?? '')}发生分裂`, summary: `${created.join('、') || '新派'}由原成员另立议席，旧派身份继续由留守核心承继。` };
    }
    if (fact.payload.transition === 'merged') {
      return { title: `${ended.join('与') || '旧派'}合议重组`, summary: `旧派结束原有身份，共同组成${created.join('、') || '新派'}。` };
    }
    return { title: `${ended.join('、') || '派系'}退出朝局`, summary: '其成员或政权载体已不足以继续维持这一政治身份。' };
  }
  if (fact.kind === 'faction_relation_changed') {
    const left = factionName(world, fact.payload.leftFactionId);
    const right = factionName(world, fact.payload.rightFactionId);
    const relation = fact.payload.relation === 'alliance' ? '盟约' : '相争';
    return {
      title: `${left}与${right}${fact.payload.action === 'formed'
        ? (fact.payload.relation === 'alliance' ? '结成盟约' : '公开相争')
        : (fact.payload.relation === 'alliance' ? '解除盟约' : '停止相争')}`,
      summary: fact.payload.action === 'formed'
        ? `双方领袖把${relation === '盟约' ? '互相支持' : '彼此牵制'}登记为明确朝局关系。`
        : `双方不再维持此前的${relation}关系。`,
    };
  }
  if (fact.kind === 'court_action_resolved') {
    const actor = characterName(world, fact.payload.initiatorId);
    const target = characterName(world, fact.payload.targetId);
    const actorFaction = fact.payload.actorFactionId ? factionName(world, fact.payload.actorFactionId) : '其所属集团';
    const targetFaction = fact.payload.targetFactionId ? factionName(world, fact.payload.targetFactionId) : '相关集团';
    if (fact.payload.action === 'power_broker_formed') {
      const frozenPowerRoots = fact.causes.find((cause) => cause.label === '派系资源')?.evidence
        ?? `${actorFaction}的已登记政治资源`;
      return {
        title: `${actor}成为${polityName(world, fact.payload.polityId)}权力中枢`,
        summary: `${actor}凭${frozenPowerRoots}进入朝议中枢，${target}此后需要与其合作。`,
      };
    }
    if (fact.payload.action === 'power_broker_fell') {
      const frozenChange = fact.causes.find((cause) => cause.label === '根基变化')?.evidence
        ?? `${targetFaction}已无法继续承载${target}的权臣地位`;
      return {
        title: `${target}退出${polityName(world, fact.payload.polityId)}权力中枢`,
        summary: `${target}退出权力中枢；${frozenChange}。`,
      };
    }
    if (fact.payload.action === 'purge') {
      const removedNames = fact.payload.removedMemberIds.slice(0, 3).map((id) => characterName(world, id));
      const governedRemoved = fact.stateDeltas.some((delta) => (
        delta.entityType === 'character'
        && delta.entityId === fact.payload.targetId
        && delta.field === 'governedRegionId'
        && delta.before !== null
        && delta.after === null
      ));
      const influenceReduced = fact.stateDeltas.some((delta) => (
        delta.entityType === 'character'
        && delta.entityId === fact.payload.targetId
        && delta.field === 'influence'
        && typeof delta.before === 'number'
        && typeof delta.after === 'number'
        && delta.after < delta.before
      ));
      const powerReduced = Boolean(fact.payload.targetFactionId) && fact.stateDeltas.some((delta) => (
        delta.entityType === 'faction'
        && delta.entityId === fact.payload.targetFactionId
        && delta.field === 'power'
        && typeof delta.before === 'number'
        && typeof delta.after === 'number'
        && delta.after < delta.before
      ));
      const changes = [
        ...(governedRemoved ? [`撤去${target}的地方职权`] : []),
        ...(influenceReduced ? [`压低${target}在朝中的影响`] : []),
        ...(removedNames.length === 0
          ? []
          : fact.payload.removedMemberIds.length > removedNames.length
            ? [`将${removedNames.join('、')}等${fact.payload.removedMemberIds.length}人逐出派系`]
            : [`将${removedNames.join('、')}逐出派系`]),
        ...(powerReduced ? [`削弱${targetFaction}的已登记权势`] : []),
      ];
      return {
        title: `${actor}清洗${targetFaction}`,
        summary: `${actor}对${targetFaction}动手；${changes.join('，') || '事实仅记录了行动身份，未冻结可读的削权差量'}。`,
      };
    }
    return {
      title: fact.payload.action === 'coup' ? `${actor}发动宫变` : `${actor}篡立新朝`,
      summary: `${actor}依靠${actorFaction}控制中枢，${target}失去君位；君位由${characterName(world, fact.payload.rulerBeforeId)}转给${characterName(world, fact.payload.rulerAfterId)}。`,
    };
  }
  const transition = fact.payload.transition === 'formed'
    ? '形成'
    : fact.payload.transition === 'resolved'
      ? '结案'
      : '转入新阶段';
  return { title: `局势${transition}`, summary: fact.payload.outcomeKey ? '结案结果已经由同季事实确认。' : '这是局势索引，不是独立发生的一件事。' };
}

function sceneFromFacts(
  world: WorldState,
  id: string,
  facts: readonly SimulationFact[],
  narrative: FactNarrative,
  result = '',
  readScope: HistoricalSceneReadScope = 'all',
): HistoricalScene {
  const ordered = [...facts].sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  const latest = ordered.at(-1) as SimulationFact;
  const factIds = new Set(ordered.map((fact) => fact.id));
  const summary = narrative.summary.trim();
  const cleanResult = result.trim();
  return {
    id,
    turn: latest.turn,
    dateLabel: historyTurnDate(latest.turn).label,
    title: narrative.title,
    summary,
    result: cleanResult,
    shortText: `${narrative.title}：${summary}${cleanResult ? ` ${cleanResult}` : ''}`,
    sourceFactIds: [...factIds].sort(stableCompare),
    historyEventIds: factHistoryIds(world, factIds, readScope),
    actorIds: unique(ordered.flatMap((fact) => fact.actorIds)),
    polityIds: unique(ordered.flatMap((fact) => fact.polityIds)),
    regionIds: unique(ordered.flatMap((fact) => fact.regionIds)),
    importance: Math.max(...ordered.map((fact) => fact.importance)),
  };
}

function agencyScene(
  world: WorldState,
  facts: readonly SimulationFact[],
  readScope: HistoricalSceneReadScope,
): HistoricalScene {
  const support = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'agency_support_resolved' }> => fact.kind === 'agency_support_resolved');
  const submitted = facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_submitted' }> => fact.kind === 'agency_intent_submitted');
  const resolution = facts.find((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => fact.kind === 'agency_intent_resolved');
  const anchor = resolution ?? submitted ?? support.at(-1) as SimulationFact;
  const actorId = resolution?.payload.actorId ?? submitted?.payload.actorId ?? support.at(-1)?.payload.actorId ?? anchor.actorIds[0];
  const actor = characterName(world, actorId);
  const targetArmyId = resolution?.payload.targetArmyId ?? submitted?.payload.targetArmyId ?? support.at(-1)?.payload.targetArmyId ?? '';
  const recordedArmyName = resolution?.payload.targetArmyName
    ?? submitted?.payload.targetArmyName
    ?? support.at(-1)?.payload.targetArmyName;
  const army = armyName(world, targetArmyId, recordedArmyName);
  const supportClause = support.length
    ? support.slice(-2).map((fact) => {
        const target = fact.payload.targetKind === 'army_officers'
          ? `${army}将校`
          : characterName(world, fact.payload.targetId);
        const response = fact.payload.outcome === 'secured' ? '答应相助' : fact.payload.outcome === 'deferred' ? '仍在观望' : '没有应允';
        return `${target}${response}`;
      }).join('，')
    : '';
  if (!submitted && !resolution) {
    const narrative = projectFactNarrative(world, support.at(-1) as SimulationFact);
    return sceneFromFacts(world, `scene:agency:${actorId}:${anchor.turn}:${anchor.id}`, facts, {
      title: narrative.title,
      summary: `${supportClause}；${actor}眼下仍未正式递交军令请求。`,
    }, '', readScope);
  }
  const resolutionCopy = resolution ? projectFactNarrative(world, resolution) : null;
  const requestClause = `${actor}随后向${polityName(world, submitted?.payload.polityId ?? resolution?.payload.polityId ?? anchor.polityIds[0] ?? '')}朝廷请领${army}军令`;
  const summary = [supportClause, requestClause, resolutionCopy?.summary].filter(Boolean).join('；');
  const changed = resolution?.stateDeltas.map((delta) => deltaCopy(world, delta)).filter((item): item is string => Boolean(item)) ?? [];
  const result = changed.length ? `直接变化：${changed.join('，')}。` : resolution ? '军令名册已经按裁决更新。' : '请求已经入册，尚待朝廷裁定。';
  return sceneFromFacts(world, `scene:agency:${actorId}:${submitted?.payload.goalId ?? resolution?.payload.goalId ?? anchor.id}`, facts, {
    title: resolutionCopy?.title ?? `${actor}正式请掌${army}`,
    summary,
  }, result, readScope);
}

function warScene(
  world: WorldState,
  facts: readonly SimulationFact[],
  key: string,
  readScope: HistoricalSceneReadScope,
): HistoricalScene {
  const start = facts.find((fact): fact is Extract<SimulationFact, { kind: 'war_started' }> => fact.kind === 'war_started');
  const end = facts.find((fact): fact is Extract<SimulationFact, { kind: 'war_ended' }> => fact.kind === 'war_ended');
  const battle = facts.find((fact): fact is Extract<SimulationFact, { kind: 'battle' }> => fact.kind === 'battle');
  const transfers = facts.filter((fact): fact is Extract<SimulationFact, { kind: 'territory_control_changed' }> => fact.kind === 'territory_control_changed');
  const anchor = end ?? battle ?? start ?? transfers[0];
  const base = projectFactNarrative(world, anchor as SimulationFact);
  if (battle) {
    const battleCopy = projectFactNarrative(world, battle);
    const result = transfers.length
      ? transfers.map((fact) => `${regionName(world, fact.payload.regionId)}随即由${polityName(world, fact.payload.previousControllerId)}转入${polityName(world, fact.payload.nextControllerId)}`).join('；') + '。'
      : '战线控制本季没有随会战立即改变。';
    return sceneFromFacts(world, `scene:war:${key}`, facts, battleCopy, result, readScope);
  }
  return sceneFromFacts(world, `scene:war:${key}`, facts, base, '', readScope);
}

function warKey(fact: SimulationFact): string | null {
  if (fact.kind === 'war_started' || fact.kind === 'war_ended' || fact.kind === 'battle') return fact.payload.warId;
  if (fact.kind === 'territory_control_changed') return fact.payload.warId;
  return null;
}

function collectAgencyChain(
  availableFacts: readonly SimulationFact[],
  resolution: Extract<SimulationFact, { kind: 'agency_intent_resolved' }>,
): SimulationFact[] {
  const byId = new Map(availableFacts.map((fact) => [fact.id, fact]));
  const submission = byId.get(resolution.payload.submissionFactId);
  const sourceFacts = submission?.sourceFactIds.map((id) => byId.get(id)).filter((fact): fact is SimulationFact => Boolean(fact)) ?? [];
  const appointmentFacts = availableFacts.filter((fact) => (
    (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended')
    && fact.sourceFactIds.includes(resolution.id)
  ));
  return [
    ...sourceFacts.filter((fact) => fact.kind === 'agency_support_resolved'),
    ...(submission ? [submission] : []),
    resolution,
    ...appointmentFacts,
  ];
}

export function projectHistoricalScenes(
  world: WorldState,
  inputFacts: readonly SimulationFact[],
  maximum = 3,
  readScope: HistoricalSceneReadScope = 'all',
): HistoricalScene[] {
  const inputIds = new Set(inputFacts.map((fact) => fact.id));
  const consumed = new Set<string>();
  const scenes: HistoricalScene[] = [];
  const facts = [...new Map(inputFacts.map((fact) => [fact.id, fact])).values()]
    .sort((left, right) => left.turn - right.turn || stableCompare(left.id, right.id));
  const availableFacts = readScope === 'all' ? readWorldFacts(world) : world.facts;

  // Identity actions are observer envelopes around an Agency domain Fact.
  // Let the concrete support/request scene own the story instead of showing a
  // second generic “人物尝试此事” scene beside it.
  for (const resolution of facts.filter((fact): fact is Extract<SimulationFact, { kind: 'embodied_action_resolved' }> => (
    fact.kind === 'embodied_action_resolved' && Boolean(fact.payload.domainFactId)
  ))) {
    consumed.add(resolution.id);
    consumed.add(resolution.payload.submissionFactId);
  }

  for (const resolution of facts.filter((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_resolved' }> => fact.kind === 'agency_intent_resolved')) {
    const chain = collectAgencyChain(availableFacts, resolution);
    chain.forEach((fact) => consumed.add(fact.id));
    scenes.push(agencyScene(world, chain, readScope));
  }
  for (const submission of facts.filter((fact): fact is Extract<SimulationFact, { kind: 'agency_intent_submitted' }> => fact.kind === 'agency_intent_submitted' && !consumed.has(fact.id))) {
    const byId = new Map(availableFacts.map((fact) => [fact.id, fact]));
    const chain = [
      ...submission.sourceFactIds.map((id) => byId.get(id)).filter((fact): fact is SimulationFact => fact?.kind === 'agency_support_resolved'),
      submission,
    ];
    chain.forEach((fact) => consumed.add(fact.id));
    scenes.push(agencyScene(world, chain, readScope));
  }
  for (const support of facts.filter((fact) => fact.kind === 'agency_support_resolved' && !consumed.has(fact.id))) {
    consumed.add(support.id);
    scenes.push(agencyScene(world, [support], readScope));
  }

  const warGroups = new Map<string, SimulationFact[]>();
  for (const fact of facts) {
    if (consumed.has(fact.id)) continue;
    const warId = warKey(fact);
    if (!warId) continue;
    const key = `${warId}:${fact.turn}`;
    const group = warGroups.get(key) ?? [];
    group.push(fact);
    warGroups.set(key, group);
    consumed.add(fact.id);
  }
  for (const [key, group] of [...warGroups.entries()].sort(([left], [right]) => stableCompare(left, right))) {
    scenes.push(warScene(world, group, key, readScope));
  }

  for (const fact of facts) {
    if (consumed.has(fact.id) || fact.kind === 'situation_milestone') continue;
    scenes.push(sceneFromFacts(world, `scene:fact:${fact.id}`, [fact], projectFactNarrative(world, fact), '', readScope));
  }

  return scenes
    .filter((scene) => scene.sourceFactIds.some((id) => inputIds.has(id)))
    .sort((left, right) => right.turn - left.turn || right.importance - left.importance || stableCompare(right.id, left.id))
    .slice(0, Math.max(0, maximum));
}

function factTouchesSituation(fact: SimulationFact, situation: SituationState): boolean {
  const participantCharacters = new Set([
    ...situation.participants.coreCharacterIds,
    ...situation.participants.supportingCharacterIds,
    ...situation.participants.opposingCharacterIds,
  ]);
  const participantPolities = new Set(situation.participants.polityIds);
  return fact.actorIds.some((id) => participantCharacters.has(id))
    && fact.polityIds.some((id) => participantPolities.has(id));
}

function courtFactTouchesSituation(fact: SimulationFact, situation: SituationState): boolean {
  const participantCharacters = new Set([
    ...situation.participants.coreCharacterIds,
    ...situation.participants.supportingCharacterIds,
    ...situation.participants.opposingCharacterIds,
  ]);
  const participantFactions = new Set(situation.participants.factionIds);
  if (fact.kind === 'court_action_resolved') {
    return fact.payload.affectedFactionIds.some((id) => participantFactions.has(id));
  }
  if (fact.kind === 'faction_relation_changed') {
    return participantFactions.has(fact.payload.leftFactionId)
      || participantFactions.has(fact.payload.rightFactionId);
  }
  if (fact.kind === 'faction_lifecycle') {
    return [
      ...fact.payload.affectedFactionIds,
      ...fact.payload.createdFactionIds,
      ...fact.payload.endedFactionIds,
    ].some((id) => participantFactions.has(id));
  }
  if (fact.kind === 'agency_support_resolved') {
    return participantCharacters.has(fact.payload.actorId)
      || (fact.payload.targetKind !== 'army_officers' && participantCharacters.has(fact.payload.targetId));
  }
  if (fact.kind === 'agency_intent_resolved') {
    return participantCharacters.has(fact.payload.actorId);
  }
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    return participantCharacters.has(fact.payload.holderId);
  }
  return false;
}

export function projectSituationHistoricalScenes(
  world: WorldState,
  situation: SituationState,
  maximum = 3,
  throughTurn: number | null = null,
  readScope: HistoricalSceneReadScope = 'all',
): HistoricalScene[] {
  const lastTurn = throughTurn ?? situation.resolvedTurn ?? situation.lastUpdatedTurn;
  const directIds = new Set([
    ...situation.causalFactIds,
    ...situation.milestoneFactIds,
    ...(situation.resolution?.resultFactIds ?? []),
  ]);
  const availableFacts = readScope === 'all' ? readWorldFacts(world) : world.facts;
  const selected = availableFacts.filter((fact) => {
    if (fact.turn < situation.startedTurn || fact.turn > lastTurn) return false;
    if (directIds.has(fact.id) || fact.sourceFactIds.some((id) => directIds.has(id))) return true;
    if (situation.type === 'war_progress') return warKey(fact) === situation.scopeKey;
    if (situation.type === 'military_power_crisis') {
      return ['agency_support_resolved', 'agency_intent_submitted', 'agency_intent_resolved', 'appointment_started', 'appointment_ended']
        .includes(fact.kind) && factTouchesSituation(fact, situation);
    }
    if (situation.type === 'court_power_struggle') {
      const polityMatch = fact.polityIds.some((id) => situation.participants.polityIds.includes(id));
      if (!polityMatch) return false;
      const isCourtSceneFact = [
        'faction_relation_changed',
        'faction_lifecycle',
        'agency_support_resolved',
        'agency_intent_resolved',
        'appointment_started',
        'appointment_ended',
        'court_action_resolved',
      ].includes(fact.kind);
      return isCourtSceneFact && courtFactTouchesSituation(fact, situation);
    }
    return ['character_death', 'appointment_started', 'appointment_ended']
      .includes(fact.kind) && factTouchesSituation(fact, situation);
  });
  return projectHistoricalScenes(world, selected, maximum, readScope);
}
