import type { SituationPhase, SituationRecentChange, SituationState } from '../sim/situations';
import type { SituationMilestoneFact } from '../sim/facts/types';
import type { WorldState } from '../sim/types';
import {
  projectSituationSnapshotItem,
  situationOutcomeLabel,
  situationPhaseLabel,
} from './situation-snapshot';
import { projectSituationHistoricalScenes } from './historical-scenes';

export const MAX_QUARTER_PULSE_SITUATIONS = 4;
export const MIN_QUARTER_PULSE_TREND_DELTA = 8;

export type QuarterPulseSituationKind = 'born' | 'heated' | 'cooled' | 'resolved';
export type QuarterPulseSituationBasis = 'lifecycle' | 'phase' | 'trend';

export interface QuarterPulseSituationChange {
  id: string;
  title: string;
  typeLabel: string;
  kind: QuarterPulseSituationKind;
  kindLabel: '新生' | '升温' | '降温' | '结案';
  sceneTitle?: string | null;
  basis: QuarterPulseSituationBasis;
  tension: number;
  delta: number;
  detail: string;
  importance: number;
  milestoneFactId: string | null;
}

const KIND_LABEL: Record<QuarterPulseSituationKind, QuarterPulseSituationChange['kindLabel']> = {
  born: '新生',
  heated: '升温',
  cooled: '降温',
  resolved: '结案',
};

const PHASE_ORDER: Record<SituationPhase, number> = {
  emerging: 0,
  active: 1,
  critical: 2,
};

