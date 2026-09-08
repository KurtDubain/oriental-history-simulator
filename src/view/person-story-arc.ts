import { readWorldFacts, readWorldHistory } from '../sim/archive';
import type { BattleFact, SimulationFact } from '../sim/facts';
import type { CharacterState, HistoryEvent, WorldState } from '../sim/types';
import { canonicalStoryKey, playerHistoryText, projectFactNarrative } from './historical-scenes';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import { historyTurnDate } from './v1-history';

export type PersonStoryPhase = 'command' | 'battle' | 'setback' | 'ending';

export interface PersonStoryBeat {
  phase: PersonStoryPhase;
  phaseLabel: string;
  dateLabel: string;
  title: string;
  summary: string;
  sourceFactIds: readonly string[];
  sourceEventIds: readonly string[];
  primaryEventId: string | null;
  primaryFactId: string;
}

interface Candidate extends Omit<PersonStoryBeat, 'phaseLabel' | 'dateLabel'> {
  id: string;
  turn: number;
  importance: number;
  priority: number;
}

interface BattleEpisode {
  battle: BattleFact;
  linked: SimulationFact[];
}

const phaseLabels: Record<PersonStoryPhase, string> = {
  command: '掌事', battle: '战阵', setback: '失势', ending: '结局',
};
const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))].sort(compareId);

function battleSide(fact: BattleFact, characterId: string) {
  for (const [index, force] of [fact.payload.attacker, ...fact.payload.defenders].entries()) {
    const participant = force.participants?.find(p => p.characterId === characterId);
    if (participant) return { participant, won: index === 0 ? fact.payload.attackerWon : !fact.payload.attackerWon, stance: index === 0 ? '进兵' : '守阵' };
  }
  return null;
}

function rootBattleId(fact: SimulationFact, byId: ReadonlyMap<string, SimulationFact>, seen = new Set<string>()): string | null {
  if (fact.kind === 'battle') return fact.id;
  if ((fact.kind === 'character_wounded' || fact.kind === 'character_death') && fact.payload.battleFactId) return fact.payload.battleFactId;
  if (seen.has(fact.id)) return null;
  seen.add(fact.id);
  for (const sourceId of fact.sourceFactIds) {
    const source = byId.get(sourceId);
    if (!source) continue;
    const root = rootBattleId(source, byId, seen);
    if (root) return root;
  }
  return null;
}

function sourceEvents(events: readonly HistoryEvent[], personId: string, factIds: readonly string[], primaryFactId: string) {
  const linked = events.filter((event) => event.actorIds.includes(personId) && event.sourceFactIds.some((id) => factIds.includes(id)));
  const primary = linked.find((event) => event.sourceFactIds.includes(primaryFactId)) ?? linked[0];
  return { ids: unique(linked.map((event) => event.id)), primary: primary?.id ?? null };
}

function episodeCandidate(world: WorldState, episodes: readonly BattleEpisode[], personId: string, events: readonly HistoryEvent[]): Candidate | null {
  const first = episodes[0]!, latest = episodes.at(-1)!;
  const allFacts = episodes.flatMap(e => [e.battle, ...e.linked]);
  const death = allFacts.find(f => f.kind === 'character_death');
  const wound = allFacts.find(f => f.kind === 'character_wounded');
  const turning = death ?? wound;
  const focus = episodes.find(e => e.linked.includes(turning!)) ?? latest;
  const side = battleSide(focus.battle, personId)!;
  const ended = allFacts.filter(f => f.kind === 'appointment_ended');
  const loss = Math.max(...episodes.map(e => { const p = battleSide(e.battle, personId)!.participant; return p.losses / Math.max(1, p.soldiersBefore); }));
  if (episodes.length === 1 && side.participant.role === 'member' && loss < .15
    && first.battle.importance < 4 && !turning && !ended.length) return null;
  const place = world.regions.find(r => r.id === focus.battle.payload.targetRegionId)?.name ?? '无名战场';
  const ids = unique(allFacts.map(f => f.id)), primary = turning?.id ?? focus.battle.id;
  const sources = sourceEvents(events, personId, ids, primary);
  const p = side.participant;
  let summary = episodes.length === 1
    ? `此役战前${p.soldiersBefore}人，战损${p.losses}人，战后${p.soldiersAfter}人。`
    : `先后参战${episodes.length}次，记录战损累计${episodes.reduce((n,e) => n + battleSide(e.battle, personId)!.participant.losses, 0)}人；最近一战战前${p.soldiersBefore}人，战后${p.soldiersAfter}人。`;
  if (wound?.kind === 'character_wounded') summary += ` 负伤退出行营，休养至第${wound.payload.recoveryUntilTurn ?? wound.turn + 2}季。`;
  if (ended.length) summary += ` 同季卸下${unique(ended.map(f => f.payload.officeKind)).join('、')}。`;
  return {
    id: primary, turn: turning?.turn ?? focus.battle.turn,
    phase: death ? 'ending' : wound || !side.won ? 'setback' : 'battle',
    title: `${place}${episodes.length > 1 ? '连番' : ''}${side.stance}${side.won ? '得胜' : '受挫'}${death ? '，阵亡' : wound ? '，负伤退营' : ''}`,
    summary, importance: Math.max(...allFacts.map(f => f.importance)),
    priority: death ? 0 : wound || loss >= .3 ? 2 : 4,
    sourceFactIds: ids, sourceEventIds: sources.ids, primaryEventId: sources.primary, primaryFactId: primary,
  };
}

