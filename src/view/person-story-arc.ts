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
  primaryFactId: string | null;
  importance: number;
}

/** Read-only snapshot cache; mutation, import and archive changes invalidate it. */
const evidenceCache = new WeakMap<WorldState, { signature: string; blocks: string[]; facts: SimulationFact[]; events: HistoryEvent[];
  byId: Map<string, SimulationFact>; actors: Map<string, SimulationFact[]>; actorEvents: Map<string, HistoryEvent[]>; capitalEvents: HistoryEvent[]; stories: Map<string, PersonStoryBeat[]> }>();
export function personHistoryEvidence(world: WorldState) {
  const signature = JSON.stringify([world.facts, world.history, world.characters, world.offices, world.polities, world.regions,
    world.factions, world.families, world.armies, world.fleets,
    world.archiveSystem.blocks.map(({ payloadBase64: _payload, ...metadata }) => metadata)]);
  const blocks = world.archiveSystem.blocks.map(b => b.payloadBase64);
  const cached = evidenceCache.get(world);
  if (cached && cached.signature === signature && cached.blocks.length === blocks.length
    && blocks.every((b, i) => b === cached.blocks[i])) return cached;
  const facts = readWorldFacts(world), events = readWorldHistory(world).filter(isDefaultVisibleHistoryEvent);
  const actors = new Map<string, SimulationFact[]>();
  for (const f of facts) for (const id of f.actorIds) {
    const records = actors.get(id) ?? []; records.push(f); actors.set(id, records);
  }
  const actorEvents = new Map<string, HistoryEvent[]>();
  for (const event of events) for (const id of new Set([...event.actorIds,
    ...event.stateDeltas.filter(d => d.field === 'rulerId' && typeof d.after === 'string').map(d => String(d.after)),
  ])) { const rows = actorEvents.get(id) ?? []; rows.push(event); actorEvents.set(id, rows); }
  const entry = { signature, blocks, facts, events, byId: new Map(facts.map(f => [f.id, f])), actors, actorEvents,
    capitalEvents: events.filter(e => e.kind === 'capital_fall'), stories: new Map<string, PersonStoryBeat[]>() };
  evidenceCache.set(world, entry);
  return entry;
}

/** A capital binding changed, not the person occupying the throne. */
export function isContinuousRulerSeat(fact: SimulationFact, facts: readonly SimulationFact[]): boolean {
  if ((fact.kind !== 'appointment_started' && fact.kind !== 'appointment_ended') || fact.payload.officeKind !== '君主') return false;
  return facts.some(f => (f.kind === 'appointment_started' || f.kind === 'appointment_ended')
    && f.kind !== fact.kind && f.turn === fact.turn && f.payload.officeKind === '君主'
    && f.payload.holderId === fact.payload.holderId && f.payload.polityId === fact.payload.polityId
    && f.payload.regionId !== fact.payload.regionId)
    && !facts.some(f => f.turn === fact.turn && f.kind === 'appointment_started' && f.payload.officeKind === '君主'
      && f.payload.polityId === fact.payload.polityId && f.payload.holderId !== fact.payload.holderId);
}

