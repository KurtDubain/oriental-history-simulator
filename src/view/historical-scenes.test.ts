import { describe, expect, it } from 'vitest';
import {
  advanceWorld,
  advanceWorldBy,
  computeWorldHash,
  createWorld,
  projectCharacterEmbodiedActions,
} from '../sim';
import {
  projectHistoricalScenes,
  projectSituationHistoricalScenes,
} from './historical-scenes';

describe('NAR01/NAR02 concrete historical scenes', () => {
  it('joins support, request, court response and direct consequences into one traceable scene', () => {
    let world = createWorld('军权春秋');
    let resolution = world.facts.find((fact) => fact.kind === 'agency_intent_resolved');
    for (let turn = 0; turn < 80 && !resolution; turn += 1) {
      world = advanceWorld(world);
      resolution = world.facts.find((fact) => fact.kind === 'agency_intent_resolved');
    }
    if (!resolution || resolution.kind !== 'agency_intent_resolved') throw new Error('expected a natural command resolution');
    const actor = world.characters.find((item) => item.id === resolution.payload.actorId);
    const army = world.armies.find((item) => item.id === resolution.payload.targetArmyId);
    const scene = projectHistoricalScenes(world, [resolution], 1)[0];
    expect(scene).toBeTruthy();
    expect(scene.shortText).toContain(actor?.name);
    expect(scene.shortText).toContain(army?.name);
    expect(scene.shortText).toMatch(/朝廷|军令/u);
    expect(scene.shortText).not.toMatch(/起源|进入发展|阶段转折|结构信号/u);
    expect(scene.sourceFactIds).toContain(resolution.id);
    expect(scene.sourceFactIds).toContain(resolution.payload.submissionFactId);
    const submission = world.facts.find((fact) => fact.id === resolution.payload.submissionFactId);
    expect(submission?.sourceFactIds.some((id) => scene.sourceFactIds.includes(id))).toBe(true);
  }, 30_000);

  it('joins a battle and same-quarter territorial transfer without reading Chronicle prose', () => {
    const world = advanceWorldBy(createWorld('具体战事场面'), 8);
    const battle = [...world.facts].reverse().find((fact) => fact.kind === 'battle');
    if (!battle || battle.kind !== 'battle') throw new Error('expected a natural battle');
    const related = world.facts.filter((fact) => (
      fact.turn === battle.turn
      && (
        fact.id === battle.id
        || (fact.kind === 'territory_control_changed' && fact.payload.warId === battle.payload.warId)
      )
    ));
    const withChronicle = projectHistoricalScenes(world, related, 1)[0];
    const withoutChronicle = projectHistoricalScenes({ ...world, history: [] }, related, 1)[0];
    expect(withChronicle.title).toContain('之战');
    expect(withChronicle.summary).toMatch(/取胜|守住/u);
    expect(withChronicle.shortText).toBe(withoutChronicle.shortText);
    expect(withoutChronicle.historyEventIds).toEqual([]);
  });

  it('makes the latest concrete scene the readable face of a Situation', () => {
    const world = advanceWorldBy(createWorld('局势具体场面'), 8);
    const situation = world.situationSystem.situations.find((item) => item.type === 'war_progress');
    if (!situation) throw new Error('expected a war Situation');
    const scenes = projectSituationHistoricalScenes(world, situation, 3);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.length).toBeLessThanOrEqual(3);
    expect(scenes[0].shortText).toMatch(/[㐀-鿿]+之战.*(取胜|守住)/u);
    expect(scenes[0].sourceFactIds.length).toBeGreaterThan(0);
  });

  it('shows the governor, place, measure, actual cost and local result instead of an action wrapper', () => {
    const initial = createWorld('地方施政场面');
    const actor = initial.characters.find((item) => item.alive && item.governedRegionId);
    const region = initial.regions.find((item) => item.id === actor?.governedRegionId);
    const polity = initial.polities.find((item) => item.id === actor?.polityId);
    if (!actor || !region || !polity) throw new Error('expected a local governor');
    actor.age = 35;
    actor.health = 100;
    actor.governance = 96;
    actor.loyalty = 90;
    region.unrest = 86;
    region.devastation = 38;
    region.food = Math.max(region.food, region.population * 2);
    polity.authority = 90;
    polity.administration = 92;
    polity.treasury = Math.max(polity.treasury, region.population);
    initial.hash = computeWorldHash(initial);
    const option = projectCharacterEmbodiedActions(initial, actor.id).find((item) => (
      item.command.kind === 'reduce_levy' && item.available
    ));
    if (!option) throw new Error('expected a tax relief action');
    const world = advanceWorld(initial, { embodiedAction: option.command });
    const fact = world.facts.find((item) => (
      item.turn === initial.turn
      && item.kind === 'local_governance_resolved'
      && item.payload.actorId === actor.id
    ));
    if (fact?.kind !== 'local_governance_resolved') throw new Error('expected local result fact');
    const scene = projectHistoricalScenes(world, [fact], 1)[0];
    expect(scene.shortText).toContain(actor.name);
    expect(scene.shortText).toContain(region.name);
    expect(scene.shortText).toContain('减免本季赋');
    expect(scene.shortText).toContain(new Intl.NumberFormat('zh-CN').format(fact.payload.treasurySpent));
    expect(scene.shortText).toMatch(/动荡由\d+降至\d+/u);
    expect(scene.shortText).not.toMatch(/人物行动|行动结果|阶段转折|结构信号/u);
  });
});
