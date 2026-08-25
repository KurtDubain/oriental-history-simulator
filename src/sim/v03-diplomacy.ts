import { stableCompare } from './random';
import type {
  DiplomacyState,
  EvidenceRef,
  PolityState,
  ShipmentRecord,
  WorldState,
} from './types';
import type { V03Emit, V03TurnContext } from './v03-context';

const TRADE_TREATY_QUARTERS = 16;
const MIN_TRIBUTE_QUARTERS = 8;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function whole(value: number): number {
  return Math.max(0, Math.round(value));
}

function polityRef(polity: PolityState, field?: string, label = polity.name): EvidenceRef {
  return { kind: 'entity', entityType: 'polity', entityId: polity.id, ...(field ? { field } : {}), label };
}

function shipmentRef(shipment: ShipmentRecord): EvidenceRef {
  return { kind: 'shipment', entityType: 'shipment', entityId: shipment.id, label: '实际交付记录' };
}

function relationParties(world: WorldState, relation: DiplomacyState): [PolityState, PolityState] | null {
  const left = world.polities.find((polity) => polity.id === relation.polityAId);
  const right = world.polities.find((polity) => polity.id === relation.polityBId);
  return left && right ? [left, right] : null;
}

function bilateralTrade(
  world: WorldState,
  context: V03TurnContext,
  leftId: string,
  rightId: string,
): { value: number; shipments: ShipmentRecord[] } {
  const regionController = new Map(world.regions.map((region) => [region.id, region.controllerId]));
  const shipments = context.trade.shipments.filter((shipment) => {
    if (shipment.kind !== '贸易' || shipment.deliveredAmount <= 0) return false;
    const origin = regionController.get(shipment.originRegionId);
    const destination = regionController.get(shipment.destinationRegionId);
    return (origin === leftId && destination === rightId) || (origin === rightId && destination === leftId);
  });
  return {
    value: shipments.reduce((sum, shipment) => sum + shipment.value, 0),
    shipments: shipments.sort((left, right) => right.value - left.value || stableCompare(left.id, right.id)),
  };
}

/**
 * A deliberately coarse comparison of mobilisable power. It is not a hidden
 * combat rating: institutions, controlled tax base and fielded forces are all
 * visible causes, so tribute can end when the underlying imbalance ends.
 */
export function v03DiplomaticPower(world: WorldState, polityId: string): number {
  const polity = world.polities.find((candidate) => candidate.id === polityId);
  if (!polity?.alive) return 0;
  const regions = world.regions.filter((region) => region.controllerId === polityId);
  const civil = regions.reduce((sum, region) => (
    sum
    + region.population / 8_000
    + region.wealth / 3_000
    + region.strategicValue * 0.45
    + region.defense * 0.18
  ), 0);
  const armies = world.armies
    .filter((army) => army.polityId === polityId)
    .reduce((sum, army) => sum + army.soldiers / 650 * (0.45 + army.morale / 200 + army.training / 250), 0);
  const fleets = world.fleets
    .filter((fleet) => fleet.polityId === polityId)
    .reduce((sum, fleet) => sum + (
      fleet.sailors / 800 + fleet.warships * 1.8 + fleet.transports * 0.35 + fleet.patrolShips * 0.6
    ) * (0.5 + fleet.readiness / 180), 0);
  const institutions = polity.authority * 0.48 + polity.administration * 0.38 + polity.legitimacy * 0.22;
  return Math.max(1, civil + armies + fleets + institutions);
}

