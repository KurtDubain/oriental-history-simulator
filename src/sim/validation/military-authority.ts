import type { InvariantViolation, SimulationFact, WorldState } from '../types';

interface MilitaryAuthorityValidationOptions {
  facts?: readonly SimulationFact[];
  trustedSourceFactIds?: ReadonlySet<string>;
}

const ORDER_KINDS = new Set(['hold', 'advance', 'intercept', 'reinforce', 'retreat']);
const ORDER_REASONS = new Set([
  'peace_garrison', 'war_goal', 'enemy_approach', 'frontline_support',
  'defend_war_goal', 'amphibious_landing', 'low_readiness', 'target_invalid',
]);
const PROVENANCE = new Set(['opening', 'legacy', 'system', 'fact']);

function issue(code: string, message: string, entityId: string): InvariantViolation {
  return { code, message, entityId };
}

function finiteRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function collectMilitarySourceFactIds(world: WorldState): Set<string> {
  const ids = new Set<string>();
  for (const army of world.armies) {
    if (army.allegiance.sourceFactId) ids.add(army.allegiance.sourceFactId);
    if (army.order.sourceFactId) ids.add(army.order.sourceFactId);
    for (const retinue of army.retinues) {
      if (retinue.sourceFactId) ids.add(retinue.sourceFactId);
    }
  }
  return ids;
}

