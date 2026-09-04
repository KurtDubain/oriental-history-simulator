import { readWorldFacts } from '../sim/archive';
import type { BattleFact, SimulationFact } from '../sim/facts';
import type { CharacterState, WorldState } from '../sim/types';
import { projectFactNarrative } from './historical-scenes';
import { historyTurnDate } from './v1-history';

export type PersonStoryPhase = 'command' | 'choice' | 'battle' | 'setback' | 'return' | 'ending';

export interface PersonStoryBeat {
  phase: PersonStoryPhase;
  phaseLabel: string;
  dateLabel: string;
  title: string;
  summary: string;
  sourceFactIds: readonly string[];
}

interface Candidate {
  id: string;
  turn: number;
  phase: PersonStoryPhase;
  title: string;
  summary: string;
  importance: number;
  priority: number;
  sourceFactIds: string[];
}

const phaseLabels: Record<PersonStoryPhase, string> = {
  command: '掌事', choice: '抉择', battle: '战阵', setback: '失势', return: '复出', ending: '结局',
};
const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const unique = (values: readonly string[]) => [...new Set(values)].sort(compareId);

function battleSide(fact: BattleFact, characterId: string) {
  const attacker = fact.payload.attacker.participants?.find((item) => item.characterId === characterId);
  if (attacker) return { participant: attacker, won: fact.payload.attackerWon, stance: '进兵' } as const;
  for (const defender of fact.payload.defenders) {
    const participant = defender.participants?.find((item) => item.characterId === characterId);
    if (participant) return { participant, won: !fact.payload.attackerWon, stance: '守阵' } as const;
  }
  return null;
}

function battleCandidate(world: WorldState, facts: readonly BattleFact[], personId: string): Candidate | null {
  const ordered = [...facts].sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  const first = ordered[0]!;
  const latest = ordered.at(-1)!;
  const firstSide = battleSide(first, personId)!;
  const latestSide = battleSide(latest, personId)!;
  const totalLosses = ordered.reduce((sum, fact) => sum + battleSide(fact, personId)!.participant.losses, 0);
  const largestLoss = Math.max(...ordered.map((fact) => {
    const side = battleSide(fact, personId)!;
    return side.participant.losses / Math.max(1, side.participant.soldiersBefore);
  }));
  if (ordered.length === 1 && firstSide.participant.role === 'member' && largestLoss < .15 && first.importance < 4) return null;
  const place = world.regions.find((item) => item.id === latest.payload.targetRegionId)?.name ?? '无名战场';
  const costliest = [...ordered].sort((left, right) => (
    (battleSide(right, personId)?.participant.losses ?? 0) - (battleSide(left, personId)?.participant.losses ?? 0)
    || compareId(left.id, right.id)
  ))[0]!;
  return {
    id: `person-story:battle:${first.id}:${latest.id}`, turn: latest.turn, phase: latestSide.won ? 'battle' : 'setback',
    title: ordered.length === 1 ? `${place}${latestSide.stance}${latestSide.won ? '得胜' : '受挫'}`
      : `${place}${latestSide.stance === '守阵' ? '数度守阵' : '连番进兵'}${latestSide.won ? '站稳' : '受挫'}`,
    summary: ordered.length === 1
      ? `此役自带${firstSide.participant.soldiersBefore}人，损失${firstSide.participant.losses}人，战后本部余${firstSide.participant.soldiersAfter}人；${latestSide.won ? '军中分量因而上升' : '自身军势受到削弱'}。`
      : `自${historyTurnDate(first.turn).label}起在此线参战${ordered.length}次，本部由${firstSide.participant.soldiersBefore}人变为${latestSide.participant.soldiersAfter}人，共损失${totalLosses}人；这段战事${latestSide.won ? '使其在军中站稳' : '削弱了其军中处境'}。`,
    importance: Math.max(...ordered.map((fact) => fact.importance)), priority: largestLoss >= .3 || latestSide.participant.role === 'commander' ? 1 : 3,
    sourceFactIds: unique([first.id, costliest.id, latest.id]),
  };
}

