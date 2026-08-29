import { BookOpen, FileUp, Library, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { APP_VERSION } from '../version';
import { listMapProfiles } from '../maps';
import type { MapProfile, MapProfileId, MapPoint } from '../maps';
import '../styles/world-start.css';

const AVAILABLE_MAP_PROFILES = listMapProfiles();

const PLAYTEST_SEEDS = [
  { seed: '沧衡-甲子', label: '山河初醒', detail: '均衡开局，适合第一次观察' },
  { seed: '潮生商路', label: '海潮东来', detail: '港口与跨海贸易更值得关注' },
  { seed: '孤城疫年', label: '孤城疫年', detail: '迁徙、卫生与地方韧性的考验' },
] as const;

export interface WorldStartProps {
  open: boolean;
  seed: string;
  selectedMapProfileId: MapProfileId;
  onSelectMapProfile: (profileId: MapProfileId) => void;
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
  mapProfiles?: readonly MapProfile[];
}

function polygonPoints(points: readonly MapPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function MapProfilePreview({ profile }: { profile: MapProfile }) {
  const { presentation } = profile;
  return (
    <svg
      className="world-start__map-svg"
      viewBox={`0 0 ${presentation.width} ${presentation.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect className="world-start__map-sea" width={presentation.width} height={presentation.height} />
      <g className="world-start__map-land">
        {presentation.landShapes.map((shape) => (
          <polygon key={shape.id} points={polygonPoints(shape.polygon)} />
        ))}
      </g>
      <g className="world-start__map-islets">
        {presentation.decorativeIslets.map((islet) => (
          <polygon key={islet.id} points={polygonPoints(islet.polygon)} />
        ))}
      </g>
    </svg>
  );
}

function mapPlaystyle(profile: MapProfile): string {
  if (profile.compatibility.legacyPartialRegionVersions.length > 0) {
    return '陆海跨度开阔，适合久看王朝、家族与边境的兴替。';
  }
  return profile.simulation.portLinks.length >= 16
    ? '关隘与港路相扣，一处争衡更容易牵动全局。'
    : '陆路相连，关隘、粮道与地方势力更值得留意。';
}

function mapEditionLabel(profile: MapProfile): string {
  return profile.compatibility.legacyPartialRegionVersions.length > 0 ? '私人舆图' : '架空舆图';
}

export function WorldStart({
  open,
  seed,
  selectedMapProfileId,
  onSelectMapProfile,
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
  mapProfiles = AVAILABLE_MAP_PROFILES,
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
      if (previouslyFocused) requestAnimationFrame(() => previouslyFocused.focus({ preventScroll: true }));
    };
  }, [open]);

  if (!open) return null;

  const selectedMapProfile = mapProfiles.find((profile) => profile.id === selectedMapProfileId)
    ?? mapProfiles[0];

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

        <section className="world-start__maps" aria-labelledby="world-start-map-title">
          <div className="world-start__section-heading">
            <h2 id="world-start-map-title">选择舆图</h2>
            <p>只决定山河底板，两张地图共用同一套历史规则</p>
          </div>
          <div className="world-start__map-options" role="radiogroup" aria-label="新世界地图">
            {mapProfiles.map((profile) => {
              const selected = profile.id === selectedMapProfileId;
              const detailId = `world-map-${profile.id}-detail`;
              return (
                <label
                  className="world-start__map-choice"
                  data-selected={selected || undefined}
                  data-map-profile-id={profile.id}
                  key={profile.id}
                >
                  <input
                    type="radio"
                    name="world-map-profile"
                    value={profile.id}
                    checked={selected}
                    onChange={() => onSelectMapProfile(profile.id)}
                    disabled={busy}
                    aria-describedby={detailId}
                  />
                  <span className="world-start__map-preview">
                    <MapProfilePreview profile={profile} />
                    <span className="world-start__map-edition">
                      {mapEditionLabel(profile)}
                    </span>
                    <span className="world-start__map-check" aria-hidden="true">选</span>
                  </span>
                  <span className="world-start__map-copy">
                    <span className="world-start__map-titleline">
                      <strong>{profile.name}</strong>
                      <span>{profile.simulation.regions.length}州 · {profile.simulation.seaZones.length}海</span>
                    </span>
                    <span className="world-start__map-feature">{profile.subtitle}</span>
                    <small id={detailId}>{mapPlaystyle(profile)}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="world-start__map-note">选图不会落笔；确认开启后，才会按种子生成这段历史。</p>
        </section>

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
        <span>{selectedMapProfile
          ? `${selectedMapProfile.name} · ${selectedMapProfile.simulation.regions.length} 陆区 · ${selectedMapProfile.simulation.seaZones.length} 海域`
          : '请选择一张舆图'}</span>
        <span>v{APP_VERSION} · 按 F 全屏</span>
      </footer>
    </div>
  );
}
