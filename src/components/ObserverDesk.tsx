import {
  BellRing,
  BookOpenCheck,
  Check,
  ChevronRight,
  Eye,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { LATEST_APP_RELEASE } from '@app-changelog';
import { appUpdateStatusText, type AppUpdateState } from '../infra/app-update';
import { APP_VERSION } from '../version';
import { useDialogLayer } from './useDialogLayer';
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
  situation: '局势',
  country: '政权',
  family: '家族',
  person: '人物',
  region: '地区',
  seaZone: '海域',
  army: '军团',
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
  onSelectPauseMatch?: (match: ObserverPauseMatch) => void;
  returnFocusTo?: HTMLElement | null;
  appUpdate?: AppUpdateState;
  onCheckUpdate?: () => Promise<unknown>;
  onApplyUpdate?: () => Promise<boolean>;
}

const DEFAULT_APP_UPDATE: AppUpdateState = {
  phase: 'idle',
  localVersion: APP_VERSION,
  localBuildId: 'unknown',
  remoteVersion: null,
  remoteBuildId: null,
  checkedAt: null,
};

function checkedAtLabel(checkedAt: number | null): string | null {
  if (!checkedAt) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(checkedAt));
}

interface PauseRuleDefinition {
  key: 'wars' | 'powerTransfers' | 'outbreaks' | 'watchlistHits' | 'situationChanges';
  label: string;
  detail: string;
}

