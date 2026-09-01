import type { CourtActionResolvedFact } from '../facts';
import type { InvariantViolation, WorldState } from '../types';
import { POWER_BROKER_FORMATION_THRESHOLD } from '../politics/court-actions';

const POWER_BROKER_ACTIONS = new Set(['power_broker_formed', 'power_broker_fell']);

function issue(
  code: string,
  message: string,
  factId: string,
): InvariantViolation {
  return { code, message, entityId: factId };
}

function duplicateIds(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

function hasDelta(
  fact: CourtActionResolvedFact,
  entityType: string,
  entityId: string,
  field: string,
  predicate: (before: unknown, after: unknown) => boolean = () => true,
): boolean {
  return fact.stateDeltas.some((delta) => (
    delta.entityType === entityType
    && delta.entityId === entityId
    && delta.field === field
    && predicate(delta.before, delta.after)
  ));
}

function hasConsistentNumericDelta(
  fact: CourtActionResolvedFact,
  entityType: string,
  entityId: string,
  field: string,
  predicate: (before: number, after: number) => boolean,
): boolean {
  return fact.stateDeltas.some((delta) => (
    delta.entityType === entityType
    && delta.entityId === entityId
    && delta.field === field
    && typeof delta.before === 'number'
    && typeof delta.after === 'number'
    && predicate(delta.before, delta.after)
    && delta.delta === delta.after - delta.before
  ));
}

function purgeDeltaIsConcreteWeakening(
  fact: CourtActionResolvedFact,
  targetFactionId: string,
): boolean {
  return fact.stateDeltas.some((delta) => {
    if (delta.before === delta.after) return false;
    if (delta.entityType === 'faction' && delta.entityId === targetFactionId) {
      if (['power', 'memberCount', 'coreMemberCount'].includes(delta.field)) {
        return typeof delta.before === 'number'
          && typeof delta.after === 'number'
          && delta.after < delta.before
          && delta.delta === delta.after - delta.before;
      }
    }
    if (delta.entityType === 'character' && delta.entityId === fact.payload.targetId) {
      if (delta.field === 'influence') {
        return typeof delta.before === 'number'
          && typeof delta.after === 'number'
          && delta.after < delta.before
          && delta.delta === delta.after - delta.before;
      }
      if (delta.field === 'governedRegionId') return delta.before !== null && delta.after === null;
    }
    return delta.entityType === 'character'
      && fact.payload.removedMemberIds.includes(delta.entityId)
      && delta.field === 'factionId'
      && delta.before === targetFactionId
      && delta.after === null;
  });
}

/**
 * Court-action Facts are durable historical records. This validator therefore
 * checks durable identities and the claimed transition, never a person's later
 * allegiance or a faction's later membership.
 */
export function validateCourtActionFacts(
  world: WorldState,
  facts: readonly CourtActionResolvedFact[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const polityIds = new Set(world.polities.map((polity) => polity.id));
  const characterIds = new Set(world.characters.map((character) => character.id));
  const factionById = new Map(world.factions.map((faction) => [faction.id, faction]));
  const eventsBySourceFactId = new Map<string, typeof world.history>();
  for (const event of world.history) {
    for (const sourceFactId of event.sourceFactIds) {
      const events = eventsBySourceFactId.get(sourceFactId) ?? [];
      events.push(event);
      eventsBySourceFactId.set(sourceFactId, events);
    }
  }
  const sameIds = (left: readonly string[], right: readonly string[]) => (
    [...new Set(left)].sort().join('\u0000') === [...new Set(right)].sort().join('\u0000')
  );
  const sameStructuredValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

  for (const fact of facts) {
    const payload = fact.payload;
    if (fact.category !== '政治') {
      violations.push(issue('fact.court-category', `${fact.id}的朝堂行动没有归入政治类别`, fact.id));
    }
    const projections = eventsBySourceFactId.get(fact.id) ?? [];
    if (projections.length !== 1) {
      violations.push(issue('fact.court-projection-count', `${fact.id}必须且只能反投影为一条纪事`, fact.id));
    } else {
      const projection = projections[0];
      if (
        projection.turn !== fact.turn
        || projection.category !== fact.category
        || !sameIds(projection.polityIds, fact.polityIds)
        || !sameIds(projection.actorIds, fact.actorIds)
      ) {
        violations.push(issue('fact.court-projection-scope', `${fact.id}与纪事的回合、政权或人物范围不一致`, fact.id));
      }
      if (
        !sameStructuredValue(projection.causes, fact.causes)
        || !sameStructuredValue(projection.stateDeltas, fact.stateDeltas)
      ) {
        violations.push(issue('fact.court-projection-content', `${fact.id}与纪事的原因或状态变化不一致`, fact.id));
      }
    }
    if (!polityIds.has(payload.polityId)
      || fact.polityIds.length !== 1
      || fact.polityIds[0] !== payload.polityId) {
      violations.push(issue('fact.court-polity', `${fact.id}的朝堂行动政权范围无效`, fact.id));
    }

    const actorIds = [
      payload.initiatorId,
      payload.targetId,
      payload.rulerBeforeId,
      payload.rulerAfterId,
      ...payload.removedMemberIds,
    ];
    if (actorIds.some((id) => !characterIds.has(id))
      || payload.initiatorId === payload.targetId
      || !fact.actorIds.includes(payload.initiatorId)
      || !fact.actorIds.includes(payload.targetId)) {
      violations.push(issue('fact.court-character', `${fact.id}的朝堂行动人物引用无效`, fact.id));
    }

    const factionIds = [
      ...(payload.actorFactionId ? [payload.actorFactionId] : []),
      ...(payload.targetFactionId ? [payload.targetFactionId] : []),
      ...payload.affectedFactionIds,
    ];
    if (factionIds.some((id) => factionById.get(id)?.polityId !== payload.polityId)
      || duplicateIds(payload.affectedFactionIds)
      || duplicateIds(payload.removedMemberIds)) {
      violations.push(issue('fact.court-faction', `${fact.id}引用未知、异国或重复的派系/成员`, fact.id));
    }
    if (
      ((payload.action === 'power_broker_formed'
        || payload.action === 'coup'
        || payload.action === 'usurpation')
        && (!payload.actorFactionId || !payload.affectedFactionIds.includes(payload.actorFactionId)))
      || (payload.action === 'purge'
        && (!payload.targetFactionId || !payload.affectedFactionIds.includes(payload.targetFactionId)))
    ) {
      violations.push(issue('fact.court-primary-faction', `${fact.id}没有登记行动的主要派系`, fact.id));
    }

    if (!payload.reasonCode.trim()
      || !Number.isFinite(payload.score)
      || !Number.isFinite(payload.threshold)
      || payload.threshold < 0) {
      violations.push(issue('fact.court-check', `${fact.id}的行动判定值或理由无效`, fact.id));
    }
    if (
      payload.action === 'power_broker_formed'
      && payload.threshold !== POWER_BROKER_FORMATION_THRESHOLD
    ) {
      violations.push(issue('fact.court-threshold', `${fact.id}的权臣形成门槛不符合当前规则`, fact.id));
    }
    if (
      ['power_broker_formed', 'purge', 'coup', 'usurpation'].includes(payload.action)
      && payload.score < payload.threshold
    ) {
      violations.push(issue('fact.court-outcome-check', `${fact.id}未达到行动门槛却记录为成功`, fact.id));
    }
    if (fact.stateDeltas.some((delta) => (
      typeof delta.before === 'number'
      && typeof delta.after === 'number'
      && delta.delta !== delta.after - delta.before
    ))) {
      violations.push(issue('fact.court-delta-consistency', `${fact.id}的数值变化与前后值不一致`, fact.id));
    }
    if (fact.stateDeltas.some((delta) => delta.before === delta.after)) {
      violations.push(issue('fact.court-noop-delta', `${fact.id}记录了没有实际变化的状态项`, fact.id));
    }

    const rulerChanged = payload.rulerBeforeId !== payload.rulerAfterId;
    const seizure = payload.action === 'coup' || payload.action === 'usurpation';
    const exactRulerDelta = hasDelta(
      fact,
      'polity',
      payload.polityId,
      'rulerId',
      (before, after) => before === payload.rulerBeforeId && after === payload.rulerAfterId,
    );
    if (seizure !== rulerChanged || (seizure && !exactRulerDelta)) {
      violations.push(issue('fact.court-ruler-delta', `${fact.id}的君位变化与行动结论不一致`, fact.id));
    }

    if (payload.action === 'power_broker_formed') {
      const influenceDelta = fact.stateDeltas.find((delta) => (
        delta.entityType === 'character'
        && delta.entityId === payload.initiatorId
        && delta.field === 'influence'
      ));
      if (influenceDelta && !hasConsistentNumericDelta(
        fact,
        'character',
        payload.initiatorId,
        'influence',
        (before, after) => after > before,
      )) {
        violations.push(issue('fact.court-power-broker-delta', `${fact.id}记录了不真实的权臣影响变化`, fact.id));
      }
    }

    if (payload.action === 'purge') {
      const targetFactionId = payload.targetFactionId ?? '';
      const everyRemovalRecorded = payload.removedMemberIds.every((memberId) => hasDelta(
        fact,
        'character',
        memberId,
        'factionId',
        (before, after) => before === payload.targetFactionId && after === null,
      ));
      if (!purgeDeltaIsConcreteWeakening(fact, targetFactionId) || !everyRemovalRecorded) {
        violations.push(issue('fact.court-purge-delta', `${fact.id}没有完整记录清洗造成的真实削权`, fact.id));
      }
    }

    if (!POWER_BROKER_ACTIONS.has(payload.action) && fact.stateDeltas.length === 0) {
      violations.push(issue('fact.court-empty-delta', `${fact.id}的朝堂行动没有状态变化`, fact.id));
    }
  }
  return violations;
}
