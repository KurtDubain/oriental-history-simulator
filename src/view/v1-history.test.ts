import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim';
import type { HistoryEvent, SimulationFact, WorldState } from '../sim/types';
import {
  buildHistoryRelatedEntities,
  clampHistoryTurn,
  decodeHistoryRelatedEntity,
  encodeHistoryRelatedEntity,
  filterHistoryEvents,
  historyTurnDate,
  reconstructHistoricalTerritory,
} from './v1-history';

function historyEvent(
  id: string,
  turn: number,
  input: Partial<HistoryEvent> = {},
): HistoryEvent {
  const date = historyTurnDate(turn);
  return {
    id,
    turn,
    year: date.year,
    season: date.season,
    category: '世界',
    kind: 'test_event',
    title: `史事 ${id}`,
    summary: '一条可检索、可追溯的测试记载。',
    importance: 2,
    actorIds: [],
    polityIds: [],
    regionIds: [],
    causes: [],
    evidence: [],
    stateDeltas: [],
    ...input,
    sourceFactIds: input.sourceFactIds ?? [],
    situationIds: input.situationIds ?? [],
  };
}

function historyWorld(): WorldState {
  const world = createWorld('V1 历史工作台测试');
  world.turn = 4;
  world.year = 2;
  world.season = '春';
  return world;
}

function territoryFact(
  id: string,
  turn: number,
  regionId: string,
  previousControllerId: string,
  nextControllerId: string,
): Extract<SimulationFact, { kind: 'territory_control_changed' }> {
  const date = historyTurnDate(turn);
  return {
    id,
    turn,
    year: date.year,
    season: date.season,
    kind: 'territory_control_changed',
    category: '军事',
    importance: 4,
    actorIds: [],
    polityIds: [previousControllerId, nextControllerId],
    regionIds: [regionId],
    causes: [{ label: '测试控制权', role: '结果', weight: 1, evidence: `${previousControllerId}→${nextControllerId}` }],
    stateDeltas: [{ entityType: 'region', entityId: regionId, field: 'controllerId', before: previousControllerId, after: nextControllerId }],
    sourceFactIds: [],
    payload: { regionId, previousControllerId, nextControllerId, reason: 'battle_capture', warId: null },
  };
}

describe('V1 history territory reconstruction', () => {
  it('reverses later controller deltas without mutating the current world', () => {
    const world = historyWorld();
    const firstPolity = world.polities[0];
    const secondPolity = world.polities[1];
    const region = world.regions.find((item) => item.controllerId === firstPolity.id) ?? world.regions[0];
    region.controllerId = firstPolity.id;
    secondPolity.foundedTurn = 1;
    secondPolity.eliminatedTurn = 3;
    secondPolity.alive = false;
    const firstCapture = territoryFact('fact_capture', 1, region.id, firstPolity.id, secondPolity.id);
    const recapture = territoryFact('fact_recapture', 3, region.id, secondPolity.id, firstPolity.id);
    world.facts = [firstCapture, recapture];
    world.history = [
      historyEvent('opening', 0, { importance: 5 }),
      historyEvent('first-capture', 1, {
        category: '军事',
        importance: 4,
        sourceFactIds: [firstCapture.id],
        stateDeltas: [{
          entityType: 'region', entityId: region.id, field: 'controllerId',
          before: firstPolity.id, after: secondPolity.id,
        }],
      }),
      historyEvent('recapture', 3, {
        category: '军事',
        importance: 5,
        sourceFactIds: [recapture.id],
        // Deliberately conflicts with the fact. Rewind must ignore this
        // presentation delta instead of reversing the same transfer twice.
        stateDeltas: [{
          entityType: 'region', entityId: region.id, field: 'controllerId',
          before: firstPolity.id, after: firstPolity.id,
        }],
      }),
    ];

    const currentController = region.controllerId;
    const atOpening = reconstructHistoricalTerritory(world, 0);
    const afterFirstCapture = reconstructHistoricalTerritory(world, 1);
    const afterElimination = reconstructHistoricalTerritory(world, 3);

    expect(atOpening.controllerByRegionId[region.id]).toBe(firstPolity.id);
    expect(afterFirstCapture.controllerByRegionId[region.id]).toBe(secondPolity.id);
    expect(afterFirstCapture.extantPolities.some((polity) => polity.id === secondPolity.id)).toBe(true);
    expect(afterFirstCapture.historyStats.eventsAtTurn).toBe(1);
    expect(afterFirstCapture.historyStats.majorEventsThroughTurn).toBe(2);
    expect(afterFirstCapture.reversedControllerChanges).toBe(1);
    expect(afterFirstCapture.confidence).toBe('complete');
    expect(afterElimination.controllerByRegionId[region.id]).toBe(firstPolity.id);
    expect(afterElimination.extantPolities.some((polity) => polity.id === secondPolity.id)).toBe(false);
    expect(region.controllerId).toBe(currentController);
  });

  it('combines post-migration territory facts with bounded legacy event fallback', () => {
    const world = historyWorld();
    const firstPolity = world.polities[0];
    const secondPolity = world.polities[1];
    const region = world.regions.find((item) => item.controllerId === firstPolity.id) ?? world.regions[0];
    region.controllerId = firstPolity.id;
    const legacyCapture = historyEvent('legacy-capture', 1, {
      stateDeltas: [{ entityType: 'region', entityId: region.id, field: 'controllerId', before: firstPolity.id, after: secondPolity.id }],
    });
    const newRecapture = territoryFact('fact_new_recapture', 4, region.id, secondPolity.id, firstPolity.id);
    world.history = [historyEvent('legacy-opening', 0), legacyCapture, historyEvent('projected-recapture', 4, { sourceFactIds: [newRecapture.id] })];
    world.facts = [newRecapture];
    world.legacyArchiveBoundary = {
      sourceSchemaVersion: 3,
      turn: 2,
      historyEventCount: 2,
      historyDigest: 'legacy-digest',
    };

    const before = JSON.stringify({ controller: region.controllerId, history: world.history, facts: world.facts });
    expect(reconstructHistoricalTerritory(world, 0).controllerByRegionId[region.id]).toBe(firstPolity.id);
    expect(reconstructHistoricalTerritory(world, 2).controllerByRegionId[region.id]).toBe(secondPolity.id);
    expect(JSON.stringify({ controller: region.controllerId, history: world.history, facts: world.facts })).toBe(before);
  });

  it('marks malformed territory facts partial instead of trusting presentation deltas', () => {
    const world = historyWorld();
    world.facts = [{
      ...territoryFact('fact_malformed', 4, world.regions[0].id, world.polities[0].id, world.polities[1].id),
      payload: null,
    } as unknown as SimulationFact];
    const view = reconstructHistoricalTerritory(world, 0);
    expect(view.confidence).toBe('partial');
    expect(view.skippedControllerChanges).toBe(1);
  });

  it('clamps dates to the recorded world boundary', () => {
    const world = historyWorld();
    expect(clampHistoryTurn(world, -8)).toBe(0);
    expect(clampHistoryTurn(world, 99)).toBe(4);
    expect(historyTurnDate(7)).toEqual({ year: 2, season: '冬', label: '第 2 年 · 冬季' });
  });
});

