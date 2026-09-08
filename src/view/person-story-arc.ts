import { readWorldFacts, readWorldHistory } from '../sim/archive';
import type { BattleFact, SimulationFact } from '../sim/facts';
import type { CharacterState, HistoryEvent, WorldState } from '../sim/types';
import { projectFactNarrative } from './historical-scenes';
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
  const attacker = fact.payload.attacker.participants?.find((item) => item.characterId === characterId);
  if (attacker) return { participant: attacker, won: fact.payload.attackerWon, stance: '进兵' } as const;
  for (const defender of fact.payload.defenders) {
    const participant = defender.participants?.find((item) => item.characterId === characterId);
    if (participant) return { participant, won: !fact.payload.attackerWon, stance: '守阵' } as const;
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
  const wanted = new Set(factIds);
  const linked = events.filter((event) => event.actorIds.includes(personId) && event.sourceFactIds.some((id) => wanted.has(id)));
  const primary = linked.find((event) => event.sourceFactIds.includes(primaryFactId)) ?? linked[0];
  return { ids: unique(linked.map((event) => event.id)), primary: primary?.id ?? null };
}

function episodeCandidate(world: WorldState, episodes: readonly BattleEpisode[], personId: string, events: readonly HistoryEvent[]): Candidate | null {
  const ordered = [...episodes].sort((left, right) => left.battle.turn - right.battle.turn || compareId(left.battle.id, right.battle.id));
  const first = ordered[0]!;
  const latest = ordered.at(-1)!;
  const firstSide = battleSide(first.battle, personId)!;
  const latestSide = battleSide(latest.battle, personId)!;
  const allFacts = ordered.flatMap((episode) => [episode.battle, ...episode.linked]);
  const death = [...allFacts].reverse().find((fact) => fact.kind === 'character_death');
  const wound = [...allFacts].reverse().find((fact) => fact.kind === 'character_wounded');
  const turningFact = death ?? wound;
  const focusEpisode = turningFact
    ? ordered.find((episode) => episode.linked.some((fact) => fact.id === turningFact.id)) ?? latest
    : latest;
  const focusSide = battleSide(focusEpisode.battle, personId)!;
  const ended = allFacts.filter((fact) => fact.kind === 'appointment_ended');
  const largestLoss = Math.max(...ordered.map(({ battle }) => {
    const side = battleSide(battle, personId)!;
    return side.participant.losses / Math.max(1, side.participant.soldiersBefore);
  }));
  if (ordered.length === 1 && firstSide.participant.role === 'member' && largestLoss < .15
    && first.battle.importance < 4 && !wound && !death && !ended.length) return null;
  const place = world.regions.find((item) => item.id === focusEpisode.battle.payload.targetRegionId)?.name ?? '无名战场';
  const totalLosses = ordered.reduce((sum, { battle }) => sum + battleSide(battle, personId)!.participant.losses, 0);
  const sourceFactIds = unique(allFacts.map((fact) => fact.id));
  const primaryFactId = turningFact?.id ?? focusEpisode.battle.id;
  const sources = sourceEvents(events, personId, sourceFactIds, primaryFactId);
  const outcome = death ? '阵亡' : wound ? '负伤退营' : focusSide.won ? '取胜' : '受挫';
  const title = ordered.length === 1
    ? `${place}${focusSide.stance}${focusSide.won ? '得胜' : '受挫'}${death || wound ? `，${outcome}` : ''}`
    : `${place}${focusSide.stance === '守阵' ? '数度守阵' : '连番进兵'}，${outcome}`;
  let summary = ordered.length === 1
    ? `此役战前${firstSide.participant.soldiersBefore}人，战损${firstSide.participant.losses}人，战后${firstSide.participant.soldiersAfter}人。`
    : `先后参战${ordered.length}次，记录战损累计${totalLosses}人；最近一战战前${latestSide.participant.soldiersBefore}人，战后${latestSide.participant.soldiersAfter}人。`;
  if (wound?.kind === 'character_wounded') summary += ` 健康由${wound.payload.healthBefore}降至${wound.payload.healthAfter}，退出行营并休养至第${wound.payload.recoveryUntilTurn ?? wound.turn + 2}季。`;
  if (death?.kind === 'character_death') summary += ' 本人阵亡，职位、兵权与余部在同季结清。';
  if (ended.length) {
    const offices = unique(ended.map((fact) => fact.kind === 'appointment_ended' ? fact.payload.officeKind : ''));
    summary += ` 同季卸下${offices.join('、')}。`;
  }
  return {
    id: `person-story:battle:${ordered.map((item) => item.battle.id).join(':')}`,
    turn: turningFact?.turn ?? focusEpisode.battle.turn,
    phase: death ? 'ending' : wound || !latestSide.won ? 'setback' : 'battle',
    title,
    summary,
    importance: Math.max(...allFacts.map((fact) => fact.importance)),
    priority: death ? 0 : wound || largestLoss >= .3 || latestSide.participant.role === 'commander' ? 1 : 3,
    sourceFactIds,
    sourceEventIds: sources.ids,
    primaryEventId: sources.primary,
    primaryFactId,
  };
}

