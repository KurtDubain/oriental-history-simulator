import type {
  FactionState,
  OfficeAppointment,
  OfficeKind,
  SimulationFact,
  WorldState,
} from '../sim/types';
import {
  calculateFactionPowerLedger,
  recentFactionPowerMovements,
} from '../sim/politics/power-ledger';
import { readWorldFacts, readWorldHistory } from '../sim/archive';
import { isDefaultVisibleHistoryEvent } from './history-visibility';

export type CourtAccessBand = 0 | 1 | 2;
export type CourtRelationKind = 'allied' | 'opposed';
export type CourtEvidenceScope = 'active' | 'all';

export interface CourtSeatView {
  id: string;
  officeId: string;
  office: Extract<OfficeKind, '君主' | '宰辅' | '枢密使' | '廷臣'>;
  holderId: string;
  holder: string;
  rank: number;
  accessBand: CourtAccessBand;
  accessLabel: '君位' | '近班' | '朝班';
  factionId: string | null;
  factionName: string | null;
  powerContribution: number;
  appointedLabel: string;
  appointmentEvidence: string | null;
  sourceEventId: string | null;
}

export interface CourtFactionPositionView {
  factionId: string;
  name: string;
  leaderId: string;
  leader: string;
  agenda: string;
  power: number;
  cohesion: number;
  seatIds: readonly string[];
  seatLabels: readonly string[];
  nearestBand: CourtAccessBand | 3;
  positionLabel: '君位' | '近班' | '朝班' | '外班';
  dominant: boolean;
  foundedLabel: string;
  topRoots: readonly {
    key: string;
    label: string;
    value: number;
  }[];
  recentMovement: {
    turn: number;
    direction: 'gained' | 'held' | 'lost';
    label: string;
    detail: string;
    sourceEventId: string | null;
  } | null;
}

export interface CourtRelationView {
  id: string;
  leftFactionId: string;
  leftName: string;
  rightFactionId: string;
  rightName: string;
  kind: CourtRelationKind;
  label: '结盟' | '相争';
  sinceLabel: string | null;
  sourceEventId: string | null;
}

export interface CourtProjectionView {
  polityId: string;
  summary: string;
  ruler: CourtSeatView | null;
  seats: readonly CourtSeatView[];
  factionPositions: readonly CourtFactionPositionView[];
  graphFactionIds: readonly string[];
  relations: readonly CourtRelationView[];
}

type FactionPoliticalMetadata = FactionState & {
  formedTurn?: number | null;
  foundedTurn?: number | null;
  rivalFactionIds?: readonly string[];
  relationSinceTurns?: Readonly<Record<string, number>> | null;
};

interface CourtEvidenceIndex {
  facts: readonly SimulationFact[];
  factById: ReadonlyMap<string, SimulationFact>;
  history: readonly WorldState['history'][number][];
  eventsBySourceFactId: ReadonlyMap<string, readonly WorldState['history'][number][]>;
}

const CENTRAL_OFFICE_KINDS = new Set<OfficeKind>(['君主', '宰辅', '枢密使', '廷臣']);

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function turnLabel(turn: number | null | undefined): string {
  if (turn === null || turn === undefined || !Number.isFinite(turn) || turn < 0) return '立派年月未详';
  const safeTurn = Math.floor(turn);
  const season = ['春', '夏', '秋', '冬'][safeTurn % 4] as string;
  return `第${Math.floor(safeTurn / 4) + 1}年${season}季立派`;
}

function shortTurnLabel(turn: number | null | undefined): string {
  if (turn === null || turn === undefined || !Number.isFinite(turn) || turn < 0) return '旧卷年月未详';
  const safeTurn = Math.floor(turn);
  const season = ['春', '夏', '秋', '冬'][safeTurn % 4] as string;
  return `第${Math.floor(safeTurn / 4) + 1}年${season}季起`;
}

function accessBand(office: CourtSeatView['office']): CourtAccessBand {
  if (office === '君主') return 0;
  if (office === '宰辅' || office === '枢密使') return 1;
  return 2;
}

function accessLabel(band: CourtAccessBand): CourtSeatView['accessLabel'] {
  if (band === 0) return '君位';
  if (band === 1) return '近班';
  return '朝班';
}

