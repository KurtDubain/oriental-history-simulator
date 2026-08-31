import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { CourtProjectionView, CourtSeatView } from '../view/court-projection';
import '../styles/court-projection.css';

interface CourtFactionDetail {
  id: string;
  name: string;
  kind: string;
  leaderId: string;
  leader: string;
  power: number;
  cohesion: number;
  agenda: string;
  resources?: readonly {
    id: string;
    label: string;
    detail: string;
    value: number;
    sourceEventId?: string | null;
  }[];
  recentMovement?: {
    periodLabel: string;
    direction: 'gained' | 'held' | 'lost';
    label: string;
    detail: string;
    sourceEventId?: string | null;
  } | null;
}

type CourtFocus = { kind: 'seat' | 'faction'; id: string };

export interface CourtProjectionProps {
  court: CourtProjectionView;
  factions: readonly CourtFactionDetail[];
  onSelectPerson?: (personId: string) => void;
  onSelectEvent?: (eventId: string) => void;
}

function defaultFocus(court: CourtProjectionView): CourtFocus | null {
  const dominant = court.factionPositions.find((faction) => faction.dominant)
    ?? court.factionPositions[0];
  if (dominant) return { kind: 'faction', id: dominant.factionId };
  if (court.ruler) return { kind: 'seat', id: court.ruler.id };
  const seat = court.seats[0];
  return seat ? { kind: 'seat', id: seat.id } : null;
}

function seatSummary(seat: CourtSeatView): string {
  const faction = seat.factionName ? `，属${seat.factionName}` : '，暂无明确派属';
  const contribution = seat.powerContribution > 0
    ? `；此席为所属集团提供${Math.round(seat.powerContribution)}点权势根基`
    : '';
  return `${seat.holder}现任${seat.office}${faction}${contribution}。`;
}

function CourtSeatButton({
  seat,
  active,
  className,
  detailId,
  onSelect,
}: {
  seat: CourtSeatView;
  active: boolean;
  className: string;
  detailId: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      data-court-seat={seat.officeId}
      data-access-band={seat.accessBand}
      aria-pressed={active}
      aria-controls={detailId}
      aria-label={`${seat.accessLabel}${seat.office}，${seat.holder}${seat.factionName ? `，${seat.factionName}` : ''}`}
      onClick={onSelect}
    >
      <span>{seat.accessLabel} · {seat.office}</span>
      <strong>{seat.holder}</strong>
      <small>{seat.factionName ?? '暂无派属'}</small>
    </button>
  );
}

