import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  FastForward,
  Map as MapIcon,
  ScrollText,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MapOverlay } from './WorldMap';
import { useDialogLayer } from './useDialogLayer';
import '../styles/map-primer.css';

export type MapPrimerStep = 'terrain' | 'situation' | 'history';
export type MapPrimerCloseReason = 'completed' | 'skipped';

export interface MapPrimerProps {
  open: boolean;
  currentStep: MapPrimerStep;
  onStep: (step: MapPrimerStep) => void;
  onClose: (reason: MapPrimerCloseReason) => void;
  onSelectOverlay: (overlay: MapOverlay) => void;
  onAdvance: () => boolean | void;
  onOpenWhy?: () => void;
  returnFocusTo?: HTMLElement | null;
}

interface PrimerStepDefinition {
  id: MapPrimerStep;
  eyebrow: string;
  title: string;
  description: string;
  reading: string;
  action: string;
}

export const MAP_PRIMER_STEPS: readonly PrimerStepDefinition[] = [
  {
    id: 'terrain',
    eyebrow: '第一眼 · 山河',
    title: '先看路怎么走',
    description: '浅地是平原，密纹是山地，青墨是河海。山河决定粮食、通行和哪里守得住。',
    reading: '先找平原与河谷，再找山口、海峡这些会改变历史的窄门。',
    action: '带我看地势',
  },
  {
    id: 'situation',
    eyebrow: '第二眼 · 人势',
    title: '再认谁控制这里',
    description: '淡色疆域属于不同政权；方印是城邑，双框是都城，锚是港口，带兵数的圆章是军团。',
    reading: '颜色只表示控制，不代表强弱。城邑、港口与军团的位置才说明当季局势。',
    action: '带我看疆界',
  },
  {
    id: 'history',
    eyebrow: '第三眼 · 因果',
    title: '让世界走过一季',
    description: '推进后，底部史册会记下本季变化。不要只看结果，打开“为何如此”追到粮食、人物与旧事。',
    reading: '地图回答“哪里变了”，史册回答“发生什么”，何故与证据回答“为何如此”。',
    action: '推进一季',
  },
] as const;

function PrimerMapDiagram({ step }: { step: MapPrimerStep }) {
  return (
    <figure className="map-primer__diagram" data-step={step} aria-hidden="true">
      <svg viewBox="0 0 540 250" focusable="false">
        <defs>
          <pattern id="map-primer-mountain-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
            <line x1="0" y1="0" x2="0" y2="9" />
          </pattern>
          <marker id="map-primer-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>

        <path className="map-primer__coast" d="M33 22 150 14l86 26 86-20 72 35 93 3 25 66-28 83-101 13-73-21-74 35-96-20-73-54-18-76Z" />
        <g className="map-primer__terrain">
          <path className="map-primer__mountain-field" d="M43 62 133 25l67 21-20 43-73 24-62-13Z" />
          <path className="map-primer__mountain-line" d="m52 83 18-25 15 22 19-32 19 33 22-29 20 25" />
          <path className="map-primer__river" d="M186 40c33 27 4 54 34 73 29 19 83 8 99 37 13 23-10 49 24 67" />
          <path className="map-primer__river map-primer__river--branch" d="M220 113c-39 6-57 26-73 53" />
          <text x="66" y="103">山地</text>
          <text x="223" y="96">河流</text>
          <text x="365" y="109">平原</text>
        </g>

        <g className="map-primer__polities">
          <path data-polity="one" d="M133 25 236 40l-16 73-73 53-40-53 26-88Z" />
          <path data-polity="two" d="m236 40 86-20 72 35-18 84-57 11-99-37Z" />
          <path data-polity="three" d="m147 166 73-53 99 37 24 67-33-18-74 35-96-20Z" />
          <path data-polity="four" d="m394 55 93 3 25 66-28 83-141 10-24-67 57-11Z" />
          <path className="map-primer__frontier" d="m220 113 99 37" />
        </g>

        <g className="map-primer__nodes">
          <g transform="translate(276 79)">
            <rect x="-7" y="-7" width="14" height="14" rx="1" />
            <rect x="-4" y="-4" width="8" height="8" rx="0.5" />
            <text x="12" y="4">都城</text>
          </g>
          <g className="map-primer__port" transform="translate(443 175)">
            <path d="M0-9v16M-5-9h10M-10 1c2 8 18 8 20 0M0 7v7" />
            <text x="14" y="4">港口</text>
          </g>
          <g className="map-primer__army" transform="translate(353 132)">
            <circle r="11" />
            <text x="-7" y="3">8k</text>
            <text x="18" y="4">军团</text>
          </g>
        </g>

        <g className="map-primer__history-flow">
          <path d="M83 206h286" markerEnd="url(#map-primer-arrow)" />
          <circle cx="104" cy="206" r="8" />
          <circle cx="235" cy="206" r="8" />
          <circle cx="362" cy="206" r="8" />
          <text x="83" y="233">地图异动</text>
          <text x="211" y="233">季度史事</text>
          <text x="341" y="233">为何如此</text>
        </g>
      </svg>
      <figcaption>{step === 'terrain' ? '地势底图' : step === 'situation' ? '疆界与节点' : '变化的阅读顺序'}</figcaption>
    </figure>
  );
}