function fiscalPressure(world: WorldState, polity: PolityState): number {
  const regions = world.regions.filter((region) => region.controllerId === polity.id);
  const forces = world.armies
    .filter((army) => army.polityId === polity.id)
    .reduce((sum, army) => sum + army.soldiers, 0)
    + world.fleets.filter((fleet) => fleet.polityId === polity.id).reduce((sum, fleet) => sum + fleet.sailors, 0);
  const liquidityTarget = Math.max(1, regions.length) * 4_000 + forces * 0.8;
  const liquidityShortfall = clamp((liquidityTarget - polity.treasury) / liquidityTarget * 100);
  const unrest = regions.length === 0 ? 100 : regions.reduce((sum, region) => sum + region.unrest, 0) / regions.length;
  return clamp(liquidityShortfall * 0.46 + polity.warWeariness * 0.38 + unrest * 0.16);
}

function threatFrom(relation: DiplomacyState, polityId: string): number {
  return polityId === relation.polityAId ? relation.threatAtoB : relation.threatBtoA;
}

function rememberTreaty(relation: DiplomacyState, eventId: string): void {
  relation.treatyEventIds.push(eventId);
  if (relation.treatyEventIds.length > 12) relation.treatyEventIds.shift();
}

function cancelTradeForWar(
  world: WorldState,
  relation: DiplomacyState,
  left: PolityState,
  right: PolityState,
  emit: V03Emit,
): void {
  if (relation.tradeAgreementUntilTurn === null || relation.status !== '战争') return;
  const war = world.wars.find((candidate) => candidate.active && (
    (candidate.attackerId === left.id && candidate.defenderId === right.id)
    || (candidate.attackerId === right.id && candidate.defenderId === left.id)
  ));
  const breaker = world.polities.find((polity) => polity.id === war?.attackerId) ?? left;
  const victim = breaker.id === left.id ? right : left;
  const oldExpiry = relation.tradeAgreementUntilTurn;
  const beforeReputation = breaker.diplomaticReputation;
  const beforeTrust = relation.trust;
  relation.tradeAgreementUntilTurn = null;
  relation.trust = whole(clamp(relation.trust - 14));
  relation.grievance = whole(clamp(relation.grievance + 12));
  breaker.diplomaticReputation = whole(clamp(breaker.diplomaticReputation - 8));
  const event = emit({
    category: '外交',
    kind: 'trade_treaty_breached',
    title: `${breaker.name}以战事撕毁商约`,
    summary: `${breaker.name}主动向${victim.name}开战，尚未到期的通商承诺随之失效；背约损害了其外交信誉。`,
    importance: 4,
    actorIds: [breaker.rulerId, victim.rulerId],
    polityIds: [breaker.id, victim.id],
    causes: [
      {
        label: '有效商约', role: '结构', weight: 0.28,
        evidence: `原商约约定持续至第${oldExpiry}回合`,
        refs: [polityRef(left, undefined, '缔约方'), polityRef(right, undefined, '缔约方')],
      },
      {
        label: '主动战争', role: '触发', weight: 0.42,
        evidence: war ? `${breaker.name}发动${war.id}` : `${relation.id}已进入战争状态`,
        refs: war
          ? [{ kind: 'entity', entityType: 'war', entityId: war.id, label: '实际战争' }]
          : [polityRef(breaker, undefined, '开战方')],
      },
      {
        label: '背约后果', role: '结果', weight: 0.3,
        evidence: `信任${beforeTrust}→${relation.trust}，${breaker.name}信誉${beforeReputation}→${breaker.diplomaticReputation}`,
        refs: [polityRef(breaker, 'diplomaticReputation', '背约方信誉')],
      },
    ],
    stateDeltas: [
      { entityType: 'diplomacy', entityId: relation.id, field: 'tradeAgreementUntilTurn', before: oldExpiry, after: null },
      { entityType: 'diplomacy', entityId: relation.id, field: 'trust', before: beforeTrust, after: relation.trust, delta: relation.trust - beforeTrust },
      { entityType: 'polity', entityId: breaker.id, field: 'diplomaticReputation', before: beforeReputation, after: breaker.diplomaticReputation, delta: breaker.diplomaticReputation - beforeReputation },
    ],
  });
  rememberTreaty(relation, event.id);
}

