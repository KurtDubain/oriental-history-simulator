import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TurnReport } from '../sim/types';
import type {
  QuarterPulseEventStory,
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

describe('QuarterPulse concrete stories', () => {
  it('uses one light T0 prompt instead of two empty histories', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report: null,
      stories: [],
      onSelectEvent: () => undefined,
      onSelectLedger: () => undefined,
    }));

    expect(markup).toContain('开始演变，看看第一季发生什么。');
    expect(markup).not.toContain('史页未启');
    expect(markup).not.toContain('推进一季后');
  });

  it('renders only concrete stories in the shared ranking order, capped at three', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [event('major', '燕京易主', 100), event('command', '主帅更替', 80), event('battle', '边地交战', 60), event('minor', '旧闻', 20)],
      onSelectEvent: () => undefined, onSelectLedger: () => undefined,
    }));
    expect(markup.match(/data-story-kind=/g)).toHaveLength(3);
    expect(markup).not.toContain('quarter-pulse-situation');
    expect(markup).not.toContain('data-event-id="minor"');
    expect(markup.indexOf('data-event-id="major"')).toBeLessThan(markup.indexOf('data-event-id="command"'));
    expect(markup).toContain('为何如此');
  });

  it('keeps the truthful quiet-quarter copy when neither stream has a visible item', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [],
      onSelectEvent: () => undefined,
      onSelectLedger: () => undefined,
    }));

    expect(markup).toContain('data-testid="quarter-pulse-quiet"');
    expect(markup).toContain('data-history-layer="quarter"');
    expect(markup).toContain('本季无大事');
    expect(markup).not.toContain('quarter-pulse__compact-headline">粮食');
    expect(markup).toContain('aria-label="人口净变化 +3。');
    expect(markup).toContain('aria-label="粮食净变化 +7。');
    expect(markup).toContain('aria-label="财富净变化 +7。');
  });

  it('keeps a neutral compact headline even when a quiet quarter has extreme food movement', () => {
    const extremeReport = {
      ...report,
      food: { ...report.food, end: -99_999_900 },
    } as TurnReport;
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report: extremeReport,
      stories: [],
      onSelectEvent: () => undefined,
      onSelectLedger: () => undefined,
      compact: true,
    }));

    expect(markup).toContain('quarter-pulse__compact-headline">本季无大事');
    expect(markup).toContain('data-testid="quarter-pulse-ledger-food"');
    expect(markup).not.toContain('最重要');
  });

  it('marks the same bounded quarter projection as condensed for a full mobile dossier', () => {
    const markup = renderToStaticMarkup(createElement(QuarterPulse, {
      report,
      stories: [event('event-major', '燕京易主', 100)],
      onSelectEvent: () => undefined,
      onSelectLedger: () => undefined,
      compact: true,
    }));

    expect(markup).toContain('data-presentation="condensed"');
    expect(markup).toContain('data-compact="true"');
    expect(markup).toContain('data-story-count="1"');
    expect(markup).toContain('quarter-pulse__compact-headline">燕京易主');
    expect(markup).toContain('第 2 年 · 冬季');
    expect(markup).toContain('data-event-id="event-major"');
  });
});