const PAUSE_RULES: PauseRuleDefinition[] = [
  { key: 'situationChanges', label: '关注局势关键变化', detail: '成形、新动向、核心人物死亡与结案' },
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
  onSelectPauseMatch,
  returnFocusTo,
  appUpdate = DEFAULT_APP_UPDATE,
  onCheckUpdate,
  onApplyUpdate,
}: ObserverDeskProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const safeSettings = useMemo(() => normalizeObserverDeskSettings(settings), [settings]);
  const progress = observerGuideProgress(safeSettings);
  const [updateBusy, setUpdateBusy] = useState(false);
  const updateAvailable = appUpdate.phase === 'available';
  const lastChecked = checkedAtLabel(appUpdate.checkedAt);

  useDialogLayer({
    open,
    containerRef: dialogRef,
    initialFocusRef: closeRef,
    onClose,
    returnFocusTo,
  });

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
        className="observer-desk-layer__backdrop observer-dialog-backdrop"
        tabIndex={-1}
        aria-label="关闭观察台"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className="observer-desk observer-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="observer-desk__header">
          <div className="observer-desk__seal" aria-hidden="true"><Eye size={20} strokeWidth={1.5} /></div>
          <div>
            <span>OBSERVER · v{APP_VERSION}</span>
            <h2 id={titleId}>观察台</h2>
            <p id={descriptionId}>只记录你想留意的历史，不改变世界。</p>
          </div>
          <button ref={closeRef} type="button" aria-label="关闭观察台" onClick={onClose}>
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        {pauseMatch ? (
          <div
            className="observer-desk__pause-note"
            role="status"
            data-pause-rule={pauseMatch.rule}
            data-situation-id={pauseMatch.situationId ?? undefined}
            data-situation-trigger={pauseMatch.situationTrigger ?? undefined}
          >
            <BellRing size={16} aria-hidden="true" />
            {pauseMatch.situationId && onSelectPauseMatch ? (
              <button
                type="button"
                className="observer-desk__pause-open"
                data-testid="observer-pause-open"
                data-situation-id={pauseMatch.situationId}
                data-situation-trigger={pauseMatch.situationTrigger}
                aria-label={`${pauseMatch.reason}：${pauseMatch.eventTitle}，打开对应局势卷宗`}
                onClick={() => onSelectPauseMatch(pauseMatch)}
              >
                <span><strong>局势有新进展，时间已停</strong><small>{pauseMatch.reason} · {pauseMatch.eventTitle}</small></span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <span><strong>时间已停</strong><small>{pauseMatch.reason} · {pauseMatch.eventTitle}</small></span>
            )}
          </div>
        ) : null}

        <div className="observer-desk__scroll">
          <section className="observer-desk__section" aria-labelledby="observer-watch-heading">
            <div className="observer-desk__section-heading">
              <div>
                <span>01</span>
                <h3 id="observer-watch-heading">关注簿</h3>
              </div>
              <strong aria-label={`${safeSettings.watchlist.length}条关注记录`}>{safeSettings.watchlist.length}</strong>
            </div>

            {safeSettings.watchlist.length ? (
              <ul className="observer-desk__watchlist">
                {safeSettings.watchlist.map((item) => (
                  <li
                    key={`${item.kind}-${item.id}`}
                    data-testid="observer-watch-item"
                    data-watch-kind={item.kind}
                    data-watch-id={item.id}
                    data-alert={item.alert || undefined}
                  >
                    <button
                      type="button"
                      className="observer-desk__watch-main"
                      data-testid="observer-watch-open"
                      onClick={() => selectWatchItem(item)}
                      aria-label={`前往${WATCH_KIND_LABELS[item.kind]}${item.label}${item.alert ? '，有新动向' : ''}`}
                    >
                      <span>{WATCH_KIND_LABELS[item.kind]}</span>
                      <span><strong>{item.label}</strong><small>{item.detail || '暂无补充记载'}</small></span>
                      {item.alert ? (
                        <i
                          aria-label={item.kind === 'situation' ? '局势有新进展' : '有新动向'}
                          data-alert-kind={item.kind === 'situation' ? 'situation-change' : 'new-history'}
                        >
                          <BellRing size={12} aria-hidden="true" />
                          <span>{item.kind === 'situation' ? '新进展' : '新动向'}</span>
                        </i>
                      ) : <ChevronRight size={14} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      className="observer-desk__watch-remove"
                      data-testid="observer-watch-remove"
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
                <p><strong>尚未留下目光</strong><span>可在“当世三问”关注一条局势，也可从人物、家族、政权或地区档案留下关注。</span></p>
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
              <label data-pause-rule="majorHistory">
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
                <label key={rule.key} data-pause-rule={rule.key}>
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
              <span>{progress.completed === progress.total ? <BookOpenCheck size={14} aria-hidden="true" /> : <ListChecks size={14} aria-hidden="true" />}{progress.completed === progress.total ? '你已掌握观察世界的基本方法。' : '完成一次操作后自动勾选。'}</span>
              {progress.completed > 0 ? (
                <button type="button" onClick={resetGuide}><RotateCcw size={12} aria-hidden="true" />重置</button>
              ) : null}
            </footer>
          </section>

          <section
            className="observer-desk__section observer-desk__release"
            aria-labelledby="observer-release-heading"
            data-update-phase={appUpdate.phase}
          >
            <div className="observer-desk__section-heading">
              <div>
                <span>04</span>
                <h3 id="observer-release-heading">版本与更新</h3>
              </div>
              <strong>v{APP_VERSION}</strong>
            </div>
            <div className="observer-desk__release-line">
              <div role="status" aria-live="polite" data-testid="app-update-status">
                <strong>{appUpdateStatusText(appUpdate)}</strong>
                <small>
                  {updateAvailable
                    ? '重载前会先暂停并保存当前世界。'
                    : lastChecked
                      ? `最近检查 ${lastChecked}`
                      : LATEST_APP_RELEASE.title}
                </small>
              </div>
              <button
                type="button"
                data-testid={updateAvailable ? 'apply-app-update' : 'check-app-update'}
                disabled={appUpdate.phase === 'checking' || updateBusy || (!onCheckUpdate && !updateAvailable)}
                onClick={async () => {
                  if (updateAvailable && onApplyUpdate) {
                    setUpdateBusy(true);
                    try {
                      await onApplyUpdate();
                    } finally {
                      setUpdateBusy(false);
                    }
                    return;
                  }
                  await onCheckUpdate?.();
                }}
              >
                <RefreshCw
                  size={14}
                  aria-hidden="true"
                  className={appUpdate.phase === 'checking' || updateBusy ? 'observer-desk__release-spin' : undefined}
                />
                {updateBusy
                  ? '正在保存'
                  : updateAvailable
                    ? '更新并重载'
                    : appUpdate.phase === 'checking'
                      ? '检查中'
                      : '检查更新'}
              </button>
            </div>
            <details className="observer-desk__release-notes">
              <summary>本版改动</summary>
              <ul>
                {LATEST_APP_RELEASE.items.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>
          </section>
        </div>

        <p className="observer-desk__footnote">局势关注、关键变化提醒与暂停仅属于观察者设置；打开、取消或调整规则均不写入世界哈希。</p>
      </aside>
    </div>
  );
}
