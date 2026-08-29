import {
  Check,
  Expand,
  Gauge,
  Image,
  RotateCcw,
  Settings2,
  Volume2,
  VolumeX,
  Waves,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import settingsArtwork from '../assets/settings-mountains-v1.jpg';
import {
  createObserverInterfaceSettings,
  normalizeObserverInterfaceSettings,
  type ObserverAudioState,
  type ObserverInterfaceSettings,
  type ObserverMotionPreference,
} from '../view/observer-interface-settings';
import '../styles/settings-panel.css';

export interface SettingsPanelProps {
  open: boolean;
  settings: ObserverInterfaceSettings;
  audioState?: ObserverAudioState;
  fullscreen?: boolean;
  onSettingsChange: (settings: ObserverInterfaceSettings) => void;
  onToggleFullscreen?: () => void;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}

const MOTION_OPTIONS: ReadonlyArray<{
  id: ObserverMotionPreference;
  label: string;
  detail: string;
}> = [
  { id: 'system', label: '跟随设备', detail: '尊重系统的动态效果偏好' },
  { id: 'full', label: '较完整', detail: '设备允许时保留展卷、落墨和季节过渡' },
  { id: 'reduced', label: '减少', detail: '停用非必要位移与呼吸效果' },
];

const AUDIO_STATE_LABEL: Record<ObserverAudioState, string> = {
  silent: '等待开启',
  waiting: '轻触页面后启用',
  ready: '正在聆听',
  suspended: '已随页面暂停',
  unsupported: '此浏览器不支持',
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SettingsPanel({
  open,
  settings,
  audioState = settings.sound.enabled ? 'ready' : 'silent',
  fullscreen = false,
  onSettingsChange,
  onToggleFullscreen,
  onClose,
  returnFocusTo,
}: SettingsPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const safeSettings = normalizeObserverInterfaceSettings(settings);

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
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open, returnFocusTo]);

  if (!open) return null;

  const commit = (patch: Partial<ObserverInterfaceSettings>) => {
    onSettingsChange(normalizeObserverInterfaceSettings({ ...safeSettings, ...patch }));
  };
  const commitSound = (patch: Partial<ObserverInterfaceSettings['sound']>) => {
    commit({ sound: { ...safeSettings.sound, ...patch } });
  };

  return (
    <div className="settings-layer" data-motion={safeSettings.motion}>
      <button
        type="button"
        className="settings-layer__backdrop"
        tabIndex={-1}
        aria-label="关闭设置"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="settings-panel"
      >
        <header className="settings-panel__hero">
          <img src={settingsArtwork} alt="" aria-hidden="true" />
          <div className="settings-panel__hero-shade" aria-hidden="true" />
          <div className="settings-panel__hero-copy">
            <span><Settings2 size={14} aria-hidden="true" /> 观览 · 声音</span>
            <h2 id={titleId}>设置</h2>
            <p id={descriptionId}>调整你看见和听见世界的方式。</p>
          </div>
          <button ref={closeRef} type="button" aria-label="关闭设置" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-panel__scroll">
          <section className="settings-section" aria-labelledby="settings-audio-heading">
            <div className="settings-section__heading">
              <span className="settings-section__number">01</span>
              <div>
                <h3 id="settings-audio-heading">声音</h3>
                <p>风、水、纸页与远钟共同组成低侵入声景。</p>
              </div>
              <span className="settings-section__status" data-active={safeSettings.sound.enabled || undefined}>
                {AUDIO_STATE_LABEL[audioState]}
              </span>
            </div>

            <label className="settings-switch-row" data-testid="settings-sound-toggle">
              <span className="settings-switch-row__icon" aria-hidden="true">
                {safeSettings.sound.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </span>
              <span>
                <strong>开启声音</strong>
                <small>需由你主动开启；切到后台会自动停下</small>
              </span>
              <input
                type="checkbox"
                checked={safeSettings.sound.enabled}
                disabled={audioState === 'unsupported'}
                onChange={(event) => commitSound({ enabled: event.target.checked })}
              />
              <i aria-hidden="true" />
            </label>

            <div className="settings-volume-list" aria-disabled={!safeSettings.sound.enabled}>
              {([
                ['masterVolume', '总音量', '所有声音的总闸'],
                ['ambienceVolume', '环境声', '风、水、远钟与紧张气氛'],
                ['effectsVolume', '操作音效', '点选、展卷、推进与重大史事'],
              ] as const).map(([key, label, detail]) => (
                <label key={key} className="settings-range-row">
                  <span><strong>{label}</strong><small>{detail}</small></span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={safeSettings.sound[key]}
                    disabled={!safeSettings.sound.enabled}
                    aria-label={label}
                    onChange={(event) => commitSound({ [key]: Number(event.target.value) })}
                  />
                  <output>{percent(safeSettings.sound[key])}</output>
                </label>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="settings-visual-heading">
            <div className="settings-section__heading">
              <span className="settings-section__number">02</span>
              <div>
                <h3 id="settings-visual-heading">画面与动态</h3>
                <p>地图仍以信息为先，气氛只改变纸色、雾度与水面。</p>
              </div>
            </div>

            <label className="settings-switch-row">
              <span className="settings-switch-row__icon" aria-hidden="true"><Waves size={18} /></span>
              <span><strong>地图气氛</strong><small>随春夏秋冬改变色温和水面明暗</small></span>
              <input
                type="checkbox"
                checked={safeSettings.mapAtmosphere}
                onChange={(event) => commit({ mapAtmosphere: event.target.checked })}
              />
              <i aria-hidden="true" />
            </label>

            <fieldset className="settings-choice" data-testid="settings-motion-choice">
              <legend><Gauge size={15} aria-hidden="true" />动态效果</legend>
              <div>
                {MOTION_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={safeSettings.motion === option.id}
                    onClick={() => commit({ motion: option.id })}
                  >
                    {safeSettings.motion === option.id ? <Check size={12} aria-hidden="true" /> : null}
                    <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="settings-choice settings-choice--density">
              <legend><Image size={15} aria-hidden="true" />界面密度</legend>
              <div>
                <button
                  type="button"
                  aria-pressed={safeSettings.interfaceDensity === 'comfortable'}
                  onClick={() => commit({ interfaceDensity: 'comfortable' })}
                >
                  {safeSettings.interfaceDensity === 'comfortable' ? <Check size={12} aria-hidden="true" /> : null}
                  <span><strong>舒展</strong><small>更大的留白与阅读间距</small></span>
                </button>
                <button
                  type="button"
                  aria-pressed={safeSettings.interfaceDensity === 'compact'}
                  onClick={() => commit({ interfaceDensity: 'compact' })}
                >
                  {safeSettings.interfaceDensity === 'compact' ? <Check size={12} aria-hidden="true" /> : null}
                  <span><strong>紧凑</strong><small>桌面减少留白，触控尺寸保持不变</small></span>
                </button>
              </div>
            </fieldset>
          </section>

          <section className="settings-section" aria-labelledby="settings-window-heading">
            <div className="settings-section__heading">
              <span className="settings-section__number">03</span>
              <div><h3 id="settings-window-heading">窗口</h3><p>不离开当前世界，改变观看方式。</p></div>
            </div>
            {onToggleFullscreen ? (
              <button type="button" className="settings-action-row" onClick={onToggleFullscreen}>
                <Expand size={17} aria-hidden="true" />
                <span><strong>{fullscreen ? '退出全屏' : '进入全屏'}</strong><small>也可随时按 F 切换</small></span>
              </button>
            ) : null}
          </section>
        </div>

        <footer className="settings-panel__footer">
          <p>这些设置只属于观察者，不改变人物选择、历史结果或世界种子。</p>
          <button type="button" onClick={() => onSettingsChange(createObserverInterfaceSettings())}>
            <RotateCcw size={13} aria-hidden="true" />恢复默认
          </button>
        </footer>
      </aside>
    </div>
  );
}
