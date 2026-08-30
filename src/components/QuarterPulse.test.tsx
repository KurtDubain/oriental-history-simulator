import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TurnReport } from '../sim/types';
import type {
  QuarterPulseEventStory,
  QuarterPulseSituationStory,
} from '../view/quarter-pulse-stories';
import { QuarterPulse } from './QuarterPulse';

const report = {
  turn: 7,
  year: 2,
  season: '冬',
  population: {
    start: 100,
    births: 4,
    civilianDeaths: 1,
    militaryDeaths: 0,
    recruited: 0,
    demobilized: 0,
    end: 103,
  },
  food: {
    start: 100,
    produced: 20,
    civilianConsumed: 10,
    armyConsumed: 2,
    spoiled: 1,
    warDestroyed: 0,
    transferred: 0,
    end: 107,
  },
  wealth: {
    start: 100,
    produced: 12,
    householdConsumed: 4,
    warDestroyed: 0,
    taxed: 2,
    militaryPayments: 1,
    end: 107,
  },
  eventIds: ['event-ordinary'],
  factIds: ['fact-situation'],
} as TurnReport;

function situation(kind: QuarterPulseSituationStory['situationKind']): QuarterPulseSituationStory {
  const labels = { born: '新生', heated: '升温', cooled: '降温', resolved: '结案' } as const;
  return {
    id: `situation:situation-${kind}`,
    kind: 'situation',
    title: '燕京军权危机',
    summary: kind === 'cooled' ? '张力 81→72（−9）' : '张力 62→72（+10）',
    sourceFactIds: kind === 'born' || kind === 'resolved' ? ['fact-situation'] : [],
    historyEventIds: [],
    regionIds: ['r_yanjing'],
    situationId: `situation-${kind}`,
    situationKind: kind,
    typeLabel: '军权危机',
    kindLabel: labels[kind],
    basis: kind === 'heated' || kind === 'cooled' ? 'trend' : 'lifecycle',
    threadTitle: '燕京军权危机',
    tension: 72,
    delta: kind === 'cooled' ? -9 : 10,
    importance: 80,
  };
}

function event(
  id: string,
  title: string,
  importance: number,
): QuarterPulseEventStory {
  return {
    id,
    kind: 'event',
    title,
    summary: '官档已记下此事的起因与结果。',
    category: '军事',
    importance,
    location: '燕京',
    eventId: id,
    source: 'chronicle',
    sourceFactIds: [],
    historyEventIds: [id],
    regionIds: ['r_yanjing'],
  };
}

describe('QuarterPulse Situation stream', () => {
  it('puts bounded Situation changes before ordinary history and exposes a dossier action', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [situation('heated'), situation('resolved'), event('event-ordinary', '秋粮入仓', 60)],
      onSelectEvent: () => undefined,
      onSelectSituation: () => undefined,
      onSelectLedger: () => undefined,
    }));

    expect(markup.match(/data-testid="quarter-pulse-situation"/g)).toHaveLength(2);
    expect(markup).toContain('data-history-layer="quarter"');
    expect(markup).toContain('data-situation-id="situation-heated"');
    expect(markup).toContain('data-kind="resolved"');
    expect(markup).toContain('打开持续局势');
    expect(markup).toContain('data-event-id="event-ordinary"');
    expect(markup).toContain('为何如此');
    expect(markup).not.toContain('何故 ›');
    expect(markup.indexOf('situation-heated')).toBeLessThan(markup.indexOf('event-ordinary'));
  });

  it('renders the shared ranking order and defensively caps it at three stories', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [
        event('event-major', '燕京易主', 100),
        situation('resolved'),
        situation('heated'),
        event('event-ordinary', '秋粮入仓', 60),
        event('event-minor', '乡市复开', 20),
      ],
      onSelectEvent: () => undefined,
      onSelectSituation: () => undefined,
      onSelectLedger: () => undefined,
    }));

    expect(markup.match(/data-story-kind=/g)).toHaveLength(3);
    expect(markup).toContain('data-event-id="event-major"');
    expect(markup).toContain('data-situation-id="situation-resolved"');
    expect(markup).toContain('data-situation-id="situation-heated"');
    expect(markup).not.toContain('data-event-id="event-ordinary"');
    expect(markup.indexOf('event-major')).toBeLessThan(markup.indexOf('situation-resolved'));
  });

  it('keeps the truthful quiet-quarter copy when neither stream has a visible item', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [],
      onSelectEvent: () => undefined,
      onSelectSituation: () => undefined,
      onSelectLedger: () => undefined,
    }));

    expect(markup).toContain('data-testid="quarter-pulse-quiet"');
    expect(markup).toContain('data-history-layer="quarter"');
    expect(markup).toContain('本季无大事');
  });

  it('marks the same bounded quarter projection as condensed for a full mobile dossier', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [event('event-major', '燕京易主', 100)],
      onSelectEvent: () => undefined,
      onSelectSituation: () => undefined,
      onSelectLedger: () => undefined,
      compact: true,
    }));

    expect(markup).toContain('data-presentation="condensed"');
    expect(markup).toContain('data-compact="true"');
    expect(markup).toContain('data-story-count="1"');
    expect(markup).toContain('第 2 年 · 冬季');
    expect(markup).toContain('data-event-id="event-major"');
  });
});
