import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HistoricalArchive, type ArchiveDossier } from './HistoricalArchive';

const dossier: ArchiveDossier = {
  id: 'person-gu',
  kind: 'person',
  eyebrow: '人物传 · 生平行状',
  title: '顾庭芳传',
  subtitle: '燕国 · 副将',
  lead: '一生大事均按史事原文收录。',
  facts: [{ label: '现职', value: '副将' }],
  chapters: [{ id: 'origin', title: '身世与起点', paragraphs: ['生于燕南。'] }],
  records: [{
    id: 'bio-event-1',
    date: '第 2 年 · 秋',
    title: '燕南守城',
    summary: '顾庭芳随军守住燕南。',
    importance: 4,
    eventId: 'event-1',
  }],
  links: [{ id: 'family-gu', kind: 'family', label: '顾氏', detail: '所属家族' }],
};

describe('HistoricalArchive reading layer', () => {
  it('shows the canonical chronology before present-day chapters', () => {
    const markup = renderToStaticMarkup(createElement(HistoricalArchive, {
      open: true,
      dossier,
      onClose: () => undefined,
      onSelectEvent: () => undefined,
    }));

    expect(markup).toContain('data-history-layer="entity"');
    expect(markup).toContain('data-history-scope="person"');
    expect(markup).toContain('data-history-scope-id="person-gu"');
    expect(markup).toContain('data-history-entry-id="bio-event-1"');
    expect(markup).toContain('data-event-id="event-1"');
    expect(markup).toContain('data-entity-kind="family"');
    expect(markup).toContain('data-entity-id="family-gu"');
    expect(markup).toContain('为何如此');
    expect(markup.indexOf('纪年 · 截至本季')).toBeLessThan(markup.indexOf(dossier.lead));
    expect(markup.indexOf('纪年 · 截至本季')).toBeLessThan(markup.indexOf('身世与起点'));
  });

  it('does not render while closed', () => {
    const markup = renderToStaticMarkup(createElement(HistoricalArchive, {
      open: false,
      dossier,
      onClose: () => undefined,
    }));
    expect(markup).toBe('');
  });
});
