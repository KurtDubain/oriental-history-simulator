import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PersonAgencySections,
  type PersonAgencyCommandRequestStage,
  type PersonAgencyView,
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

  it('links only a submitted or resolved request to its exact original event', () => {
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

    expect(planned).not.toContain('查本季原事');
    expect(planned).not.toContain('查请令原事');
    expect(submitted).toContain('查请令原事');
    expect(approved).toContain('查授令原事');
    expect(blocked).toContain('查未准原事');
  });
});
