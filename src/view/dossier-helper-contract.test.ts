import { describe, expect, it } from 'vitest';
import { createWorld, serializeWorld } from '../sim';
import { eventArchiveRecord, historyRecord, sourceEventIdForFact } from './dossier-adapter-shared';
import { toPersonExperienceRecords } from './person-dossier-adapter';
import { decimalNumber } from './compact-number';
import { toCountryArchive, toCountryInspector } from './country-dossier-adapter';
import { projectCourt } from './court-projection';

describe('dossier helper equivalence contracts', () => {
  it.each(['ruling', 'vacant', 'eliminated'] as const)('always provides the complete court summary for a %s polity', (state) => {
    const world = createWorld('朝局必有投影');
    const polity = world.polities[0];
    if (state !== 'ruling') {
      polity.rulerId = '';
      world.factions = world.factions.filter(f => f.polityId !== polity.id);
      world.offices = world.offices.filter(o => o.polityId !== polity.id);
    }
    if (state === 'eliminated') polity.alive = false;
    const before = serializeWorld(world), inspector = toCountryInspector(world, polity);
    expect(Object.getOwnPropertyDescriptor(inspector, 'court')?.get).toBeTypeOf('function');
    expect(inspector.court).toEqual(projectCourt(world, polity.id, 'all'));
    expect(inspector.court).toBe(inspector.court);
    expect(toCountryArchive(world, polity).chapters.find(c => c.id === 'court')?.paragraphs[0])
      .toBe(inspector.court.summary);
    expect(serializeWorld(world)).toBe(before);
  });

  it.each([0, -0, 1.25, -1.25, 999.99, 10000, 1234567.89, NaN, Infinity, -Infinity])(
    'preserves grouped decimal formatting for %s, never compact notation', (value) => {
      expect(decimalNumber(value)).toBe(new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value));
    },
  );

  it('keeps visible evidence ordering by descending turn then descending id without changing history', () => {
    const world = createWorld('证据共享顺序');
    const base = world.history[0];
    world.history = [
      { ...base, id: 'event_z_old', turn: 1, sourceFactIds: ['target'] },
      { ...base, id: 'event_b', turn: 2, sourceFactIds: ['target'] },
      { ...base, id: 'event_a', turn: 2, sourceFactIds: ['target'] },
      { ...base, id: 'event_hidden', turn: 3, kind: 'situation_updated', sourceFactIds: ['target'] },
      { ...base, id: 'event_unrelated', turn: 4, sourceFactIds: ['other'] },
    ];
    const before = serializeWorld(world);
    expect(sourceEventIdForFact(world, 'target')).toBe('event_b');
    expect(sourceEventIdForFact(world, 'missing')).toBeNull();
    expect(serializeWorld(world)).toBe(before);
  });

  it('preserves the two record shapes including existing JSON property order', () => {
    const event = createWorld('史事记录字段顺序').history[0];
    const common = { id: event.id, date: `第 ${event.year} 年 · ${event.season}`, title: event.title, summary: event.summary };
    expect(JSON.stringify(historyRecord(event))).toBe(JSON.stringify({ ...common, eventId: event.id, importance: event.importance }));
    expect(JSON.stringify(eventArchiveRecord(event))).toBe(JSON.stringify({ ...common, importance: event.importance, eventId: event.id }));
    expect(historyRecord(event)).toEqual(eventArchiveRecord(event));
  });

  it('does not revive hidden history through a biography link or credit another actor', () => {
    const world = createWorld('履历可见性边界');
    const person = world.characters[0], stranger = world.characters[1], base = world.history[0];
    world.history = [
      { ...base, id: 'visible', turn: 2, actorIds: [person.id], title: '参与朝议', sourceFactIds: [] },
      { ...base, id: 'hidden', turn: 3, actorIds: [person.id], kind: 'situation_updated', title: '内部追踪', sourceFactIds: [] },
      { ...base, id: 'unrelated', turn: 4, actorIds: [stranger.id], title: '他人功绩', sourceFactIds: [] },
    ];
    person.biography = world.history.map(e => ({ id: `bio:${e.id}`, turn: e.turn, kind: e.title,
      summary: e.summary, eventId: e.id, factId: null, importance: e.importance }));
    const before = serializeWorld(world), records = toPersonExperienceRecords(world, person);
    expect(records.some(r => r.eventId === 'visible')).toBe(true);
    expect(records.some(r => r.eventId === 'hidden' || r.eventId === 'unrelated')).toBe(false);
    expect(serializeWorld(world)).toBe(before);
  });
});
