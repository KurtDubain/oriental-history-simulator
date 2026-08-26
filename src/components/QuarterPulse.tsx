import { useId } from 'react';
import type { TurnReport } from '../sim/types';
import type { QuarterPulseSituationChange } from '../view/quarter-pulse-situations';
import '../styles/quarter-pulse.css';

export type QuarterPulseLedger = 'population' | 'food' | 'wealth';

export interface QuarterPulseEvent {
  id: string;
  title: string;
  category: string;
  importance: number;
  location?: string;
}

export interface QuarterPulseProps {
  report: TurnReport | null;
  events: QuarterPulseEvent[];
  situationChanges: QuarterPulseSituationChange[];
  onSelectEvent: (id: string) => void;
  onSelectSituation: (id: string) => void;
  onSelectLedger: (ledger: QuarterPulseLedger) => void;
  compact?: boolean;
}

const exactNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

function formatNumber(value: number): string {
  return exactNumber.format(Math.round(value));
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${formatNumber(rounded)}`;
  if (rounded < 0) return `−${formatNumber(Math.abs(rounded))}`;
  return '±0';
}

function netTone(value: number): 'gain' | 'loss' | 'even' {
  if (value > 0) return 'gain';
  if (value < 0) return 'loss';
  return 'even';
}

export function QuarterPulse({
  report,
  events,
  situationChanges,
  onSelectEvent,
  onSelectSituation,
  onSelectLedger,
  compact = false,
}: QuarterPulseProps) {
  const tooltipId = useId();

  if (!report) {
    return (
      <section
        className="quarter-pulse quarter-pulse--empty"
        data-compact={compact || undefined}
        data-testid="quarter-pulse"
        aria-label="季报尚未生成"
      >
        <div className="quarter-pulse__date">
          <span className="quarter-pulse__kicker">本季变化</span>
          <strong>史页未启</strong>
        </div>
        <p className="quarter-pulse__waiting" data-testid="quarter-pulse-waiting">
          推进一季后，此处将留下人口、粮食、财富与史事的确切变化。
        </p>
      </section>
    );
  }

  const ledgers = [
    {
      key: 'population' as const,
      label: '人口',
      delta: report.population.end - report.population.start,
      breakdown: `期初 ${formatNumber(report.population.start)}；出生 +${formatNumber(report.population.births)}；平民死亡 −${formatNumber(report.population.civilianDeaths)}；军人死亡 −${formatNumber(report.population.militaryDeaths)}；征募 ${formatNumber(report.population.recruited)}；复员 ${formatNumber(report.population.demobilized)}；期末 ${formatNumber(report.population.end)}`,
    },
    {
      key: 'food' as const,
      label: '粮食',
      delta: report.food.end - report.food.start,
      breakdown: `期初 ${formatNumber(report.food.start)}；生产 +${formatNumber(report.food.produced)}；民食 −${formatNumber(report.food.civilianConsumed)}；军粮 −${formatNumber(report.food.armyConsumed)}；腐坏 −${formatNumber(report.food.spoiled)}；战毁 −${formatNumber(report.food.warDestroyed)}；调运 ${formatSigned(report.food.transferred)}；期末 ${formatNumber(report.food.end)}`,
    },
    {
      key: 'wealth' as const,
      label: '财富',
      delta: report.wealth.end - report.wealth.start,
      breakdown: `期初 ${formatNumber(report.wealth.start)}；产出 +${formatNumber(report.wealth.produced)}；民用 −${formatNumber(report.wealth.householdConsumed)}；战毁 −${formatNumber(report.wealth.warDestroyed)}；征税流转 ${formatNumber(report.wealth.taxed)}；军饷流转 ${formatNumber(report.wealth.militaryPayments)}；期末 ${formatNumber(report.wealth.end)}`,
    },
  ];
  const visibleEvents = [...events]
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 3);
  const visibleSituations = situationChanges.slice(0, 4);

  return (
    <section
      className="quarter-pulse"
      data-compact={compact || undefined}
      data-testid="quarter-pulse"
      data-turn={report.turn}
      aria-labelledby={`${tooltipId}-heading`}
    >
      <header className="quarter-pulse__date" data-testid="quarter-pulse-date">
        <span className="quarter-pulse__kicker">本季变化</span>
        <strong id={`${tooltipId}-heading`}>第 {report.year} 年 · {report.season}季</strong>
        <small>第 {report.turn + 1} 季记</small>
      </header>

      <div className="quarter-pulse__ledgers" aria-label="本季总账净变化">
        {ledgers.map((ledger) => {
          const breakdownId = `${tooltipId}-${ledger.key}`;
          return (
            <button
              key={ledger.key}
              type="button"
              className="quarter-pulse__ledger"
              data-testid={`quarter-pulse-ledger-${ledger.key}`}
              data-tone={netTone(ledger.delta)}
              aria-describedby={breakdownId}
              aria-label={`${ledger.label}净变化 ${formatSigned(ledger.delta)}。${ledger.breakdown}。打开${ledger.label}账本`}
              onClick={() => onSelectLedger(ledger.key)}
            >
              <span>{ledger.label}</span>
              <strong>{formatSigned(ledger.delta)}</strong>
              <span id={breakdownId} role="tooltip" className="quarter-pulse__tooltip">
                {ledger.breakdown}
              </span>
            </button>
          );
        })}
      </div>

      <div className="quarter-pulse__events" aria-label="本季局势与重要史事">
        {visibleSituations.length || visibleEvents.length ? (
          <ol className="quarter-pulse__event-list">
            {visibleSituations.map((situation) => (
              <li key={`situation:${situation.id}`} data-story-kind="situation">
                <button
                  type="button"
                  className="quarter-pulse__event quarter-pulse__situation"
                  data-testid="quarter-pulse-situation"
                  data-situation-id={situation.id}
                  data-kind={situation.kind}
                  data-basis={situation.basis}
                  aria-label={`${situation.kindLabel}：${situation.title}。${situation.detail}。打开局势全卷`}
                  onClick={() => onSelectSituation(situation.id)}
                >
                  <span className="quarter-pulse__event-meta">
                    <span className="quarter-pulse__situation-kind">{situation.kindLabel}</span>
                    <span>{situation.detail}</span>
                  </span>
                  <strong>{situation.title}</strong>
                  <span className="quarter-pulse__event-cause" aria-hidden="true">看卷 ›</span>
                </button>
              </li>
            ))}
            {visibleEvents.map((event) => (
              <li key={event.id} data-story-kind="event">
                <button
                  type="button"
                  className="quarter-pulse__event"
                  data-testid="quarter-pulse-event"
                  data-event-id={event.id}
                  data-importance={event.importance}
                  aria-label={`${event.category}：${event.title}${event.location ? `，发生于${event.location}` : ''}。查看因果`}
                  onClick={() => onSelectEvent(event.id)}
                >
                  <span className="quarter-pulse__event-meta">
                    <span>{event.category}</span>
                    {event.location ? <span>{event.location}</span> : null}
                  </span>
                  <strong>{event.title}</strong>
                  <span className="quarter-pulse__event-cause" aria-hidden="true">何故 ›</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="quarter-pulse__quiet" data-testid="quarter-pulse-quiet">
            <strong>平静之季</strong>
            <span>此季没有足以改变天下走向的大事。</span>
          </p>
        )}
      </div>
    </section>
  );
}