function positionLabel(band: CourtFactionPositionView['nearestBand']): CourtFactionPositionView['positionLabel'] {
  if (band === 0) return '君位';
  if (band === 1) return '近班';
  if (band === 2) return '朝班';
  return '外班';
}

function createCourtEvidenceIndex(world: WorldState, scope: CourtEvidenceScope): CourtEvidenceIndex {
  const facts = scope === 'all' ? readWorldFacts(world) : world.facts;
  const history = (scope === 'all' ? readWorldHistory(world) : world.history)
    .filter(isDefaultVisibleHistoryEvent);
  const eventsBySourceFactId = new Map<string, WorldState['history'][number][]>();
  for (const event of history) {
    for (const sourceFactId of event.sourceFactIds) {
      const linked = eventsBySourceFactId.get(sourceFactId) ?? [];
      linked.push(event);
      eventsBySourceFactId.set(sourceFactId, linked);
    }
  }
  for (const linked of eventsBySourceFactId.values()) {
    linked.sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id));
  }
  return {
    facts,
    factById: new Map(facts.map((fact) => [fact.id, fact])),
    history,
    eventsBySourceFactId,
  };
}

function sourceEventIdForFact(evidence: CourtEvidenceIndex, factId: string): string | null {
  return evidence.eventsBySourceFactId.get(factId)?.[0]?.id ?? null;
}

function sourceEventIdForFactChain(evidence: CourtEvidenceIndex, root: SimulationFact): string | null {
  let frontier = [root.id];
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const events = frontier
      .flatMap((factId) => evidence.eventsBySourceFactId.get(factId) ?? [])
      .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id));
    if (events[0]) return events[0].id;
    const next: string[] = [];
    for (const factId of frontier) {
      if (seen.has(factId)) continue;
      seen.add(factId);
      const fact = evidence.factById.get(factId);
      if (fact) next.push(...fact.sourceFactIds.filter((sourceId) => !seen.has(sourceId)));
    }
    frontier = [...new Set(next)].sort(stableCompare);
  }
  return null;
}

