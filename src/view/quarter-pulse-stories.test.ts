import { describe, expect, it } from 'vitest';

import { advanceWorld, createWorld } from '../sim';
import type { HistoryEvent, SimulationFact, WorldState } from '../sim/types';
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

  it('requires a concrete military or court result instead of treating any anchored chronicle as main news', () => {
    const base = advanceWorld(createWorld('TRIM02季度维护记录契约'));
    const actor = base.characters[0];
    const polity = base.polities.find((item) => item.id === actor.polityId) ?? base.polities[0];
    const region = base.regions.find((item) => item.id === actor.locationRegionId) ?? base.regions[0];
    const maintenance = chronicleEvent(base, 'chronicle-maintenance', {
      kind: 'observer_index_maintenance',
      title: '观察索引例行维护',
      importance: 5,
    });
    const armyRaised = chronicleEvent(base, 'chronicle-army-raised', {
      category: '军事',
      kind: 'army_raised',
      title: `${polity.name}编成新军`,
      polityIds: [polity.id],
      regionIds: [region.id],
      stateDeltas: [{ entityType: 'army', entityId: 'army-new', field: 'soldiers', before: 0, after: 2_000 }],
      importance: 4,
    });
    const legitimacyCrisis = chronicleEvent(base, 'chronicle-legitimacy-crisis', {
      kind: 'legitimacy_crisis',
      title: `${polity.name}国统动摇`,
      polityIds: [polity.id],
      stateDeltas: [{
        entityType: 'polity',
        entityId: polity.id,
        field: 'legitimacy',
        before: 31,
        after: 29,
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
    const events = [maintenance, armyRaised, legitimacyCrisis, namedAction];
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
      armyRaised.id,
      legitimacyCrisis.id,
    ]);
    expect(projection.stories).not.toContainEqual(expect.objectContaining({ id: maintenance.id }));
    expect(projection.stories).not.toContainEqual(expect.objectContaining({ id: namedAction.id }));
  });

  it('keeps ordinary trade, migration and disease out of the default three stories without a proven military or court consequence', () => {
    const base = advanceWorld(createWorld('军政无关周边不得抢位'));
    const region = base.regions[0];
    const background = [
      chronicleEvent(base, 'ordinary-trade', {
        category: '经济', kind: 'trade_delivery', title: '一批纺织品到岸', importance: 5,
        regionIds: [region.id], stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'wealth', before: 10, after: 12 }],
      }),
      chronicleEvent(base, 'ordinary-migration', {
        category: '迁徙', kind: 'refugee_settlement', title: '流民落籍', importance: 5,
        regionIds: [region.id], stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'refugeePopulation', before: 10, after: 30 }],
      }),
      chronicleEvent(base, 'ordinary-disease', {
        category: '疾病', kind: 'outbreak_detected', title: '地方察觉时疫', importance: 5,
        regionIds: [region.id], stateDeltas: [{ entityType: 'infection', entityId: 'infection-background', field: 'infectious', before: 0, after: 20 }],
      }),
    ];
    const world: WorldState = {
      ...base,
      facts: [],
      history: background,
      lastTurn: { ...base.lastTurn!, factIds: [], eventIds: background.map((event) => event.id) },
    };

    expect(projectQuarterPulse(world).stories).toEqual([]);
  });

  it('does not promote a high-importance ordinary Fact scene without a military or court result', () => {
    const base = advanceWorld(createWorld('普通事实不入主季报'));
    const report = base.lastTurn!;
    const left = base.characters[0];
    const right = base.characters.find((character) => character.id !== left.id) ?? base.characters[1];
    const fact: Extract<SimulationFact, { kind: 'marriage' }> = {
      id: 'fact-ordinary-marriage',
      turn: report.turn,
      year: report.year,
      season: report.season,
      kind: 'marriage',
      category: '政治',
      importance: 5,
      actorIds: [left.id, right.id],
      polityIds: [left.polityId, right.polityId],
      regionIds: [left.locationRegionId],
      causes: [],
      stateDeltas: [],
      sourceFactIds: [],
      payload: {
        leftCharacterId: left.id,
        rightCharacterId: right.id,
        leftFamilyId: left.familyId ?? 'family-left',
        rightFamilyId: right.familyId ?? 'family-right',
        diplomatic: false,
      },
    };
    const world: WorldState = {
      ...base,
      facts: [fact],
      history: [],
      lastTurn: { ...report, factIds: [fact.id], eventIds: [] },
    };

    expect(projectQuarterPulse(world).stories).toEqual([]);
  });

  it('沧衡-甲子首季不再让两条普通通商约占据主季报', () => {
    const world = advanceWorld(createWorld('沧衡-甲子'));
    const projection = projectQuarterPulse(world);
    const ordinaryTradeTreaties = projection.stories.filter((story) => (
      story.kind === 'event'
      && story.source === 'chronicle'
      && (story.title.includes('通商约') || story.title.includes('商约'))
    ));

    expect(projection.stories.length).toBeLessThanOrEqual(MAX_QUARTER_PULSE_STORIES);
    expect(ordinaryTradeTreaties).toEqual([]);
    expect(projection.stories.map((story) => story.title)).not.toEqual([
      '沧海盟与燕国缔结通商约',
      '齐国与和国缔结通商约',
    ]);
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
