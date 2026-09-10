import { readWorldFacts, readWorldHistory } from '../sim/archive';
import { continuousAppointmentIds } from '../sim/facts/projector';
import type { BattleFact, SimulationFact } from '../sim/facts';
import type { CharacterState, HistoryEvent, WorldState } from '../sim/types';
import { playerHistoryText, projectFactNarrative } from './historical-scenes';
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
const evidenceCache = new WeakMap<WorldState, { signature: string; blocks: string[]; facts: SimulationFact[]; events: HistoryEvent[]; continuations: Set<string>;
    byId: Map<string, SimulationFact>; order: Map<string, number>; actors: Map<string, SimulationFact[]>; actorEvents: Map<string, HistoryEvent[]>; capitalEvents: HistoryEvent[]; stories: Map<string, PersonStoryBeat[]> }>();
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
  const entry = { signature, blocks, facts, events, continuations: continuousAppointmentIds(facts), byId: new Map(facts.map(f => [f.id, f])), order: new Map(facts.map((f,i) => [f.id,i])), actors, actorEvents,
    capitalEvents: events.filter(e => e.kind === 'capital_fall' || e.kind === 'polity_eliminated'), stories: new Map<string, PersonStoryBeat[]>() };
  evidenceCache.set(world, entry);
  return entry;
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
const unique = (values: readonly string[]) => [...new Set(values)].sort();

/** Distinct territorial consequences in an already selected career; citations aren't achievements. */
export function storyTerritories(ids: readonly string[], byId: ReadonlyMap<string, SimulationFact>) {
  return new Set(ids.flatMap(id => {
    const f = byId.get(id);
    return f?.kind === 'territory_control_changed' ? [f.payload.regionId] : [];
  }));
}

function mergeSources(target: Candidate, sources: readonly Candidate[]) {
  target.sourceFactIds = unique([...target.sourceFactIds, ...sources.flatMap(c => c.sourceFactIds)]);
  target.sourceEventIds = unique([...target.sourceEventIds, ...sources.flatMap(c => c.sourceEventIds)]);
}

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

function sourceEvents(events: readonly HistoryEvent[], factIds: readonly string[], primaryFactId: string) {
  const linked = events.filter((event) => event.sourceFactIds.some((id) => factIds.includes(id)));
  const primary = linked.find((event) => event.sourceFactIds.includes(primaryFactId));
  return { sourceFactIds: factIds, primaryFactId, sourceEventIds: linked.map((event) => event.id), primaryEventId: primary?.id ?? null };
}

