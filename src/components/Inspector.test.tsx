import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EntityHistoryGateway,
  Inspector,
  PersonAgencySections,
  PersonEmbodimentClosureNotice,
  type PersonAgencyCommandRequestStage,
  type PersonAgencyView,
  type PersonEmbodimentView,
} from './Inspector';

function agency(stage: PersonAgencyCommandRequestStage): PersonAgencyView {
  return {
    availability: 'active',
    reason: '此人正在谋划自己的前路',
    barrier: null,
    longTermDirectionLabel: '权力',
    desires: [{ label: '权力', core: true, reason: '久任副将，希望独当一面' }],
    primaryGoal: {
      id: 'goal-command',
      label: '谋求独领一军',
      status: 'active',
      progress: 70,
      commitment: 82,
      reason: '已有军中历练，也希望建立自己的功名',
      barrier: '',
    },
    secondaryGoals: [],
    currentPlanSteps: [
      { label: '积累可查证的功绩', status: 'completed', reason: '近年战功已有记载' },
      { label: '向朝廷请领军令', status: stage === 'planned' ? 'blocked' : 'available', reason: '等候合适时机' },
    ],
    memories: [],
    quarterChoice: null,
    commandRequest: {
      id: `request-${stage}`,
      stage,
      periodLabel: '初元二年 · 夏',
      statusLabel: {
        planned: '已有此意',
        preparing: '正在筹备',
        submitted: '已经请令',
        approved: '军令已授',
        blocked: '此次未准',
      }[stage],
      title: '向朝廷请领雁门军军令',
      summary: stage === 'approved' ? '请令获准，现已升任雁门军主帅。' : '朝廷正在衡量他的功业与军中声望。',
      evidence: [
        { tone: 'support', label: '有利', detail: '已任雁门军副将六季，近年战功可查' },
        { tone: 'support', label: '有利', detail: '军中声望足以服众' },
        { tone: 'barrier', label: '掣肘', detail: '朝廷暂无空缺军令' },
        { tone: 'barrier', label: '掣肘', detail: '这一条不应越过三条上限' },
      ],
      sourceEventId: 'event-command',
    },
  };
}

describe('person command request reading flow', () => {
  it.each([
    ['planned', '已有此意'],
    ['preparing', '正在筹备'],
    ['submitted', '已经请令'],
    ['approved', '军令已授'],
    ['blocked', '此次未准'],
  ] as const)('renders %s as a distinct, natural-language stage', (stage, label) => {
    const markup = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency(stage),
      onSelectEvent: () => undefined,
    }));

    expect(markup).toContain('data-testid="person-command-request"');
    expect(markup).toContain(`data-stage="${stage}"`);
    expect(markup).toContain(label);
    expect(markup).toContain('请令进展');
    expect(markup.match(/data-tone=/g)).toHaveLength(3);
    expect(markup).not.toContain('这一条不应越过三条上限');
    expect(markup).not.toMatch(/Intent|Resolver|request_independent_command|threshold|score/i);
  });

  it('links only a submitted or resolved request to its exact original event with one causal label', () => {
    const planned = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('planned'),
      onSelectEvent: () => undefined,
    }));
    const submitted = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('submitted'),
      onSelectEvent: () => undefined,
    }));
    const approved = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('approved'),
      onSelectEvent: () => undefined,
    }));
    const blocked = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('blocked'),
      onSelectEvent: () => undefined,
    }));

    expect(planned).not.toContain('为何如此');
    expect(submitted.match(/为何如此/g)).toHaveLength(1);
    expect(approved.match(/为何如此/g)).toHaveLength(1);
    expect(blocked.match(/为何如此/g)).toHaveLength(1);
  });
});

