import { describe, expect, it } from 'vitest';
import { emitSimulationFact, type FactTurnBuffer } from '../facts';
import { advanceWorldBy, createWorld, serializeWorld } from '../index';
import { changeFactionRelation } from './faction-lifecycle';
import {
  calculateCharacterPowerPosition,
  calculateFactionPowerLedger,
  recentFactionPowerMovements,
  refreshFactionPowerLedgers,
} from './power-ledger';

function factContext(world: ReturnType<typeof createWorld>): FactTurnBuffer {
  return {
    turn: world.turn,
    year: world.year,
    season: world.season,
    facts: [],
  };
}

describe('POL01 political power ledger', () => {
  it('derives every faction total from concrete bounded assets without reading the old total', () => {
    const world = advanceWorldBy(createWorld('权势资源账'), 8);
    const before = serializeWorld(world);
    const active = world.factions.filter((faction) => faction.active);
    expect(active.length).toBeGreaterThan(0);

    for (const faction of active) {
      const ledger = calculateFactionPowerLedger(world, faction);
      expect(ledger.total).toBe(faction.power);
      expect(ledger.total).toBeGreaterThanOrEqual(0);
      expect(ledger.total).toBeLessThanOrEqual(100);
      expect(ledger.categories.map((category) => category.category)).toEqual([
        'central_office',
        'regional_office',
        'military_command',
        'family_backing',
        'member_renown',
        'alliance_support',
        'cohesion',
      ]);
      expect(ledger.resources.length).toBeLessThanOrEqual(48);
      expect(ledger.resources.every((resource) => resource.evidence.length > 0)).toBe(true);
      expect(ledger.resources.some((resource) => resource.evidence.some((ref) => ref.field === 'power'))).toBe(false);
      for (const category of ledger.categories) {
        expect(category.value).toBeLessThanOrEqual(category.maximum + 0.1);
      }
    }
    expect(serializeWorld(world)).toBe(before);
  });

  it('shows a person only the offices, commands, family standing and explicit support they actually possess', () => {
    const world = advanceWorldBy(createWorld('人物权势落点'), 12);
    const person = world.characters.find((character) => (
      character.alive
      && world.offices.some((office) => office.active && office.holderId === character.id)
    ));
    if (!person) throw new Error('expected a living office holder');
    const position = calculateCharacterPowerPosition(world, person.id);
    expect(position.total).toBeGreaterThan(0);
    expect(position.resources.length).toBeLessThanOrEqual(8);
    expect(position.resources.every((resource) => resource.characterIds.includes(person.id))).toBe(true);
    expect(position.resources.some((resource) => (
      resource.evidence.some((ref) => ref.entityType === 'office')
      || resource.evidence.some((ref) => ref.entityType === 'family')
    ))).toBe(true);
  });

  it('counts one secured support Fact exactly once and lets it expire after sixteen quarters', () => {
    const world = createWorld('POL06-支持资源时效');
    const faction = world.factions.find((item) => item.active && item.memberIds.length > 0);
    if (!faction) throw new Error('expected an active faction');
    const actor = world.characters.find((item) => item.id === faction.memberIds[0]);
    const target = world.characters.find((item) => (
      item.alive && item.polityId === faction.polityId && item.id !== actor?.id
    ));
    const army = world.armies.find((item) => item.polityId === faction.polityId);
    if (!actor || !target || !army) throw new Error('expected support participants and an army');

    const fact = emitSimulationFact(world, factContext(world), {
      kind: 'agency_support_resolved',
      category: '政治',
      importance: 2,
      actorIds: [actor.id, target.id],
      polityIds: [faction.polityId],
      regionIds: [actor.locationRegionId],
      causes: [{ label: '明确背书', role: '结果', weight: 1, evidence: `${target.name}答应支持${actor.name}` }],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        actorId: actor.id,
        goalId: 'goal_pol06_support',
        planId: 'plan_pol06_support',
        planStepId: 'plan_pol06_support:step:seek_patronage',
        action: 'request_backing',
        attemptOrdinal: 1,
        targetKind: 'ruler',
        targetId: target.id,
        targetArmyId: army.id,
        targetArmyName: army.name,
        polityId: faction.polityId,
        outcome: 'secured',
        strength: 64,
        retryAfterTurn: null,
      },
    });
    if (fact.kind !== 'agency_support_resolved') throw new Error('expected support fixture Fact');
    const duplicate = emitSimulationFact(world, factContext(world), {
      kind: 'agency_support_resolved',
      category: '政治',
      importance: 2,
      actorIds: [actor.id, target.id],
      polityIds: [faction.polityId],
      regionIds: [actor.locationRegionId],
      causes: [{ label: '重复背书', role: '结果', weight: 1, evidence: `${target.name}再次确认支持${actor.name}` }],
      stateDeltas: [],
      sourceFactIds: [fact.id],
      payload: { ...fact.payload, attemptOrdinal: 2, strength: 80 },
    });
    const staleSupportId = `support:${fact.id}`;
    const supportId = `support:${duplicate.id}`;

    const current = calculateFactionPowerLedger(world, faction);
    expect(current.resources.filter((resource) => resource.id === supportId)).toHaveLength(1);
    expect(current.resources.some((resource) => resource.id === staleSupportId)).toBe(false);
    expect(current.resources.find((resource) => resource.id === supportId)).toMatchObject({
      category: 'alliance_support',
      evidence: [{ entityType: 'fact', entityId: duplicate.id, field: 'outcome' }],
    });

    const actorPosition = calculateCharacterPowerPosition(world, actor.id);
    expect(actorPosition.resources.map((resource) => resource.id)).toHaveLength(
      new Set(actorPosition.resources.map((resource) => resource.id)).size,
    );
    expect(actorPosition.resources.filter((resource) => resource.id === supportId)).toHaveLength(1);
    expect(calculateCharacterPowerPosition(world, target.id).resources).not.toContainEqual(
      expect.objectContaining({ id: supportId }),
    );

    target.alive = false;
    expect(calculateFactionPowerLedger(world, faction).resources.some((resource) => resource.id === supportId)).toBe(false);
    target.alive = true;
    const originalTargetPolityId = target.polityId;
    target.polityId = world.polities.find((item) => item.id !== faction.polityId)?.id ?? target.polityId;
    expect(calculateFactionPowerLedger(world, faction).resources.some((resource) => resource.id === supportId)).toBe(false);
    target.polityId = originalTargetPolityId;

    const militarySupport = emitSimulationFact(world, factContext(world), {
      kind: 'agency_support_resolved', category: '政治', importance: 2,
      actorIds: [actor.id], polityIds: [faction.polityId], regionIds: [army.regionId],
      causes: [{ label: '将校背书', role: '结果', weight: 1, evidence: `${army.name}将校支持${actor.name}` }],
      stateDeltas: [], sourceFactIds: [],
      payload: {
        ...fact.payload,
        goalId: 'goal_pol06_military_support',
        planId: 'plan_pol06_military_support',
        planStepId: 'plan_pol06_military_support:step',
        action: 'cultivate_military_support',
        targetKind: 'army_officers',
        targetId: actor.id,
        targetArmyId: army.id,
        targetArmyName: army.name,
      },
    });
    const militarySupportId = `support:${militarySupport.id}`;
    expect(calculateFactionPowerLedger(world, faction).resources.some((resource) => resource.id === militarySupportId)).toBe(true);
    const armyIndex = world.armies.findIndex((item) => item.id === army.id);
    world.armies.splice(armyIndex, 1);
    expect(calculateFactionPowerLedger(world, faction).resources.some((resource) => resource.id === militarySupportId)).toBe(false);
    world.armies.splice(armyIndex, 0, army);

    refreshFactionPowerLedgers(world, faction.polityId);
    const retained = advanceWorldBy(world, 16);
    const retainedFaction = retained.factions.find((item) => item.id === faction.id);
    if (!retainedFaction?.active) throw new Error('expected the supported faction to survive the retention window');
    const retainedLedger = calculateFactionPowerLedger(retained, retainedFaction);
    expect(retainedLedger.resources.filter((resource) => resource.id === supportId)).toHaveLength(1);
    expect(retainedFaction.power).toBe(retainedLedger.total);

    const advanced = advanceWorldBy(retained, 1);
    const advancedFaction = advanced.factions.find((item) => item.id === faction.id);
    if (!advancedFaction?.active) throw new Error('expected the supported faction to survive the expiry boundary');
    const expiredLedger = calculateFactionPowerLedger(advanced, advancedFaction);
    expect(expiredLedger.resources.some((resource) => resource.id === supportId)).toBe(false);
    expect(advancedFaction.power).toBe(expiredLedger.total);
  });

  it('projects a bilateral faction alliance into one uniquely identified resource per ledger', () => {
    const world = createWorld('POL06-联盟资源去重');
    const polity = world.polities.find((item) => (
      item.alive && world.factions.filter((faction) => faction.active && faction.polityId === item.id).length >= 2
    ));
    const [left, right] = world.factions
      .filter((faction) => faction.active && faction.polityId === polity?.id)
      .slice(0, 2);
    if (!polity || !left || !right) throw new Error('expected two factions in one polity');

    const relation = changeFactionRelation(
      world,
      factContext(world),
      left.id,
      right.id,
      'alliance',
      'formed',
      'pol06_test_alliance',
    );
    if (!relation) throw new Error('expected an alliance formation Fact');

    for (const [faction, ally] of [[left, right], [right, left]] as const) {
      const resources = calculateFactionPowerLedger(world, faction).resources;
      const ids = resources.map((resource) => resource.id);
      expect(ids).toHaveLength(new Set(ids).size);
      expect(resources.filter((resource) => resource.id === `alliance:${ally.id}`)).toHaveLength(1);
    }
  });

  it('projects broker formation and fall only onto the faction that actually gained or lost the position', () => {
    const world = createWorld('POL06-权臣双派动态归属');
    const polity = world.polities.find((item) => (
      item.alive && world.factions.filter((faction) => faction.active && faction.polityId === item.id).length >= 2
    ));
    const ruler = world.characters.find((item) => item.id === polity?.rulerId);
    const rulerFaction = world.factions.find((item) => item.id === ruler?.factionId);
    const brokerFaction = world.factions.find((item) => (
      item.active && item.polityId === polity?.id && item.id !== rulerFaction?.id
    ));
    const broker = world.characters.find((item) => item.id === brokerFaction?.leaderId);
    if (!polity || !ruler || !rulerFaction || !brokerFaction || !broker) throw new Error('expected two court factions');

    const formed = emitSimulationFact(world, factContext(world), {
      kind: 'court_action_resolved',
      category: '政治',
      importance: 3,
      actorIds: [broker.id, ruler.id],
      polityIds: [polity.id],
      regionIds: [],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        action: 'power_broker_formed', polityId: polity.id,
        actorFactionId: brokerFaction.id, targetFactionId: rulerFaction.id,
        initiatorId: broker.id, targetId: ruler.id,
        reasonCode: 'test_formed', score: 70, threshold: 66,
        rulerBeforeId: ruler.id, rulerAfterId: ruler.id,
        affectedFactionIds: [brokerFaction.id, rulerFaction.id], removedMemberIds: [],
      },
    });
    const fell = emitSimulationFact(world, factContext(world), {
      kind: 'court_action_resolved',
      category: '政治',
      importance: 3,
      actorIds: [ruler.id, broker.id],
      polityIds: [polity.id],
      regionIds: [],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [formed.id],
      payload: {
        action: 'power_broker_fell', polityId: polity.id,
        actorFactionId: rulerFaction.id, targetFactionId: brokerFaction.id,
        initiatorId: ruler.id, targetId: broker.id,
        reasonCode: 'test_fell', score: 20, threshold: 54,
        rulerBeforeId: ruler.id, rulerAfterId: ruler.id,
        affectedFactionIds: [brokerFaction.id, rulerFaction.id], removedMemberIds: [],
      },
    });

    const brokerMovements = recentFactionPowerMovements(world, brokerFaction, 10);
    expect(brokerMovements.find((item) => item.factId === formed.id)).toMatchObject({
      direction: 'gained', label: '领袖成为权力中枢',
    });
    expect(brokerMovements.find((item) => item.factId === fell.id)).toMatchObject({
      direction: 'lost', label: '退出权力中枢',
    });
    const rulerMovementFactIds = recentFactionPowerMovements(world, rulerFaction, 10)
      .map((item) => item.factId);
    expect(rulerMovementFactIds).not.toContain(formed.id);
    expect(rulerMovementFactIds).not.toContain(fell.id);
  });
});
