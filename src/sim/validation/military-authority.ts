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
  const forceByOwner = new Map<string, typeof world.personalForces[number]>();
  const formationByOwner = new Map<string, string>();
  for (const force of world.personalForces) {
    const owner = characters.get(force.ownerId);
    if (forceByOwner.has(force.ownerId)) {
      violations.push(issue('personal-force.duplicate', `${force.ownerId}拥有多支个人军势`, force.ownerId));
    }
    forceByOwner.set(force.ownerId, force);
    if (!owner?.alive || (owner.age < 16 && !world.polities.some((polity) => polity.alive && polity.rulerId === owner.id))) {
      violations.push(issue('personal-force.owner', `${force.ownerId}不具备持有个人军势的资格`, force.ownerId));
    }
    if (!Number.isSafeInteger(force.soldiers) || force.soldiers < 0
      || !finiteRange(force.cohesion, 0, 100) || !finiteRange(force.readiness, 0, 100)
      || !regions.has(force.homeRegionId)
      || !['驻留', '集结', '出征', '交战', '撤退'].includes(force.status)) {
      violations.push(issue('personal-force.state', `${force.ownerId}的个人军势状态无效`, force.ownerId));
    }
  }
  for (const character of world.characters.filter((item) => item.alive && (item.age >= 16
    || world.polities.some((polity) => polity.alive && polity.rulerId === item.id)))) {
    if (!forceByOwner.has(character.id)) {
      violations.push(issue('personal-force.missing', `${character.name}没有唯一个人军势`, character.id));
    }
  }

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
    const eligible = new Set(army.participantIds);
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

    if (new Set(army.participantIds).size !== army.participantIds.length || army.participantIds.length === 0) {
      violations.push(issue('formation.participants', `${army.name}的出征成员重复或为空`, army.id));
    }
    if (!eligible.has(army.commanderId) || (army.deputyCommanderId && !eligible.has(army.deputyCommanderId))) {
      violations.push(issue('formation.command', `${army.name}的主副将不在出征成员中`, army.id));
    }
    let formationSoldiers = 0;
    for (const ownerId of army.participantIds) {
      const owner = characters.get(ownerId);
      const force = forceByOwner.get(ownerId);
      if (!owner?.alive || owner.polityId !== army.polityId || !force || force.formationId !== army.id) {
        violations.push(issue('formation.member', `${army.name}包含无效或未归队的人物军势`, army.id));
        continue;
      }
      const previousArmyId = formationByOwner.get(ownerId);
      if (previousArmyId && previousArmyId !== army.id) {
        violations.push(issue('formation.multi', `${ownerId}同时加入多支出征编队`, army.id));
      }
      formationByOwner.set(ownerId, army.id);
      formationSoldiers += force.soldiers;
    }
    if (formationSoldiers !== army.soldiers) {
      violations.push(issue('formation.soldiers-cache', `${army.name}汇总兵力与成员部曲不符`, army.id));
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
  for (const fact of facts.values()) {
    if (fact.kind !== 'battle') continue;
    const seenParticipants = new Set<string>();
    for (const formation of [fact.payload.attacker, ...fact.payload.defenders]) {
      if (!formation.participants) continue;
      const totals = formation.participants.reduce((sum, participant) => ({
        before: sum.before + participant.soldiersBefore,
        after: sum.after + participant.soldiersAfter,
        losses: sum.losses + participant.losses,
      }), { before: 0, after: 0, losses: 0 });
      if (totals.before !== formation.soldiersBefore || totals.after !== formation.soldiersAfter
        || totals.losses !== formation.losses || totals.before - totals.after !== totals.losses) {
        violations.push(issue('fact.battle-personal-force-total', `${fact.id}的人物部曲伤亡与编队战报不一致`, fact.id));
      }
      if (formation.participants.some((participant) => {
        const invalid = seenParticipants.has(participant.characterId)
          || participant.formationCommanderId !== formation.commanderId
          || participant.soldiersBefore < 0
          || participant.soldiersAfter < 0
          || participant.losses < 0
          || participant.soldiersBefore - participant.soldiersAfter !== participant.losses
          || !fact.actorIds.includes(participant.characterId);
        seenParticipants.add(participant.characterId);
        return invalid;
      })) violations.push(issue('fact.battle-personal-force', `${fact.id}的人物部曲快照无效`, fact.id));
    }
  }
  return violations;
}