function factCandidate(world: WorldState, fact: SimulationFact, events: readonly HistoryEvent[], personId: string): Candidate | null {
  let phase: PersonStoryPhase;
  let priority: number;
  if (fact.kind === 'character_death') { phase = 'ending'; priority = 0; }
  else if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    if (fact.payload.officeKind === '廷臣' && fact.importance < 4) return null;
    phase = fact.kind === 'appointment_started' ? 'command' : 'setback';
    priority = fact.payload.officeKind === '君主' ? 0 : fact.payload.rank >= 70 ? 1 : 3;
  } else if (fact.kind === 'local_governance_resolved' && fact.payload.outcome === 'enacted') {
    phase = 'command'; priority = 2;
  } else if (fact.kind === 'court_action_resolved' && [fact.payload.initiatorId, fact.payload.targetId].includes(personId)) {
    phase = fact.payload.targetId === personId ? 'setback' : 'command'; priority = 0;
  } else if (fact.kind === 'faction_lifecycle' && fact.payload.nextLeaderId === personId
    && fact.payload.previousLeaderId !== personId && fact.turn > 0) {
    phase = 'command'; priority = 2;
  } else if (fact.kind === 'faction_relation_changed' && fact.payload.action === 'ended'
    && [fact.payload.leftLeaderId, fact.payload.rightLeaderId].includes(personId)) {
    phase = 'setback'; priority = 3;
  } else return null;
  const narrative = projectFactNarrative(world, fact);
  if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    narrative.title += ` · ${fact.payload.officeKind}`;
  }
  const sources = sourceEvents(events, personId, [fact.id], fact.id);
  return {
    id: fact.id, turn: fact.turn, phase, title: narrative.title, summary: narrative.summary,
    importance: fact.importance, priority, sourceFactIds: [fact.id], sourceEventIds: sources.ids,
    primaryEventId: sources.primary, primaryFactId: fact.id,
  };
}

