import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld } from '../sim';
import type { HistoryEvent, WorldState } from '../sim/types';
import {
  MAX_QUARTER_PULSE_STORIES,
  projectQuarterPulse,
  selectQuarterPulseStories,
  type QuarterPulseEventStory,
  type QuarterPulseSituationStory,
  type QuarterPulseStory,
} from './quarter-pulse-stories';

function eventStory(
  id: string,
  importance: number,
  patch: Partial<QuarterPulseEventStory> = {},
): QuarterPulseEventStory {
  return {
    id,
    kind: 'event',
    title: `${id}发生`,
    summary: `${id}已经形成可核对结果。`,
    importance,
    sourceFactIds: [],
    historyEventIds: [id],
    regionIds: [],
    category: '世界',
    eventId: id,
    source: 'chronicle',
    ...patch,
  };
}

function situationStory(
  id: string,
  importance: number,
  patch: Partial<QuarterPulseSituationStory> = {},
): QuarterPulseSituationStory {
  return {
    id: `situation:${id}`,
    kind: 'situation',
    title: `${id}升温`,
    summary: `${id}的张力在本季发生明确变化。`,
    importance,
    sourceFactIds: [],
    historyEventIds: [],
    regionIds: [],
    situationId: id,
    situationKind: 'heated',
    kindLabel: '升温',
    basis: 'trend',
    typeLabel: '军权危机',
    threadTitle: id,
    tension: importance,
    delta: 10,
    ...patch,
  };
}

function chronicleEvent(
  world: WorldState,
  id: string,
  patch: Partial<HistoryEvent> = {},
): HistoryEvent {
  const report = world.lastTurn;
  if (!report) throw new Error('expected an advanced world');
  return {
    id,
    turn: report.turn,
    year: report.year,
    season: report.season,
    category: '政治',
    kind: 'court_action',
    title: `${id}发生`,
    summary: `${id}留下了可核对的当季记载。`,
    importance: 3,
    actorIds: [],
    polityIds: [],
    regionIds: [],
    causes: [],
    evidence: [],
    stateDeltas: [],
    sourceFactIds: [],
    situationIds: [],
    ...patch,
  };
}

