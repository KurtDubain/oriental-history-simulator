import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { advanceWorld, createWorld } from '../sim';
import { deriveObserverLeads } from '../view/observer-leads';
import { ObserverLeads, observerLeadTargetKey, observerLeadWatchKey } from './ObserverLeads';
import { TopBar } from './TopBar';
import type { ObserverPauseMatch } from '../view/v1-observer';

function leadsAt(turn: number, seed: string) {
  let world = createWorld(seed);
  while (world.turn < turn) world = advanceWorld(world);
  return { world, leads: deriveObserverLeads(world) };
}

function render(leads: ReturnType<typeof deriveObserverLeads>, situationCount = 0) {
  return renderToStaticMarkup(createElement(ObserverLeads, {
    leads,
    watchedKeys: new Set(leads[0] ? [observerLeadWatchKey(leads[0])] : []),
    situationCount,
    onInspect: vi.fn(),
    onToggleWatch: vi.fn(),
    onOpenSituations: vi.fn(),
  }));
}

describe('ObserverLeads', () => {
  it('shows a receipt only for a directed watch pause and uses its stored identity', () => {
    const match: ObserverPauseMatch = {
      eventId: 'event-battle', eventTitle: '广州之战', reason: '关注变化', rule: 'situationChanges',
      situationId: 'war-story', situationTrigger: 'phase-change', sourceFactId: 'fact-battle',
      watchMatches: [{ kind: 'situation', id: 'war-story', label: '雍攻沧', detail: '', alert: true }],
    };
    const bar = (pauseMatch: ObserverPauseMatch | null, isRunning = false) => renderToStaticMarkup(createElement(TopBar, {
      year: 23, season: '夏', turn: 89, isRunning, pauseMatch,
      onReadPause: vi.fn(), onAdvance: vi.fn(), onToggleRunning: vi.fn(),
    }));
    expect(bar(match)).toContain('你关注的“雍攻沧”发生广州之战');
    expect(bar(match)).toContain('data-situation-id="war-story"');
    expect(bar({ ...match, situationTrigger: 'resolution' })).toContain('已经结束');
    expect(bar(null)).not.toContain('watch-pause-receipt');
    expect(bar({ ...match, watchMatches: [] })).not.toContain('watch-pause-receipt');
    expect(bar(match, true)).not.toContain('watch-pause-receipt');
  });
  it('keeps the story entrance visible without manufacturing empty questions', () => {
    const markup = render(deriveObserverLeads(createWorld('当世三问-空白开局')));

    expect(markup).toContain('眼下大事');
    expect(markup).toContain('一条主线 · 两则侧闻');
    expect(markup).toContain('眼下暂无值得单列的战事或朝局');
    expect(markup).toContain('没有值得说的事，就不凑数');
    expect(markup).not.toContain('data-testid="observer-lead"');
  });

  it('renders at most three concrete story questions without fixed slots or detector values', () => {
    const { world, leads } = leadsAt(8, '当世三问-组件测试');
    const markup = render(leads, world.situationSystem.situations.length);

    expect(leads.length).toBeGreaterThan(0);
    expect(leads.length).toBeLessThanOrEqual(3);
    expect(markup.match(/data-testid="observer-lead"/g)).toHaveLength(leads.length);
    expect(markup).not.toContain('data-slot=');
    expect(markup).not.toContain('data-stage=');
    expect(markup).not.toContain('接着看');
    expect(markup).not.toMatch(/会不会|能否|还是/);
    expect(markup.match(/data-testid="observer-lead-fact"/g)).toHaveLength(leads.length);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('查看战事与朝局');
    expect(markup.match(/data-situation-workbench-trigger/g)).toHaveLength(1);
  });

  it('watches a Situation by its identity and a Fact fallback by its target identity', () => {
    const situationLead = leadsAt(8, '兵权入世').leads.find((item) => item.situationId);
    if (!situationLead?.situationId) throw new Error('expected a Situation lead');
    const situationMarkup = render([situationLead], 1);

    expect(observerLeadWatchKey(situationLead)).toBe(`situation:${situationLead.situationId}`);
    expect(observerLeadTargetKey(situationLead)).toBe(`${situationLead.target.kind}:${situationLead.target.id}`);
    expect(situationMarkup).toContain('已关注');
    expect(situationMarkup).toContain('data-watch-kind="situation"');
    expect(situationMarkup).not.toContain('observer-leads__situation-age');

    const factWorld = leadsAt(3, '当世三问-fact').world;
    const factLead = deriveObserverLeads({
      ...factWorld,
      situationSystem: { ...factWorld.situationSystem, situations: [] },
    }).find((item) => item.source === 'fact');
    if (!factLead) throw new Error('expected a Fact fallback lead');
    expect(observerLeadWatchKey(factLead)).toBe(`${factLead.target.kind}:${factLead.target.id}`);
  });

  it('renders one declarative headline with two concise evidence lines', () => {
    const lead = leadsAt(8, '春战副将').leads.find((item) => item.situationId);
    if (!lead) throw new Error('expected a Situation lead');
    const markup = render([lead]);

    expect(markup).toContain(`<strong data-testid="observer-lead-question">${lead.question}</strong>`);
    expect(markup).toContain('data-story-rank="main"');
    for (const evidence of lead.evidence) expect(markup).toContain(evidence);
  });

  it('keeps a changed headline watched by Situation identity, without adopting another case', () => {
    const lead = leadsAt(8, '春战副将').leads.find((item) => item.situationId)!;
    const renamed = { ...lead, question: '另一位实际参战者继续守城' };
    const markup = renderToStaticMarkup(createElement(ObserverLeads, {
      leads: [renamed, { ...renamed, id: 'another-lead', situationId: 'another-case' }],
      watchedKeys: new Set([observerLeadWatchKey(lead)]), situationCount: 2,
      onInspect: vi.fn(), onToggleWatch: vi.fn(), onOpenSituations: vi.fn(),
    }));
    expect(observerLeadWatchKey(renamed)).toBe(observerLeadWatchKey(lead));
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(1);
  });
});
