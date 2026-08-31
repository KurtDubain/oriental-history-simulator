import {
  Activity,
  Anchor,
  ChevronDown,
  ChevronRight,
  Layers3,
  Map,
  Mountain,
  Network,
  Route,
  Shield,
  Sparkles,
  UsersRound,
  Wheat,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MapOverlay } from './WorldMap';
import {
  projectLayerPicker,
  type LayerPickerEntry,
  type LayerPickerId,
} from '../view/layer-picker-model';
import '../styles/layer-picker.css';

interface LayerDefinition {
  label: string;
  description: string;
  icon: LucideIcon;
}

const LAYERS: Readonly<Record<LayerPickerId, LayerDefinition>> = {
  political: { label: '疆界', description: '列国疆界、都城朝局与实权根基', icon: Layers3 },
  war: { label: '兵势', description: '军团、战乱与破坏', icon: Shield },
  food: { label: '粮情', description: '地方粮储余裕', icon: Wheat },
  none: { label: '地势', description: '山川、海岸与通行地貌', icon: Mountain },
  population: { label: '人口', description: '人口与城邑密度', icon: UsersRound },
  trade: { label: '商路', description: '当季成交与港口吞吐', icon: Route },
  migration: { label: '迁徙', description: '谋生迁移与难民流向', icon: Network },
  naval: { label: '海权', description: '海域控制、舰队与封锁', icon: Anchor },
  disease: { label: '疾疫', description: '病势、暴发与输入路径', icon: Activity },
  knowledge: { label: '知识', description: '实践掌握与传播', icon: Sparkles },
};

export interface LayerPickerProps {
  value: MapOverlay;
  onChange: (value: MapOverlay) => void;
}

export function LayerPicker({ value, onChange }: LayerPickerProps) {
  const [open, setOpen] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const titleId = useId();
  const moreId = `${titleId}-more`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const projection = projectLayerPicker(value);
  const current = LAYERS[projection.activeId];
  const CurrentIcon = current.icon;

  const close = () => {
    setMoreExpanded(false);
    setOpen(false);
  };

  const layerButton = (entry: LayerPickerEntry) => {
    const layer = LAYERS[entry.id];
    const Icon = layer.icon;
    return (
      <button
        type="button"
        aria-pressed={projection.activeId === entry.id}
        key={entry.id}
        data-layer-id={entry.id}
        data-layer-tier={entry.tier}
        onClick={() => {
          onChange(entry.id);
          close();
        }}
      >
        <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
        <span>
          <strong>{layer.label}</strong>
          <small>{entry.tier === 'current' ? `正在查看 · ${layer.description}` : layer.description}</small>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    );
  };

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      const buttons = Array.from(sheetRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      const visible = buttons.filter((button) => button.getClientRects().length > 0);
      const checked = visible.find((button) => button.getAttribute('aria-pressed') === 'true');
      (checked ?? visible[0])?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMoreExpanded(false);
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
        .filter((button) => button.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <div className="layer-picker">
      <button
        ref={triggerRef}
        type="button"
        className="observer-navigation__item layer-picker__trigger"
        data-navigation-entry="layers"
        data-active={open || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'observer-layer-sheet' : undefined}
        aria-label={`舆图叠层，当前${current.label}`}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        <span className="observer-navigation__glyph"><CurrentIcon size={19} strokeWidth={1.55} aria-hidden="true" /></span>
        <span>叠层</span>
      </button>

      {open ? (
        <>
          <button className="layer-picker__backdrop" type="button" tabIndex={-1} aria-label="关闭舆图叠层" onClick={close} />
          <div
            id="observer-layer-sheet"
            ref={sheetRef}
            className="layer-picker__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-layer-more-expanded={moreExpanded || undefined}
          >
            <header>
              <div>
                <span>舆图所见</span>
                <h2 id={titleId}><Map size={15} aria-hidden="true" />舆图叠层</h2>
              </div>
              <button type="button" aria-label="关闭舆图叠层" onClick={close}><X size={18} aria-hidden="true" /></button>
            </header>
            <div className="layer-picker__groups">
              <section className="layer-picker__tier layer-picker__tier--primary" aria-label="常用图层">
                <h3>常用</h3>
                <div>{projection.entries.filter((entry) => entry.tier === 'primary').map(layerButton)}</div>
              </section>
              {projection.currentEntry ? (
                <section className="layer-picker__tier layer-picker__tier--current" aria-label="正在查看的图层">
                  <h3>正在查看</h3>
                  <div>{layerButton(projection.currentEntry)}</div>
                </section>
              ) : null}
              <button
                type="button"
                className="layer-picker__more-trigger"
                data-layer-more-trigger
                aria-expanded={moreExpanded}
                aria-controls={moreId}
                onClick={() => setMoreExpanded((expanded) => !expanded)}
              >
                <span>更多图层</span>
                <small>{projection.moreEntries.length} 项</small>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <section
                id={moreId}
                className="layer-picker__tier layer-picker__tier--more"
                aria-label="更多图层"
                data-layer-more-expanded={moreExpanded || undefined}
              >
                <h3>更多</h3>
                <div>{projection.moreEntries.map(layerButton)}</div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