function settleTribute(
  world: WorldState,
  context: V03TurnContext,
  relation: DiplomacyState,
  left: PolityState,
  right: PolityState,
  emit: V03Emit,
): void {
  if (relation.status === '战争' && relation.tributePayerId !== null) {
    const payer = relation.tributePayerId === left.id ? left : relation.tributePayerId === right.id ? right : null;
    const receiver = payer?.id === left.id ? right : left;
    const formerPayerId = relation.tributePayerId;
    const formerDue = relation.tributePerTurn;
    relation.tributePayerId = null;
    relation.tributePerTurn = 0;
    relation.lastChangedTurn = context.turn;
    const event = emit({
      category: '外交',
      kind: 'tribute_ended_by_war',
      title: payer ? `${payer.name}与${receiver.name}以战争终结朝贡` : `${left.name}与${right.name}的朝贡因战争终结`,
      summary: `双方已进入战争状态，原每季${formerDue}的和平输纳义务失去制度基础；本季没有凭空支付贡金。`,
      importance: 4,
      actorIds: [left.rulerId, right.rulerId],
      polityIds: [left.id, right.id],
      causes: [
        {
          label: '既有朝贡', role: '结构', weight: 0.3,
          evidence: `原纳贡方${payer?.name ?? formerPayerId}，每季义务${formerDue}`,
          refs: [polityRef(payer ?? left, undefined, '原纳贡方'), polityRef(receiver, undefined, '原受贡方')],
        },
        {
          label: '战争触发', role: '触发', weight: 0.42,
          evidence: `${relation.id}已从和平等级关系转为战争`,
          refs: [polityRef(left, undefined, '交战方'), polityRef(right, undefined, '交战方')],
        },
        {
          label: '义务清理', role: '结果', weight: 0.28,
          evidence: `纳贡方${formerPayerId}→无，每季${formerDue}→0`,
          refs: [polityRef(left), polityRef(right)],
        },
      ],
      stateDeltas: [
        { entityType: 'diplomacy', entityId: relation.id, field: 'tributePayerId', before: formerPayerId, after: null },
        { entityType: 'diplomacy', entityId: relation.id, field: 'tributePerTurn', before: formerDue, after: 0, delta: -formerDue },
      ],
    });
    rememberTreaty(relation, event.id);
    return;
  }
  if (relation.status !== '朝贡' || relation.tributePayerId === null) return;
  const payer = relation.tributePayerId === left.id ? left : relation.tributePayerId === right.id ? right : null;
  const receiver = payer?.id === left.id ? right : left;
  if (!payer?.alive || !receiver.alive) {
    relation.status = '中立';
    relation.tributePayerId = null;
    relation.tributePerTurn = 0;
    relation.lastChangedTurn = context.turn;
    return;
  }

  const payerPower = v03DiplomaticPower(world, payer.id);
  const receiverPower = v03DiplomaticPower(world, receiver.id);
  const ratio = receiverPower / Math.max(1, payerPower);
  const imposedFor = context.turn - relation.lastChangedTurn;
  if (imposedFor >= MIN_TRIBUTE_QUARTERS && ratio < 1.42 && threatFrom(relation, receiver.id) < 58) {
    const oldStatus = relation.status;
    relation.status = '中立';
    relation.tributePayerId = null;
    relation.tributePerTurn = 0;
    relation.lastChangedTurn = context.turn;
    const event = emit({
      category: '外交',
      kind: 'tribute_ended',
      title: `${payer.name}结束对${receiver.name}的朝贡`,
      summary: `双方实力差已缩小，${receiver.name}也已无法维持足够威慑，朝贡关系因其结构基础消失而解除。`,
      importance: 3,
      actorIds: [payer.rulerId, receiver.rulerId],
      polityIds: [payer.id, receiver.id],
      causes: [
        { label: '实力回归', role: '结构', weight: 0.45, evidence: `受贡方/纳贡方实力比仅${ratio.toFixed(2)}`, refs: [polityRef(payer), polityRef(receiver)] },
        { label: '威慑消退', role: '条件', weight: 0.3, evidence: `受贡方威胁${threatFrom(relation, receiver.id)}，低于维系线58`, refs: [polityRef(receiver)] },
        { label: '关系解除', role: '结果', weight: 0.25, evidence: `${oldStatus}→中立`, refs: [polityRef(payer), polityRef(receiver)] },
      ],
      stateDeltas: [{ entityType: 'diplomacy', entityId: relation.id, field: 'status', before: oldStatus, after: '中立' }],
    });
    rememberTreaty(relation, event.id);
    return;
  }

  // The establishing quarter records the obligation but does not charge it twice.
  if (context.turn <= relation.lastChangedTurn) return;
  const due = whole(relation.tributePerTurn);
  const paid = Math.min(due, whole(payer.treasury));
  const payerBefore = payer.treasury;
  const receiverBefore = receiver.treasury;
  payer.treasury -= paid;
  receiver.treasury += paid;
  if (paid === due) {
    const reputationBefore = payer.diplomaticReputation;
    const trustBefore = relation.trust;
    relation.trust = whole(clamp(relation.trust + 1));
    if (context.season === '冬') payer.diplomaticReputation = whole(clamp(payer.diplomaticReputation + 1));
    emit({
      category: '外交',
      kind: 'tribute_paid',
      title: `${payer.name}如期输纳贡金`,
      summary: `${payer.name}从国库实付${paid}，${receiver.name}国库实收${paid}；转移总额守恒。`,
      importance: context.season === '冬' ? 2 : 1,
      actorIds: [payer.rulerId, receiver.rulerId],
      polityIds: [payer.id, receiver.id],
      causes: [
        { label: '朝贡义务', role: '结构', weight: 0.34, evidence: `本季应付${due}`, refs: [polityRef(payer, 'treasury', '纳贡方国库')] },
        { label: '足额履约', role: '选择', weight: 0.33, evidence: `可用国库${payerBefore}，实付${paid}`, refs: [polityRef(payer, 'diplomaticReputation', '履约方信誉')] },
        { label: '守恒转移', role: '结果', weight: 0.33, evidence: `${payer.name}-${paid}，${receiver.name}+${paid}`, refs: [polityRef(payer, 'treasury'), polityRef(receiver, 'treasury')] },
      ],
      stateDeltas: [
        { entityType: 'polity', entityId: payer.id, field: 'treasury', before: payerBefore, after: payer.treasury, delta: -paid },
        { entityType: 'polity', entityId: receiver.id, field: 'treasury', before: receiverBefore, after: receiver.treasury, delta: paid },
        { entityType: 'diplomacy', entityId: relation.id, field: 'trust', before: trustBefore, after: relation.trust, delta: relation.trust - trustBefore },
        { entityType: 'polity', entityId: payer.id, field: 'diplomaticReputation', before: reputationBefore, after: payer.diplomaticReputation, delta: payer.diplomaticReputation - reputationBefore },
      ],
    });
    return;
  }

  const reputationBefore = payer.diplomaticReputation;
  const trustBefore = relation.trust;
  const oldStatus = relation.status;
  payer.diplomaticReputation = whole(clamp(payer.diplomaticReputation - 10));
  relation.trust = whole(clamp(relation.trust - 16));
  relation.grievance = whole(clamp(relation.grievance + 14));
  relation.status = '中立';
  relation.tributePayerId = null;
  relation.tributePerTurn = 0;
  relation.lastChangedTurn = context.turn;
  const event = emit({
    category: '外交',
    kind: 'tribute_breached',
    title: `${payer.name}无力足额纳贡`,
    summary: `${payer.name}应付${due}而仅实付${paid}，朝贡关系破裂；已经支付的部分仍真实进入${receiver.name}国库。`,
    importance: 4,
    actorIds: [payer.rulerId, receiver.rulerId],
    polityIds: [payer.id, receiver.id],
    causes: [
      { label: '财政缺口', role: '结构', weight: 0.42, evidence: `期初国库${payerBefore}，低于应付${due}`, refs: [polityRef(payer, 'treasury', '纳贡方国库')] },
      { label: '未足额履约', role: '触发', weight: 0.31, evidence: `欠付${due - paid}`, refs: [polityRef(payer, 'diplomaticReputation', '背约方信誉')] },
      { label: '背约后果', role: '结果', weight: 0.27, evidence: `关系${oldStatus}→中立，信誉${reputationBefore}→${payer.diplomaticReputation}`, refs: [polityRef(payer), polityRef(receiver)] },
    ],
    stateDeltas: [
      { entityType: 'polity', entityId: payer.id, field: 'treasury', before: payerBefore, after: payer.treasury, delta: -paid },
      { entityType: 'polity', entityId: receiver.id, field: 'treasury', before: receiverBefore, after: receiver.treasury, delta: paid },
      { entityType: 'diplomacy', entityId: relation.id, field: 'status', before: oldStatus, after: '中立' },
      { entityType: 'diplomacy', entityId: relation.id, field: 'trust', before: trustBefore, after: relation.trust, delta: relation.trust - trustBefore },
      { entityType: 'polity', entityId: payer.id, field: 'diplomaticReputation', before: reputationBefore, after: payer.diplomaticReputation, delta: payer.diplomaticReputation - reputationBefore },
    ],
  });
  rememberTreaty(relation, event.id);
}