describe('V1 history search', () => {
  it('searches narrative, evidence and entity names, then combines causal filters', () => {
    const world = historyWorld();
    const person = world.characters[0];
    const polity = world.polities[0];
    const region = world.regions[0];
    world.history = [
      historyEvent('opening', 0, { title: '诸国立纪', importance: 5 }),
      historyEvent('famine-council', 1, {
        category: '政治',
        title: `${polity.shortName}召开赈济廷议`,
        summary: '朝臣商议开仓安置流民。',
        importance: 4,
        actorIds: [person.id],
        polityIds: [polity.id],
        causes: [{
          label: '粮荒压力',
          weight: 1,
          evidence: `${region.name}连续歉收，仓廪告急`,
          refs: [{ kind: 'entity', entityType: 'region', entityId: region.id, label: '受灾州域' }],
        }],
      }),
      historyEvent('border-battle', 2, {
        category: '军事',
        title: `${region.name}边军交战`,
        importance: 3,
        actorIds: [person.id],
        polityIds: [polity.id],
        regionIds: [region.id],
      }),
    ];

    expect(filterHistoryEvents(world, { query: `${person.name} 粮荒` }).map((event) => event.id))
      .toEqual(['famine-council']);
    expect(filterHistoryEvents(world, {
      categories: ['政治'],
      minimumImportance: 4,
      relatedEntity: { kind: 'region', id: region.id },
      throughTurn: 1,
    }).map((event) => event.id)).toEqual(['famine-council']);
    expect(filterHistoryEvents(world, {
      categories: ['军事'],
      minimumImportance: 4,
    })).toEqual([]);
    expect(filterHistoryEvents(world).map((event) => event.id))
      .toEqual(['border-battle', 'famine-council', 'opening']);
  });

  it('builds deduplicated related-object choices and round-trips option values', () => {
    const world = historyWorld();
    const person = world.characters[0];
    const region = world.regions[0];
    world.history = [historyEvent('linked', 1, {
      actorIds: [person.id],
      regionIds: [region.id],
      causes: [{
        label: '凭证', weight: 1, evidence: '同一对象也出现在凭证中',
        refs: [
          { kind: 'entity', entityType: 'character', entityId: person.id, label: '行动者' },
          { kind: 'entity', entityType: 'region', entityId: region.id, label: '州域' },
        ],
      }],
    })];

    const options = buildHistoryRelatedEntities(world);
    expect(options.find((option) => option.kind === 'character' && option.id === person.id)?.eventCount).toBe(1);
    expect(options.find((option) => option.kind === 'region' && option.id === region.id)?.eventCount).toBe(1);
    const encoded = encodeHistoryRelatedEntity({ kind: 'character', id: person.id });
    expect(decodeHistoryRelatedEntity(encoded)).toEqual({ kind: 'character', id: person.id });
    expect(decodeHistoryRelatedEntity('army:a_1')).toBeNull();
  });
});