interface Candidate extends Omit<PersonStoryBeat, 'phaseLabel' | 'dateLabel'> {
  id: string;
  turn: number;
  startTurn?: number;
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
  const places = [...new Set(episodes.map(e => world.regions.find(r => r.id === e.battle.payload.targetRegionId)?.name ?? '无名战场'))];
  const place = world.regions.find(r => r.id === focus.battle.payload.targetRegionId)?.name ?? '无名战场';
  const ids = unique(allFacts.map(f => f.id)), primary = turning?.id ?? focus.battle.id;
  const sources = sourceEvents(events, personId, ids, primary);
  const p = side.participant;
  let summary = episodes.length === 1
    ? `此役战前${p.soldiersBefore}人，战损${p.losses}人，战后${p.soldiersAfter}人。`
    : `沿${places.join('、')}先后参战${episodes.length}次，记录战损累计${episodes.reduce((n,e) => n + battleSide(e.battle, personId)!.participant.losses, 0)}人；最近一战战前${p.soldiersBefore}人，战后${p.soldiersAfter}人。`;
  if (wound?.kind === 'character_wounded') summary += ` 负伤退出行营，休养至第${wound.payload.recoveryUntilTurn ?? wound.turn + 2}季。`;
  if (ended.length) summary += ` 同季卸下${unique(ended.map(f => f.payload.officeKind)).join('、')}。`;
  return {
    id: primary, turn: turning?.turn ?? focus.battle.turn, startTurn: first.battle.turn,
    phase: death ? 'ending' : wound || !side.won ? 'setback' : 'battle',
    title: `${places.length > 1 ? places.join('、') : place}${episodes.length > 1 ? '连番' : ''}${side.stance}${side.won ? '得胜' : '受挫'}${death ? '，阵亡' : wound ? '，负伤退营' : ''}`,
    summary, importance: Math.max(...allFacts.map(f => f.importance)),
    priority: death ? 0 : wound || loss >= .3 || places.length > 1 ? 2 : 4,
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
    priority = fact.payload.officeKind === '君主' ? 0 : fact.payload.officeKind === '宰辅' ? 1 : 3;
  } else if (fact.kind === 'local_governance_resolved' && fact.payload.outcome === 'enacted') {
    phase = 'command'; priority = 1;
  } else if (fact.kind === 'court_action_resolved' && [fact.payload.initiatorId, fact.payload.targetId].includes(personId)) {
    phase = fact.payload.targetId === personId ? 'setback' : 'command'; priority = 0;
  } else if (fact.kind === 'faction_lifecycle' && fact.payload.nextLeaderId === personId
    && fact.payload.previousLeaderId !== personId && fact.turn > 0) {
    phase = 'command'; priority = 2;
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

/** Up to five evidence-owned changes, shared by discovery and the opened dossier. */
export function projectPersonStoryArc(world: WorldState, person: CharacterState, scope: 'all' | 'active' = 'all', evidence = scope === 'all' ? personHistoryEvidence(world) : null): PersonStoryBeat[] {
  const cached = evidence?.stories.get(person.id);
  if (cached) return cached;
  const seen = new Set<string>();
  const allFacts = evidence?.facts ?? world.facts;
  const facts = (evidence?.actors.get(person.id) ?? allFacts)
    .filter((fact) => fact.actorIds.includes(person.id) && (fact.kind !== 'battle' || battleSide(fact, person.id)))
    .sort((left, right) => left.turn - right.turn || compareId(left.id, right.id))
    .filter((fact) => { const key = canonicalStoryKey(fact); if (seen.has(key)) return false; seen.add(key); return true; });
  const events = (evidence ? [...new Set([...(evidence.actorEvents.get(person.id) ?? []), ...evidence.capitalEvents])] : world.history.filter(isDefaultVisibleHistoryEvent)).filter(e => e.actorIds.includes(person.id)
    || e.stateDeltas.some(d => d.field === 'rulerId' && d.after === person.id) || e.kind === 'capital_fall' || e.kind === 'polity_eliminated');
  const byId = evidence?.byId ?? new Map(allFacts.map((fact) => [fact.id, fact]));
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
    const key = `${episode.battle.payload.warId}:${side.stance}:${side.won}`;
    const current = activeGroupByKey.get(key);
    const previous = current?.at(-1);
    const currentTurnsFate = episode.linked.some((fact) => fact.kind === 'character_wounded' || fact.kind === 'character_death');
    const previousTurnsFate = previous?.linked.some((fact) => fact.kind === 'character_wounded' || fact.kind === 'character_death');
    const adjacent = previous && (previous.battle.payload.targetRegionId === episode.battle.payload.targetRegionId
      || world.regions.find(r => r.id === previous.battle.payload.targetRegionId)?.neighbors.includes(episode.battle.payload.targetRegionId));
    if (!current || !previous || !adjacent || episode.battle.turn - previous.battle.turn > 4 || currentTurnsFate || previousTurnsFate) {
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
    if (isContinuousRulerSeat(fact, facts)) continue;
    if (fact.kind === 'battle' || linkedIds.has(fact.id) || fact.kind === 'character_wounded') continue;
    if (fact.kind === 'appointment_ended' && !fact.sourceFactIds.length && injuryTurns.has(fact.turn)) continue;
    const candidate = factCandidate(world, fact, events, person.id);
    if (candidate) candidates.push(candidate);
  }
  // Accession and capital relocation are authoritative Chronicle changes, not battle participation.
  for (const event of events) {
    const accession = event.stateDeltas.some(d => d.field === 'rulerId' && d.after === person.id)
      || !event.sourceFactIds.length && event.kind === 'succession' && event.actorIds.length === 1
        && event.actorIds[0] === person.id && /继位|登位|获拥立/.test(event.title);
    const legacyDeed = !event.sourceFactIds.length && event.actorIds.includes(person.id)
      && ['local_governance', 'naval_operation_aborted'].includes(event.kind);
    const capital = event.kind === 'capital_fall';
    const oldCapitalId = event.stateDeltas.find(d => d.field === 'capitalRegionId')?.before;
    const involved = event.actorIds.includes(person.id);
    const capture = capital ? [...episodes.values()].find(e => e.battle.turn === event.turn
      && e.battle.payload.targetRegionId === oldCapitalId && battleSide(e.battle, person.id)?.won
      && event.sourceFactIds.some(id => { const f = byId.get(id); return f && rootBattleId(f, byId) === e.battle.id; })) : undefined;
    if (!accession && !legacyDeed && !(capital && (involved || capture))) continue;
    const battle = capture?.battle;
    const place = world.regions.find(r => r.id === oldCapitalId)?.name ?? '旧都';
    const title = accession ? `${person.name}登位` : legacyDeed ? event.title : battle ? `${person.name}参战，攻克${place}` : `任内国事：${event.title}`;
    const sourceFactIds = unique([...event.sourceFactIds, ...(battle ? [battle.id] : []), ...facts.filter(f => accession
      && f.turn === event.turn && f.kind === 'appointment_started' && f.payload.holderId === person.id
      && f.payload.officeKind === '君主').map(f => f.id)]);
    const episode = battle && candidates.find(c => c.sourceFactIds.includes(battle.id));
    if (episode) {
      episode.priority = -1;
      if (!episode.title.startsWith(`${person.name}参战，攻克`)) episode.title = `${person.name}参战，攻克${place}`;
      else if (!episode.title.includes(place)) episode.title += `、${place}`;
      episode.summary += ` ${historyTurnDate(event.turn).label}，${person.name}参战攻克${place}；${event.summary}`;
      episode.sourceFactIds = unique([...episode.sourceFactIds, ...sourceFactIds]);
      episode.sourceEventIds = unique([...episode.sourceEventIds, event.id]);
      continue;
    }
    const operationId = event.stateDeltas.find(d => d.entityType === 'navalOperation')?.entityId;
    const departure = event.kind === 'naval_operation_aborted' && operationId ? events.find(e => e.kind === 'amphibious_operation_prepared'
      && e.turn <= event.turn && e.stateDeltas.some(d => d.entityType === 'navalOperation' && d.entityId === operationId)) : undefined;
    candidates.push({ id: event.id, turn: event.turn, startTurn: departure?.turn, importance: event.importance,
      priority: accession ? -2 : battle ? -1 : 1, phase: accession || event.kind === 'local_governance' ? 'command' : battle ? 'battle' : 'setback',
      title, summary: `${departure ? `${departure.summary} 此后，` : ''}${event.summary}`.replace(/navop_\d+/g, '所记远征'),
      sourceFactIds, sourceEventIds: departure ? [departure.id, event.id] : [event.id], primaryEventId: event.id, primaryFactId: battle?.id ?? event.sourceFactIds[0] ?? null });
  }
  const courtChains = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const f = c.sourceFactIds.map(id => byId.get(id)).find(f => f?.kind === 'court_action_resolved'
      && (f.payload.action === 'power_broker_formed' && f.payload.initiatorId === person.id
        || f.payload.action === 'power_broker_fell' && f.payload.targetId === person.id));
    if (f?.kind !== 'court_action_resolved') continue;
    const chain = courtChains.get(f.payload.polityId) ?? []; chain.push(c); courtChains.set(f.payload.polityId, chain);
  }
  for (const chain of courtChains.values()) {
    if (chain.length < 2) continue;
    chain.sort((a,b) => a.turn - b.turn || compareId(a.id,b.id));
    const first = chain[0], last = chain.at(-1)!;
    first.summary = chain.map(c => `${historyTurnDate(c.turn).label}，${c.title}。`).join('');
    const entrances = chain.filter(c => c.phase === 'command').length;
    first.title = `${person.name}先后${entrances}次进入权力中枢${last.phase === 'setback' ? '，后又退出' : ''}`;
    first.startTurn = first.turn; first.turn = last.turn;
    first.sourceFactIds = unique(chain.flatMap(c => c.sourceFactIds)); first.sourceEventIds = unique(chain.flatMap(c => c.sourceEventIds));
    for (const c of chain.slice(1)) candidates.splice(candidates.indexOf(c), 1);
  }
  // A group's formation and its leader's simultaneous command are one beginning, not two slots.
  for (const item of [...candidates]) {
    const formation = item.sourceFactIds.map(id => byId.get(id)).find(f => f?.kind === 'faction_lifecycle');
    if (!formation) continue;
    const command = candidates.find(c => c !== item && c.turn === item.turn && c.sourceFactIds.some(id => {
      const f = byId.get(id); return f?.kind === 'appointment_started' && f.payload.holderId === person.id && f.payload.officeKind === '军团主帅';
    }));
    if (!command) continue;
    command.summary += ` ${item.summary}`;
    command.sourceFactIds = unique([...command.sourceFactIds, ...item.sourceFactIds]);
    command.sourceEventIds = unique([...command.sourceEventIds, ...item.sourceEventIds]);
    candidates.splice(candidates.indexOf(item), 1);
  }
  const terminal = !person.alive ? candidates.filter((item) => item.phase === 'ending')
    .sort((left, right) => right.turn - left.turn || compareId(left.id, right.id))[0] : undefined;
  const pool = candidates.filter((item) => item !== terminal).sort((left, right) => left.priority - right.priority
    || right.importance - left.importance || right.turn - left.turn || compareId(left.id, right.id));
  const chosen: Candidate[] = [];
  for (const item of pool) {
    if (chosen.length >= (terminal ? 4 : 5)) break;
    if (chosen.some(entry => entry.title === item.title || entry.sourceFactIds.some(id => item.sourceFactIds.includes(id)))) continue;
    chosen.push(item);
  }
  const ordered = chosen.sort((left, right) => (left.startTurn ?? left.turn) - (right.startTurn ?? right.turn) || compareId(left.id, right.id));
  if (terminal) ordered.push(terminal);
  const result = ordered.map((item) => ({
    phase: item.phase, phaseLabel: phaseLabels[item.phase], dateLabel: item.startTurn !== undefined && item.startTurn !== item.turn
      ? `${historyTurnDate(item.startTurn).label}至${historyTurnDate(item.turn).label}` : historyTurnDate(item.turn).label,
    title: playerHistoryText(world, item.title), summary: playerHistoryText(world, item.summary), sourceFactIds: item.sourceFactIds,
    sourceEventIds: item.sourceEventIds, primaryEventId: item.primaryEventId, primaryFactId: item.primaryFactId, importance: item.importance,
  }));
  evidence?.stories.set(person.id, result);
  return result;
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