function compressedBattles(world: WorldState, facts: readonly SimulationFact[], personId: string): Candidate[] {
  const groups = new Map<string, BattleFact[]>();
  for (const fact of facts) {
    if (fact.kind !== 'battle') continue;
    const side = battleSide(fact, personId);
    if (!side) continue;
    const key = `${fact.payload.warId}:${fact.payload.targetRegionId}:${side.stance}:${side.won}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  return [...groups.values()].map((group) => battleCandidate(world, group, personId)).filter((item): item is Candidate => Boolean(item));
}

function factCandidate(world: WorldState, fact: SimulationFact): Candidate | null {
  const narrative = projectFactNarrative(world, fact);
  if (fact.kind === 'character_death') return { id: `person-story:${fact.id}`, turn: fact.turn, phase: 'ending', title: narrative.title,
    summary: narrative.summary, importance: fact.importance, priority: 0, sourceFactIds: [fact.id] };
  if (fact.kind === 'character_wounded') return { id: `person-story:${fact.id}`, turn: fact.turn, phase: 'setback', title: `${narrative.title}退营休养`,
    summary: `${narrative.summary} 至第${fact.payload.recoveryUntilTurn ?? fact.turn + 2}季前不能照常领军。`,
    importance: fact.importance, priority: 1, sourceFactIds: [fact.id] };
  if (fact.kind === 'expedition_response') return { id: `person-story:${fact.id}`, turn: fact.turn, phase: 'choice', title: narrative.title,
    summary: narrative.summary, importance: fact.importance, priority: 1, sourceFactIds: [fact.id] };
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    const military = fact.payload.officeKind.includes('军团') || fact.payload.officeKind.includes('水师') || fact.payload.officeKind === '枢密使';
    if (!military && fact.importance < 4) return null;
    return { id: `person-story:${fact.id}`, turn: fact.turn, phase: fact.kind === 'appointment_started' ? 'command' : 'setback',
      title: narrative.title, summary: narrative.summary, importance: fact.importance,
      priority: military ? 1 : 2, sourceFactIds: [fact.id] };
  }
  return null;
}

function markReturn(candidates: Candidate[], facts: readonly SimulationFact[], personId: string): void {
  const wound = [...facts].reverse().find((fact) => fact.kind === 'character_wounded');
  if (!wound || wound.kind !== 'character_wounded') return;
  const returnBattle = candidates.filter((item) => item.sourceFactIds.some((id) => {
    const fact = facts.find((entry) => entry.id === id);
    return fact?.kind === 'battle' && fact.turn >= (wound.payload.recoveryUntilTurn ?? wound.turn + 2)
      && Boolean(battleSide(fact, personId));
  })).sort((left, right) => left.turn - right.turn || compareId(left.id, right.id))[0];
  if (!returnBattle) return;
  returnBattle.phase = 'return';
  returnBattle.priority = Math.min(returnBattle.priority, 1);
  returnBattle.summary = `负伤休养后重新随军。${returnBattle.summary}`;
}

/** Sparse, fact-owned life story: one to three actual changes of circumstance, never a fixed four-slot biography. */
export function projectPersonStoryArc(world: WorldState, person: CharacterState, scope: 'all' | 'active' = 'all'): PersonStoryBeat[] {
  const facts = (scope === 'all' ? readWorldFacts(world) : world.facts)
    .filter((fact) => fact.actorIds.includes(person.id) && (fact.kind !== 'battle' || battleSide(fact, person.id)))
    .sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  const candidates = compressedBattles(world, facts, person.id);
  for (const fact of facts) {
    if (fact.kind === 'battle' || fact.kind === 'situation_milestone' || fact.kind === 'embodied_action_submitted'
      || fact.kind === 'agency_intent_submitted' || fact.kind === 'war_started' || fact.kind === 'war_ended'
      || fact.kind === 'territory_control_changed') continue;
    const candidate = factCandidate(world, fact);
    if (candidate) candidates.push(candidate);
  }
  markReturn(candidates, facts, person.id);
  if (!candidates.length) return [];

  const terminal = !person.alive ? candidates.filter((item) => item.phase === 'ending')
    .sort((left, right) => right.turn - left.turn || compareId(left.id, right.id))[0] : undefined;
  const pool = candidates.filter((item) => item !== terminal)
    .sort((left, right) => left.priority - right.priority || right.importance - left.importance
      || right.turn - left.turn || compareId(left.id, right.id));
  const chosen: Candidate[] = [];
  for (const item of pool) {
    if (chosen.length >= (terminal ? 2 : 3)) break;
    if (chosen.some((entry) => entry.sourceFactIds.some((id) => item.sourceFactIds.includes(id)))) continue;
    if (item.id.startsWith('person-story:battle:') && chosen.some((entry) => entry.id.startsWith('person-story:battle:'))) continue;
    chosen.push(item);
  }
  const ordered = chosen.sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  if (terminal) ordered.push(terminal);
  return ordered.map((item) => ({
    phase: item.phase, phaseLabel: phaseLabels[item.phase], dateLabel: historyTurnDate(item.turn).label,
    title: item.title, summary: item.summary, sourceFactIds: item.sourceFactIds,
  }));
}
