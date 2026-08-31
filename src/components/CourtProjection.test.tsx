import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CourtProjectionView } from '../view/court-projection';
import { CourtProjection } from './CourtProjection';

const court: CourtProjectionView = {
  polityId: 'polity-yan',
  summary: '顾庭芳居君位；宣政社据宰辅，权势62，居朝中首位。',
  ruler: {
    id: 'court-seat:ruler', officeId: 'ruler', office: '君主', holderId: 'person-ruler', holder: '顾庭芳',
    rank: 100, accessBand: 0, accessLabel: '君位', factionId: 'faction-a', factionName: '宣政社',
    powerContribution: 14, appointedLabel: '第1年春季受任', appointmentEvidence: '顾庭芳承继君位并承担统治职责', sourceEventId: 'event-ruler',
  },
  seats: [
    {
      id: 'court-seat:ruler', officeId: 'ruler', office: '君主', holderId: 'person-ruler', holder: '顾庭芳',
      rank: 100, accessBand: 0, accessLabel: '君位', factionId: 'faction-a', factionName: '宣政社',
      powerContribution: 14, appointedLabel: '第1年春季受任', appointmentEvidence: '顾庭芳承继君位并承担统治职责', sourceEventId: 'event-ruler',
    },
    {
      id: 'court-seat:chancellor', officeId: 'chancellor', office: '宰辅', holderId: 'person-chancellor', holder: '隋行简',
      rank: 82, accessBand: 1, accessLabel: '近班', factionId: 'faction-a', factionName: '宣政社',
      powerContribution: 10, appointedLabel: '第2年夏季受任', appointmentEvidence: '隋行简的政略与朝中影响居群臣之首', sourceEventId: 'event-chancellor',
    },
  ],
  factionPositions: [{
    factionId: 'faction-a', name: '宣政社', leaderId: 'person-chancellor', leader: '隋行简', agenda: '扩张权势',
    power: 62, cohesion: 71, seatIds: ['court-seat:ruler', 'court-seat:chancellor'], seatLabels: ['君主', '宰辅'],
    nearestBand: 0, positionLabel: '君位', dominant: true, foundedLabel: '第1年春季立派',
    topRoots: [{ key: 'central_office', label: '中枢席位', value: 22 }], recentMovement: null,
  }],
  graphFactionIds: ['faction-a'],
  relations: [],
};

describe('CourtProjection', () => {
  it('renders one shared focus ledger plus desktop and ordered mobile seat views', () => {
    const markup = renderToStaticMarkup(createElement(CourtProjection, {
      court,
      factions: [{
        id: 'faction-a', name: '宣政社', kind: '官僚', leaderId: 'person-chancellor', leader: '隋行简',
        power: 62, cohesion: 71, agenda: '扩张权势', resources: [{
          id: 'office:chancellor', label: '宰辅', detail: '隋行简占据正式席位', value: 10,
          sourceEventId: 'event-chancellor',
        }],
      }],
      onSelectPerson: () => undefined,
      onSelectEvent: () => undefined,
    }));

    expect(markup).toContain('data-testid="court-projection"');
    expect(markup).toContain('data-court-layout="desktop"');
    expect(markup).toContain('按距君主远近排列的中枢席位');
    expect(markup).toContain('座次是官位，不是地盘');
    expect(markup).toContain('派系次序');
    expect(markup).toContain('查看权势根由');
    expect(markup.match(/data-court-focus-detail/g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('看领袖 · 隋行简');
    expect(markup).toContain('查看宰辅的由来');
    expect(markup).toContain('以隋行简为首');
    expect(markup).not.toContain('由隋行简领袖');
  });

  it('renders an explicit seat and focus empty state instead of an empty mobile list', () => {
    const markup = renderToStaticMarkup(createElement(CourtProjection, {
      court: {
        polityId: 'polity-empty',
        summary: '君位空悬；朝中尚无明确派系格局。',
        ruler: null,
        seats: [],
        factionPositions: [],
        graphFactionIds: [],
        relations: [],
      },
      factions: [],
    }));

    expect(markup).toContain('目前没有中枢席位可列。');
    expect(markup).toContain('目前没有中枢任官记录，派系格局也未成形。');
    expect(markup).not.toContain('中枢座次已有记录');
  });

  it('keeps the concrete appointment reason readable even without a Chronicle route', () => {
    const seat = { ...court.seats[0]!, factionId: null, factionName: null, sourceEventId: null };
    const markup = renderToStaticMarkup(createElement(CourtProjection, {
      court: {
        polityId: court.polityId,
        summary: '顾庭芳居君位。',
        ruler: seat,
        seats: [seat],
        factionPositions: [],
        graphFactionIds: [],
        relations: [],
      },
      factions: [],
      onSelectEvent: () => undefined,
    }));

    expect(markup).toContain('为何任此职');
    expect(markup).toContain('顾庭芳承继君位并承担统治职责');
    expect(markup).not.toContain('查看任命史事');
  });
});
