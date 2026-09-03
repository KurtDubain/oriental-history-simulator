import { ChevronRight, Layers3, Map, Mountain, Shield, Wheat, X, type LucideIcon } from 'lucide-react';
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
  war: { label: '军争', description: '人物部曲、出征行营、舰队与预计接敌', icon: Shield },
  food: { label: '供养', description: '粮储余裕与支撑军民的主要压力', icon: Wheat },
  none: { label: '地势', description: '山川、海岸与通行地貌', icon: Mountain },
};

export interface LayerPickerProps {
  value: MapOverlay;
  onChange: (value: MapOverlay) => void;
}

export function LayerPicker({ value, onChange }: LayerPickerProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const projection = projectLayerPicker(value);
  const current = LAYERS[projection.activeId];
  const CurrentIcon = current.icon;

  const close = () => {
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
        onClick={() => {
          onChange(entry.id);
          close();
        }}
      >
        <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
        <span>
          <strong>{layer.label}</strong>
          <small>{layer.description}</small>
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
          >
            <header>
              <div>
                <span>舆图所见</span>
                <h2 id={titleId}><Map size={15} aria-hidden="true" />舆图叠层</h2>
              </div>
              <button type="button" aria-label="关闭舆图叠层" onClick={close}><X size={18} aria-hidden="true" /></button>
            </header>
            <div className="layer-picker__groups">
              <section className="layer-picker__tier layer-picker__tier--primary" aria-label="舆图图层">
                <h3>所见</h3>
                <div>{projection.entries.map(layerButton)}</div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
