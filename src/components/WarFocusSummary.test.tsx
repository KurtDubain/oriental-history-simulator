import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { WarGroupProjection } from '../view/war-group-projection';
import { WarFocusSummary } from './WarFocusSummary';

const war: WarGroupProjection = {
  warId: 'war_test',
  title: '临攻朔',
  durationTurns: 3,
  durationLabel: '第3季',
  mainFront: '济州',
  sides: [{
    polityId: 'p_lin', polity: '临', role: '攻方', armyCount: 1, soldiers: 2_700,
    groups: [{
      id: 'group_lin', factionId: 'f_lin', name: '天衡系', shortName: '天衡', leaderId: 'c_zhao', leader: '赵维谦',
      generalIds: ['c_zhao', 'c_xie'], generals: ['赵维谦', '谢德清'],
      persons: [
        { id: 'c_zhao', name: '赵维谦', soldiers: 1_800, formationId: 'a_lin', formation: '天衡行营', commander: '赵维谦', region: '济州', status: '出征' },
        { id: 'c_xie', name: '谢德清', soldiers: 900, formationId: 'a_lin', formation: '天衡行营', commander: '赵维谦', region: '济州', status: '出征' },
      ],
      armies: [], soldiers: 2_700, lossesThisTurn: 300, fronts: ['济州'], posture: '进攻',
    }],
  }, {
    polityId: 'p_shuo', polity: '朔', role: '守方', armyCount: 1, soldiers: 1_600,
    groups: [],
  }],
  contacts: [],
  latestBattle: {
    factId: 'fact_battle_1', eventId: null, regionId: 'r_jizhou', region: '济州',
    attacker: '天衡行营', attackerCommander: '赵维谦', attackerGroup: '天衡系',
    defender: '朔军行营', defenderCommanders: '独孤守一', defenderGroups: '雪塞边军',
    attackerBefore: 3_000, defenderBefore: 2_000, attackerLosses: 300, defenderLosses: 400,
    result: '得胜', aftermath: '临军留守济州。',
  },
  armyIds: ['a_lin', 'a_shuo'],
};

describe('WarFocusSummary', () => {
  it('默认折叠集团明细，且无史页的战役仍可打开轻量战报', () => {
    const markup = renderToStaticMarkup(createElement(WarFocusSummary, {
      war,
      onInspectPerson: vi.fn(),
      onInspectBattle: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(markup).toContain('赵维谦 · 1800');
    expect(markup).toContain('查看各集团投入');
    expect(markup).not.toContain('<details class="war-focus-summary__groups" open=""');
    expect(markup).toContain('最近交战');
    expect(markup).not.toContain('disabled');
  });
});