export function MapPrimer({
  open,
  currentStep,
  onStep,
  onClose,
  onSelectOverlay,
  onAdvance,
  onOpenWhy,
  returnFocusTo,
}: MapPrimerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [historyAdvanced, setHistoryAdvanced] = useState(false);

  const stepIndex = Math.max(0, MAP_PRIMER_STEPS.findIndex((item) => item.id === currentStep));
  const step = MAP_PRIMER_STEPS[stepIndex];

  useDialogLayer({
    open,
    containerRef: dialogRef,
    initialFocusRef: actionRef,
    onClose: () => onClose('skipped'),
    returnFocusTo,
  });

  useEffect(() => {
    if (!open || currentStep !== 'history') setHistoryAdvanced(false);
  }, [currentStep, open]);

  if (!open) return null;

  const runPrimaryAction = () => {
    if (currentStep === 'terrain') {
      onSelectOverlay('none');
      onStep('situation');
      return;
    }
    if (currentStep === 'situation') {
      onSelectOverlay('political');
      onStep('history');
      return;
    }
    if (!historyAdvanced) {
      if (onAdvance() !== false) setHistoryAdvanced(true);
      return;
    }
    onClose('completed');
    onOpenWhy?.();
  };

  const primaryLabel = currentStep === 'history' && historyAdvanced
    ? (onOpenWhy ? '打开“为何如此”' : '完成导览')
    : step.action;

  return (
    <div className="map-primer-layer" data-map-primer>
      <button
        type="button"
        className="map-primer-layer__backdrop observer-dialog-backdrop"
        tabIndex={-1}
        aria-label="跳过地图导览"
        onClick={() => onClose('skipped')}
      />
      <aside
        ref={dialogRef}
        className="map-primer observer-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-map-primer-step={currentStep}
      >
        <header className="map-primer__header">
          <span className="map-primer__seal" aria-hidden="true"><MapIcon size={19} strokeWidth={1.45} /></span>
          <div>
            <span>三眼读懂天下</span>
            <h2 id={titleId}>先会看图，再看历史</h2>
          </div>
          <button type="button" aria-label="跳过地图导览" data-map-primer-skip onClick={() => onClose('skipped')}>
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <nav className="map-primer__steps" aria-label="地图导览进度">
          <ol>
            {MAP_PRIMER_STEPS.map((item, index) => (
              <li key={item.id} data-active={item.id === currentStep || undefined} data-past={index < stepIndex || undefined}>
                <button
                  type="button"
                  aria-current={item.id === currentStep ? 'step' : undefined}
                  aria-label={`第${index + 1}步，${item.title}`}
                  onClick={() => onStep(item.id)}
                >
                  <span>{index < stepIndex ? <Check size={11} aria-hidden="true" /> : index + 1}</span>
                  <small>{item.id === 'terrain' ? '山河' : item.id === 'situation' ? '局势' : '因果'}</small>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <PrimerMapDiagram step={currentStep} />

        <section className="map-primer__copy" aria-live="polite" aria-atomic="true">
          <span>{step.eyebrow}</span>
          <h3>{step.title}</h3>
          <p id={descriptionId}>{step.description}</p>
          <p className="map-primer__reading"><Eye size={14} strokeWidth={1.6} aria-hidden="true" />{step.reading}</p>
          {currentStep === 'history' && historyAdvanced ? (
            <p className="map-primer__advanced" role="status">
              <ScrollText size={15} aria-hidden="true" />一季已过。现在沿底部史册打开一条记载，查看它“为何如此”。
            </p>
          ) : null}
        </section>

        <footer className="map-primer__footer">
          <button
            type="button"
            className="map-primer__back"
            disabled={stepIndex === 0}
            onClick={() => onStep(MAP_PRIMER_STEPS[stepIndex - 1]?.id ?? 'terrain')}
          >
            <ArrowLeft size={15} aria-hidden="true" />上一步
          </button>
          <span aria-label={`第${stepIndex + 1}步，共3步`}>{stepIndex + 1}<i>/</i>3</span>
          <button
            ref={actionRef}
            type="button"
            className="map-primer__primary"
            data-map-primer-action
            onClick={runPrimaryAction}
          >
            {currentStep === 'history' && !historyAdvanced ? <FastForward size={15} aria-hidden="true" /> : null}
            {primaryLabel}
            {currentStep !== 'history' || historyAdvanced ? <ArrowRight size={15} aria-hidden="true" /> : null}
          </button>
        </footer>
      </aside>
    </div>
  );
}
