import {
  BellRing,
  BookOpenCheck,
  Check,
  ChevronRight,
  Eye,
  ListChecks,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef } from 'react';
import {
  OBSERVER_GUIDE_STEPS,
  normalizeObserverDeskSettings,
  observerGuideProgress,
  removeObserverWatch,
  setObserverWatchAlert,
  type ObserverDeskSettings,
  type ObserverGuideStepId,
  type ObserverPauseMatch,
  type ObserverPauseRules,
  type ObserverWatchItem,
  type ObserverWatchKind,
} from '../view/v1-observer';
import '../styles/observer-ui.css';
import '../styles/observer-desk.css';

const WATCH_KIND_LABELS: Record<ObserverWatchKind, string> = {
  country: '政权',
  family: '家族',
  person: '人物',
  region: '地区',
  seaZone: '海域',
  fleet: '舰队',
  tradeCorridor: '商路',
  practice: '实践',
  outbreak: '疫情',
  migration: '迁徙',
};

export interface ObserverDeskProps {
  open: boolean;
  settings: ObserverDeskSettings;
  onSettingsChange: (settings: ObserverDeskSettings) => void;
  onClose: () => void;
  onSelectWatchItem: (item: ObserverWatchItem) => void;
  onGuideAction?: (step: ObserverGuideStepId) => void;
  pauseMatch?: ObserverPauseMatch | null;
  returnFocusTo?: HTMLElement | null;
}

interface PauseRuleDefinition {
  key: 'wars' | 'powerTransfers' | 'outbreaks' | 'watchlistHits';
  label: string;
  detail: string;
}

const PAUSE_RULES: PauseRuleDefinition[] = [
  { key: 'wars', label: '战争', detail: '宣战、关键战役、都城陷落与媾和' },
  { key: 'powerTransfers', label: '政变与继承', detail: '宫变、篡立、摄政、继承与政权解体' },
  { key: 'outbreaks', label: '疾疫', detail: '疫病输入、暴发与重要人物染病' },
  { key: 'watchlistHits', label: '关注对象命中', detail: '关注的人、地与势力卷入新史事' },
];