function episodeCandidate(world: WorldState, episodes: readonly BattleEpisode[], personId: string, events: readonly HistoryEvent[]): Candidate | null {
  const first = episodes[0]!, latest = episodes.at(-1)!;
  const allFacts = episodes.flatMap(e => [e.battle, ...e.linked]);
  const death = allFacts.find(f => f.kind === 'character_death');
  const wound = allFacts.find(f => f.kind === 'character_wounded');
  const turning = death ?? wound;
  const focus = latest; // Injury/death already ends a battle group.
  const side = battleSide(focus.battle, personId)!;
  const ended = allFacts.filter(f => f.kind === 'appointment_ended');
  const loss = Math.max(...episodes.map(e => { const p = battleSide(e.battle, personId)!.participant; return p.losses / Math.max(1, p.soldiersBefore); }));
  if (episodes.length === 1 && side.participant.role === 'member' && loss < .15
    && first.battle.importance < 4 && !turning && !ended.length) return null;
  const places = [...new Set(episodes.map(e => world.regions.find(r => r.id === e.battle.payload.targetRegionId)?.name ?? '无名战场'))];
  const ids = unique(allFacts.map(f => f.id)), primary = turning?.id ?? focus.battle.id;
  const p = side.participant;
  let summary = episodes.length === 1
    ? `此役战前${p.soldiersBefore}人，战损${p.losses}人，战后${p.soldiersAfter}人。`
    : `沿${places.join('、')}先后参战${episodes.length}次，记录战损累计${episodes.reduce((n,e) => n + battleSide(e.battle, personId)!.participant.losses, 0)}人；最近一战战前${p.soldiersBefore}人，战后${p.soldiersAfter}人。`;
  if (wound?.kind === 'character_wounded') summary += ` 负伤退出行营，休养至第${wound.payload.recoveryUntilTurn ?? wound.turn + 2}季。`;
  if (ended.length) summary += ` 同季卸下${unique(ended.map(f => f.payload.officeKind)).join('、')}。`;
  return {
    id: primary, turn: turning?.turn ?? focus.battle.turn, startTurn: first.battle.turn,
    phase: death ? 'ending' : wound || !side.won ? 'setback' : 'battle',
    title: `${places.join('、')}${episodes.length > 1 ? '连番' : ''}${side.stance}${side.won ? '得胜' : '受挫'}${death ? '，阵亡' : wound ? '，负伤退营' : ''}`,
    summary, importance: Math.max(...allFacts.map(f => f.importance)),
    priority: death ? 0 : wound || !side.won && loss >= .2 || places.length > 1 ? 2 : 4,
    ...sourceEvents(events, ids, primary),
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
  return {
    id: fact.id, turn: fact.turn, phase, ...projectFactNarrative(world, fact),
    importance: fact.importance, priority, ...sourceEvents(events, [fact.id], fact.id),
  };
}

/** Up to five evidence-owned changes, shared by discovery and the opened dossier. */
export function projectPersonStoryArc(world: WorldState, person: CharacterState, evidence = personHistoryEvidence(world)): PersonStoryBeat[] {
  const cached = evidence.stories.get(person.id);
  if (cached) return cached;
  const allFacts = evidence.facts;
  const facts = (evidence.actors.get(person.id) ?? [])
    .filter((fact) => fact.kind !== 'battle' || battleSide(fact, person.id))
    .sort((left, right) => left.turn - right.turn);
  const events = [...new Set([...(evidence.actorEvents.get(person.id) ?? []), ...evidence.capitalEvents])];
  const byId = evidence.byId;
  const appointments = facts.filter((f): f is Extract<SimulationFact, {kind:'appointment_started'|'appointment_ended'}> =>
    (f.kind === 'appointment_started' || f.kind === 'appointment_ended') && f.payload.holderId === person.id);
  const reigns = world.offices.filter(o => o.holderId === person.id && o.kind === '君主');
  const seats = reigns.map(office => ({ office,
    start: appointments.find(f => f.kind === 'appointment_started' && f.payload.appointmentId === office.id && !evidence.continuations.has(f.id)),
    end: facts.find(f => f.kind === 'character_death'
      || f.kind === 'appointment_ended' && f.payload.appointmentId === office.id && !evidence.continuations.has(f.id)
      || f.turn >= office.appointedTurn && f.stateDeltas.some(d => d.entityId === office.polityId
        && d.field === 'rulerId' && d.before === person.id && d.after !== person.id)),
  }));
  // Read the archive stream, never ID spelling. Unsourced legacy events only have a dated tenure.
  const reignAt = (turn: number, ids: readonly string[] = []) => {
    const position = Math.min(...ids.map(id => byId.get(id)?.turn === turn ? evidence.order.get(id)! : Infinity));
    return seats.filter(({office:o,start,end}) => o.appointedTurn <= turn && (o.endedTurn === null || o.endedTurn >= turn)
      && (!start || start.turn !== turn || evidence.order.get(start.id)! <= position)
      && (!Number.isFinite(position) || !end || end.turn > turn
        || end.turn === turn && evidence.order.get(end.id)! >= position)).map(s => s.office);
  };
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
    left.battle.turn - right.battle.turn
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
    if (evidence.continuations.has(fact.id)) continue;
    if (fact.kind === 'battle' || linkedIds.has(fact.id) || fact.kind === 'character_wounded') continue;
    if (fact.kind === 'appointment_ended' && !fact.sourceFactIds.length && injuryTurns.has(fact.turn)) continue;
    const candidate = factCandidate(world, fact, events, person.id);
    if (candidate) candidates.push(candidate);
  }
  // Accession and capital relocation are authoritative Chronicle changes, not battle participation.
  for (const event of events) {
    const founded = event.kind === 'rebellion' ? event.stateDeltas.find(d => d.entityType === 'polity'
      && d.field === 'alive' && (d.before === false || d.before === 0) && d.after && reignAt(event.turn).some(o => o.polityId === d.entityId)) : undefined;
    const accession = event.stateDeltas.some(d => d.field === 'rulerId' && d.after === person.id)
      || event.kind === 'succession' && (event.sourceFactIds.some(id => {
        const f = byId.get(id); return f?.kind === 'appointment_started' && f.payload.officeKind === '君主' && f.payload.holderId === person.id;
      }) || !event.sourceFactIds.length && event.actorIds.length === 1
        && event.actorIds[0] === person.id && /继位|登位|获拥立/.test(event.title));
    const legacyDeed = !event.sourceFactIds.length && event.actorIds.includes(person.id)
      && ['local_governance', 'naval_operation_aborted'].includes(event.kind);
    const capital = event.kind === 'capital_fall';
    const loss = event.stateDeltas.find(d => d.entityType === 'polity' && (capital ? d.field === 'capitalRegionId'
      : event.kind === 'polity_eliminated' && d.field === 'alive' && (d.after === false || d.after === 0)));
    const oldCapitalId = loss?.before;
    const transfers = event.sourceFactIds.map(id => byId.get(id)).filter(f => f?.kind === 'territory_control_changed');
    const defeated = reignAt(event.turn, event.sourceFactIds).some(o => o.polityId === loss?.entityId);
    const victorious = !defeated && reignAt(event.turn, transfers.map(f => f!.id)).some(o => transfers.some(f =>
      f!.payload.nextControllerId === o.polityId && f!.payload.previousControllerId === loss?.entityId));
    const capture = capital ? [...episodes.values()].find(e => e.battle.turn === event.turn
      && e.battle.payload.targetRegionId === oldCapitalId && battleSide(e.battle, person.id)?.won
      && event.sourceFactIds.some(id => { const f = byId.get(id); return f && rootBattleId(f, byId) === e.battle.id; })) : undefined;
    if (!founded && !accession && !legacyDeed && !((capital || event.kind === 'polity_eliminated') && (defeated || victorious || capture))) continue;
    const battle = capture?.battle;
    const place = world.regions.find(r => r.id === oldCapitalId)?.name ?? '旧都';
    const polityName = world.polities.find(p => p.id === (founded?.entityId ?? loss?.entityId))?.name ?? '该国';
    const title = founded ? `${event.title}，建立${polityName}` : accession ? `${person.name}登位` : legacyDeed ? event.title
      : battle ? `${person.name}参战，攻克${place}` : capital ? `任内国事：${victorious ? `攻取${place}` : event.title}`
        : `任内${victorious ? '灭敌' : '亡国'}：${polityName}`;
    const sourceFactIds = unique([...event.sourceFactIds, ...(battle ? [battle.id] : []), ...appointments.filter(f => f.turn === event.turn && (
      ((accession || founded) && (f.kind === 'appointment_started' && (f.payload.officeKind === '君主' || f.payload.polityId === founded?.entityId)
        || f.kind === 'appointment_ended' && !f.sourceFactIds.length && (accession && event.polityIds.includes(f.payload.polityId)
          || founded && event.stateDeltas.some(d => d.entityType === 'character' && d.entityId === person.id
            && d.field === 'polityId' && d.before === f.payload.polityId && d.after === founded.entityId)))
        || event.kind === 'polity_eliminated' && defeated
        && f.kind === 'appointment_ended' && f.payload.polityId === loss?.entityId)
      )).map(f => f.id)]);
    const episode = battle && candidates.find(c => c.sourceFactIds.includes(battle.id));
    if (episode) {
      if (episode.phase === 'battle') {
        episode.priority = -1;
        episode.title = `${person.name}参战，攻克${place}`;
        episode.primaryEventId = event.id;
        episode.primaryFactId = battle.id;
      }
      episode.summary += ` ${event.summary}`;
      episode.sourceFactIds = unique([...episode.sourceFactIds, ...sourceFactIds]);
      episode.sourceEventIds = unique([...episode.sourceEventIds, event.id]);
      continue;
    }
    const operationId = event.stateDeltas.find(d => d.entityType === 'navalOperation')?.entityId;
    const departure = event.kind === 'naval_operation_aborted' && operationId ? events.find(e => e.kind === 'amphibious_operation_prepared'
      && e.turn <= event.turn && e.stateDeltas.some(d => d.entityType === 'navalOperation' && d.entityId === operationId)) : undefined;
    const settled = candidates.filter(c => c.turn === event.turn && c.sourceFactIds.some(id => sourceFactIds.includes(id))
      && c.sourceFactIds.some(id => ['appointment_started','appointment_ended'].includes(byId.get(id)?.kind ?? '')));
    for (const c of settled) candidates.splice(candidates.indexOf(c), 1);
    candidates.push({ id: event.id, turn: event.turn, startTurn: departure?.turn, importance: event.importance,
      priority: founded || accession ? -2 : capital || event.kind === 'polity_eliminated' ? -1 : 1,
      phase: founded || accession || event.kind === 'local_governance' ? 'command' : battle || victorious ? 'battle' : 'setback',
      title, summary: `${departure ? `${departure.summary} 此后，` : ''}${event.summary}`.replace(/navop_\d+/g, '所记远征'),
      sourceFactIds,
      sourceEventIds: [...(departure ? [departure.id] : []), event.id],
      primaryEventId: event.id, primaryFactId: battle?.id ?? sourceFactIds[0] ?? null });
    mergeSources(candidates.at(-1)!, settled);
  }
  // A recent capture followed by defending that same place in the same war is
  // one career stage. A different war, role, defeat or wound stays separate.
  for (const defense of [...candidates]) {
    const battles = defense.sourceFactIds.map(id => byId.get(id)).filter((f): f is BattleFact => f?.kind === 'battle')
      .sort((a,b) => evidence.order.get(a.id)! - evidence.order.get(b.id)!);
    if (!battles.length || defense.phase !== 'battle') continue;
    const first = battles[0], place = first.payload.targetRegionId, role = battleSide(first, person.id)!.participant.role;
    if (!battles.every(b => {
      const side = battleSide(b, person.id)!;
      return b.payload.targetRegionId === place && side.stance === '守阵' && side.won && side.participant.role === role;
    })) continue;
    const attack = candidates.find(c => c !== defense && c.phase === 'battle' && c.turn <= first.turn && first.turn - c.turn <= 4
      && c.sourceFactIds.some(id => {
        const f = byId.get(id); return f?.kind === 'territory_control_changed' && f.payload.regionId === place
          && f.payload.warId === first.payload.warId && f.payload.reason === 'battle_capture';
      }) && c.sourceFactIds.some(id => {
        const f = byId.get(id); return f?.kind === 'battle' && f.payload.targetRegionId === place
          && battleSide(f, person.id)?.participant.role === role && battleSide(f, person.id)?.stance === '进兵';
      }));
    if (!attack) continue;
    attack.summary += ` 随后在${world.regions.find(r => r.id === place)?.name ?? '当地'}参与${battles.length}次守战，${battles.some(b => b.payload.defenders.length > 1) ? '与同地友军一起' : ''}击退来敌。`;
    attack.startTurn ??= attack.turn; attack.turn = defense.turn;
    mergeSources(attack, [defense]);
    candidates.splice(candidates.indexOf(defense), 1);
  }
  // Territorial changes belong to a reign, not automatically to the ruler's sword.
  const campaigns: SimulationFact[][] = [];
  let campaign: SimulationFact[] | undefined;
  for (const f of (reigns.length ? allFacts : []).filter(f => f.kind === 'territory_control_changed' && f.payload.reason === 'battle_capture'
    && reignAt(f.turn, [f.id]).some(o => [f.payload.nextControllerId,f.payload.previousControllerId].includes(o.polityId)))
    .sort((a,b) => a.turn - b.turn)) {
    if (f.kind !== 'territory_control_changed') continue;
    if (!reignAt(f.turn, [f.id]).some(o => o.polityId === f.payload.nextControllerId)) { campaign = undefined; continue; }
    const first = campaign?.[0];
    if (first?.kind !== 'territory_control_changed' || first.payload.previousControllerId !== f.payload.previousControllerId
      || first.payload.nextControllerId !== f.payload.nextControllerId || !campaign?.some(prev => prev.regionIds.some(id => id === f.payload.regionId
        || world.regions.find(r => r.id === id)?.neighbors.includes(f.payload.regionId)))) {
      campaign = []; campaigns.push(campaign);
    }
    campaign!.push(f);
  }
  for (const group of campaigns.filter(g => g.length > 1)) {
    const places = [...new Set(group.flatMap(f => f.regionIds))].map(id => world.regions.find(r => r.id === id)?.name ?? '失名州郡');
    const ids = unique(group.flatMap(f => [f.id, ...f.sourceFactIds]));
    const own = candidates.filter(c => c.phase === 'battle' && c.sourceFactIds.some(id => ids.includes(id)));
    const combined: Candidate = { id: group[0].id, startTurn: group[0].turn, turn: group.at(-1)!.turn, phase: 'battle', priority: -1,
      title: `${person.name}任内连取${places.length > 3 ? `${places.at(-1)}等${places.length}地` : places.join('、')}`,
      summary: `其在位期间，军队先后取得${places.join('、')}。${own.map(c => c.summary).join('')}`,
      importance: Math.max(...group.map(f => f.importance)), ...sourceEvents(events, ids, group.at(-1)!.id) };
    mergeSources(combined, own); candidates.push(combined);
    for (const c of own) candidates.splice(candidates.indexOf(c), 1);
  }
  // A simultaneous change of post is not, by itself, a political fall.
  for (const ended of appointments.filter(f => f.kind === 'appointment_ended' && f.payload.officeKind !== '君主')) {
    if (ended.sourceFactIds.length || injuryTurns.has(ended.turn)) continue;
    const started = appointments.find(f => f.kind === 'appointment_started' && f.turn === ended.turn
      && f.payload.polityId === ended.payload.polityId && f.payload.officeKind !== ended.payload.officeKind);
    const next = started && candidates.find(c => c.id === started.id), old = candidates.find(c => c.id === ended.id);
    if (!next || !old || started?.kind !== 'appointment_started') continue;
    next.title = `${person.name}由${ended.payload.officeKind}转任${started.payload.officeKind}`;
    next.summary = `${next.summary} 同季卸下${ended.payload.officeKind}。`;
    mergeSources(next, [old]);
    candidates.splice(candidates.indexOf(old), 1);
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
    chain.sort((a,b) => a.turn - b.turn);
    const first = chain[0], last = chain.at(-1)!;
    first.summary = chain.map(c => `${historyTurnDate(c.turn).label}，${c.title}。`).join('');
    const entrances = chain.filter(c => c.phase === 'command').length;
    first.title = `${person.name}先后${entrances}次进入权力中枢${last.phase === 'setback' ? '，后又退出' : ''}`;
    first.startTurn = first.turn; first.turn = last.turn;
    mergeSources(first, chain);
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
    mergeSources(command, [item]);
    candidates.splice(candidates.indexOf(item), 1);
  }
  const terminal = !person.alive ? candidates.filter((item) => item.phase === 'ending')
    .sort((left, right) => right.turn - left.turn)[0] : undefined;
  if (terminal) {
    const battle = terminal.sourceFactIds.map(id => byId.get(id)).find(f => f?.kind === 'battle');
    if (battle?.kind === 'battle') {
      const losses = allFacts.filter(f => f.kind === 'territory_control_changed' && f.payload.warId === battle.payload.warId
        && f.turn <= terminal.turn && reignAt(f.turn, [f.id]).some(o => o.polityId === f.payload.previousControllerId))
        .sort((a,b) => a.turn-b.turn);
      const exits = events.filter(e => e.turn === terminal.turn && ['faction_ended', 'polity_eliminated'].includes(e.kind)
        && (e.actorIds.includes(person.id) || e.kind === 'polity_eliminated'
          && e.sourceFactIds.some(id => { const f=byId.get(id); return f && rootBattleId(f,byId) === battle.id; })));
      const lostPlaces = [...new Set(losses.filter(f => f.turn < terminal.turn).flatMap(f => f.regionIds))]
        .map(id => world.regions.find(r => r.id === id)?.name ?? '州郡');
      if (lostPlaces.length) terminal.title = `${lostPlaces.join('、')}先后失守，${terminal.title}`;
      terminal.summary += exits.map(e => ` ${e.title}。`).join('');
      terminal.sourceFactIds = unique([...terminal.sourceFactIds, ...losses.flatMap(f => [f.id, ...f.sourceFactIds]), ...exits.flatMap(e => e.sourceFactIds)]);
      terminal.sourceEventIds = unique([...terminal.sourceEventIds, ...exits.map(e => e.id)]);
    }
  }
  const pool = candidates.filter((item) => item !== terminal).sort((left, right) => left.priority - right.priority
    || right.importance - left.importance || right.turn - left.turn);
  const chosen: Candidate[] = [];
  const latest = [...pool].sort((a,b) => b.turn-a.turn)[0];
  const beginning = [...pool].sort((a,b) => (a.startTurn ?? a.turn)-(b.startTurn ?? b.turn))[0];
  const gains = (c: Candidate) => c.phase === 'battle' ? storyTerritories(c.sourceFactIds, byId).size : 0;
  const peak = [...pool].sort((a,b) => gains(b)-gains(a) || a.priority-b.priority || b.importance-a.importance)[0];
  const setback = pool.find(c => c.phase === 'setback' && c.priority <= 2);
  for (const item of [pool[0], peak, setback, latest, ...pool.filter(c => c.priority < 0), beginning, ...pool]) {
    if (!item) continue;
    if (chosen.length >= (terminal ? 4 : 5)) break;
    if (chosen.some(entry => entry.title === item.title || entry.sourceFactIds.some(id => item.sourceFactIds.includes(id)))) continue;
    chosen.push(item);
  }
  const ordered = chosen.sort((left, right) => (left.startTurn ?? left.turn) - (right.startTurn ?? right.turn));
  if (terminal) ordered.push(terminal);
  const result = ordered.map((item) => ({
    phase: item.phase, phaseLabel: phaseLabels[item.phase], dateLabel: item.startTurn !== undefined && item.startTurn !== item.turn
      ? `${historyTurnDate(item.startTurn).label}至${historyTurnDate(item.turn).label}` : historyTurnDate(item.turn).label,
    title: playerHistoryText(world, item.title), summary: playerHistoryText(world, item.summary), sourceFactIds: item.sourceFactIds,
    sourceEventIds: item.sourceEventIds, primaryEventId: item.primaryEventId, primaryFactId: item.primaryFactId, importance: item.importance,
  }));
  evidence.stories.set(person.id, result);
  return result;
}
