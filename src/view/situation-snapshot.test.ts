import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim';
import type { WorldState } from '../sim/types';
import type { SituationState, SituationSystemState } from '../sim/situations';
import {
  MAX_SNAPSHOT_OPEN_SITUATIONS,
  MAX_SNAPSHOT_RECENT_RESOLVED_SITUATIONS,
  projectSituationSystemSnapshot,
  toSituationSnapshot,
} from './situation-snapshot';

function testSituation(world: WorldState, patch: Partial<SituationState> = {}): SituationState {
  const character = world.characters[0];
  const supporter = world.characters[1];
  const opponent = world.characters[2];
  const polity = world.polities[0];
  const family = world.families[0];
  const faction = world.factions[0];
  const region = world.regions[0];
  const army = world.armies[0];
  const fleet = world.fleets[0];
  return {
    id: 'situation_000001',
    type: 'military_power_crisis',
    scopeKey: `${polity.id}:${character.id}`,
    titleKey: 'military_power_crisis',
    status: 'open',
    phase: 'active',
    startedTurn: 3,
    phaseSinceTurn: 4,
    lastUpdatedTurn: 5,
    resolvedTurn: null,
    tension: 72,
    momentum: 8,
    consecutivePhaseRiseTurns: 1,
    consecutivePhaseFallTurns: 0,
    consecutiveBelowResolutionTurns: 0,
    participants: {
      coreCharacterIds: [character.id],
      supportingCharacterIds: [supporter.id],
      opposingCharacterIds: [opponent.id],
      familyIds: [family.id],
      factionIds: [faction.id],
      polityIds: [polity.id],
      regionIds: [region.id],
      armyIds: [army.id],
      fleetIds: [fleet.id],
    },
    executableActorIds: [character.id],
    signals: [
      {
        key: 'weak_central_authority',
        role: 'structural',
        contribution: 14,
        refs: [{
          kind: 'index', entityType: 'polity', entityId: polity.id,
          field: 'authority', value: polity.authority,
        }],
      },
      {
        key: 'recent_battle_record',
        role: 'trigger',
        contribution: 9,
        refs: [{ kind: 'fact', factId: 'fact_battle_5' }],
      },
      {
        key: 'strong_loyalty',
        role: 'inhibitor',
        contribution: -4,
        refs: [{
          kind: 'index', entityType: 'character', entityId: character.id,
          field: 'loyalty', value: character.loyalty,
        }],
      },
    ],
    causalFactIds: ['fact_battle_5', 'fact_order_5'],
    milestoneFactIds: ['fact_battle_5'],
    recentChanges: [
      {
        turn: 3,
        kind: 'formed',
        tension: 58,
        fromPhase: null,
        toPhase: 'emerging',
        sourceFactIds: ['fact_formed_3'],
      },
      {
        turn: 5,
        kind: 'phase_changed',
        tension: 72,
        fromPhase: 'emerging',
        toPhase: 'active',
        sourceFactIds: ['fact_battle_5'],
      },
    ],
    possibleOutcomes: [{ key: 'submission', confidence: 55 }],
    nextWatch: {
      key: 'watch_recall_or_refusal',
      refs: [
        {
          kind: 'index', entityType: 'polity', entityId: polity.id,
          field: 'authority', value: polity.authority,
        },
        { kind: 'fact', factId: 'fact_order_5' },
      ],
    },
    startSnapshot: {
      turn: 3,
      pressure: 58,
      participantDigest: 'participant-digest',
      evidenceDigest: 'evidence-digest',
    },
    resolution: null,
    importance: 78,
    visibility: 84,
    ...patch,
  };
}

function situationSystem(
  situations: SituationState[],
  archivedResolvedCount = 0,
): SituationSystemState {
  return {
    version: 1,
    lastReducedTurn: Math.max(0, ...situations.map((item) => item.lastUpdatedTurn)),
    nextSituationNumber: situations.length + 1,
    candidates: [],
    situations,
    archive: {
      resolvedCount: archivedResolvedCount,
      resolvedDigest: 'archive-digest',
    },
  };
}

function resolvedSituation(
  world: WorldState,
  id: string,
  resolvedTurn: number,
): SituationState {
  return testSituation(world, {
    id,
    status: 'resolved',
    lastUpdatedTurn: resolvedTurn,
    resolvedTurn,
    momentum: -7,
    resolution: {
      outcomeKey: 'submission',
      resolvedTurn,
      resultFactIds: [`fact_resolved_${resolvedTurn}`],
      belowThresholdTurns: 2,
      finalSnapshotDigest: `digest-${resolvedTurn}`,
    },
    recentChanges: [{
      turn: resolvedTurn,
      kind: 'resolved',
      tension: 30,
      fromPhase: 'active',
      toPhase: 'active',
      sourceFactIds: [`fact_resolved_${resolvedTurn}`],
    }],
  });
}

