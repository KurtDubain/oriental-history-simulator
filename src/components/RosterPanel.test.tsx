import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RosterPanel } from './RosterPanel';

describe('RosterPanel power sections', () => {
  it('renders one accessible three-section power ledger without duplicating rosters', () => {
    const markup = renderToStaticMarkup(createElement(RosterPanel, {
      title: '天下军旅',
      eyebrow: '势力诸卷 · 兵力军需',
      items: [{ id: 'a_1', title: '北营', subtitle: '驻燕原', meta: '8千' }],
      selectedId: null,
      emptyMessage: '无军旅',
      sections: [
        { id: 'polities', label: '列国', count: 8 },
        { id: 'families', label: '世家', count: 92 },
        { id: 'military', label: '军旅', count: 14, alertCount: 3 },
      ],
      activeSection: 'military',
      onSectionChange: () => undefined,
      onSelect: () => undefined,
      onClose: () => undefined,
    }));

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-roster-scope="powers"');
    expect(markup).toContain('data-active-section="military"');
    expect(markup.match(/data-roster-id="a_1"/g)).toHaveLength(1);
  });
});
