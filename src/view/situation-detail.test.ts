import { describe, expect, it } from 'vitest';
import { advanceWorldBy, createWorld } from '../sim';
import type { WorldState } from '../sim/types';
import type { SituationState } from '../sim/situations';
import {
  MAX_SITUATION_DETAIL_DELTAS,
  MAX_SITUATION_DETAIL_FACTS,
  MAX_SITUATION_DETAIL_TIMELINE,
  MAX_SITUATION_DIRECTORY_RESOLVED,
  projectSituationDetail,
  projectSituationWorkbench,
} from './situation-detail';

function establishedWorld(): WorldState {
  return advanceWorldBy(createWorld('春战副将'), 8);
}

function withoutOptionalHistoryLinks<T extends {
  timeline: Array<{ historyEventIds: string[] }>;
  evidence: Array<{ historyEventIds: string[] }>;
  scenes: Array<{ historyEventIds: readonly string[] }>;
}>(detail: T) {
  return {
    ...detail,
    timeline: detail.timeline.map(({ historyEventIds: _historyEventIds, ...item }) => item),
    evidence: detail.evidence.map(({ historyEventIds: _historyEventIds, ...item }) => item),
    scenes: detail.scenes.map(({ historyEventIds: _historyEventIds, ...item }) => item),
  };
}