function appointmentEvidence(
  evidence: CourtEvidenceIndex,
  appointmentId: string,
): { sourceEventId: string | null; summary: string | null } {
  const fact = evidence.facts
    .filter((candidate): candidate is Extract<SimulationFact, { kind: 'appointment_started' }> => (
      candidate.kind === 'appointment_started' && candidate.payload.appointmentId === appointmentId
    ))
    .sort((left, right) => right.turn - left.turn || stableCompare(right.id, left.id))[0];
  if (!fact) return { sourceEventId: null, summary: null };
  const reason = fact.causes
    .filter((cause) => cause.role !== '结果')
    .map((cause) => cause.evidence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('；');
  return {
    sourceEventId: sourceEventIdForFactChain(evidence, fact),
    summary: reason || fact.causes.find((cause) => cause.role === '结果')?.evidence || null,
  };
}

function factionForCharacter(
  world: WorldState,
  characterId: string,
  activeFactions: readonly FactionPoliticalMetadata[],
): FactionPoliticalMetadata | null {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  const ownedId = character?.factionId;
  if (!ownedId) return null;
  return activeFactions.find((candidate) => candidate.id === ownedId) ?? null;
}

function relationSinceTurn(
  faction: FactionPoliticalMetadata,
  otherId: string,
  kind: CourtRelationKind,
): number | null {
  const turns = faction.relationSinceTurns;
  if (!turns) return null;
  const direct = turns[otherId];
  if (Number.isFinite(direct)) return Number(direct);
  const namespaced = turns[`${kind}:${otherId}`];
  return Number.isFinite(namespaced) ? Number(namespaced) : null;
}

function relationSourceEventId(
  evidence: CourtEvidenceIndex,
  left: FactionPoliticalMetadata,
  right: FactionPoliticalMetadata,
  kind: CourtRelationKind,
): string | null {
  const fact = [...evidence.facts]
    .reverse()
    .find((candidate) => {
      if ((candidate.kind as string) !== 'faction_relation_changed') return false;
      const payload = candidate.payload as unknown as {
        factionAId?: string;
        factionBId?: string;
        leftFactionId?: string;
        rightFactionId?: string;
        relation?: string;
        kind?: string;
        action?: string;
      };
      const pair = [payload.factionAId ?? payload.leftFactionId, payload.factionBId ?? payload.rightFactionId];
      const relation = payload.relation ?? payload.kind;
      return pair.includes(left.id) && pair.includes(right.id)
        && (payload.action === undefined || payload.action === 'formed')
        && (
          relation === kind
          || (kind === 'allied' && relation === 'alliance')
          || (kind === 'opposed' && (relation === 'rival' || relation === 'rivalry'))
        );
    });
  if (fact) return sourceEventIdForFact(evidence, fact.id);
  const legacyKind = kind === 'allied' ? 'political_alliance' : 'purge';
  return [...evidence.history]
    .filter((event) => (
      event.kind === legacyKind
      && event.polityIds.includes(left.polityId)
      && `${event.title}${event.summary}`.includes(left.name)
      && `${event.title}${event.summary}`.includes(right.name)
    ))
    .sort((a, b) => b.turn - a.turn || stableCompare(b.id, a.id))[0]?.id ?? null;
}

function projectRelations(
  evidence: CourtEvidenceIndex,
  factions: readonly FactionPoliticalMetadata[],
): CourtRelationView[] {
  const byId = new Map(factions.map((faction) => [faction.id, faction]));
  const seen = new Set<string>();
  const result: CourtRelationView[] = [];
  for (const left of factions) {
    const relations: Array<{ kind: CourtRelationKind; ids: readonly string[] }> = [
      { kind: 'allied', ids: left.alliedFactionIds },
      { kind: 'opposed', ids: left.rivalFactionIds ?? [] },
    ];
    for (const relation of relations) {
      for (const otherId of relation.ids) {
        const right = byId.get(otherId);
        if (!right || right.id === left.id) continue;
        const pair = [left.id, right.id].sort(stableCompare);
        const id = `${relation.kind}:${pair[0]}:${pair[1]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const sinceTurn = relationSinceTurn(left, right.id, relation.kind)
          ?? relationSinceTurn(right, left.id, relation.kind);
        result.push({
          id,
          leftFactionId: left.id,
          leftName: left.name,
          rightFactionId: right.id,
          rightName: right.name,
          kind: relation.kind,
          label: relation.kind === 'allied' ? '结盟' : '相争',
          sinceLabel: shortTurnLabel(sinceTurn),
          sourceEventId: relationSourceEventId(evidence, left, right, relation.kind),
        });
      }
    }
  }
  return result.sort((left, right) => (
    (left.kind === 'allied' ? 0 : 1) - (right.kind === 'allied' ? 0 : 1)
    || stableCompare(left.id, right.id)
  ));
}

function centralAppointments(world: WorldState, polityId: string): OfficeAppointment[] {
  return world.offices
    .filter((office) => (
      office.active
      && office.polityId === polityId
      && CENTRAL_OFFICE_KINDS.has(office.kind)
    ))
    .sort((left, right) => (
      accessBand(left.kind as CourtSeatView['office']) - accessBand(right.kind as CourtSeatView['office'])
      || right.rank - left.rank
      || stableCompare(left.kind, right.kind)
      || stableCompare(left.id, right.id)
    ));
}

export function projectCourt(
  world: WorldState,
  polityId: string,
  evidenceScope: CourtEvidenceScope = 'active',
): CourtProjectionView {
  const evidence = createCourtEvidenceIndex(world, evidenceScope);
  const activeFactions = world.factions
    .filter((faction) => faction.active && faction.polityId === polityId)
    .map((faction) => faction as FactionPoliticalMetadata);
  const ledgerByFactionId = new Map(activeFactions.map((faction) => [
    faction.id,
    calculateFactionPowerLedger(world, faction),
  ]));
  const seats: CourtSeatView[] = centralAppointments(world, polityId).map((office) => {
    const holder = world.characters.find((character) => character.id === office.holderId);
    const faction = factionForCharacter(world, office.holderId, activeFactions);
    const ledger = faction ? ledgerByFactionId.get(faction.id) : null;
    const contribution = ledger?.resources.find((resource) => resource.id === `office:${office.id}`)?.value ?? 0;
    const band = accessBand(office.kind as CourtSeatView['office']);
    const appointment = appointmentEvidence(evidence, office.id);
    return {
      id: `court-seat:${office.id}`,
      officeId: office.id,
      office: office.kind as CourtSeatView['office'],
      holderId: office.holderId,
      holder: holder?.name ?? '任官者不详',
      rank: office.rank,
      accessBand: band,
      accessLabel: accessLabel(band),
      factionId: faction?.id ?? null,
      factionName: faction?.name ?? null,
      powerContribution: contribution,
      appointedLabel: shortTurnLabel(office.appointedTurn)?.replace(/起$/, '受任') ?? '受任年月未详',
      appointmentEvidence: appointment.summary,
      sourceEventId: appointment.sourceEventId,
    };
  });
  const seatByFactionId = new Map<string, CourtSeatView[]>();
  for (const seat of seats) {
    if (!seat.factionId) continue;
    const current = seatByFactionId.get(seat.factionId) ?? [];
    current.push(seat);
    seatByFactionId.set(seat.factionId, current);
  }
  const factionPositions = activeFactions
    .map((faction) => {
      const ledger = ledgerByFactionId.get(faction.id);
      const factionSeats = [...(seatByFactionId.get(faction.id) ?? [])].sort((a, b) => (
        a.accessBand - b.accessBand || b.rank - a.rank || stableCompare(a.id, b.id)
      ));
      const nearestBand = factionSeats[0]?.accessBand ?? 3;
      const leader = world.characters.find((character) => character.id === faction.leaderId);
      const movement = recentFactionPowerMovements(world, faction, 1)[0];
      return {
        factionId: faction.id,
        name: faction.name,
        leaderId: faction.leaderId,
        leader: leader?.name ?? '领袖不详',
        agenda: faction.agenda,
        power: ledger?.total ?? 0,
        cohesion: faction.cohesion,
        seatIds: factionSeats.map((seat) => seat.id),
        seatLabels: [...factionSeats.reduce((labels, seat) => {
          labels.set(seat.office, (labels.get(seat.office) ?? 0) + 1);
          return labels;
        }, new Map<string, number>())].map(([label, count]) => count > 1 ? `${label}×${count}` : label),
        nearestBand,
        positionLabel: positionLabel(nearestBand),
        dominant: false,
        foundedLabel: turnLabel(faction.formedTurn ?? faction.foundedTurn),
        topRoots: [...(ledger?.categories ?? [])]
          .filter((category) => category.value > 0)
          .sort((left, right) => right.value - left.value || stableCompare(left.category, right.category))
          .slice(0, 2)
          .map((category) => ({ key: category.category, label: category.label, value: category.value })),
        recentMovement: movement ? {
          turn: movement.turn,
          direction: movement.direction,
          label: movement.label,
          detail: movement.detail,
          sourceEventId: sourceEventIdForFact(evidence, movement.factId),
        } : null,
      } satisfies CourtFactionPositionView;
    })
    .sort((left, right) => (
      right.power - left.power
      || left.nearestBand - right.nearestBand
      || stableCompare(left.factionId, right.factionId)
    ))
    .map((faction, index) => ({ ...faction, dominant: index === 0 }));
  const ruler = seats.find((seat) => seat.office === '君主') ?? null;
  const dominant = factionPositions[0];
  const root = dominant?.seatLabels.length
    ? `据${dominant.seatLabels.join('、')}`
    : dominant?.topRoots.length
      ? `根基主要在${dominant.topRoots.map((item) => item.label).join('、')}，尚未占中枢近班`
      : '尚无可核对的正式根基';
  const rulerSummary = ruler ? `${ruler.holder}居君位` : '君位空悬';
  const summary = dominant
    ? `${rulerSummary}；${dominant.name}${root}，权势${Math.round(dominant.power)}，居朝中首位。`
    : `${rulerSummary}；朝中尚无明确军政集团。`;
  return {
    polityId,
    summary,
    ruler,
    seats,
    factionPositions,
    graphFactionIds: factionPositions.slice(0, 4).map((faction) => faction.factionId),
    relations: projectRelations(evidence, activeFactions),
  };
}