export function CourtProjection({ court, factions, onSelectPerson, onSelectEvent }: CourtProjectionProps) {
  const detailId = useId();
  const [focus, setFocus] = useState<CourtFocus | null>(() => defaultFocus(court));
  useEffect(() => {
    setFocus((current) => {
      const stillExists = current?.kind === 'seat'
        ? court.seats.some((seat) => seat.id === current.id)
        : current?.kind === 'faction'
          ? court.factionPositions.some((position) => position.factionId === current.id)
          : false;
      return stillExists ? current : defaultFocus(court);
    });
  }, [court.polityId, court.seats, court.factionPositions]);
  const factionById = useMemo(() => new Map(factions.map((faction) => [faction.id, faction])), [factions]);
  const positionById = useMemo(() => new Map(court.factionPositions.map((position) => [position.factionId, position])), [court.factionPositions]);
  const graphFactions = court.graphFactionIds
    .map((id) => positionById.get(id))
    .filter((position): position is NonNullable<typeof position> => Boolean(position));
  const focusedSeat = focus?.kind === 'seat' ? court.seats.find((seat) => seat.id === focus.id) ?? null : null;
  const focusedPosition = focus?.kind === 'faction' ? positionById.get(focus.id) ?? null : null;
  const focusedFaction = focusedPosition ? factionById.get(focusedPosition.factionId) ?? null : null;
  const benchSeats = court.seats.filter((seat) => seat.office !== '君主');

  const moveRankFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = event.currentTarget.closest('ol')?.querySelectorAll<HTMLButtonElement>('[data-court-rank]');
    if (!rows?.length) return;
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    rows[(index + offset + rows.length) % rows.length]?.focus();
  };

  return (
    <section className="court-projection" aria-labelledby={`${detailId}-heading`} data-testid="court-projection">
      <header className="court-projection__heading">
        <div>
          <span>朝仪 · 当季座次</span>
          <h3 id={`${detailId}-heading`}>朝中谁能影响决策</h3>
        </div>
        <small>座次是官位，不是地盘</small>
      </header>
      <p className="court-projection__summary">{court.summary}</p>

      <div className="court-projection__map" data-court-layout="desktop" role="group" aria-label="朝堂座次图">
        {court.ruler ? (
          <div className="court-projection__throne">
            <CourtSeatButton
              seat={court.ruler}
              active={focus?.kind === 'seat' && focus.id === court.ruler.id}
              className="court-projection__seat court-projection__seat--ruler"
              detailId={detailId}
              onSelect={() => setFocus({ kind: 'seat', id: court.ruler!.id })}
            />
          </div>
        ) : <p className="court-projection__vacancy">君位任官记录暂缺</p>}
        {benchSeats.length ? (
          <div className="court-projection__bench" role="group" aria-label="中枢近班与朝班官席">
            {benchSeats.map((seat) => (
              <CourtSeatButton
                key={seat.id}
                seat={seat}
                active={focus?.kind === 'seat' && focus.id === seat.id}
                className="court-projection__seat"
                detailId={detailId}
                onSelect={() => setFocus({ kind: 'seat', id: seat.id })}
              />
            ))}
          </div>
        ) : null}
        {graphFactions.length ? (
          <div className="court-projection__faction-rail" role="group" aria-label="朝中主要派系印记，非官位座次">
            <span className="court-projection__faction-rail-label" aria-hidden="true">派系印记 · 非座次</span>
            {graphFactions.map((position) => (
              <button
                type="button"
                key={position.factionId}
                data-court-faction={position.factionId}
                data-dominant={position.dominant || undefined}
                aria-pressed={focus?.kind === 'faction' && focus.id === position.factionId}
                aria-controls={detailId}
                onClick={() => setFocus({ kind: 'faction', id: position.factionId })}
              >
                <span>{position.positionLabel}</span>
                <strong>{position.name}</strong>
                <small>权势 {Math.round(position.power)}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ol className="court-projection__mobile-seats" aria-label="按距君主远近排列的中枢席位">
        {court.seats.length ? court.seats.map((seat) => (
          <li key={seat.id}>
            <CourtSeatButton
              seat={seat}
              active={focus?.kind === 'seat' && focus.id === seat.id}
              className="court-projection__mobile-seat"
              detailId={detailId}
              onSelect={() => setFocus({ kind: 'seat', id: seat.id })}
            />
          </li>
        )) : <li className="court-projection__mobile-empty">目前没有中枢席位可列。</li>}
      </ol>

      {court.relations.length ? (
        <ul className="court-projection__relations" aria-label="派系联盟与对立">
          {court.relations.map((relation) => (
            <li key={relation.id} data-relation={relation.kind}>
              <span>{relation.leftName}</span>
              <b>{relation.label}</b>
              <span>{relation.rightName}</span>
              {relation.sinceLabel ? <small>{relation.sinceLabel}</small> : null}
              {relation.sourceEventId && onSelectEvent ? (
                <button
                  type="button"
                  title="查看这段关系的缘由"
                  aria-label={`查看${relation.leftName}与${relation.rightName}${relation.label}的缘由`}
                  onClick={() => onSelectEvent(relation.sourceEventId!)}
                >
                  看缘由
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="court-projection__no-relations">朝中暂未见公开结盟或相争。</p>}

      {court.factionPositions.length ? (
        <div className="court-projection__ranking">
          <h4>派系次序</h4>
          <ol>
            {court.factionPositions.map((position, index) => (
              <li key={position.factionId}>
                <button
                  type="button"
                  data-court-rank={position.factionId}
                  aria-pressed={focus?.kind === 'faction' && focus.id === position.factionId}
                  aria-controls={detailId}
                  onClick={() => setFocus({ kind: 'faction', id: position.factionId })}
                  onKeyDown={(event) => moveRankFocus(event, index)}
                >
                  <i>{String(index + 1).padStart(2, '0')}</i>
                  <span><strong>{position.name}</strong><small>{position.positionLabel} · {position.seatLabels.length ? position.seatLabels.join('、') : '无中枢席位'}</small></span>
                  <b>{Math.round(position.power)}</b>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div id={detailId} className="court-projection__focus" data-court-focus-detail aria-live="polite">
        {focusedSeat ? (
          <>
            <header><span>{focusedSeat.accessLabel}</span><h4>{focusedSeat.office} · {focusedSeat.holder}</h4></header>
            <p>{seatSummary(focusedSeat)}</p>
            <dl>
              <div><dt>任职</dt><dd>{focusedSeat.appointedLabel}</dd></div>
              <div><dt>所属</dt><dd>{focusedSeat.factionName ?? '暂无明确派属'}</dd></div>
            </dl>
            {focusedSeat.appointmentEvidence ? (
              <details className="court-projection__appointment">
                <summary>为何任此职</summary>
                <p>{focusedSeat.appointmentEvidence}</p>
              </details>
            ) : null}
            <footer>
              {onSelectPerson ? <button type="button" onClick={() => onSelectPerson(focusedSeat.holderId)}>看人物 · {focusedSeat.holder}</button> : null}
              {focusedSeat.sourceEventId && onSelectEvent ? <button type="button" onClick={() => onSelectEvent(focusedSeat.sourceEventId!)}>查看任命史事</button> : null}
            </footer>
          </>
        ) : focusedPosition && focusedFaction ? (
          <>
            <header><span>{focusedPosition.positionLabel}</span><h4>{focusedFaction.name}</h4></header>
            <p>{focusedPosition.foundedLabel}，以{focusedFaction.leader}为首；所图“{focusedFaction.agenda}”。</p>
            <dl>
              <div><dt>权势</dt><dd>{Math.round(focusedFaction.power)}</dd></div>
              <div><dt>凝聚</dt><dd>{Math.round(focusedFaction.cohesion)}</dd></div>
            </dl>
            {focusedPosition.topRoots.length ? (
              <ul className="court-projection__roots" aria-label="最强权势根基">
                {focusedPosition.topRoots.map((root) => <li key={root.key}><span>{root.label}</span><b>{Math.round(root.value)}</b></li>)}
              </ul>
            ) : null}
            {focusedFaction.recentMovement ? (
              <div className="court-projection__movement" data-direction={focusedFaction.recentMovement.direction}>
                <span>{focusedFaction.recentMovement.periodLabel} · {focusedFaction.recentMovement.label}</span>
                <p>{focusedFaction.recentMovement.detail}</p>
                {focusedFaction.recentMovement.sourceEventId && onSelectEvent ? <button type="button" onClick={() => onSelectEvent(focusedFaction.recentMovement!.sourceEventId!)}>为何如此</button> : null}
              </div>
            ) : null}
            {focusedFaction.resources?.length ? (
              <details className="court-projection__assets">
                <summary>查看权势根由 <span>{focusedFaction.resources.length} 项</span></summary>
                <ol>
                  {focusedFaction.resources.map((resource) => (
                    <li key={resource.id}>
                      <span><strong>{resource.label}</strong><small>{resource.detail}</small></span>
                      <b>+{Math.round(resource.value)}</b>
                      {resource.sourceEventId && onSelectEvent ? <button type="button" onClick={() => onSelectEvent(resource.sourceEventId!)} aria-label={`查看${resource.label}的由来`}>何故</button> : null}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            <footer>
              {onSelectPerson ? <button type="button" onClick={() => onSelectPerson(focusedFaction.leaderId)}>看领袖 · {focusedFaction.leader}</button> : null}
            </footer>
          </>
        ) : <p className="court-projection__empty">目前没有中枢任官记录，派系格局也未成形。</p>}
      </div>
    </section>
  );
}