const KIND_PRIORITY: Record<QuarterPulseSituationKind, number> = {
  resolved: 4,
  born: 3,
  heated: 2,
  cooled: 1,
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rounded(value: number): number {
  return Math.round(value);
}

function signed(value: number): string {
  const amount = rounded(value);
  return amount > 0 ? `+${amount}` : amount < 0 ? `−${Math.abs(amount)}` : '±0';
}

function matchingChange(
  situation: SituationState,
  fact: SituationMilestoneFact,
): SituationRecentChange | null {
  const expectedKind = fact.payload.transition === 'formed'
    ? 'formed'
    : fact.payload.transition === 'resolved'
      ? 'resolved'
      : 'phase_changed';
  return situation.recentChanges.find((change) => (
    change.turn === fact.turn
    && change.kind === expectedKind
    && change.fromPhase === fact.payload.fromPhase
    && change.toPhase === fact.payload.toPhase
  )) ?? null;
}

function milestoneKind(fact: SituationMilestoneFact): QuarterPulseSituationKind | null {
  if (fact.payload.transition === 'formed') return 'born';
  if (fact.payload.transition === 'resolved') return 'resolved';
  const from = fact.payload.fromPhase;
  const to = fact.payload.toPhase;
  if (!from || !to || from === to) return null;
  return PHASE_ORDER[to] > PHASE_ORDER[from] ? 'heated' : 'cooled';
}

function milestoneDetail(
  world: WorldState,
  situation: SituationState,
  fact: SituationMilestoneFact,
  kind: QuarterPulseSituationKind,
): string {
  const scene = projectSituationHistoricalScenes(world, situation, 1, fact.turn)[0];
  if (scene) return `${scene.summary}${scene.result ? ` ${scene.result}` : ''}`;
  if (kind === 'born') {
    const phase = fact.payload.toPhase ?? situation.phase;
    return `进入${situationPhaseLabel(phase)} · 张力 ${rounded(fact.payload.tension)}`;
  }
  if (kind === 'resolved') {
    const outcome = situationOutcomeLabel(fact.payload.outcomeKey ?? situation.resolution?.outcomeKey ?? 'dissipated');
    const duration = Math.max(1, fact.turn - situation.startedTurn + 1);
    return `${outcome} · 历时 ${duration} 季`;
  }
  const from = fact.payload.fromPhase;
  const to = fact.payload.toPhase;
  if (!from || !to) return `张力 ${rounded(fact.payload.tension)}`;
  return `${situationPhaseLabel(from)}→${situationPhaseLabel(to)} · 张力 ${rounded(fact.payload.tension)}`;
}

function milestoneChange(
  world: WorldState,
  situation: SituationState,
  fact: SituationMilestoneFact,
): QuarterPulseSituationChange | null {
  if (!situation.milestoneFactIds.includes(fact.id) || !matchingChange(situation, fact)) return null;
  const kind = milestoneKind(fact);
  if (!kind) return null;
  const snapshot = projectSituationSnapshotItem(situation, world);
  const scene = projectSituationHistoricalScenes(world, situation, 1, fact.turn)[0];
  return {
    id: situation.id,
    title: snapshot.title,
    typeLabel: snapshot.typeLabel,
    kind,
    kindLabel: KIND_LABEL[kind],
    sceneTitle: scene?.title ?? null,
    basis: kind === 'born' || kind === 'resolved' ? 'lifecycle' : 'phase',
    tension: rounded(fact.payload.tension),
    delta: rounded(fact.payload.momentum),
    detail: milestoneDetail(world, situation, fact, kind),
    importance: situation.importance,
    milestoneFactId: fact.id,
  };
}

function trendChange(world: WorldState, situation: SituationState, turn: number): QuarterPulseSituationChange | null {
  if (
    situation.status !== 'open'
    || situation.lastUpdatedTurn !== turn
    || Math.abs(situation.momentum) < MIN_QUARTER_PULSE_TREND_DELTA
  ) return null;
  const kind: QuarterPulseSituationKind = situation.momentum > 0 ? 'heated' : 'cooled';
  const previousTension = situation.tension - situation.momentum;
  const leadingSignal = [...situation.signals]
    .filter((signal) => signal.refs.length > 0)
    .sort((left, right) => (
      Math.abs(right.contribution) - Math.abs(left.contribution)
      || stableCompare(left.key, right.key)
    ))[0];
  const snapshot = projectSituationSnapshotItem(situation, world);
  const signalLabel = leadingSignal
    ? snapshot.evidence.find((evidence) => evidence.key === leadingSignal.key)?.label
    : null;
  const scene = projectSituationHistoricalScenes(world, situation, 1, turn)[0];
  return {
    id: situation.id,
    title: snapshot.title,
    typeLabel: snapshot.typeLabel,
    kind,
    kindLabel: KIND_LABEL[kind],
    sceneTitle: scene?.title ?? null,
    basis: 'trend',
    tension: rounded(situation.tension),
    delta: rounded(situation.momentum),
    detail: scene
      ? `${scene.summary}${scene.result ? ` ${scene.result}` : ''}`
      : `张力 ${rounded(previousTension)}→${rounded(situation.tension)}（${signed(situation.momentum)}）${signalLabel ? ` · ${signalLabel}` : ''}`,
    importance: situation.importance,
    milestoneFactId: null,
  };
}

/**
 * Read-only C05 projection contract:
 *
 * - 新生、结案与阶段升降只认 lastTurn.factIds 内、且能与 Situation
 *   recentChanges / milestoneFactIds 双向对应的权威 milestone Fact。
 * - 非阶段性升降只读 Situation 当季持久化的 tension + momentum；前季值可由
 *   tension - momentum 精确还原。小于 8 点的普通抖动保持沉默，且这种走势
 *   不会伪装成 milestone，也不会展开或重复底层普通 Facts。
 * - 结果稳定排序并限制为四条，不写 WorldState、Fact、Chronicle 或 hash。
 */
export function projectQuarterPulseSituations(world: WorldState): QuarterPulseSituationChange[] {
  const report = world.lastTurn;
  if (!report || world.situationSystem.lastReducedTurn !== report.turn) return [];

  const factIds = new Set(report.factIds);
  const situations = new Map(world.situationSystem.situations.map((item) => [item.id, item]));
  const milestones = world.facts
    .filter((fact): fact is SituationMilestoneFact => (
      fact.kind === 'situation_milestone'
      && fact.turn === report.turn
      && factIds.has(fact.id)
    ))
    .sort((left, right) => stableCompare(left.id, right.id));
  const changedIds = new Set<string>();
  const changes: QuarterPulseSituationChange[] = [];

  for (const fact of milestones) {
    const situation = situations.get(fact.payload.situationId);
    if (!situation || changedIds.has(situation.id)) continue;
    const change = milestoneChange(world, situation, fact);
    if (!change) continue;
    changedIds.add(situation.id);
    changes.push(change);
  }

  for (const situation of world.situationSystem.situations) {
    if (changedIds.has(situation.id)) continue;
    const change = trendChange(world, situation, report.turn);
    if (change) changes.push(change);
  }

  return changes
    .sort((left, right) => (
      (left.basis === 'trend' ? 1 : 0) - (right.basis === 'trend' ? 1 : 0)
      || KIND_PRIORITY[right.kind] - KIND_PRIORITY[left.kind]
      || right.importance - left.importance
      || Math.abs(right.delta) - Math.abs(left.delta)
      || stableCompare(left.id, right.id)
    ))
    .slice(0, MAX_QUARTER_PULSE_SITUATIONS);
}