describe('Situation detail projection', () => {
  it('renders all three real Situation types as bounded Chinese stories without mutating the world', () => {
    const world = establishedWorld();
    const before = JSON.stringify(world);
    const hash = world.hash;
    const types = new Set(world.situationSystem.situations.map((item) => item.type));
    expect(types).toEqual(new Set(['military_power_crisis', 'inheritance_crisis', 'war_progress']));

    for (const situation of world.situationSystem.situations) {
      const detail = projectSituationDetail(world, situation);
      expect(detail.title).toMatch(/危机|战争进程/);
      expect(detail.playerSummary.length).toBeGreaterThanOrEqual(2);
      expect(detail.playerSummary.join('')).not.toMatch(/military_power_crisis|inheritance_crisis|war_progress|situation_/);
      expect(detail.nextWatch).toMatch(/[\u3400-\u9fff]/u);
      expect(detail.timeline.length).toBeLessThanOrEqual(MAX_SITUATION_DETAIL_TIMELINE);
      expect(detail.evidence.length).toBeLessThanOrEqual(MAX_SITUATION_DETAIL_FACTS);
      expect(detail.consequences.length).toBeLessThanOrEqual(MAX_SITUATION_DETAIL_DELTAS);
      expect(detail.audit.situationId).toBe(situation.id);
      expect(detail.audit.randomness).toContain('无');
      expect(detail.audit.coverageNotes.join('')).toContain('不可倒推');
    }

    const warSituation = world.situationSystem.situations.find((item) => item.type === 'war_progress');
    if (!warSituation) throw new Error('expected natural war Situation');
    const war = world.wars.find((item) => item.id === warSituation.scopeKey);
    if (!war) throw new Error('expected matching war state');
    const detail = projectSituationDetail(world, warSituation);
    const attacker = world.polities.find((item) => item.id === war.attackerId);
    const defender = world.polities.find((item) => item.id === war.defenderId);
    const attackerLabel = attacker?.shortName || attacker?.name;
    const defenderLabel = defender?.shortName || defender?.name;
    expect(detail.title.indexOf(attackerLabel ?? '')).toBeLessThan(detail.title.indexOf(defenderLabel ?? ''));

    expect(world.hash).toBe(hash);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('uses Chronicle only for optional navigation links, never for story, outcome, or consequence truth', () => {
    const world = establishedWorld();
    const situation = world.situationSystem.situations[0];
    const withChronicle = projectSituationDetail(world, situation);
    const withoutChronicle = projectSituationDetail({ ...world, history: [] }, situation);

    expect(withoutOptionalHistoryLinks(withoutChronicle)).toEqual(withoutOptionalHistoryLinks(withChronicle));
    expect(withoutChronicle.playerSummary).toEqual(withChronicle.playerSummary);
    expect(withoutChronicle.outcome).toEqual(withChronicle.outcome);
    expect(withoutChronicle.consequences).toEqual(withChronicle.consequences);
  });

  it('builds a truthful result-Fact closure and marks missing evidence instead of inventing it', () => {
    const world = establishedWorld();
    const source = world.situationSystem.situations.find((item) => item.type === 'military_power_crisis');
    const resultFact = world.facts.find((fact) => fact.stateDeltas.length > 0);
    if (!source || !resultFact) throw new Error('expected Situation and result Fact');
    const resolvedTurn = world.turn;
    const resolved: SituationState = {
      ...source,
      id: 'situation_projection_resolved',
      status: 'resolved',
      resolvedTurn,
      lastUpdatedTurn: resolvedTurn,
      momentum: -9,
      recentChanges: [...source.recentChanges, {
        turn: resolvedTurn,
        kind: 'resolved',
        tension: 22,
        fromPhase: source.phase,
        toPhase: source.phase,
        sourceFactIds: [resultFact.id],
      }],
      resolution: {
        outcomeKey: 'command_removed',
        resolvedTurn,
        resultFactIds: [resultFact.id],
        belowThresholdTurns: 0,
        finalSnapshotDigest: 'projection-final-digest',
      },
    };
    const detail = projectSituationDetail(world, resolved);
    expect(detail.status).toBe('resolved');
    expect(detail.outcome).toMatchObject({ label: '军职已经解除', resultFactIds: [resultFact.id] });
    expect(detail.playerSummary).toHaveLength(3);
    expect(detail.playerSummary.join('')).toContain('历时');
    expect(detail.playerSummary[0]).toMatch(/[㐀-鿿].*(受任|去职|之战|易手|去世|成婚|请|军令|支持)/u);
    expect(detail.consequences.length).toBeGreaterThan(0);
    expect(new Set(detail.consequences.map((item) => item.factId))).toEqual(new Set([resultFact.id]));
    expect(detail.consequenceCoverage).toContain('直接');

    const missing = projectSituationDetail(world, {
      ...resolved,
      resolution: { ...resolved.resolution!, resultFactIds: ['fact_missing_result'] },
    });
    expect(missing.consequences).toEqual([]);
    expect(missing.audit.missingFactIds).toContain('fact_missing_result');
    expect(missing.consequenceCoverage).toContain('缺页');
  });

  it('bounds the directory and deterministically retains only the newest resolved cases', () => {
    const world = establishedWorld();
    const base = world.situationSystem.situations[0];
    const resolved = Array.from({ length: MAX_SITUATION_DIRECTORY_RESOLVED + 4 }, (_, index): SituationState => ({
      ...base,
      id: `situation_resolved_${String(index).padStart(2, '0')}`,
      status: 'resolved',
      resolvedTurn: 30 + index,
      lastUpdatedTurn: 30 + index,
      resolution: {
        outcomeKey: 'actor_died',
        resolvedTurn: 30 + index,
        resultFactIds: [],
        belowThresholdTurns: 3,
        finalSnapshotDigest: `digest-${index}`,
      },
    }));
    const projection = projectSituationWorkbench({
      ...world,
      situationSystem: {
        ...world.situationSystem,
        situations: resolved,
        archive: { resolvedCount: 9, resolvedDigest: 'archive-digest' },
      },
    });

    expect(projection.open).toEqual([]);
    expect(projection.recentResolved).toHaveLength(MAX_SITUATION_DIRECTORY_RESOLVED);
    expect(projection.recentResolved[0].id).toBe('situation_resolved_11');
    expect(projection.recentResolved.at(-1)?.id).toBe('situation_resolved_04');
    expect(projection.resolvedCount).toBe(21);
    expect(projectSituationWorkbench({
      ...world,
      situationSystem: { ...world.situationSystem, situations: resolved },
    }).recentResolved.map((item) => item.id)).toEqual(
      resolved.slice().sort((left, right) => (right.resolvedTurn ?? 0) - (left.resolvedTurn ?? 0)).slice(0, 8).map((item) => item.id),
    );
  });
});