function processTradeTreaties(
  world: WorldState,
  context: V03TurnContext,
  emit: V03Emit,
  actualByRelation: Map<string, ReturnType<typeof bilateralTrade>>,
): void {
  const candidates: Array<{
    relation: DiplomacyState;
    left: PolityState;
    right: PolityState;
    trade: ReturnType<typeof bilateralTrade>;
    score: number;
  }> = [];
  for (const relation of [...world.diplomacy].sort((left, right) => stableCompare(left.id, right.id))) {
    const parties = relationParties(world, relation);
    if (!parties || !parties[0].alive || !parties[1].alive) continue;
    const [left, right] = parties;
    const trade = actualByRelation.get(relation.id) ?? { value: 0, shipments: [] };
    cancelTradeForWar(world, relation, left, right, emit);
    if (relation.tradeAgreementUntilTurn !== null && relation.status !== '战争') {
      if (context.turn >= relation.tradeAgreementUntilTurn) {
        const oldExpiry = relation.tradeAgreementUntilTurn;
        const renew = trade.value > 0 && relation.tradeDependency >= 28 && relation.trust >= 50 && relation.grievance <= 38;
        relation.tradeAgreementUntilTurn = renew ? context.turn + TRADE_TREATY_QUARTERS : null;
        relation.lastChangedTurn = context.turn;
        const event = emit({
          category: '外交',
          kind: renew ? 'trade_treaty_renewed' : 'trade_treaty_expired',
          title: renew ? `${left.name}与${right.name}续订商约` : `${left.name}与${right.name}商约期满`,
          summary: renew
            ? `本季仍有${trade.value}货值真实交付，双方将通商安排续期四年。`
            : '约期结束时缺少足够的实际贸易依赖或信任，双方没有自动续约。',
          importance: renew ? 3 : 2,
          actorIds: [left.rulerId, right.rulerId],
          polityIds: [left.id, right.id],
          causes: [
            { label: '期限到达', role: '触发', weight: 0.3, evidence: `原到期回合${oldExpiry}`, refs: [polityRef(left), polityRef(right)] },
            {
              label: '实际往来', role: '条件', weight: 0.38,
              evidence: `本季交付货值${trade.value}，贸易依赖${relation.tradeDependency}`,
              refs: trade.shipments.length > 0 ? trade.shipments.slice(0, 3).map(shipmentRef) : [polityRef(left), polityRef(right)],
            },
            { label: renew ? '续约结果' : '到期结果', role: '结果', weight: 0.32, evidence: renew ? `新期限至${relation.tradeAgreementUntilTurn}` : '通商约束解除', refs: [polityRef(left), polityRef(right)] },
          ],
          stateDeltas: [{ entityType: 'diplomacy', entityId: relation.id, field: 'tradeAgreementUntilTurn', before: oldExpiry, after: relation.tradeAgreementUntilTurn }],
        });
        rememberTreaty(relation, event.id);
      } else if (trade.value > 0) {
        relation.trust = whole(clamp(relation.trust + Math.min(2, trade.value / 30_000)));
        if (context.season === '冬') {
          left.diplomaticReputation = whole(clamp(left.diplomaticReputation + 1));
          right.diplomaticReputation = whole(clamp(right.diplomaticReputation + 1));
        }
      }
      continue;
    }
    if ((relation.status === '中立' || relation.status === '联盟')
      && trade.value > 0
      && relation.tradeDependency >= 24
      && relation.trust >= 50
      && relation.grievance <= 35) {
      candidates.push({ relation, left, right, trade, score: relation.tradeDependency + relation.trust + Math.min(100, trade.value / 1_000) });
    }
  }

  const committed = new Set<string>();
  for (const candidate of candidates.sort((left, right) => right.score - left.score || stableCompare(left.relation.id, right.relation.id))) {
    const { relation, left, right, trade } = candidate;
    if (committed.has(left.id) || committed.has(right.id)) continue;
    const before = relation.tradeAgreementUntilTurn;
    relation.tradeAgreementUntilTurn = context.turn + TRADE_TREATY_QUARTERS;
    relation.lastChangedTurn = context.turn;
    const event = emit({
      category: '外交',
      kind: 'trade_treaty_formed',
      title: `${left.name}与${right.name}缔结通商约`,
      summary: `${trade.value}货值的真实跨境交付与既有信任，使双方将事实商路固定为四年通商安排。`,
      importance: 3,
      actorIds: [left.rulerId, right.rulerId],
      polityIds: [left.id, right.id],
      causes: [
        { label: '真实贸易', role: '结构', weight: 0.4, evidence: `${trade.shipments.length}笔交付、货值${trade.value}`, refs: trade.shipments.slice(0, 3).map(shipmentRef) },
        { label: '互信条件', role: '条件', weight: 0.3, evidence: `信任${relation.trust}、积怨${relation.grievance}`, refs: [polityRef(left), polityRef(right)] },
        { label: '制度化结果', role: '结果', weight: 0.3, evidence: `商约持续至第${relation.tradeAgreementUntilTurn}回合`, refs: [polityRef(left), polityRef(right)] },
      ],
      stateDeltas: [{ entityType: 'diplomacy', entityId: relation.id, field: 'tradeAgreementUntilTurn', before, after: relation.tradeAgreementUntilTurn }],
    });
    rememberTreaty(relation, event.id);
    committed.add(left.id);
    committed.add(right.id);
  }
}

