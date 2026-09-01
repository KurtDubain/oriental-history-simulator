import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CausalDrawer, type CausalEvent } from './CausalDrawer';

const event: CausalEvent = {
  id: 'event-1',
  date: '第 2 年 · 秋',
  title: '燕南守城',
  summary: '燕军守住城门。',
  factors: [{
    id: 'factor-1',
    role: 'choice',
    label: '守将选择坚守',
    evidence: '守城军令',
  }],
  consequence: '燕南仍属燕国。',
  subjects: [{ id: 'person-1', kind: 'person', label: '顾临川', detail: '燕南守将' }],
};

describe('CausalDrawer reading layer', () => {
  it('uses one stable evidence destination and natural player language', () => {
    const markup = renderToStaticMarkup(createElement(CausalDrawer, {
      open: true,
      event,
      onClose: () => undefined,
    }));

    expect(markup).toContain('data-history-layer="evidence"');
    expect(markup).toContain('data-event-id="event-1"');
    expect(markup).toContain('何故与证据');
    expect(markup).toContain('此事为何发生？');
    expect(markup).toContain('接着看这些人');
    expect(markup.indexOf('此事为何发生？')).toBeLessThan(markup.indexOf('接着看这些人'));
    expect(markup).not.toContain('史事溯因');
  });

  it('does not render while closed', () => {
    const markup = renderToStaticMarkup(createElement(CausalDrawer, {
      open: false,
      event,
      onClose: () => undefined,
    }));
    expect(markup).toBe('');
  });

  it('links explicit living-court factions and keeps ended factions as disabled history', () => {
    const markup = renderToStaticMarkup(createElement(CausalDrawer, {
      open: true,
      event: {
        ...event,
        politicalFocus: [{
          polityId: 'polity-1',
          polityName: '燕国',
          factionId: 'faction-active',
          factionName: '北府派',
          active: true,
          detail: '本事明载此派参与的朝堂行动',
        }, {
          polityId: 'polity-1',
          polityName: '燕国',
          factionId: 'faction-ended',
          factionName: '故相党',
          active: false,
          detail: '此派已退出当下朝局',
        }],
      },
      onClose: () => undefined,
      onSelectCourtFaction: () => undefined,
    }));

    expect(markup).toContain('本事所系朝局');
    expect(markup).toContain('data-court-focus-faction="faction-active"');
    expect(markup).toContain('燕国 · 看其朝局');
    expect(markup).toMatch(/data-court-focus-faction="faction-ended"[^>]*disabled/);
  });
});