/** One to three evidence-owned changes; archived lives are read only when opened. */
export function projectPersonStoryArc(world: WorldState, person: CharacterState, scope: 'all' | 'active' = 'all'): PersonStoryBeat[] {
  const seen = new Set<string>();
  const allFacts = scope === 'all' ? readWorldFacts(world) : world.facts;
  const facts = allFacts
    .filter((fact) => fact.actorIds.includes(person.id) && (fact.kind !== 'battle' || battleSide(fact, person.id)))
    .sort((left, right) => left.turn - right.turn || compareId(left.id, right.id))
    .filter((fact) => { const key = canonicalStoryKey(fact); if (seen.has(key)) return false; seen.add(key); return true; });
  const events = (scope === 'all' ? readWorldHistory(world) : world.history).filter(isDefaultVisibleHistoryEvent);
  const byId = new Map(allFacts.map((fact) => [fact.id, fact]));
  const episodes = new Map<string, BattleEpisode>();
  for (const fact of facts) {
    const rootId = rootBattleId(fact, byId);
    if (!rootId) continue;
    const battle = byId.get(rootId);
    if (battle?.kind !== 'battle' || !battleSide(battle, person.id)) continue;
    const episode = episodes.get(rootId) ?? { battle, linked: [] };
    if (fact.id !== rootId) episode.linked.push(fact);
    episodes.set(rootId, episode);
  }
  const battleGroups: BattleEpisode[][] = [];
  const activeGroupByKey = new Map<string, BattleEpisode[]>();
  const orderedEpisodes = [...episodes.values()].sort((left, right) => (
    left.battle.turn - right.battle.turn || compareId(left.battle.id, right.battle.id)
  ));
  for (const episode of orderedEpisodes) {
    const side = battleSide(episode.battle, person.id)!;
    const key = `${episode.battle.payload.warId}:${episode.battle.payload.targetRegionId}:${side.stance}:${side.won}`;
    const current = activeGroupByKey.get(key);
    const previous = current?.at(-1);
    const currentTurnsFate = episode.linked.some((fact) => fact.kind === 'character_wounded' || fact.kind === 'character_death');
    const previousTurnsFate = previous?.linked.some((fact) => fact.kind === 'character_wounded' || fact.kind === 'character_death');
    if (!current || !previous || episode.battle.turn - previous.battle.turn > 4 || currentTurnsFate || previousTurnsFate) {
      const next = [episode];
      activeGroupByKey.set(key, next);
      battleGroups.push(next);
    } else {
      current.push(episode);
    }
  }
  const candidates = battleGroups.map((group) => episodeCandidate(world, group, person.id, events))
    .filter((item): item is Candidate => Boolean(item));
  const linkedIds = new Set([...episodes.values()].flatMap((episode) => episode.linked.map((fact) => fact.id)));
  const injuryTurns = new Set(facts.filter((fact) => fact.kind === 'character_wounded' || fact.kind === 'character_death').map((fact) => fact.turn));
  for (const fact of facts) {
    if (fact.kind === 'battle' || linkedIds.has(fact.id) || fact.kind === 'character_wounded') continue;
    if (fact.kind === 'appointment_ended' && !fact.sourceFactIds.length && injuryTurns.has(fact.turn)) continue;
    const candidate = factCandidate(world, fact, events, person.id);
    if (candidate) candidates.push(candidate);
  }
  // Accession and capital relocation are authoritative Chronicle changes, not battle participation.
  for (const event of events) {
    const accession = event.stateDeltas.some(d => d.field === 'rulerId' && d.after === person.id);
    const capital = event.kind === 'capital_fall';
    const oldCapitalId = event.stateDeltas.find(d => d.field === 'capitalRegionId')?.before;
    const involved = event.actorIds.includes(person.id);
    const capture = capital ? [...episodes.values()].find(e => e.battle.turn === event.turn
      && e.battle.payload.targetRegionId === oldCapitalId && battleSide(e.battle, person.id)?.won
      && event.sourceFactIds.some(id => { const f = byId.get(id); return f && rootBattleId(f, byId) === e.battle.id; })) : undefined;
    if (!accession && !(capital && (involved || capture))) continue;
    const battle = capture?.battle;
    const place = world.regions.find(r => r.id === oldCapitalId)?.name ?? '旧都';
    const title = accession ? `${person.name}登位` : battle ? `${person.name}参战，攻克${place}` : `任内国事：${event.title}`;
    const sourceFactIds = unique([...event.sourceFactIds, ...(battle ? [battle.id] : []), ...facts.filter(f => accession
      && f.turn === event.turn && f.kind === 'appointment_started' && f.payload.holderId === person.id
      && f.payload.officeKind === '君主').map(f => f.id)]);
    candidates.push({ id: event.id, turn: event.turn, importance: event.importance,
      priority: accession ? -2 : battle ? -1 : 1, phase: accession ? 'command' : battle ? 'battle' : 'setback',
      title, summary: event.summary,
      sourceFactIds, sourceEventIds: [event.id], primaryEventId: event.id, primaryFactId: battle?.id ?? event.sourceFactIds[0] ?? event.id });
  }
  const terminal = !person.alive ? candidates.filter((item) => item.phase === 'ending')
    .sort((left, right) => right.turn - left.turn || compareId(left.id, right.id))[0] : undefined;
  const pool = candidates.filter((item) => item !== terminal).sort((left, right) => left.priority - right.priority
    || right.importance - left.importance || left.turn - right.turn || compareId(left.id, right.id));
  const chosen: Candidate[] = [];
  for (const item of pool) {
    if (chosen.length >= (terminal ? 2 : 3)) break;
    if (chosen.some(entry => entry.title === item.title || entry.sourceFactIds.some(id => item.sourceFactIds.includes(id)))) continue;
    chosen.push(item);
  }
  const ordered = chosen.sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  if (terminal) ordered.push(terminal);
  return ordered.map((item) => ({
    phase: item.phase, phaseLabel: phaseLabels[item.phase], dateLabel: historyTurnDate(item.turn).label,
    title: playerHistoryText(world, item.title), summary: playerHistoryText(world, item.summary), sourceFactIds: item.sourceFactIds,
    sourceEventIds: item.sourceEventIds, primaryEventId: item.primaryEventId, primaryFactId: item.primaryFactId,
  }));
}

/** Important former offices survive death and the bounded biography window. */
export function personHistoricalOffice(world: WorldState, person: CharacterState): string {
  return world.offices.filter(o => o.holderId === person.id).sort((a, b) => b.rank - a.rank || a.appointedTurn - b.appointedTurn)[0]?.kind ?? '未见任官记载';
}

export function personShortBiography(world: WorldState, person: CharacterState, beats: readonly PersonStoryBeat[]): string {
  const first = world.offices.filter(o => o.holderId === person.id).sort((a, b) => a.appointedTurn - b.appointedTurn || b.rank - a.rank)[0];
  const beginning = first && !beats.some(b => b.dateLabel === historyTurnDate(first.appointedTurn).label && b.title.includes(first.kind))
    ? `${historyTurnDate(first.appointedTurn).label}，${person.name}任${first.kind}。` : '';
  return beginning + beats.map(b => `${b.dateLabel}，${b.title}。`).join('') || `${person.name}尚无重要经历见于记载。`;
}