export function ObserverDesk({
  open,
  settings,
  onSettingsChange,
  onClose,
  onSelectWatchItem,
  onGuideAction,
  pauseMatch,
  returnFocusTo,
}: ObserverDeskProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const safeSettings = useMemo(() => normalizeObserverDeskSettings(settings), [settings]);
  const progress = observerGuideProgress(safeSettings);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = returnFocusTo ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, returnFocusTo]);

  if (!open) return null;

  const changeRules = (patch: Partial<ObserverPauseRules>) => {
    onSettingsChange(normalizeObserverDeskSettings({
      ...safeSettings,
      pauseRules: { ...safeSettings.pauseRules, ...patch },
    }));
  };

  const selectWatchItem = (item: ObserverWatchItem) => {
    if (item.alert) onSettingsChange(setObserverWatchAlert(safeSettings, item.kind, item.id, false));
    onSelectWatchItem(item);
  };

  const resetGuide = () => {
    onSettingsChange(normalizeObserverDeskSettings({
      ...safeSettings,
      guide: { completedSteps: [], dismissed: false },
    }));
  };

  return (
    <div className="observer-desk-layer">
      <button
        type="button"
        className="observer-desk-layer__backdrop"
        tabIndex={-1}
        aria-label="关闭观察台"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className="observer-desk"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="observer-desk__header">
          <div className="observer-desk__seal" aria-hidden="true"><Eye size={20} strokeWidth={1.5} /></div>
          <div>
            <span>OBSERVER · V1</span>
            <h2 id={titleId}>观察台</h2>
            <p id={descriptionId}>只记录你想留意的历史，不改变世界。</p>
          </div>
          <button ref={closeRef} type="button" aria-label="关闭观察台" onClick={onClose}>
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        {pauseMatch ? (
          <div className="observer-desk__pause-note" role="status">
            <BellRing size={16} aria-hidden="true" />
            <span><strong>时间已停</strong><small>{pauseMatch.reason} · {pauseMatch.eventTitle}</small></span>
          </div>
        ) : null}

        <div className="observer-desk__scroll">
          <section className="observer-desk__section" aria-labelledby="observer-watch-heading">
            <div className="observer-desk__section-heading">
              <div>
                <span>01</span>
                <h3 id="observer-watch-heading">关注对象</h3>
              </div>
              <strong aria-label={`${safeSettings.watchlist.length}个关注对象`}>{safeSettings.watchlist.length}</strong>
            </div>

            {safeSettings.watchlist.length ? (
              <ul className="observer-desk__watchlist">
                {safeSettings.watchlist.map((item) => (
                  <li key={`${item.kind}-${item.id}`} data-alert={item.alert || undefined}>
                    <button
                      type="button"
                      className="observer-desk__watch-main"
                      onClick={() => selectWatchItem(item)}
                      aria-label={`前往${WATCH_KIND_LABELS[item.kind]}${item.label}${item.alert ? '，有新动向' : ''}`}
                    >
                      <span>{WATCH_KIND_LABELS[item.kind]}</span>
                      <span><strong>{item.label}</strong><small>{item.detail || '暂无补充记载'}</small></span>
                      {item.alert ? <i aria-label="有新动向"><BellRing size={13} aria-hidden="true" /></i> : <ChevronRight size={14} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      className="observer-desk__watch-remove"
                      aria-label={`取消关注${item.label}`}
                      onClick={() => onSettingsChange(removeObserverWatch(safeSettings, item.kind, item.id))}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="observer-desk__empty">
                <Eye size={21} strokeWidth={1.3} aria-hidden="true" />
                <p><strong>尚未留下目光</strong><span>在人物、家族、政权或地区档案中选择“关注”，其后续动向会汇集于此。</span></p>
              </div>
            )}
          </section>

          <section className="observer-desk__section" aria-labelledby="observer-pause-heading">
            <div className="observer-desk__section-heading">
              <div>
                <span>02</span>
                <h3 id="observer-pause-heading">自动暂停</h3>
              </div>
              <label className="observer-desk__master-switch">
                <span>{safeSettings.pauseRules.enabled ? '已启用' : '已关闭'}</span>
                <input
                  type="checkbox"
                  checked={safeSettings.pauseRules.enabled}
                  onChange={(event) => changeRules({ enabled: event.target.checked })}
                />
                <i aria-hidden="true" />
              </label>
            </div>

            <div className="observer-desk__rules" aria-disabled={!safeSettings.pauseRules.enabled}>
              <label>
                <input
                  type="checkbox"
                  checked={safeSettings.pauseRules.majorHistory}
                  disabled={!safeSettings.pauseRules.enabled}
                  onChange={(event) => changeRules({ majorHistory: event.target.checked })}
                />
                <span className="observer-desk__check" aria-hidden="true"><Check size={11} /></span>
                <span><strong>重大史事</strong><small>重要度达到阈值即停下</small></span>
                <select
                  value={safeSettings.pauseRules.importanceThreshold}
                  disabled={!safeSettings.pauseRules.enabled || !safeSettings.pauseRules.majorHistory}
                  aria-label="重大史事暂停阈值"
                  onChange={(event) => changeRules({
                    importanceThreshold: Number(event.target.value) as ObserverPauseRules['importanceThreshold'],
                  })}
                >
                  <option value={2}>≥ 2</option>
                  <option value={3}>≥ 3</option>
                  <option value={4}>≥ 4</option>
                  <option value={5}>= 5</option>
                </select>
              </label>
              {PAUSE_RULES.map((rule) => (
                <label key={rule.key}>
                  <input
                    type="checkbox"
                    checked={safeSettings.pauseRules[rule.key]}
                    disabled={!safeSettings.pauseRules.enabled}
                    onChange={(event) => changeRules({ [rule.key]: event.target.checked })}
                  />
                  <span className="observer-desk__check" aria-hidden="true"><Check size={11} /></span>
                  <span><strong>{rule.label}</strong><small>{rule.detail}</small></span>
                </label>
              ))}
            </div>
          </section>

          <section className="observer-desk__section observer-desk__guide" aria-labelledby="observer-guide-heading">
            <div className="observer-desk__section-heading">
              <div>
                <span>03</span>
                <h3 id="observer-guide-heading">首次试玩</h3>
              </div>
              <strong>{progress.completed}/{progress.total}</strong>
            </div>
            <div
              className="observer-desk__progress"
              role="progressbar"
              aria-label="首次试玩完成度"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.completed}
            >
              <i style={{ width: `${progress.percent}%` }} />
            </div>
            <ol>
              {OBSERVER_GUIDE_STEPS.map((step, index) => {
                const complete = safeSettings.guide.completedSteps.includes(step.id);
                const content = (
                  <>
                    <span className="observer-desk__guide-mark">{complete ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
                    <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                    {!complete && onGuideAction ? <ChevronRight size={14} aria-hidden="true" /> : null}
                  </>
                );
                return (
                  <li key={step.id} data-complete={complete || undefined}>
                    {!complete && onGuideAction ? (
                      <button type="button" onClick={() => onGuideAction(step.id)}>{content}</button>
                    ) : (
                      <div>{content}</div>
                    )}
                  </li>
                );
              })}
            </ol>
            <footer>
              <span>{progress.completed === progress.total ? <BookOpenCheck size={14} aria-hidden="true" /> : <ListChecks size={14} aria-hidden="true" />}{progress.completed === progress.total ? '你已掌握观察世界的基本方法。' : '完成状态由真实操作自动记录。'}</span>
              {progress.completed > 0 ? (
                <button type="button" onClick={resetGuide}><RotateCcw size={12} aria-hidden="true" />重置</button>
              ) : null}
            </footer>
          </section>
        </div>

        <p className="observer-desk__footnote">关注与暂停仅属于观察者设置；读取、跳转或取消关注均不写入世界哈希。</p>
      </aside>
    </div>
  );
}
