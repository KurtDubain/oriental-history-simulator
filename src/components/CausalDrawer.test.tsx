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
});
