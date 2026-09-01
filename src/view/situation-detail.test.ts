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
  it('renders the three baseline Situation types as bounded Chinese stories without mutating the world', () => {
    const world = establishedWorld();
    const before = JSON.stringify(world);
    const hash = world.hash;
    const types = new Set(world.situationSystem.situations.map((item) => item.type));
    expect([...types]).toEqual(expect.arrayContaining(['military_power_crisis', 'inheritance_crisis', 'war_progress']));

    for (const situation of world.situationSystem.situations) {
      const detail = projectSituationDetail(world, situation);
      expect(detail.title).toMatch(/危机|战争进程|朝堂权斗/);
      expect(detail.playerSummary.length).toBeGreaterThanOrEqual(1);
      expect(detail.playerSummary.length).toBeLessThanOrEqual(2);
      expect(`${detail.currentChange}${detail.playerSummary.join('')}`).not.toMatch(/military_power_crisis|inheritance_crisis|war_progress|court_power_struggle|situation_|持续张力|结构证据|推动因素|阶段转折/);
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

  it('projects court power struggles as a concrete polity story backed by the POL01 vocabulary', () => {
    const world = establishedWorld();
    const base = world.situationSystem.situations[0];
    const polity = world.polities.find((item) => item.alive);
    const factions = world.factions.filter((item) => item.active && item.polityId === polity?.id).slice(0, 2);
    if (!base || !polity || factions.length === 0) throw new Error('expected baseline Situation and court participants');
    const court: SituationState = {
      ...base,
      id: 'situation_court_projection',
      type: 'court_power_struggle',
      titleKey: 'situation.court_power_struggle',
      scopeKey: polity.id,
      participants: {
        coreCharacterIds: [polity.rulerId, factions[0].leaderId],
        supportingCharacterIds: [],
        opposingCharacterIds: [],
        familyIds: [],
        factionIds: factions.map((item) => item.id),
        polityIds: [polity.id],
        regionIds: polity.capitalRegionId ? [polity.capitalRegionId] : [],
        armyIds: [],
        fleetIds: [],
      },
      signals: [
        {
          key: 'challenger_central_office',
          role: 'structural',
          contribution: 16,
          refs: [{ kind: 'index', entityType: 'faction_power_ledger', entityId: factions[0].id, field: 'central_office', value: 20 }],
        },
        {
          key: 'weak_court_authority',
          role: 'structural',
          contribution: 9,
          refs: [{ kind: 'index', entityType: 'polity', entityId: polity.id, field: 'authority', value: polity.authority }],
        },
      ],
      nextWatch: {
        key: 'watch_court_power_resources',
        refs: [{ kind: 'index', entityType: 'polity', entityId: polity.id, field: 'authority', value: polity.authority }],
      },
      possibleOutcomes: [
        { key: 'factional_compromise', confidence: 57 },
        { key: 'palace_coup_succeeded', confidence: 29 },
      ],
    };

    const detail = projectSituationDetail(world, court);
    expect(detail.typeLabel).toBe('朝堂权斗');
    expect(detail.title).toBe(`${polity.shortName || polity.name}的朝堂权斗`);
    expect(detail.playerSummary.join('')).toContain(polity.shortName || polity.name);
    expect(detail.playerSummary.join('')).toContain(factions[0].name);
    expect(detail.playerSummary.join('')).toContain('结案');
    expect(detail.playerSummary.join('')).not.toContain(detail.publicDrivers[0]?.label);
    expect(detail.nextWatch).toContain('任免');
    expect(detail.publicDrivers[0]?.label).toBe('实掌中枢官席');
    expect(detail.audit.template?.type).toBe('court_power_struggle');
    expect(detail.audit.possibleOutcomes.map((item) => item.label)).toEqual(['双方暂成妥协', '宫变夺位已成']);
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

  it('does not expose Situation wrapper events through Fact evidence links', () => {
    const world = establishedWorld();
    const situation = world.situationSystem.situations[0];
    const baseline = projectSituationDetail(world, situation);
    const evidenceFactId = baseline.evidence[0]?.id;
    const template = world.history[0];
    if (!evidenceFactId || !template) throw new Error('expected Situation evidence and Chronicle template');
    const hiddenEventId = 'event_hidden_situation_milestone';
    const projected = projectSituationDetail({
      ...world,
      history: [...world.history, {
        ...template,
        id: hiddenEventId,
        kind: 'situation_phase_changed',
        sourceFactIds: [evidenceFactId],
      }],
    }, situation);

    expect(projected.evidence.flatMap((fact) => fact.historyEventIds)).not.toContain(hiddenEventId);
    expect(projected.timeline.flatMap((item) => item.historyEventIds)).not.toContain(hiddenEventId);
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
    expect(detail.playerSummary).toHaveLength(2);
    expect(detail.playerSummary.join('')).toContain('历时');
    expect(detail.currentChange).toMatch(/[㐀-鿿].*(受任|去职|之战|易手|去世|成婚|请|军令|支持)/u);
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
