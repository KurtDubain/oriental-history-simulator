import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createRosterDiscoveryState, type RosterDiscoveryDefinition } from '../view/roster-discovery';
import { RosterPanel } from './RosterPanel';

const militaryDefinition: RosterDiscoveryDefinition = {
  scope: 'military',
  unitLabel: '支军旅',
  quickViews: [
    { id: 'all', label: '全部军旅' },
    { id: 'weak-supply', label: '粮道吃紧' },
  ],
  filters: [{
    id: 'kind',
    label: '军种',
    options: [
      { id: 'all', label: '全部军种' },
      { id: 'army', label: '军团' },
      { id: 'fleet', label: '水师' },
    ],
  }],
  sorts: [
    { id: 'attention', label: '值得关注', direction: 'desc' },
    { id: 'strength', label: '兵力', direction: 'desc' },
  ],
};

const militaryItem = {
  id: 'a_1',
  title: '北营',
  subtitle: '驻燕原',
  meta: '8千',
  reason: {
    kind: 'open-situation' as const,
    label: '北线粮道已连续两季吃紧',
    target: { kind: 'situation' as const, id: 'supply-north' },
  },
  discovery: {
    quickViews: ['weak-supply'],
    filters: { kind: 'army' },
    sortValues: { strength: 8_000 },
    attention: {
      kind: 'open-situation' as const,
      phase: 1,
      tension: 72,
      turn: 8,
      importance: 65,
      value: 8_000,
    },
  },
};

describe('RosterPanel discovery presentation', () => {
  it('renders one controlled power ledger with compact controls and a sibling reason action', () => {
    const markup = renderToStaticMarkup(createElement(RosterPanel, {
      title: '天下军旅',
      eyebrow: '势力诸卷 · 兵力军需',
      items: [militaryItem],
      definition: militaryDefinition,
      state: createRosterDiscoveryState(),
      selectedId: null,
      sections: [
        { id: 'polities', label: '列国', count: 8 },
        { id: 'families', label: '世家', count: 92 },
        { id: 'military', label: '军旅', count: 14, alertCount: 3 },
      ],
      activeSection: 'military',
      onSectionChange: () => undefined,
      onStateChange: () => undefined,
      onSelect: () => undefined,
      onReasonSelect: () => undefined,
      onClose: () => undefined,
    }));

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-roster-scope="powers"');
    expect(markup).toContain('data-roster-directory="military"');
    expect(markup).toContain('data-active-section="military"');
    expect(markup).toContain('1 / 1 支军旅 · 值得关注');
    expect(markup).toContain('data-roster-filter-toggle="true"');
    expect(markup).toContain('data-roster-discovery-controls="true"');
    expect(markup.match(/<select/g)).toHaveLength(3);
    expect(markup.match(/data-roster-id="a_1"/g)).toHaveLength(1);
    expect(markup.match(/data-roster-reason="open-situation"/g)).toHaveLength(1);
    expect(markup).toContain('</button><button class="roster-panel__reason"');
  });

  it('uses the controlled conditions for an explicit empty result', () => {
    const markup = renderToStaticMarkup(createElement(RosterPanel, {
      title: '天下军旅',
      eyebrow: '势力诸卷',
      items: [militaryItem],
      definition: militaryDefinition,
      state: { ...createRosterDiscoveryState(), query: '海军' },
      onStateChange: () => undefined,
      onSelect: () => undefined,
      onReasonSelect: () => undefined,
      onClose: () => undefined,
    }));

    expect(markup).toContain('0 / 1 支军旅 · 值得关注');
    expect(markup).toContain('没有符合检索“海军”的支军旅');
    expect(markup).not.toContain('data-roster-id="a_1"');
  });

  it('keeps a suspended mobile roster mounted but hidden for dossier return', () => {
    const markup = renderToStaticMarkup(createElement(RosterPanel, {
      title: '天下军旅',
      eyebrow: '军旅名录',
      items: [militaryItem],
      definition: militaryDefinition,
      state: createRosterDiscoveryState(),
      selectedId: 'a_1',
      onStateChange: () => undefined,
      onSelect: () => undefined,
      onReasonSelect: () => undefined,
      onClose: () => undefined,
      suspended: true,
    }));

    expect(markup).toContain('data-roster-state="suspended"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-roster-id="a_1"');
  });
});
