import { readWorldFacts } from '../archive';
import { stableCompare } from '../random';
import type {
  FactionLifecycleTransition,
  FactionState,
  InvariantViolation,
  SimulationFact,
  WorldState,
} from '../types';

function issue(code: string, message: string, entityId?: string): InvariantViolation {
  return { code, message, entityId };
}

function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => (index === 0 || stableCompare(values[index - 1] as string, value) < 0));
}

function matchingLifecycleFact(
  factById: ReadonlyMap<string, SimulationFact>,
  faction: FactionState,
  factId: string | null,
  transition: FactionLifecycleTransition,
  role: 'created' | 'ended',
  expectedTurn: number | null,
): boolean {
  if (!factId || expectedTurn === null) return false;
  const fact = factById.get(factId);
  return Boolean(
    fact?.kind === 'faction_lifecycle'
    && fact.turn === expectedTurn
    && fact.payload.transition === transition
    && fact.payload.polityId === faction.polityId
    && fact.payload.affectedFactionIds.includes(faction.id)
    && (role === 'created'
      ? fact.payload.createdFactionIds.includes(faction.id)
      : fact.payload.endedFactionIds.includes(faction.id))
  );
}

export function validateFactionState(world: WorldState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const factionById = new Map(world.factions.map((faction) => [faction.id, faction]));
  const characterById = new Map(world.characters.map((character) => [character.id, character]));
  const polityById = new Map(world.polities.map((polity) => [polity.id, polity]));
  const facts = readWorldFacts(world);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));

  for (const character of world.characters) {
    if (!character.factionId) continue;
    const faction = factionById.get(character.factionId);
    if (!faction?.active || !character.alive || character.age < 16 || faction.polityId !== character.polityId) {
      violations.push(issue('faction.character-affiliation', `${character.name}的当前派系归属无效`, character.id));
    }
  }

  const activeCountByPolity = new Map<string, number>();
  for (const faction of world.factions) {
    if (!polityById.has(faction.polityId) || !characterById.has(faction.leaderId)) {
      violations.push(issue('faction.references', `${faction.name}的政权或领袖引用无效`, faction.id));
    }
    if (!Number.isFinite(faction.power) || faction.power < 0 || faction.power > 100 || !Number.isFinite(faction.cohesion) || faction.cohesion < 0 || faction.cohesion > 100) {
      violations.push(issue('faction.metrics', `${faction.name}的权势或凝聚越界`, faction.id));
    }
    for (const values of [faction.memberIds, faction.predecessorFactionIds, faction.successorFactionIds, faction.alliedFactionIds, faction.rivalFactionIds]) {
      if (!sortedUnique(values)) violations.push(issue('faction.sorted-unique', `${faction.name}存在重复或未排序的身份引用`, faction.id));
    }
    if (faction.active && (faction.coreMemberIds.length > 5 || faction.coreMemberIds.some((id) => !faction.memberIds.includes(id)))) {
      violations.push(issue('faction.core', `${faction.name}的核心成员不是有效成员子集`, faction.id));
    }
    if (faction.lifecycle.length > 12 || faction.lifecycle.some((record) => record.turn < 0 || record.turn > world.turn)) {
      violations.push(issue('faction.lifecycle-bound', `${faction.name}的近史记录越界`, faction.id));
    }
    for (const record of faction.lifecycle) {
      if (!sortedUnique(record.relatedFactionIds)
        || record.relatedFactionIds.includes(faction.id)
        || record.relatedFactionIds.some((id) => factionById.get(id)?.polityId !== faction.polityId)) {
        violations.push(issue('faction.lifecycle-related', `${faction.name}的近史关联派系无效`, faction.id));
      }
      if (record.factId === null) {
        if (faction.origin !== 'legacy' || record.reasonCode !== 'legacy_boundary') {
          violations.push(issue('faction.lifecycle-fact', `${faction.name}存在没有事实支持的近史记录`, faction.id));
        }
        continue;
      }
      const source = factById.get(record.factId);
      if (source?.kind !== 'faction_lifecycle'
        || source.turn !== record.turn
        || source.payload.transition !== record.transition
        || source.payload.reasonCode !== record.reasonCode
        || source.payload.polityId !== faction.polityId
        || !source.payload.affectedFactionIds.includes(faction.id)
        || record.relatedFactionIds.some((id) => !source.payload.affectedFactionIds.includes(id))) {
        violations.push(issue('faction.lifecycle-fact', `${faction.name}的近史记录与对应事实不一致`, faction.id));
      }
    }

    if (faction.active) {
      activeCountByPolity.set(faction.polityId, (activeCountByPolity.get(faction.polityId) ?? 0) + 1);
      const derivedMembers = world.characters
        .filter((character) => character.factionId === faction.id)
        .map((character) => character.id)
        .sort(stableCompare);
      if (JSON.stringify(derivedMembers) !== JSON.stringify(faction.memberIds)) {
        violations.push(issue('faction.membership-cache', `${faction.name}成员账与人物当前归属不一致`, faction.id));
      }
      if (faction.endedTurn !== null || faction.endedReason !== null || !polityById.get(faction.polityId)?.alive) {
        violations.push(issue('faction.active', `${faction.name}的活动状态与政权存续不一致`, faction.id));
      }
      if (!faction.memberIds.includes(faction.leaderId) || !faction.coreMemberIds.includes(faction.leaderId)) {
        violations.push(issue('faction.leader', `${faction.name}领袖不在成员与核心名单中`, faction.id));
      }
    } else if (
      faction.endedTurn === null
      || faction.endedReason === null
      || faction.alliedFactionIds.length > 0
      || faction.rivalFactionIds.length > 0
    ) {
      violations.push(issue('faction.ended', `${faction.name}的结束状态不完整`, faction.id));
    }

    if (faction.origin !== 'legacy') {
      const originTransition = faction.origin === 'split'
        ? 'split'
        : faction.origin === 'merged'
          ? 'merged'
          : 'formed';
      if (!matchingLifecycleFact(factById, faction, faction.originFactId, originTransition, 'created', faction.formedTurn)) {
        violations.push(issue('faction.origin-fact', `${faction.name}缺少匹配的建立事实`, faction.id));
      }
    }
    if (!faction.active && faction.endedReason !== 'legacy') {
      const endTransition = faction.endedReason === 'merged' ? 'merged' : 'ended';
      if (!matchingLifecycleFact(factById, faction, faction.endedFactId, endTransition, 'ended', faction.endedTurn)) {
        violations.push(issue('faction.end-fact', `${faction.name}缺少匹配的结束事实`, faction.id));
      }
    }

    for (const alliedId of faction.alliedFactionIds) {
      const allied = factionById.get(alliedId);
      if (!allied?.active || allied.polityId !== faction.polityId || !allied.alliedFactionIds.includes(faction.id) || faction.rivalFactionIds.includes(alliedId)) {
        violations.push(issue('faction.alliance', `${faction.name}的联盟不对称、跨国或与对立重叠`, faction.id));
      }
    }
    for (const rivalId of faction.rivalFactionIds) {
      const rival = factionById.get(rivalId);
      if (!rival?.active || rival.polityId !== faction.polityId || !rival.rivalFactionIds.includes(faction.id) || faction.alliedFactionIds.includes(rivalId)) {
        violations.push(issue('faction.rivalry', `${faction.name}的对立不对称、跨国或与联盟重叠`, faction.id));
      }
    }
    for (const predecessorId of faction.predecessorFactionIds) {
      const predecessor = factionById.get(predecessorId);
      if (!predecessor || predecessor.polityId !== faction.polityId || !predecessor.successorFactionIds.includes(faction.id)) {
        violations.push(issue('faction.predecessor', `${faction.name}的前身引用不对称`, faction.id));
      }
    }
    for (const successorId of faction.successorFactionIds) {
      const successor = factionById.get(successorId);
      if (!successor || successor.polityId !== faction.polityId || !successor.predecessorFactionIds.includes(faction.id)) {
        violations.push(issue('faction.successor', `${faction.name}的后继引用不对称`, faction.id));
      }
    }
  }

  for (const [polityId, count] of activeCountByPolity) {
    if (count > 4) violations.push(issue('faction.active-cap', `${polityById.get(polityId)?.name ?? polityId}存在${count}个活动集团，超过4席上限`, polityId));
  }
  return violations;
}