export function validateMilitaryAuthority(
  world: WorldState,
  options: MilitaryAuthorityValidationOptions = {},
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const characters = new Map(world.characters.map((character) => [character.id, character]));
  const armies = new Map(world.armies.map((army) => [army.id, army]));
  const regions = new Set(world.regions.map((region) => region.id));
  const wars = new Map(world.wars.map((war) => [war.id, war]));
  const facts = new Map((options.facts ?? world.facts).map((fact) => [fact.id, fact]));
  const trustedSourceFactIds = options.trustedSourceFactIds ?? new Set<string>();
  const retinueArmyByOwner = new Map<string, string>();

  for (const army of world.armies) {
    const movement = army.recentMovement;
    if (movement && (
      !regions.has(movement.fromRegionId)
      || !regions.has(movement.toRegionId)
      || !Number.isSafeInteger(movement.turn)
      || movement.turn < 0
      || movement.turn > world.turn
      || !ORDER_KINDS.has(movement.orderKind)
      || (movement.warId !== null && !wars.has(movement.warId))
    )) violations.push(issue('army.recent-movement', `${army.name}最近一步行军记录无效`, army.id));
    const eligible = new Set([
      army.commanderId,
      army.deputyCommanderId,
      ...army.retinues.map((retinue) => retinue.ownerId),
    ].filter((id): id is string => Boolean(id)));
    const allegiance = characters.get(army.allegiance.characterId);
    if (!allegiance?.alive || allegiance.polityId !== army.polityId || !eligible.has(allegiance.id)) {
      violations.push(issue('army.allegiance', `${army.name}实际拥戴者不在有效军令链中`, army.id));
    }
    if (!finiteRange(army.allegiance.strength, 0, 100)
      || !Number.isSafeInteger(army.allegiance.sinceTurn)
      || army.allegiance.sinceTurn > world.turn
      || !PROVENANCE.has(army.allegiance.provenance)) {
      violations.push(issue('army.allegiance-state', `${army.name}军中拥戴状态无效`, army.id));
    }
    if (army.allegiance.sourceFactId
      && !facts.has(army.allegiance.sourceFactId)
      && !trustedSourceFactIds.has(army.allegiance.sourceFactId)) {
      violations.push(issue('army.allegiance-fact', `${army.name}军中拥戴引用未知事实`, army.id));
    }

    if (army.retinues.length > 2) violations.push(issue('army.retinue-bound', `${army.name}直属部曲超过两支上限`, army.id));
    const ownerIds = new Set<string>();
    let retinueSoldiers = 0;
    for (const retinue of army.retinues) {
      const owner = characters.get(retinue.ownerId);
      if (!owner?.alive || owner.polityId !== army.polityId
        || (retinue.ownerId !== army.commanderId && retinue.ownerId !== army.deputyCommanderId)) {
        violations.push(issue('army.retinue-owner', `${army.name}直属部曲所有者不在主副将军令链中`, army.id));
      }
      if (ownerIds.has(retinue.ownerId)) violations.push(issue('army.retinue-duplicate', `${army.name}重复记录同一人物部曲`, army.id));
      ownerIds.add(retinue.ownerId);
      const previousArmyId = retinueArmyByOwner.get(retinue.ownerId);
      if (previousArmyId && previousArmyId !== army.id) {
        violations.push(issue('army.retinue-multi-army', `${retinue.ownerId}同时在多支军团拥有直属部曲`, army.id));
      }
      retinueArmyByOwner.set(retinue.ownerId, army.id);
      if (!Number.isSafeInteger(retinue.soldiers) || retinue.soldiers <= 0
        || !finiteRange(retinue.cohesion, 0, 100)
        || !Number.isSafeInteger(retinue.attachedTurn) || retinue.attachedTurn > world.turn) {
        violations.push(issue('army.retinue-state', `${army.name}直属部曲规模、凝聚或入营时间无效`, army.id));
      }
      if (retinue.sourceFactId
        && !facts.has(retinue.sourceFactId)
        && !trustedSourceFactIds.has(retinue.sourceFactId)) {
        violations.push(issue('army.retinue-fact', `${army.name}直属部曲引用未知事实`, army.id));
      }
      retinueSoldiers += retinue.soldiers;
    }
    if (retinueSoldiers > army.soldiers || retinueSoldiers > Math.ceil(army.soldiers * 0.18)) {
      violations.push(issue('army.retinue-subset', `${army.name}直属部曲不是军团兵力的有界子集`, army.id));
    }

    const order = army.order;
    const issuer = characters.get(order.issuerId);
    if (!ORDER_KINDS.has(order.kind) || !ORDER_REASONS.has(order.reasonCode)
      || !PROVENANCE.has(order.provenance) || !['active', 'blocked'].includes(order.status)
      || !Number.isSafeInteger(order.issuedTurn) || order.issuedTurn > world.turn
      || !Number.isSafeInteger(order.lastReviewedTurn) || order.lastReviewedTurn < order.issuedTurn
      || order.lastReviewedTurn > world.turn) {
      violations.push(issue('army.order-state', `${army.name}当前军令字段无效`, army.id));
    }
    if (!issuer?.alive || issuer.polityId !== army.polityId || order.issuerId !== army.commanderId) {
      violations.push(issue('army.order-issuer', `${army.name}当前军令不是由法定主帅发出`, army.id));
    }
    if (order.targetRegionId && !regions.has(order.targetRegionId)) {
      violations.push(issue('army.order-region', `${army.name}当前军令指向未知州域`, army.id));
    }
    if (order.targetArmyId && !armies.has(order.targetArmyId)) {
      violations.push(issue('army.order-army', `${army.name}当前军令指向未知军团`, army.id));
    }
    if (order.warId && !wars.get(order.warId)?.active) {
      violations.push(issue('army.order-war', `${army.name}当前军令引用已结束或未知战争`, army.id));
    }
    if (order.kind === 'hold' && !order.targetRegionId) {
      violations.push(issue('army.order-hold', `${army.name}固守令缺少驻守州域`, army.id));
    }
    if (order.kind !== 'hold' && !order.targetRegionId) {
      violations.push(issue('army.order-target', `${army.name}行动军令缺少目的地`, army.id));
    }
    if (order.sourceFactId) {
      const source = facts.get(order.sourceFactId);
      if (!source && trustedSourceFactIds.has(order.sourceFactId)) {
        // Runtime validation trusts source references already authenticated in
        // the previous snapshot; full validation resolves them from the archive.
      } else if (source?.kind !== 'army_order_changed' || source.payload.armyId !== army.id
        || source.payload.next.kind !== order.kind || source.payload.next.issuerId !== order.issuerId
        || source.payload.next.issuedTurn !== order.issuedTurn
        || source.payload.next.warId !== order.warId
        || source.payload.next.targetRegionId !== order.targetRegionId
        || source.payload.next.targetArmyId !== order.targetArmyId
        || source.payload.next.status !== order.status
        || source.payload.next.reasonCode !== order.reasonCode
        || source.payload.next.provenance !== order.provenance) {
        violations.push(issue('army.order-fact', `${army.name}当前军令没有匹配的权威事实`, army.id));
      }
    } else if (order.provenance === 'fact') {
      violations.push(issue('army.order-fact-missing', `${army.name}事实来源军令缺少事实引用`, army.id));
    }
    const operation = army.embarkedOperationId
      ? world.navalOperations.find((item) => (
          item.id === army.embarkedOperationId && item.stage !== '完成' && item.stage !== '失败'
        ))
      : null;
    if (operation && (order.kind !== 'advance' || order.warId !== operation.warId
      || order.targetRegionId !== operation.targetRegionId || order.reasonCode !== 'amphibious_landing')) {
      violations.push(issue('army.order-landing', `${army.name}当前军令与跨海登陆行动不一致`, army.id));
    }
  }
  return violations;
}