function factCandidate(world: WorldState, fact: SimulationFact, events: readonly HistoryEvent[]): Candidate | null {
  const narrative = projectFactNarrative(world, fact);
  let phase: PersonStoryPhase;
  let priority: number;
  if (fact.kind === 'character_death') { phase = 'ending'; priority = 0; }
  else if (fact.kind === 'appointment_started' || fact.kind === 'appointment_ended') {
    const military = fact.payload.officeKind.includes('军团') || fact.payload.officeKind.includes('水师') || fact.payload.officeKind === '枢密使';
    if (!military && fact.importance < 4) return null;
    phase = fact.kind === 'appointment_started' ? 'command' : 'setback'; priority = military ? 1 : 2;
  } else return null;
  const sources = sourceEvents(events, fact.actorIds[0] ?? '', [fact.id], fact.id);
  return {
    id: `person-story:${fact.id}`, turn: fact.turn, phase, title: narrative.title, summary: narrative.summary,
    importance: fact.importance, priority, sourceFactIds: [fact.id], sourceEventIds: sources.ids,
    primaryEventId: sources.primary, primaryFactId: fact.id,
  };
}

/** One to three evidence-owned changes of circumstance; one battle settlement can occupy only one beat. */
export function projectPersonStoryArc(world: WorldState, person: CharacterState, scope: 'all' | 'active' = 'all'): PersonStoryBeat[] {
  const facts = (scope === 'all' ? readWorldFacts(world) : world.facts)
    .filter((fact) => fact.actorIds.includes(person.id) && (fact.kind !== 'battle' || battleSide(fact, person.id)))
    .sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  const events = (scope === 'all' ? readWorldHistory(world) : world.history).filter(isDefaultVisibleHistoryEvent);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
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
    const candidate = factCandidate(world, fact, events);
    if (candidate) candidates.push(candidate);
  }
  const terminal = !person.alive ? candidates.filter((item) => item.phase === 'ending')
    .sort((left, right) => right.turn - left.turn || compareId(left.id, right.id))[0] : undefined;
  const pool = candidates.filter((item) => item !== terminal).sort((left, right) => left.priority - right.priority
    || right.importance - left.importance || right.turn - left.turn || compareId(left.id, right.id));
  const chosen: Candidate[] = [];
  for (const item of pool) {
    if (chosen.length >= (terminal ? 2 : 3)) break;
    if (chosen.some((entry) => entry.sourceFactIds.some((id) => item.sourceFactIds.includes(id)))) continue;
    chosen.push(item);
  }
  const ordered = chosen.sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  if (terminal) ordered.push(terminal);
  return ordered.map((item) => ({
    phase: item.phase, phaseLabel: phaseLabels[item.phase], dateLabel: historyTurnDate(item.turn).label,
    title: item.title, summary: item.summary, sourceFactIds: item.sourceFactIds,
    sourceEventIds: item.sourceEventIds, primaryEventId: item.primaryEventId, primaryFactId: item.primaryFactId,
  }));
}
