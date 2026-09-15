import { describe, expect, it } from 'vitest';

import { computeWorldHash, createWorld, serializeWorld } from '../sim';
import { toCausalEvent, toCausalFact } from './history-causal-adapter';
import { playerHistoryText } from './historical-scenes';

describe('history causal Fact boundary', () => {
  it('resolves names in detailed causes and state values without rewriting evidence', () => {
    const world = createWorld('详细依据名称', 'contest-v01'), place = world.regions[0];
    const event = { ...world.history[0], title: '某氏政权政权灭亡',
      summary: '患病，健康降低；具名人物是群体人口中的叙事标记，不重复扣减人口。',
      causes: [{ label: '迁驻', role: '结果' as const, weight: 1, evidence: `${place.id}失守`,
        refs: [{ kind: 'entity' as const, entityType: 'region' as const, entityId: place.id, label: place.id }] }],
      stateDeltas: [{ entityType: 'polity' as const, entityId: world.polities[0].id, field: 'capitalRegionId', before: place.id, after: 'r_unknown' }] };
    const before = serializeWorld(world), original = JSON.stringify(event), view = toCausalEvent(world,event);
    expect(view.title).toBe('某氏政权灭亡');
    expect(view.summary).toBe('患病，健康降低');
    expect(view.factors[0].evidence).toBe(`${place.name}失守`);
    expect(view.consequence).toBe(`capitalRegionId：${place.name} → 旧日所属`);
    expect(view.factors[0].refs?.[0]).toMatchObject({id:place.id,label:place.name,detail:place.name});
    expect(JSON.stringify(event)).toBe(original);
    expect(serializeWorld(world)).toBe(before);
    expect(playerHistoryText(world, event.summary)).not.toContain('叙事标记');
  });
  it('opens an unarchived Fact as read-only evidence instead of disabling the story link', () => {
    const world = createWorld('事实因果入口');
    const fact = world.facts.find((item) => item.causes.length > 0) ?? world.facts[0]!;
    const before = serializeWorld(world);
    const hash = computeWorldHash(world);

    const causal = toCausalFact(world, fact);

    expect(causal.id).toBe(fact.id);
    expect(causal.title.length).toBeGreaterThan(0);
    expect(causal.factors.at(-1)?.role).toBe('outcome');
    expect(serializeWorld(world)).toBe(before);
    expect(computeWorldHash(world)).toBe(hash);
  });
});