function formTribute(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  if (context.season !== '冬') return;
  const alreadyPaying = new Set(world.diplomacy.map((relation) => relation.tributePayerId).filter((id): id is string => Boolean(id)));
  const candidates = world.diplomacy
    .filter((relation) => relation.status === '中立' && relation.tributePayerId === null)
    .map((relation) => {
      const parties = relationParties(world, relation);
      if (!parties || !parties[0].alive || !parties[1].alive) return null;
      const [left, right] = parties;
      const leftPower = v03DiplomaticPower(world, left.id);
      const rightPower = v03DiplomaticPower(world, right.id);
      const receiver = leftPower >= rightPower ? left : right;
      const payer = receiver.id === left.id ? right : left;
      const ratio = Math.max(leftPower, rightPower) / Math.max(1, Math.min(leftPower, rightPower));
      const pressure = fiscalPressure(world, payer);
      const threat = threatFrom(relation, receiver.id);
      return { relation, receiver, payer, ratio, pressure, threat, score: ratio * 35 + pressure + threat * 0.4 };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .filter((candidate) => (
      !alreadyPaying.has(candidate.payer.id)
      && candidate.ratio >= 2.15
      && candidate.threat >= 68
      && candidate.pressure >= 48
    ))
    .sort((left, right) => right.score - left.score || stableCompare(left.relation.id, right.relation.id));
  const chosen = candidates[0];
  if (!chosen) return;
  const { relation, receiver, payer, ratio, pressure, threat } = chosen;
  const payerRegions = world.regions.filter((region) => region.controllerId === payer.id);
  const taxBase = payerRegions.reduce((sum, region) => sum + region.wealth, 0);
  const due = whole(clamp(80 + taxBase * 0.0008 + payer.treasury * 0.006, 80, 5_000));
  const oldStatus = relation.status;
  relation.status = '朝贡';
  relation.tributePayerId = payer.id;
  relation.tributePerTurn = due;
  relation.lastChangedTurn = context.turn;
  const event = emit({
    category: '外交',
    kind: 'tribute_imposed',
    title: `${payer.name}向${receiver.name}接受朝贡安排`,
    summary: `实力悬殊、军事威胁与${payer.name}的财政压力共同迫使其承诺每季输纳${due}；贡金尚未凭空支付。`,
    importance: 4,
    actorIds: [payer.rulerId, receiver.rulerId],
    polityIds: [payer.id, receiver.id],
    causes: [
      { label: '实力悬殊', role: '结构', weight: 0.34, evidence: `受贡方/纳贡方实力比${ratio.toFixed(2)}`, refs: [polityRef(payer), polityRef(receiver)] },
      { label: '威胁压力', role: '条件', weight: 0.25, evidence: `受贡方威胁指数${threat}`, refs: [polityRef(receiver)] },
      { label: '财政压力', role: '条件', weight: 0.21, evidence: `纳贡方压力指数${pressure.toFixed(0)}`, refs: [polityRef(payer, 'treasury', '纳贡方国库')] },
      { label: '朝贡义务', role: '结果', weight: 0.2, evidence: `每季应付${due}，从下一季开始实结`, refs: [polityRef(payer), polityRef(receiver)] },
    ],
    stateDeltas: [
      { entityType: 'diplomacy', entityId: relation.id, field: 'status', before: oldStatus, after: '朝贡' },
      { entityType: 'diplomacy', entityId: relation.id, field: 'tributePerTurn', before: 0, after: due, delta: due },
    ],
  });
  rememberTreaty(relation, event.id);
}

/**
 * V0.3's material diplomacy layer. Call after market settlement (so agreements
 * see delivered shipments) and after V0.2 war/status maintenance.
 */
export function processV03Diplomacy(world: WorldState, context: V03TurnContext, emit: V03Emit): void {
  const actualByRelation = new Map<string, ReturnType<typeof bilateralTrade>>();
  for (const relation of world.diplomacy) {
    relation.tradeAgreementUntilTurn ??= null;
    relation.tributePayerId ??= null;
    relation.tributePerTurn ??= 0;
    relation.treatyEventIds ??= [];
    if (relation.treatyEventIds.length > 12) relation.treatyEventIds = relation.treatyEventIds.slice(-12);
    actualByRelation.set(
      relation.id,
      bilateralTrade(world, context, relation.polityAId, relation.polityBId),
    );
  }

  processTradeTreaties(world, context, emit, actualByRelation);
  for (const relation of [...world.diplomacy].sort((left, right) => stableCompare(left.id, right.id))) {
    const parties = relationParties(world, relation);
    if (parties) settleTribute(world, context, relation, parties[0], parties[1], emit);
  }
  formTribute(world, context, emit);
}
