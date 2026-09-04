import { readWorldFacts, readWorldHistory } from '../sim/archive';
import type { BattleFact, SimulationFact } from '../sim/facts';
import type { CharacterState, WorldState } from '../sim/types';
import { projectFactNarrative } from './historical-scenes';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import { historyTurnDate } from './v1-history';

export type PersonStoryPhase = 'origin' | 'rise' | 'turning' | 'current';

export interface PersonStoryBeat {
  id: string;
  phase: PersonStoryPhase;
  phaseLabel: string;
  dateLabel: string;
  title: string;
  summary: string;
  sourceFactIds: readonly string[];
  sourceEventIds: readonly string[];
  primaryEventId: string | null;
  importance: number;
}

interface Candidate {
  id: string;
  turn: number;
  title: string;
  summary: string;
  importance: number;
  tone: Exclude<PersonStoryPhase, 'current'> | 'neutral';
  sourceFactIds: string[];
  sourceEventIds: string[];
}

const labels: Record<PersonStoryPhase, string> = { origin: '起点', rise: '得势', turning: '转折', current: '近况' };
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

function factTone(fact: SimulationFact, characterId: string): Candidate['tone'] {
  if (fact.turn === 0) return 'origin';
  if (fact.kind === 'battle') return battleSide(fact, characterId)?.won ? 'rise' : 'turning';
  if (fact.kind === 'character_death' || fact.kind === 'character_wounded'
    || fact.kind === 'appointment_ended' || fact.kind === 'expedition_response'
    || (fact.kind === 'army_order_changed' && fact.payload.next.status === 'blocked')) return 'turning';
  if (fact.kind === 'appointment_started' || fact.kind === 'marriage' || fact.kind === 'local_governance_resolved') return 'rise';
  if (fact.kind === 'agency_intent_resolved') return fact.payload.outcome === 'executed' ? 'rise' : 'turning';
  return 'neutral';
}

