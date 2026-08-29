import {
  Activity,
  Anchor,
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
import '../styles/layer-picker.css';

interface LayerDefinition {
  id: MapOverlay;
  label: string;
  description: string;
  icon: LucideIcon;
}

const GROUPS: Array<{ label: string; layers: LayerDefinition[] }> = [
  {
    label: '山河',
    layers: [
      { id: 'none', label: '地势', description: '山川、海岸与通行地貌', icon: Mountain },
      { id: 'political', label: '疆界', description: '列国控制与都城', icon: Layers3 },
      { id: 'war', label: '兵势', description: '军团、战乱与破坏', icon: Shield },
    ],
  },
  {
    label: '生计',
    layers: [
      { id: 'food', label: '粮情', description: '地方粮储余裕', icon: Wheat },
      { id: 'population', label: '人口', description: '人口与城邑密度', icon: UsersRound },
      { id: 'trade', label: '商路', description: '当季成交与港口吞吐', icon: Route },
      { id: 'migration', label: '迁徙', description: '谋生迁移与难民流向', icon: Network },
    ],
  },
  {
    label: '海疆',
    layers: [
      { id: 'naval', label: '海权', description: '海域控制、舰队与封锁', icon: Anchor },
    ],
  },
  {
    label: '文明',
    layers: [
      { id: 'disease', label: '疾疫', description: '病势、暴发与输入路径', icon: Activity },
      { id: 'knowledge', label: '知识', description: '实践掌握与传播', icon: Sparkles },
    ],
  },
];

const ALL_LAYERS = GROUPS.flatMap((group) => group.layers);

export interface LayerPickerProps {
  value: MapOverlay;
  onChange: (value: MapOverlay) => void;
}

export function LayerPicker({ value, onChange }: LayerPickerProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const current = ALL_LAYERS.find((layer) => layer.id === value) ?? ALL_LAYERS[0];
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLButtonElement>('button'));
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
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span className="observer-navigation__glyph"><CurrentIcon size={19} strokeWidth={1.55} aria-hidden="true" /></span>
        <span>叠层</span>
      </button>

      {open ? (
        <>
          <button className="layer-picker__backdrop" type="button" tabIndex={-1} aria-label="关闭舆图叠层" onClick={() => setOpen(false)} />
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
              <button type="button" aria-label="关闭舆图叠层" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
            </header>
            <div className="layer-picker__groups">
              {GROUPS.map((group) => (
                <section key={group.label} aria-label={`${group.label}图层`}>
                  <h3>{group.label}</h3>
                  <div role="radiogroup" aria-label={`${group.label}图层`}>
                    {group.layers.map((layer) => {
                      const Icon = layer.icon;
                      return (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={value === layer.id}
                          key={layer.id}
                          data-layer-id={layer.id}
                          onClick={() => {
                            onChange(layer.id);
                            setOpen(false);
                          }}
                        >
                          <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                          <span><strong>{layer.label}</strong><small>{layer.description}</small></span>
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
