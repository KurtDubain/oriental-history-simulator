import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { advanceWorld, createWorld } from '../sim';
import { deriveObserverLeadProjection, deriveObserverLeads } from '../view/observer-leads';
import { ObserverLeads } from './ObserverLeads';

describe('ObserverLeads', () => {
  it('renders three actionable, evidence-backed questions', () => {
    const leads = deriveObserverLeads(createWorld('当世三问-组件测试'));
    const markup = renderToStaticMarkup(createElement(ObserverLeads, {
      leads,
      watchedKeys: new Set([`${leads[0].target.kind}:${leads[0].target.id}`]),
      situationCount: 7,
      onInspect: vi.fn(),
      onToggleWatch: vi.fn(),
      onOpenSituations: vi.fn(),
    }));

    expect(markup).toContain('现在看什么');
    expect(markup).toContain('当世三问');
    expect(markup.match(/data-testid="observer-lead"/g)).toHaveLength(3);
    expect(markup).toContain('下一观察');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('展开局势全卷');
    expect(markup).toContain('卷 7');
  });

  it('exposes Situation identity, continuity and the proxy-watch boundary in markup', () => {
    let world = createWorld('春战副将');
    let projection = deriveObserverLeadProjection(world);
    while (world.turn < 8) {
      const previousHash = world.hash;
      world = advanceWorld(world);
      projection = deriveObserverLeadProjection(world, projection.continuity, previousHash);
    }
    const watchedLead = projection.leads[0];
    const markup = renderToStaticMarkup(createElement(ObserverLeads, {
      leads: projection.leads,
      watchedKeys: new Set([`${watchedLead.target.kind}:${watchedLead.target.id}`]),
      situationCount: world.situationSystem.situations.length,
      onInspect: vi.fn(),
      onToggleWatch: vi.fn(),
      onOpenSituations: vi.fn(),
    }));

    expect(markup.match(/data-source="situation"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup.match(/data-situation-id="situation_/g)).toHaveLength(3);
    expect(markup.match(/data-display-mode="tracking"/g)).toHaveLength(3);
    expect(markup.match(/data-testid="observer-lead-change"/g)).toHaveLength(3);
    expect(markup).toContain('已追踪');
    expect(markup).toContain('对象已关注');
    expect(markup).toContain('当前关注相关对象；局势级关注下一阶段开放');
  });
});
