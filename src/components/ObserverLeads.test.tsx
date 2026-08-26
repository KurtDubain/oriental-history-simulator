import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '../sim';
import { deriveObserverLeads } from '../view/observer-leads';
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
});
