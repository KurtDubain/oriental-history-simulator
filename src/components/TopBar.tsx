import {
  CalendarDays,
  Gauge,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react';
import '../styles/observer-ui.css';

export type Season = '春' | '夏' | '秋' | '冬';
export type PlaybackSpeed = 1 | 2 | 4 | 8;

export interface TopBarProps {
  title?: string;
  eraName?: string;
  year: number;
  season: Season;
  turn: number;
  isRunning: boolean;
  speed?: PlaybackSpeed;
  canAdvance?: boolean;
  onToggleRunning: () => void;
  onAdvance: () => void;
  onSpeedChange?: (speed: PlaybackSpeed) => void;
}

const SEASONS: Record<Season, { months: string; key: string }> = {
  春: { months: '正月—三月', key: 'spring' },
  夏: { months: '四月—六月', key: 'summer' },
  秋: { months: '七月—九月', key: 'autumn' },
  冬: { months: '十月—腊月', key: 'winter' },
};

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8];

function formatYear(year: number) {
  return year > 0 ? `第 ${year} 年` : `纪元前 ${Math.abs(year) + 1} 年`;
}

export function TopBar({
  title = '沧衡纪',
  eraName = '新元',
  year,
  season,
  turn,
  isRunning,
  speed = 1,
  canAdvance = true,
  onToggleRunning,
  onAdvance,
  onSpeedChange,
}: TopBarProps) {
  const currentSeason = SEASONS[season];
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];

  return (
    <header className="observer-topbar">
      <div className="observer-brand" aria-label={`${title}历史演化观察台`}>
        <span className="observer-brand__seal" aria-hidden="true">
          衡
        </span>
        <span className="observer-brand__copy">
          <strong>{title}</strong>
          <small>历史演化观察台</small>
        </span>
      </div>

      <div className="observer-date" aria-label={`当前纪年：${eraName}${formatYear(year)}${season}季`}>
        <CalendarDays size={17} strokeWidth={1.6} aria-hidden="true" />
        <span className="observer-date__era">{eraName}</span>
        <strong>{formatYear(year)}</strong>
        <span className="observer-date__season" data-season={currentSeason.key} key={`${year}-${season}`}>
          {season}
        </span>
        <span className="observer-date__detail">
          {currentSeason.months} · 第 {turn} 回合
        </span>
      </div>

      <div className="observer-time-controls" aria-label="时间控制">
        {onSpeedChange ? (
          <div className="observer-speed" role="group" aria-label="自动推演速度">
            <Gauge size={15} strokeWidth={1.7} aria-hidden="true" />
            {SPEEDS.map((option) => (
              <button
                type="button"
                key={option}
                className="observer-speed__button"
                aria-label={`${option} 倍速推演`}
                aria-pressed={speed === option}
                onClick={() => onSpeedChange(option)}
              >
                {option}×
              </button>
            ))}
          </div>
        ) : null}

        {onSpeedChange ? (
          <button
            type="button"
            className="observer-speed-cycle"
            aria-label={`当前${speed}倍速，点按切换至${nextSpeed}倍速`}
            onClick={() => onSpeedChange(nextSpeed)}
          >
            <Gauge size={15} strokeWidth={1.7} aria-hidden="true" />
            <span>{speed}×</span>
          </button>
        ) : null}

        <button
          type="button"
          className="observer-icon-button observer-time-controls__toggle"
          aria-label={isRunning ? '暂停自动推演' : '开始自动推演'}
          aria-pressed={isRunning}
          onClick={onToggleRunning}
        >
          {isRunning ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="observer-advance-button"
          disabled={!canAdvance}
          aria-label="推进至下一季"
          onClick={onAdvance}
        >
          <span>下一季</span>
          <SkipForward size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