function battleCandidate(world: WorldState, facts: readonly BattleFact[], personId: string): Candidate {
  const ordered = [...facts].sort((left, right) => left.turn - right.turn || compareId(left.id, right.id));
  const first = ordered[0] as BattleFact;
  const latest = ordered.at(-1) as BattleFact;
  const firstSide = battleSide(first, personId)!;
  const latestSide = battleSide(latest, personId)!;
  const place = world.regions.find((item) => item.id === latest.payload.targetRegionId)?.name ?? '无名战场';
  if (ordered.length === 1) return {
    id: `person-story:battle:${first.id}`, turn: first.turn,
    title: `${place}${firstSide.stance}${firstSide.won ? '得胜' : '受挫'}`,
    summary: `自带${firstSide.participant.soldiersBefore}人参战，损失${firstSide.participant.losses}人，余${firstSide.participant.soldiersAfter}人；${firstSide.won ? '随军守住胜势' : '随败军退却'}。`,
    importance: first.importance + (firstSide.participant.role === 'commander' ? 1 : 0),
    tone: firstSide.won ? 'rise' : 'turning', sourceFactIds: [first.id], sourceEventIds: [],
  };
  const costliest = [...ordered].sort((left, right) => (
    (battleSide(right, personId)?.participant.losses ?? 0) - (battleSide(left, personId)?.participant.losses ?? 0)
    || compareId(left.id, right.id)
  ))[0] as BattleFact;
  return {
    id: `person-story:battles:${first.id}:${latest.id}`, turn: latest.turn,
    title: `${place}${latestSide.stance === '守阵' ? '屡次守阵' : '连续进兵'}${latestSide.won ? '得势' : '受挫'}`,
    summary: `自${historyTurnDate(first.turn).label}起在此线交战${ordered.length}次，共损失${ordered.reduce((sum, fact) => sum + battleSide(fact, personId)!.participant.losses, 0)}人；最初本部${firstSide.participant.soldiersBefore}人，最近一战尚余${latestSide.participant.soldiersAfter}人。`,
    importance: Math.max(...ordered.map((fact) => fact.importance)) + (latestSide.participant.role === 'commander' ? 1 : 0),
    tone: latestSide.won ? 'rise' : 'turning',
    sourceFactIds: unique([first.id, costliest.id, latest.id]), sourceEventIds: [],
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
  return [...groups.values()].map((group) => battleCandidate(world, group, personId));
}

function currentCandidate(world: WorldState, person: CharacterState, facts: readonly SimulationFact[], anchor: Candidate): Candidate {
  if (!person.alive) return { ...anchor, tone: 'neutral' };
  const force = world.personalForces.find((item) => item.ownerId === person.id);
  const army = force?.formationId ? world.armies.find((item) => item.id === force.formationId) : undefined;
  const place = world.regions.find((item) => item.id === person.locationRegionId)?.name ?? '所在不详';
  const faction = world.factions.find((item) => item.id === person.factionId && item.active);
  const defenses = facts.filter((fact): fact is BattleFact => fact.kind === 'battle')
    .filter((fact) => battleSide(fact, person.id)?.stance === '守阵' && battleSide(fact, person.id)?.won);
  const places = unique(defenses.map((fact) => world.regions.find((item) => item.id === fact.payload.targetRegionId)?.name ?? '无名战场'));
  const standing = army
    ? person.id === army.commanderId ? `仍掌${army.name}` : `随${world.characters.find((item) => item.id === army.commanderId)?.name ?? '主将'}出征`
    : '独立驻留';
  return {
    ...anchor, title: `${person.name}如今在${place}`,
    summary: `${defenses.length >= 2 ? `此前先后在${places.slice(0, 3).join('、')}守阵${defenses.length}次；` : ''}${standing}${force ? `，自有部曲${force.soldiers}人` : ''}${faction ? `，为${faction.name}${faction.leaderId === person.id ? '首领' : '成员'}` : ''}；最近可核验的经历是“${anchor.title}”。`,
    tone: 'neutral', sourceFactIds: unique([...anchor.sourceFactIds, ...defenses.map((fact) => fact.id)]),
  };
}

/** A read-only synopsis. Facts own the account; Chronicle only supplies navigation. */
export function projectPersonStoryArc(world: WorldState, person: CharacterState, scope: 'all' | 'active' = 'all'): PersonStoryBeat[] {
  const facts = (scope === 'all' ? readWorldFacts(world) : world.facts)
    .filter((fact) => fact.actorIds.includes(person.id) && (fact.kind !== 'battle' || battleSide(fact, person.id)));
  const history = (scope === 'all' ? readWorldHistory(world) : world.history)
    .filter((event) => isDefaultVisibleHistoryEvent(event) && event.actorIds.includes(person.id));
  const eventsByFact = new Map<string, string[]>();
  for (const event of history) for (const factId of event.sourceFactIds) {
    eventsByFact.set(factId, [...(eventsByFact.get(factId) ?? []), event.id]);
  }
  const battleIds = new Set(facts.filter((fact) => fact.kind === 'battle').map((fact) => fact.id));
  const candidates = compressedBattles(world, facts, person.id);
  for (const fact of facts) {
    if (battleIds.has(fact.id) || fact.kind === 'situation_milestone' || fact.kind === 'embodied_action_submitted') continue;
    const narrative = projectFactNarrative(world, fact);
    candidates.push({
      id: `person-story:fact:${fact.id}`, turn: fact.turn, title: narrative.title, summary: narrative.summary,
      importance: fact.importance + (fact.kind === 'army_order_changed' && fact.payload.next.status === 'blocked' ? 4 : 0),
      tone: factTone(fact, person.id), sourceFactIds: [fact.id], sourceEventIds: [],
    });
  }
  for (const item of candidates) item.sourceEventIds = unique(item.sourceFactIds.flatMap((id) => eventsByFact.get(id) ?? []));
  const latest = [...candidates].sort((left, right) => right.turn - left.turn || right.importance - left.importance || compareId(left.id, right.id))[0];
  if (!latest) return [];
  const used = new Set([latest.id]);
  const pick = (tone: Candidate['tone'], comparison: (left: Candidate, right: Candidate) => number) => {
    const item = [...candidates].filter((candidate) => candidate.tone === tone && !used.has(candidate.id)).sort(comparison)[0];
    if (item) used.add(item.id);
    return item;
  };
  const selected: Array<[PersonStoryPhase, Candidate | undefined]> = [
    ['origin', pick('origin', (left, right) => left.turn - right.turn || compareId(left.id, right.id))
      ?? pick('neutral', (left, right) => left.turn - right.turn || compareId(left.id, right.id))],
    ['rise', pick('rise', (left, right) => right.importance - left.importance || left.turn - right.turn || compareId(left.id, right.id))],
    ['turning', pick('turning', (left, right) => right.importance - left.importance || right.turn - left.turn || compareId(left.id, right.id))],
    ['current', currentCandidate(world, person, facts, latest)],
  ];
  return selected.filter((item): item is [PersonStoryPhase, Candidate] => Boolean(item[1])).map(([phase, item]) => ({
    id: item.id, phase, phaseLabel: labels[phase], dateLabel: historyTurnDate(item.turn).label,
    title: item.title, summary: item.summary, sourceFactIds: item.sourceFactIds, sourceEventIds: item.sourceEventIds,
    primaryEventId: item.sourceEventIds[0] ?? null, importance: Math.min(5, item.importance),
  }));
}
