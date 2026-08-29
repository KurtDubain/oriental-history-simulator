import { BookOpen, FileUp, Library, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { APP_VERSION } from '../version';
import { getMapProfile } from '../maps';
import '../styles/world-start.css';

const DEFAULT_MAP_PROFILE = getMapProfile();

const PLAYTEST_SEEDS = [
  { seed: '沧衡-甲子', label: '山河初醒', detail: '均衡开局，适合第一次观察' },
  { seed: '潮生商路', label: '海潮东来', detail: '港口与跨海贸易更值得关注' },
  { seed: '孤城疫年', label: '孤城疫年', detail: '迁徙、卫生与地方韧性的考验' },
] as const;

interface WorldStartProps {
  open: boolean;
  seed: string;
  hasSave: boolean;
  busy?: boolean;
  error?: string | null;
  onSeedChange: (seed: string) => void;
  onCreate: () => void;
  onContinue: () => void;
  onOpenCollection?: () => void;
  collectionCount?: number;
  onImport: (file: File) => void;
  onCancel?: () => void;
}

export function WorldStart({
  open,
  seed,
  hasSave,
  busy = false,
  error,
  onSeedChange,
  onCreate,
  onContinue,
  onOpenCollection,
  collectionCount = 0,
  onImport,
  onCancel,
}: WorldStartProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = requestAnimationFrame(() => primaryActionRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCancelRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])',
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
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused) requestAnimationFrame(() => previouslyFocused.focus());
    };
  }, [open]);

  if (!open) return null;

  return (
    <div ref={dialogRef} className="world-start" role="dialog" aria-modal="true" aria-labelledby="world-start-title">
      <div className="world-start__grain" aria-hidden="true" />
      {onCancel ? (
        <button className="world-start__close" type="button" onClick={onCancel} aria-label="返回当前世界">
          <X size={19} aria-hidden="true" />
        </button>
      ) : null}
      <section className="world-start__content">
        <p className="world-start__kicker">架空东方历史演化观察台 · v{APP_VERSION}</p>
        <h1 id="world-start-title">沧衡纪</h1>
        <p className="world-start__lede">不统治天下，只见证它如何成为历史。</p>

        <label className="world-start__seed">
          <span>世界种子</span>
          <input
            value={seed}
            onChange={(event) => onSeedChange(event.target.value)}
            maxLength={48}
            spellCheck={false}
            disabled={busy}
            aria-describedby="seed-note"
          />
        </label>
        <p id="seed-note" className="world-start__note">
          相同种子与相同推进将写出完全相同的历史。
        </p>

        <div className="world-start__scenarios" role="group" aria-label="推荐试玩世界">
          {PLAYTEST_SEEDS.map((scenario) => (
            <button
              key={scenario.seed}
              type="button"
              data-selected={seed === scenario.seed || undefined}
              onClick={() => onSeedChange(scenario.seed)}
              disabled={busy}
              aria-pressed={seed === scenario.seed}
            >
              <strong>{scenario.label}</strong>
              <small>{scenario.detail}</small>
            </button>
          ))}
        </div>

        {error ? <p className="world-start__error">{error}</p> : null}

        <div className="world-start__actions">
          <button ref={primaryActionRef} className="world-start__primary" onClick={onCreate} disabled={busy || !seed.trim()} id="start-world">
            <Sparkles size={16} aria-hidden="true" />
            开启新纪
          </button>
          {hasSave ? (
            <button onClick={onContinue} disabled={busy} id="continue-world">
              <BookOpen size={16} aria-hidden="true" />
              续读旧史
            </button>
          ) : null}
          {onOpenCollection ? (
            <button
              type="button"
              onClick={onOpenCollection}
              disabled={busy}
              id="open-world-collection"
              aria-label={`打开世界收藏，现有${collectionCount}个命名世界`}
            >
              <Library size={16} aria-hidden="true" />
              世界收藏{collectionCount > 0 ? ` · ${collectionCount}` : ''}
            </button>
          ) : null}
          <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <FileUp size={16} aria-hidden="true" />
            导入史册
          </button>
          <input
            ref={fileInputRef}
            className="world-start__file"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = '';
            }}
            tabIndex={-1}
          />
        </div>
      </section>

      <footer className="world-start__footer">
        <span>一回合 · 三个月</span>
        <span>{DEFAULT_MAP_PROFILE.name} · {DEFAULT_MAP_PROFILE.simulation.regions.length} 陆区 · {DEFAULT_MAP_PROFILE.simulation.seaZones.length} 海域</span>
        <span>v{APP_VERSION} · 按 F 全屏</span>
      </footer>
    </div>
  );
}