describe('TRIM01 QuarterPulse story projection', () => {
  it('ranks ordinary history and Situation changes in one normalized pool capped at three stories', () => {
    const candidates: QuarterPulseStory[] = [
      eventStory('event-minor', 20),
      eventStory('event-three', 60),
      situationStory('situation-eighty', 80, {
        basis: 'phase',
        sourceFactIds: ['fact-situation-eighty'],
      }),
      eventStory('event-five', 100),
      eventStory('event-two', 40),
    ];

    const selected = selectQuarterPulseStories(candidates);

    expect(selected).toHaveLength(MAX_QUARTER_PULSE_STORIES);
    expect(selected.map((story) => story.id)).toEqual([
      'event-five',
      'situation:situation-eighty',
      'event-three',
    ]);
  });

  it('uses source Fact and Chronicle identities to collapse duplicate tellings while preserving the winning evidence links', () => {
    const factWinner = eventStory('event-fact-winner', 90, {
      source: 'fact',
      sourceFactIds: ['fact-shared', 'fact-winner'],
      historyEventIds: ['history-fact-winner'],
      regionIds: ['region-fact'],
    });
    const factDuplicate = situationStory('fact-duplicate', 80, {
      sourceFactIds: ['fact-shared', 'fact-situation'],
      historyEventIds: ['history-situation'],
      regionIds: ['region-situation'],
    });
    const historyWinner = eventStory('event-history-winner', 70, {
      sourceFactIds: ['fact-history-winner'],
      historyEventIds: ['history-shared', 'history-winner'],
    });
    const historyDuplicate = situationStory('history-duplicate', 60, {
      sourceFactIds: ['fact-history-duplicate'],
      historyEventIds: ['history-shared'],
    });
    const unrelated = eventStory('event-unrelated', 50, {
      sourceFactIds: ['fact-unrelated'],
      historyEventIds: ['history-unrelated'],
    });

    const selected = selectQuarterPulseStories([
      factDuplicate,
      unrelated,
      historyDuplicate,
      factWinner,
      historyWinner,
    ]);

    expect(selected.map((story) => story.id)).toEqual([
      factWinner.id,
      historyWinner.id,
      unrelated.id,
    ]);
    expect(selected).not.toContainEqual(factDuplicate);
    expect(selected).not.toContainEqual(historyDuplicate);
    expect(selected[0]).toMatchObject({
      sourceFactIds: ['fact-shared', 'fact-situation', 'fact-winner'],
      historyEventIds: ['history-fact-winner', 'history-situation'],
      regionIds: ['region-fact', 'region-situation'],
    });
    expect(selected[1]).toMatchObject({
      sourceFactIds: ['fact-history-duplicate', 'fact-history-winner'],
      historyEventIds: ['history-shared', 'history-winner'],
    });
  });

  it('never uses a bare numerical trend to fill space after concrete events', () => {
    const selected = selectQuarterPulseStories([
      situationStory('trend-ninety', 90),
      situationStory('trend-eighty', 80),
      eventStory('event-three', 60),
      eventStory('event-two', 40),
    ]);

    expect(selected.map((story) => story.id)).toEqual([
      'event-three',
      'event-two',
    ]);
  });

  it('rejects unanchored maintenance chronicles while retaining Fact-, delta-, and named-action records', () => {
    const base = advanceWorld(createWorld('TRIM02季度维护记录契约'));
    const actor = base.characters[0];
    const polity = base.polities.find((item) => item.id === actor.polityId) ?? base.polities[0];
    const region = base.regions.find((item) => item.id === actor.locationRegionId) ?? base.regions[0];
    const maintenance = chronicleEvent(base, 'chronicle-maintenance', {
      kind: 'observer_index_maintenance',
      title: '观察索引例行维护',
      importance: 5,
    });
    const factBacked = chronicleEvent(base, 'chronicle-fact-backed', {
      sourceFactIds: ['fact-recorded-elsewhere'],
      importance: 4,
    });
    const deltaBacked = chronicleEvent(base, 'chronicle-delta-backed', {
      stateDeltas: [{
        entityType: 'world',
        entityId: 'world',
        field: 'seasonalMarker',
        before: false,
        after: true,
      }],
      importance: 3,
    });
    const namedAction = chronicleEvent(base, 'chronicle-named-action', {
      title: `${actor.name}在${region.name}奉${polity.shortName || polity.name}之命议事`,
      actorIds: [actor.id],
      polityIds: [polity.id],
      regionIds: [region.id],
      importance: 2,
    });
    const events = [maintenance, factBacked, deltaBacked, namedAction];
    const world: WorldState = {
      ...base,
      facts: [],
      history: events,
      lastTurn: {
        ...base.lastTurn!,
        factIds: [],
        eventIds: events.map((event) => event.id),
      },
    };

    const projection = projectQuarterPulse(world);

    expect(projection.stories.map((story) => story.id)).toEqual([
      factBacked.id,
      deltaBacked.id,
      namedAction.id,
    ]);
    expect(projection.stories).not.toContainEqual(expect.objectContaining({ id: maintenance.id }));
    expect(projection.stories.find((story) => story.id === namedAction.id)).toMatchObject({
      source: 'chronicle',
      eventId: namedAction.id,
      regionIds: [region.id],
    });
  });

  it('uses stable story identity as the final tie-break regardless of candidate order', () => {
    const candidates = [
      eventStory('event-c', 60, { historyEventIds: ['history-c'] }),
      eventStory('event-a', 60, { historyEventIds: ['history-a'] }),
      eventStory('event-b', 60, { historyEventIds: ['history-b'] }),
    ];

    const forward = selectQuarterPulseStories(candidates);
    const reversed = selectQuarterPulseStories([...candidates].reverse());

    expect(forward.map((story) => story.id)).toEqual(['event-a', 'event-b', 'event-c']);
    expect(reversed).toEqual(forward);
  });

  it('is deterministic and leaves the authoritative world JSON and hash untouched', () => {
    const world = advanceWorld(createWorld('TRIM01共同季报纯投影'));
    const before = JSON.stringify(world);
    const hashBefore = world.hash;

    const first = projectQuarterPulse(world);
    const second = projectQuarterPulse(world);

    expect(second).toEqual(first);
    expect(first.stories.length).toBeLessThanOrEqual(MAX_QUARTER_PULSE_STORIES);
    expect(JSON.stringify(world)).toBe(before);
    expect(world.hash).toBe(hashBefore);
  });

  it('keeps forty real quarters bounded, current-dated, and free of repeated evidence', () => {
    let world = createWorld('TRIM01四十季证据门');
    for (let turn = 1; turn <= 40; turn += 1) {
      world = advanceWorld(world);
      const projection = projectQuarterPulse(world);
      const report = world.lastTurn;
      expect(report?.turn).toBe(turn - 1);
      expect(projection.stories.length).toBeLessThanOrEqual(MAX_QUARTER_PULSE_STORIES);
      expect(projection.stories.every((story) => story.kind === 'event')).toBe(true);

      const seenFacts = new Set<string>();
      const seenEvents = new Set<string>();
      for (const story of projection.stories) {
        for (const factId of story.sourceFactIds) {
          expect(seenFacts.has(factId)).toBe(false);
          seenFacts.add(factId);
          expect(world.facts.find((fact) => fact.id === factId)?.turn).toBe(report?.turn);
        }
        for (const eventId of story.historyEventIds) {
          expect(seenEvents.has(eventId)).toBe(false);
          seenEvents.add(eventId);
          expect(world.history.find((event) => event.id === eventId)?.turn).toBe(report?.turn);
        }
        if (story.kind === 'event' && story.eventId) {
          expect(world.history.find((event) => event.id === story.eventId)?.turn).toBe(report?.turn);
        }
      }

      expect(projection.highlightedRegionIds).toEqual([
        ...new Set(projection.stories.flatMap((story) => story.regionIds)),
      ].slice(0, 16));
    }
  });
});