describe('embodied character action reading flow', () => {
  const embodiment: PersonEmbodimentView = {
    active: true,
    activeCharacterName: '顾庭芳',
    pending: null,
    usedThisQuarter: false,
    actions: [{
      actionId: 'emb-action',
      label: '经营关系',
      targetLabel: '顾云岫',
      intent: '亲自与顾云岫往来，争取更多信任。',
      cost: '1 点私产与本季精力',
      obstacle: '顾云岫目前对其信任为58',
      nextSignal: '观察顾云岫是否回应，以及双方信任如何变化',
      available: true,
      unavailableReason: null,
    }],
    lastResult: null,
    closure: null,
  };

  it('states the one-action boundary and exact target, cost, obstacle and next signal', () => {
    const markup = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('planned'),
      embodiment,
      onChooseEmbodiedAction: () => undefined,
    }));

    expect(markup).toContain('本季只定一事');
    expect(markup).toContain('顾云岫');
    expect(markup).toContain('1 点私产与本季精力');
    expect(markup).toContain('信任为58');
    expect(markup).toContain('之后看');
    expect(markup).not.toMatch(/\bAI\b|Intent|Resolver|BUFF/);
  });

  it('keeps a queued action legible without claiming it has already succeeded', () => {
    const markup = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('planned'),
      embodiment: { ...embodiment, pending: { actorName: '顾庭芳', label: '经营关系', targetLabel: '顾云岫' } },
      onCancelEmbodiedAction: () => undefined,
    }));

    expect(markup).toContain('随下一季结算');
    expect(markup).toContain('撤回本季决定');
    expect(markup).not.toContain('定下此事');
  });

  it('marks a role-specific action without exposing resolver terminology', () => {
    const identityAction = {
      ...embodiment.actions[0],
      actionId: 'emb-military',
      identityLabel: '副将行事',
      label: '联络本军将校',
      targetLabel: '燕京中军将校',
      intent: '亲自巡营联络本军将校，为日后独当一面争取军中支持。',
    };
    const markup = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('planned'),
      embodiment: { ...embodiment, actions: [identityAction] },
      onChooseEmbodiedAction: () => undefined,
    }));

    expect(markup).toContain('副将行事');
    expect(markup).toContain('联络本军将校');
    expect(markup).toContain('燕京中军将校');
    expect(markup).not.toMatch(/Intent|Resolver|request_backing|cultivate_military_support/i);
  });

  it('keeps local governance inside the same four-action reading surface', () => {
    const localActions = [
      {
        ...embodiment.actions[0],
        actionId: 'emb-relief',
        identityLabel: '地方施政',
        label: '开仓赈济',
        targetLabel: '河间',
        intent: '动用河间仓粮，先缓解饥困、流民与地方不安。',
        cost: '预计动用540石州粮',
      },
      {
        ...embodiment.actions[0],
        actionId: 'emb-levy',
        identityLabel: '地方施政',
        label: '减免本季赋',
        targetLabel: '河间',
        intent: '请朝廷把本季部分赋款退回河间。',
        cost: '预计由国库退还120财力',
      },
    ];
    const markup = renderToStaticMarkup(createElement(PersonAgencySections, {
      agency: agency('planned'),
      embodiment: { ...embodiment, actions: localActions },
      onChooseEmbodiedAction: () => undefined,
    }));

    expect(markup).toContain('地方施政');
    expect(markup).toContain('开仓赈济');
    expect(markup).toContain('减免本季赋');
    expect(markup).toContain('540石州粮');
    expect(markup).toContain('120财力');
    expect(markup).not.toMatch(/local_governance|open_granary|reduce_levy|Resolver/i);
  });

  it('closes a departed life with concrete experiences and a direct last-page route', () => {
    const markup = renderToStaticMarkup(createElement(PersonEmbodimentClosureNotice, {
      closure: {
        reason: 'died',
        summary: '将领顾庭芳一生至此，享年六十三岁。世界仍会沿着此人留下的关系继续演变。',
        highlights: ['曾在雁门击退来敌', '请领军令后升任主帅'],
        sourceEventId: 'event-death',
      },
      onSelectEvent: () => undefined,
      onDismiss: () => undefined,
    }));

    expect(markup).toContain('人物离世 · 已回到观察');
    expect(markup).toContain('一生至此');
    expect(markup).toContain('雁门击退来敌');
    expect(markup).toContain('为何如此');
    expect(markup).toContain('收起');
    expect(markup).not.toMatch(/observer metadata|activeActor|worldHash|Fact ID/i);
  });
});

describe('entity history gateways', () => {
  it.each([
    ['country', '读完整本纪'],
    ['family', '读完整世录'],
    ['person', '读完整人物传'],
  ] as const)('renders the %s archive as an explicit text gateway', (kind, label) => {
    const markup = renderToStaticMarkup(createElement(EntityHistoryGateway, {
      kind,
      label,
      onOpen: () => undefined,
    }));

    expect(markup).toContain('data-testid="entity-history-gateway"');
    expect(markup).toContain(`data-entity-history-gateway="${kind}"`);
    expect(markup).toContain(label);
  });

  it('uses the person reading tabs without restoring the competing header archive icon', () => {
    const markup = renderToStaticMarkup(createElement(Inspector, {
      kind: 'person',
      data: {
        id: 'person-gu',
        name: '顾庭芳',
        age: 41,
        gender: '女',
        role: '副将',
        ambition: 72,
        loyalty: 61,
        caution: 55,
        abilities: { command: 68, martial: 57, governance: 49, strategy: 63, charisma: 58, scholarship: 52 },
      },
      onOpenArchive: () => undefined,
    }));

    expect(markup).toContain('data-inspector-tab="life"');
    expect(markup).toContain('data-inspector-tab="history"');
    expect(markup).toContain('>其人<');
    expect(markup).toContain('>所图<');
    expect(markup).toContain('>关系<');
    expect(markup).toContain('>生平<');
    expect(markup).not.toContain('展开顾庭芳史卷');
    expect(markup).not.toContain('data-testid="entity-history-gateway"');
  });
});