describe('Situation observer snapshot', () => {
  it('projects Chinese participant labels and detached structured evidence', () => {
    const world = createWorld('Situation只读投影-标签');
    const situation = testSituation(world);
    world.situationSystem = situationSystem([situation]);
    const before = JSON.stringify(world.situationSystem);

    const snapshot = toSituationSnapshot(world);
    const direct = projectSituationSystemSnapshot(world.situationSystem, world);

    expect(snapshot).toEqual(direct);
    expect(snapshot).toMatchObject({
      version: 1,
      openCount: 1,
      resolvedCount: 0,
      archivedResolvedCount: 0,
    });
    const item = snapshot.open[0];
    expect(item).toMatchObject({
      id: situation.id,
      type: 'military_power_crisis',
      typeLabel: '军权危机',
      status: 'open',
      statusLabel: '发展中',
      phase: 'active',
      phaseLabel: '发展',
      tension: 72,
      momentum: 8,
      startedTurn: 3,
      phaseSinceTurn: 4,
      causalFactIds: ['fact_battle_5', 'fact_order_5'],
      milestoneFactIds: ['fact_battle_5'],
      latestChange: {
        turn: 5,
        kind: 'phase_changed',
        label: '阶段变化',
        sourceFactIds: ['fact_battle_5'],
      },
      nextSignal: {
        key: 'watch_recall_or_refusal',
        factIds: ['fact_order_5'],
      },
    });
    expect(item.title).toContain(world.characters[0].name);
    expect(item.title).toContain(world.polities[0].shortName || world.polities[0].name);
    expect(item.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'coreCharacterIds',
        label: '核心人物',
        entities: [{ id: world.characters[0].id, label: world.characters[0].name }],
      }),
      expect.objectContaining({
        key: 'familyIds',
        label: '相关家族',
        entities: [{ id: world.families[0].id, label: world.families[0].name }],
      }),
      expect.objectContaining({
        key: 'armyIds',
        label: '相关军团',
        entities: [{ id: world.armies[0].id, label: world.armies[0].name }],
      }),
    ]));
    expect(item.evidence).toHaveLength(3);
    expect(item.evidence[0]).toMatchObject({
      key: 'weak_central_authority',
      label: '中央权威不足',
      contribution: 14,
      factIds: [],
    });
    expect(item.evidence[1]).toMatchObject({
      key: 'recent_battle_record',
      contribution: 9,
      factIds: ['fact_battle_5'],
      refs: [{ kind: 'fact', factId: 'fact_battle_5' }],
    });
    expect(item.evidence.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(world.situationSystem)).toBe(before);

    item.participants[0].entities[0].label = '改写投影';
    item.evidence[0].refs.splice(0);
    expect(JSON.stringify(world.situationSystem)).toBe(before);
  });

  it('bounds open situations and retains only the two newest resolved summaries', () => {
    const world = createWorld('Situation只读投影-边界');
    const open = Array.from({ length: MAX_SNAPSHOT_OPEN_SITUATIONS + 3 }, (_, index) => (
      testSituation(world, {
        id: `situation_open_${String(index).padStart(2, '0')}`,
        phase: index === 0 ? 'critical' : index === 1 ? 'active' : 'emerging',
        importance: 100 - index,
        tension: 90 - index,
      })
    ));
    const resolved = Array.from({ length: 4 }, (_, index) => (
      resolvedSituation(world, `situation_resolved_${index}`, 20 + index)
    ));
    world.situationSystem = situationSystem([...open, ...resolved], 7);

    const snapshot = toSituationSnapshot(world);

    expect(snapshot.openCount).toBe(open.length);
    expect(snapshot.open).toHaveLength(MAX_SNAPSHOT_OPEN_SITUATIONS);
    expect(snapshot.open[0]).toMatchObject({ id: 'situation_open_00', phase: 'critical' });
    expect(new Set(snapshot.open.map((item) => item.id)).size).toBe(snapshot.open.length);
    expect(snapshot.recentResolved).toHaveLength(MAX_SNAPSHOT_RECENT_RESOLVED_SITUATIONS);
    expect(snapshot.recentResolved.map((item) => item.id)).toEqual([
      'situation_resolved_3',
      'situation_resolved_2',
    ]);
    expect(snapshot.recentResolved.every((item) => item.status === 'resolved')).toBe(true);
    expect(snapshot.archivedResolvedCount).toBe(7);
    expect(snapshot.resolvedCount).toBe(11);
    expect(toSituationSnapshot(world)).toEqual(snapshot);
  });

  it('projects inheritance crises with Chinese evidence, watch copy, and a polity title', () => {
    const world = createWorld('Situation继承危机-投影');
    const polity = world.polities[0];
    const situation = testSituation(world, {
      id: 'situation_inheritance_01',
      type: 'inheritance_crisis',
      scopeKey: polity.id,
      titleKey: 'situation.inheritance_crisis',
      signals: [
        {
          key: 'no_legal_successor',
          role: 'structural',
          contribution: 24,
          refs: [{
            kind: 'index',
            entityType: 'succession_pool',
            entityId: polity.id,
            field: 'legalCandidateCount',
            value: 0,
          }],
        },
        {
          key: 'weak_succession_enforcement',
          role: 'structural',
          contribution: 12,
          refs: [{
            kind: 'index',
            entityType: 'polity',
            entityId: polity.id,
            field: 'authority',
            value: polity.authority,
          }],
        },
      ],
      nextWatch: {
        key: 'watch_heir_designation',
        refs: [{
          kind: 'index',
          entityType: 'polity',
          entityId: polity.id,
          field: 'rulingFamilyId',
          value: polity.rulingFamilyId,
        }],
      },
    });
    world.situationSystem = situationSystem([situation]);

    const item = toSituationSnapshot(world).open[0];

    expect(item).toMatchObject({
      type: 'inheritance_crisis',
      typeLabel: '继承危机',
      title: `${polity.shortName || polity.name}的继承危机`,
      nextSignal: {
        key: 'watch_heir_designation',
        label: '观察统治家族是否出现合法候选人',
      },
    });
    expect(item.evidence.map((entry) => entry.label)).toEqual([
      '合法继承人缺位',
      '中央难以执行继承安排',
    ]);
    expect(item.nextSignal.label).not.toContain('watch_');
  });
});
