import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import { stableCompare, stableHash } from '../random';
import type {
  CharacterState,
  EventCause,
  HistoryEvent,
  RelationshipState,
  StateDelta,
  WorldState,
} from '../types';

export const EMBODIED_ACTION_KINDS = [
  'strengthen_relationship',
  'seek_opportunity',
  'declare_stance',
  'cultivate_military_support',
  'request_backing',
  'request_independent_command',
] as const;

export const EMBODIED_IDENTITY_ACTION_KINDS = [
  'cultivate_military_support',
  'request_backing',
  'request_independent_command',
] as const;

export type EmbodiedActionKind = (typeof EMBODIED_ACTION_KINDS)[number];
export type EmbodiedActionStance = 'support' | 'oppose' | null;

export interface EmbodiedActionCommand {
  actionId: string;
  issuedTurn: number;
  actorId: string;
  kind: EmbodiedActionKind;
  targetKind: 'character' | 'faction' | 'army';
  targetId: string;
  stance: EmbodiedActionStance;
}

export interface EmbodiedActionProjection {
  command: EmbodiedActionCommand;
  label: string;
  targetLabel: string;
  intent: string;
  cost: string;
  obstacle: string;
  nextSignal: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface EmbodiedActionTurnContext extends FactTurnBuffer {
  embodiedActionCommand?: EmbodiedActionCommand | null;
}

export interface EmbodiedActionEventInput {
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
  sourceFactIds?: string[];
  situationIds?: string[];
}

export type EmitEmbodiedActionEvent = (input: EmbodiedActionEventInput) => HistoryEvent;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function directedRelationship(world: WorldState, sourceId: string, targetId: string): RelationshipState | undefined {
  return world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
}

function actionId(
  world: WorldState,
  actorId: string,
  kind: EmbodiedActionKind,
  targetId: string,
  stance: EmbodiedActionStance,
): string {
  return `emb_${stableHash([world.seed, world.turn, actorId, kind, targetId, stance, 'embodied-action-v1']).slice(0, 14)}`;
}

export function createEmbodiedActionCommand(
  world: WorldState,
  actorId: string,
  kind: EmbodiedActionKind,
  targetKind: EmbodiedActionCommand['targetKind'],
  targetId: string,
  stance: EmbodiedActionStance = null,
): EmbodiedActionCommand {
  return {
    actionId: actionId(world, actorId, kind, targetId, stance),
    issuedTurn: world.turn,
    actorId,
    kind,
    targetKind,
    targetId,
    stance,
  };
}

function characterTargetCandidates(world: WorldState, actor: CharacterState): CharacterState[] {
  const polity = world.polities.find((item) => item.id === actor.polityId && item.alive);
  const family = world.families.find((item) => item.id === actor.familyId && item.active);
  const faction = world.factions.find((item) => item.active && item.memberIds.includes(actor.id));
  const army = actor.commandingArmyId
    ? world.armies.find((item) => item.id === actor.commandingArmyId)
    : world.armies.find((item) => item.deputyCommanderId === actor.id);
  const fleet = actor.commandingFleetId
    ? world.fleets.find((item) => item.id === actor.commandingFleetId)
    : world.fleets.find((item) => item.deputyCommanderId === actor.id);
  const ids = [
    polity?.rulerId,
    family?.headId,
    faction?.leaderId,
    army?.commanderId,
    army?.deputyCommanderId,
    fleet?.commanderId,
    fleet?.deputyCommanderId,
    ...world.relationships
      .filter((item) => item.sourceId === actor.id || item.targetId === actor.id)
      .sort((left, right) => (
        right.trust + right.affinity + right.gratitude - right.grievance
        - (left.trust + left.affinity + left.gratitude - left.grievance)
        || stableCompare(left.id, right.id)
      ))
      .map((item) => item.sourceId === actor.id ? item.targetId : item.sourceId),
  ].filter((id): id is string => Boolean(id && id !== actor.id));
  return [...new Set(ids)]
    .map((id) => world.characters.find((item) => item.id === id && item.alive))
    .filter((item): item is CharacterState => Boolean(item));
}

function relationshipTarget(world: WorldState, actor: CharacterState): CharacterState | null {
  return characterTargetCandidates(world, actor)
    .sort((left, right) => {
      const leftView = directedRelationship(world, left.id, actor.id);
      const rightView = directedRelationship(world, right.id, actor.id);
      const leftNeed = 100 - (leftView?.trust ?? 28) + left.influence * 0.35;
      const rightNeed = 100 - (rightView?.trust ?? 28) + right.influence * 0.35;
      return rightNeed - leftNeed || stableCompare(left.id, right.id);
    })[0] ?? null;
}

function opportunityTarget(world: WorldState, actor: CharacterState): CharacterState | null {
  const polity = world.polities.find((item) => item.id === actor.polityId && item.alive);
  const army = world.armies.find((item) => item.deputyCommanderId === actor.id);
  const fleet = world.fleets.find((item) => item.deputyCommanderId === actor.id);
  const preferredIds = [
    army?.commanderId,
    fleet?.commanderId,
    polity?.rulerId,
    world.families.find((item) => item.id === actor.familyId && item.active)?.headId,
  ].filter((id): id is string => Boolean(id && id !== actor.id));
  const preferred = preferredIds
    .map((id) => world.characters.find((item) => item.id === id && item.alive))
    .find((item): item is CharacterState => Boolean(item));
  if (preferred) return preferred;
  return world.factions
    .filter((item) => item.active && item.polityId === actor.polityId && item.leaderId !== actor.id)
    .sort((left, right) => right.power - left.power || stableCompare(left.id, right.id))
    .map((item) => world.characters.find((character) => character.id === item.leaderId && character.alive))
    .find((item): item is CharacterState => Boolean(item)) ?? null;
}

function opportunityLabel(world: WorldState, actor: CharacterState): string {
  if (world.armies.some((item) => item.deputyCommanderId === actor.id)
    || world.fleets.some((item) => item.deputyCommanderId === actor.id)) return '一项随军重任';
  if (actor.role === '廷臣') return '一项朝廷差遣';
  if (actor.role === '地方长官') return '更多施政支持';
  if (actor.role === '将领') return '更多军政资源';
  return '臣僚公开支持';
}

function stanceTarget(world: WorldState, actor: CharacterState) {
  const own = world.factions.find((item) => item.active && item.memberIds.includes(actor.id));
  return own ?? world.factions
    .filter((item) => item.active && item.polityId === actor.polityId)
    .sort((left, right) => right.power - left.power || stableCompare(left.id, right.id))[0] ?? null;
}

/** Pure projection: opening, entering or switching views cannot mutate the world. */
export function projectEmbodiedActions(world: WorldState, actorId: string): readonly EmbodiedActionProjection[] {
  const actor = world.characters.find((item) => item.id === actorId);
  if (!actor) return [];
  const adultReason = !actor.alive
    ? '此人已经不在人世'
    : actor.age < 16
      ? '尚未成年，不能独自经营此事'
      : null;
  const relationTarget = relationshipTarget(world, actor);
  const chanceTarget = opportunityTarget(world, actor);
  const faction = stanceTarget(world, actor);
  const stance: Exclude<EmbodiedActionStance, null> = actor.loyalty + actor.caution >= actor.ambition + 30
    ? 'support'
    : 'oppose';
  const opportunity = opportunityLabel(world, actor);
  const relationUnavailable = adultReason ?? (!relationTarget ? '身边没有可明确往来的人物' : actor.personalWealth < 1 ? '至少需要 1 点私产用于往来' : null);
  const chanceUnavailable = adultReason ?? (!chanceTarget ? '眼下没有能够回应请求的上位者' : null);
  const stanceUnavailable = adultReason ?? (!faction ? '所属政权尚无可公开表态的政治集团' : null);
  return [
    {
      command: createEmbodiedActionCommand(world, actor.id, 'strengthen_relationship', 'character', relationTarget?.id ?? 'missing'),
      label: '经营关系',
      targetLabel: relationTarget?.name ?? '暂无对象',
      intent: relationTarget ? `亲自与${relationTarget.name}往来，争取更多信任。` : '寻找一位能够长期往来的人。',
      cost: '1 点私产与本季精力',
      obstacle: relationTarget
        ? `${relationTarget.name}目前对其信任为${directedRelationship(world, relationTarget.id, actor.id)?.trust ?? 28}`
        : '缺少明确对象',
      nextSignal: relationTarget ? `观察${relationTarget.name}是否回应，以及双方信任如何变化` : '观察是否出现新的同僚、亲族或上位者',
      available: relationUnavailable === null,
      unavailableReason: relationUnavailable,
    },
    {
      command: createEmbodiedActionCommand(world, actor.id, 'seek_opportunity', 'character', chanceTarget?.id ?? 'missing'),
      label: '争取机会',
      targetLabel: chanceTarget ? `${chanceTarget.name} · ${opportunity}` : opportunity,
      intent: chanceTarget ? `向${chanceTarget.name}争取${opportunity}。` : `寻找能够给予${opportunity}的人。`,
      cost: '本季人情与声望',
      obstacle: chanceTarget
        ? `能否成事取决于履历、影响与${chanceTarget.name}的态度`
        : '缺少有权回应的人',
      nextSignal: chanceTarget ? `观察${chanceTarget.name}是应允、留待后议还是拒绝` : '观察官位、军令或朝局是否出现缺口',
      available: chanceUnavailable === null,
      unavailableReason: chanceUnavailable,
    },
    {
      command: createEmbodiedActionCommand(world, actor.id, 'declare_stance', 'faction', faction?.id ?? 'missing', stance),
      label: stance === 'support' ? '表明支持' : '公开反对',
      targetLabel: faction ? `${faction.name} · ${faction.agenda}` : '暂无议程',
      intent: faction
        ? `${stance === 'support' ? '支持' : '反对'}${faction.name}主张的“${faction.agenda}”。`
        : '在朝局中表明自己的立场。',
      cost: '公开承担政治立场',
      obstacle: faction ? `集团凝聚为${Math.round(faction.cohesion)}，领袖为${world.characters.find((item) => item.id === faction.leaderId)?.name ?? '未详'}` : '缺少明确集团',
      nextSignal: faction ? `观察${faction.name}的凝聚、权势与领袖态度` : '观察政权内是否形成政治集团',
      available: stanceUnavailable === null,
      unavailableReason: stanceUnavailable,
    },
  ];
}

function ensureRelationship(world: WorldState, sourceId: string, targetId: string): RelationshipState {
  const existing = directedRelationship(world, sourceId, targetId);
  if (existing) return existing;
  world.counters.relationship += 1;
  const relationship: RelationshipState = {
    id: `rel_${String(world.counters.relationship).padStart(5, '0')}`,
    sourceId,
    targetId,
    kinship: '无',
    affinity: 34,
    trust: 28,
    fear: 0,
    grievance: 0,
    gratitude: 0,
    lastInteractionTurn: world.turn,
    memories: [],
  };
  world.relationships.push(relationship);
  return relationship;
}

function addDelta(
  deltas: StateDelta[],
  entityType: StateDelta['entityType'],
  entityId: string,
  field: string,
  before: number,
  after: number,
): void {
  if (before === after) return;
  deltas.push({ entityType, entityId, field, before, after, delta: after - before });
}

function appendBiography(character: CharacterState, event: HistoryEvent, factId: string, kind: string): void {
  character.biography.push({
    id: `${character.id}:bio:${event.id}:${kind}`,
    turn: event.turn,
    kind,
    summary: event.summary,
    importance: event.importance,
    eventId: event.id,
    factId,
  });
  if (character.biography.length > 80) character.biography.splice(0, character.biography.length - 80);
  character.biographyDigest = stableHash(character.biography);
}

function outcomeCopy(outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated'): string {
  if (outcome === 'succeeded') return '得到了回应';
  if (outcome === 'deferred') return '被留待后议';
  if (outcome === 'refused') return '没有得到应允';
  return '因处境变化未能成行';
}

function commandMatches(left: EmbodiedActionCommand, right: EmbodiedActionCommand): boolean {
  return left.actionId === right.actionId
    && left.issuedTurn === right.issuedTurn
    && left.actorId === right.actorId
    && left.kind === right.kind
    && left.targetKind === right.targetKind
    && left.targetId === right.targetId
    && left.stance === right.stance;
}

/**
 * Resolves one observer-issued character action inside the authoritative Agency
 * phase. The command receives no player modifier and is revalidated against the
 * live world before any state changes are applied.
 */
export function resolveEmbodiedAction(
  world: WorldState,
  context: EmbodiedActionTurnContext,
  emit: EmitEmbodiedActionEvent,
): string | null {
  const requested = context.embodiedActionCommand;
  if (!requested) return null;
  if (world.facts.some((fact) => fact.turn === context.turn && fact.kind === 'embodied_action_submitted')) return null;
  const actor = world.characters.find((item) => item.id === requested.actorId);
  const projected = projectEmbodiedActions(world, requested.actorId);
  let option = projected.find((item) => commandMatches(item.command, requested));
  if (!option && actor && requested.issuedTurn === context.turn && requested.actionId === actionId(
    world,
    requested.actorId,
    requested.kind,
    requested.targetId,
    requested.stance,
  )) {
    const template = projected.find((item) => item.command.kind === requested.kind);
    const targetCharacter = requested.targetKind === 'character'
      ? world.characters.find((item) => item.id === requested.targetId && item.alive)
      : null;
    const targetFaction = requested.targetKind === 'faction'
      ? world.factions.find((item) => item.id === requested.targetId && item.active && item.polityId === actor.polityId)
      : null;
    const knownCharacterTarget = Boolean(targetCharacter && (
      targetCharacter.polityId === actor.polityId
      || world.relationships.some((item) => (
        item.sourceId === actor.id && item.targetId === targetCharacter.id
      ) || (
        item.targetId === actor.id && item.sourceId === targetCharacter.id
      ))
    ));
    if (template && (knownCharacterTarget || targetFaction)) {
      const targetLabel = targetCharacter?.name
        ?? (targetFaction ? `${targetFaction.name} · ${targetFaction.agenda}` : template.targetLabel);
      const unavailableReason = !actor.alive
        ? '此人已经不在人世'
        : actor.age < 16
          ? '尚未成年，不能独自经营此事'
          : requested.kind === 'strengthen_relationship' && actor.personalWealth < 1
            ? '至少需要 1 点私产用于往来'
            : null;
      option = {
        ...template,
        command: requested,
        targetLabel,
        intent: requested.kind === 'strengthen_relationship' && targetCharacter
          ? `亲自与${targetCharacter.name}往来，争取更多信任。`
          : requested.kind === 'seek_opportunity' && targetCharacter
            ? `向${targetCharacter.name}争取${opportunityLabel(world, actor)}。`
            : requested.kind === 'declare_stance' && targetFaction
              ? `${requested.stance === 'support' ? '支持' : '反对'}${targetFaction.name}主张的“${targetFaction.agenda}”。`
              : template.intent,
        obstacle: requested.kind === 'strengthen_relationship' && targetCharacter
          ? `${targetCharacter.name}目前对其信任为${directedRelationship(world, targetCharacter.id, actor.id)?.trust ?? 28}`
          : requested.kind === 'seek_opportunity' && targetCharacter
            ? `能否成事取决于履历、影响与${targetCharacter.name}的态度`
            : targetFaction
              ? `集团凝聚为${Math.round(targetFaction.cohesion)}，领袖为${world.characters.find((item) => item.id === targetFaction.leaderId)?.name ?? '未详'}`
              : template.obstacle,
        nextSignal: requested.kind === 'strengthen_relationship' && targetCharacter
          ? `观察${targetCharacter.name}是否回应，以及双方信任如何变化`
          : requested.kind === 'seek_opportunity' && targetCharacter
            ? `观察${targetCharacter.name}是应允、留待后议还是拒绝`
            : targetFaction
              ? `观察${targetFaction.name}的凝聚、权势与领袖态度`
              : template.nextSignal,
        available: unavailableReason === null,
        unavailableReason,
      };
    }
  }
  const valid = Boolean(actor?.alive && requested.issuedTurn === context.turn && option?.available);
  const polityId = actor?.polityId ?? '';
  const regionId = actor?.locationRegionId ?? '';
  const submission = emitSimulationFact(world, context, {
    kind: 'embodied_action_submitted',
    category: '政治',
    importance: 1,
    actorIds: actor ? [actor.id] : [],
    polityIds: polityId ? [polityId] : [],
    regionIds: regionId ? [regionId] : [],
    causes: [
      { label: '人物本意', role: '选择', weight: 0.55, evidence: option?.intent ?? '原定行动已失去可核验的对象或条件' },
      { label: '入世决定', role: '触发', weight: 0.45, evidence: '观察者本季只替此人定下这一件事，其余世界仍由原有系统推进' },
    ],
    stateDeltas: [],
    sourceFactIds: [],
    payload: {
      actionId: requested.actionId,
      issuedTurn: requested.issuedTurn,
      source: 'player_embodied',
      actorId: requested.actorId,
      action: requested.kind,
      targetKind: requested.targetKind,
      targetId: requested.targetId,
      stance: requested.stance,
    },
  });
  const deltas: StateDelta[] = [];
  let score = 0;
  let threshold = 50;
  let outcome: 'succeeded' | 'deferred' | 'refused' | 'invalidated' = 'invalidated';
  let reasonCode: 'conditions_changed' | 'accepted' | 'insufficient_support' | 'target_refused' = 'conditions_changed';
  let resultSummary = actor ? `${actor.name}原定之事因处境变化未能成行。` : '原定人物已经失去行动载体。';
  let nextSignal = option?.nextSignal ?? '观察人物是否仍有新的行动条件';
  let targetLabel = option?.targetLabel ?? '原定对象';
  if (valid && actor && option) {
    const variance = (Number.parseInt(stableHash([requested.actionId, 'resolver-v1']).slice(0, 8), 16) % 17) - 8;
    if (requested.kind === 'strengthen_relationship') {
      const target = world.characters.find((item) => item.id === requested.targetId && item.alive);
      if (target && actor.personalWealth >= 1) {
        const relation = ensureRelationship(world, target.id, actor.id);
        score = clamp(actor.governance * 0.24 + actor.cunning * 0.18 + actor.influence * 0.16
          + actor.loyalty * 0.1 + relation.trust * 0.22 + relation.affinity * 0.1 + variance);
        threshold = 48;
        outcome = score >= threshold ? 'succeeded' : score >= threshold - 10 ? 'deferred' : 'refused';
        reasonCode = outcome === 'succeeded' ? 'accepted' : outcome === 'deferred' ? 'insufficient_support' : 'target_refused';
        const wealthBefore = actor.personalWealth;
        actor.personalWealth = Math.max(0, actor.personalWealth - 1);
        addDelta(deltas, 'character', actor.id, 'personalWealth', wealthBefore, actor.personalWealth);
        const trustBefore = relation.trust;
        const affinityBefore = relation.affinity;
        relation.trust = clamp(relation.trust + (outcome === 'succeeded' ? 7 : outcome === 'deferred' ? 2 : -3));
        relation.affinity = clamp(relation.affinity + (outcome === 'succeeded' ? 4 : outcome === 'refused' ? -2 : 1));
        relation.lastInteractionTurn = context.turn;
        addDelta(deltas, 'relationship', relation.id, 'trust', trustBefore, relation.trust);
        addDelta(deltas, 'relationship', relation.id, 'affinity', affinityBefore, relation.affinity);
        resultSummary = outcome === 'succeeded'
          ? `${actor.name}亲自拜访${target.name}，${target.name}答应今后互通消息，信任由${trustBefore}升至${relation.trust}。`
          : outcome === 'deferred'
            ? `${actor.name}与${target.name}见了一面，${target.name}没有许诺相助，但仍愿继续往来。`
            : `${actor.name}试图亲近${target.name}，${target.name}没有领情，双方反而多了一分隔阂。`;
        targetLabel = target.name;
      }
    } else if (requested.kind === 'seek_opportunity') {
      const target = world.characters.find((item) => item.id === requested.targetId && item.alive);
      if (target) {
        const relation = ensureRelationship(world, target.id, actor.id);
        const ability = actor.role === '地方长官' ? actor.governance : actor.role === '将领' ? actor.leadership : actor.cunning;
        score = clamp(ability * 0.2 + actor.merit * 0.24 + actor.influence * 0.2 + actor.renown * 0.12
          + relation.trust * 0.18 + actor.loyalty * 0.06 + variance);
        threshold = 54;
        outcome = score >= threshold ? 'succeeded' : score >= threshold - 12 ? 'deferred' : 'refused';
        reasonCode = outcome === 'succeeded' ? 'accepted' : outcome === 'deferred' ? 'insufficient_support' : 'target_refused';
        const influenceBefore = actor.influence;
        const meritBefore = actor.merit;
        const trustBefore = relation.trust;
        if (outcome === 'succeeded') {
          actor.influence = clamp(actor.influence + 3);
          actor.merit = clamp(actor.merit + 1);
          relation.trust = clamp(relation.trust + 4);
        } else if (outcome === 'deferred') {
          relation.trust = clamp(relation.trust + 1);
        } else {
          relation.trust = clamp(relation.trust - 3);
        }
        relation.lastInteractionTurn = context.turn;
        addDelta(deltas, 'character', actor.id, 'influence', influenceBefore, actor.influence);
        addDelta(deltas, 'character', actor.id, 'merit', meritBefore, actor.merit);
        addDelta(deltas, 'relationship', relation.id, 'trust', trustBefore, relation.trust);
        const opportunity = opportunityLabel(world, actor);
        resultSummary = outcome === 'succeeded'
          ? `${actor.name}向${target.name}争取${opportunity}，${target.name}答应让其先行参与，${actor.name}的影响由${influenceBefore}升至${actor.influence}。`
          : outcome === 'deferred'
            ? `${actor.name}向${target.name}争取${opportunity}，${target.name}没有当场应允，只说待有缺口再议。`
            : `${actor.name}向${target.name}争取${opportunity}，${target.name}认为履历与支持尚不足，明确没有应允。`;
        targetLabel = target.name;
      }
    } else {
      const faction = world.factions.find((item) => item.id === requested.targetId && item.active);
      const leader = faction ? world.characters.find((item) => item.id === faction.leaderId && item.alive) : undefined;
      if (faction && leader && requested.stance) {
        const relation = ensureRelationship(world, leader.id, actor.id);
        threshold = requested.stance === 'support' ? 46 : 58;
        score = clamp(actor.influence * 0.24 + actor.cunning * 0.18 + actor.renown * 0.12
          + (requested.stance === 'support' ? actor.loyalty * 0.2 + faction.cohesion * 0.16 : actor.ambition * 0.24 + (100 - faction.cohesion) * 0.16)
          + relation.trust * 0.1 + variance);
        outcome = score >= threshold ? 'succeeded' : score >= threshold - 10 ? 'deferred' : 'refused';
        reasonCode = outcome === 'succeeded' ? 'accepted' : outcome === 'deferred' ? 'insufficient_support' : 'target_refused';
        const cohesionBefore = faction.cohesion;
        const influenceBefore = actor.influence;
        const trustBefore = relation.trust;
        if (requested.stance === 'support') {
          faction.cohesion = clamp(faction.cohesion + (outcome === 'succeeded' ? 3 : outcome === 'deferred' ? 1 : -1));
          actor.influence = clamp(actor.influence + (outcome === 'succeeded' ? 2 : 0));
          relation.trust = clamp(relation.trust + (outcome === 'succeeded' ? 5 : outcome === 'deferred' ? 1 : -2));
        } else {
          faction.cohesion = clamp(faction.cohesion - (outcome === 'succeeded' ? 3 : outcome === 'deferred' ? 1 : 0));
          actor.influence = clamp(actor.influence + (outcome === 'succeeded' ? 2 : outcome === 'refused' ? -1 : 0));
          relation.trust = clamp(relation.trust - (outcome === 'succeeded' ? 5 : outcome === 'deferred' ? 2 : 1));
        }
        relation.lastInteractionTurn = context.turn;
        faction.lastActionTurn = context.turn;
        addDelta(deltas, 'faction', faction.id, 'cohesion', cohesionBefore, faction.cohesion);
        addDelta(deltas, 'character', actor.id, 'influence', influenceBefore, actor.influence);
        addDelta(deltas, 'relationship', relation.id, 'trust', trustBefore, relation.trust);
        const verb = requested.stance === 'support' ? '支持' : '反对';
        resultSummary = outcome === 'succeeded'
          ? `${actor.name}公开${verb}${faction.name}的“${faction.agenda}”主张；${leader.name}${requested.stance === 'support' ? '接纳了这份支持' : '不得不回应这份异议'}，集团凝聚由${cohesionBefore}变为${faction.cohesion}。`
          : outcome === 'deferred'
            ? `${actor.name}对${faction.name}的“${faction.agenda}”表了态，但同僚尚未跟进，影响暂时有限。`
            : `${actor.name}公开${verb}${faction.name}的“${faction.agenda}”，${leader.name}没有接纳这份立场，${actor.name}的处境没有改善。`;
        targetLabel = `${faction.name} · ${faction.agenda}`;
      }
    }
  }
  const result = emitSimulationFact(world, context, {
    kind: 'embodied_action_resolved',
    category: '政治',
    importance: outcome === 'succeeded' ? 2 : 1,
    actorIds: actor ? [
      actor.id,
      ...(requested.targetKind === 'character'
        && requested.targetId !== actor.id
        && world.characters.some((item) => item.id === requested.targetId)
        ? [requested.targetId]
        : []),
    ] : [],
    polityIds: polityId ? [polityId] : [],
    regionIds: regionId ? [regionId] : [],
    causes: [
      { label: '人物所求', role: '选择', weight: 0.28, evidence: option?.intent ?? '原定行动已失去条件' },
      { label: '能力与履历', role: '条件', weight: 0.25, evidence: valid ? `人物能力、履历与资源合计形成${score}点把握` : '行动前提已经改变' },
      { label: '对象回应', role: '条件', weight: 0.25, evidence: valid ? `需要达到${threshold}，本次${outcomeCopy(outcome)}` : '对象、身份或资源已不再吻合' },
      { label: '直接结果', role: '结果', weight: 0.22, evidence: resultSummary },
    ],
    stateDeltas: deltas,
    sourceFactIds: [submission.id],
    payload: {
      submissionFactId: submission.id,
      domainFactId: null,
      actionId: requested.actionId,
      issuedTurn: requested.issuedTurn,
      source: 'player_embodied',
      actorId: requested.actorId,
      action: requested.kind,
      targetKind: requested.targetKind,
      targetId: requested.targetId,
      targetLabel,
      stance: requested.stance,
      outcome,
      reasonCode,
      score,
      threshold,
      cost: option?.cost ?? '无实际支出',
      resultSummary,
      nextSignal,
    },
  });
  const event = emit({
    category: result.category,
    kind: `embodied_${requested.kind}_${outcome}`,
    title: actor ? `${actor.name}${outcome === 'succeeded' ? '办成' : outcome === 'invalidated' ? '未能进行' : '尝试'}${option?.label ?? '原定之事'}` : '入世行动失去人物载体',
    summary: resultSummary,
    importance: result.importance,
    actorIds: result.actorIds,
    polityIds: result.polityIds,
    regionIds: result.regionIds,
    causes: result.causes,
    stateDeltas: deltas,
    sourceFactIds: [submission.id, result.id],
  });
  if (actor) appendBiography(actor, event, result.id, option?.label ?? '入世行动');
  return actor?.id ?? null;
}
