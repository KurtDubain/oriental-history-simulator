import {
  ArrowDown,
  ArrowUp,
  CloudLightning,
  Crown,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { V03InterventionAction } from '../sim';
import '../styles/mandate-panel.css';

export interface MandateTarget {
  id: string;
  kind: 'country' | 'person' | 'region';
  name: string;
  detail: string;
}

export interface MandateMessage {
  tone: 'success' | 'error';
  text: string;
}

interface MandatePanelProps {
  open: boolean;
  available: number;
  usedThisTurn: boolean;
  target: MandateTarget | null;
  busy?: boolean;
  message?: MandateMessage | null;
  recentIntervention?: { title: string; date: string } | null;
  onApply: (action: V03InterventionAction) => Promise<boolean>;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}

const ACTION_COST = {
  legitimacy: 2,
  support: 3,
  protect: 4,
  disaster: 5,
} as const;

export function MandatePanel({
  open,
  available,
  usedThisTurn,
  target,
  busy = false,
  message,
  recentIntervention,
  onApply,
  onClose,
  returnFocusTo,
}: MandatePanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmDisasterRef = useRef(false);
  const [confirmDisaster, setConfirmDisaster] = useState(false);

  useEffect(() => setConfirmDisaster(false), [open, target?.id]);
  useEffect(() => {
    confirmDisasterRef.current = confirmDisaster;
  }, [confirmDisaster]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmDisasterRef.current) setConfirmDisaster(false);
        else onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
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
      returnFocusTo?.focus();
    };
  }, [onClose, open, returnFocusTo]);

  if (!open) return null;
  const unavailable = usedThisTurn || available <= 0;
  const canAfford = (cost: number) => !busy && !unavailable && available >= cost;

  const apply = async (action: V03InterventionAction) => {
    const succeeded = await onApply(action);
    if (succeeded) setConfirmDisaster(false);
  };

  return (
    <div className="mandate-layer">
      <button type="button" className="mandate-layer__backdrop" tabIndex={-1} aria-label="关闭天意" onClick={onClose} />
      <aside ref={panelRef} className="mandate-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="mandate-panel__header">
          <div>
            <span><Sparkles size={13} aria-hidden="true" />观察者的有限偏转</span>
            <h2 id={titleId}>天意</h2>
          </div>
          <button ref={closeRef} type="button" aria-label="关闭天意" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="mandate-panel__ledger" data-used={usedThisTurn || undefined}>
          <span><strong>{available}</strong><small>点可用天命</small></span>
          <p>{usedThisTurn ? '本季已经落笔，下季方可再次干预。' : '每季至多一次；每年仅回复一点，最高十二点。'}</p>
        </div>

        {target ? (
          <section className="mandate-panel__target" aria-labelledby="mandate-target-heading">
            <span id="mandate-target-heading">当前所指</span>
            <strong>{target.name}</strong>
            <small>{target.detail}</small>
          </section>
        ) : (
          <p className="mandate-panel__empty">先在舆图或名录中选择一个政权、人物或地区。海域、舰队与史事只供观察，不接受天意直改。</p>
        )}

        {target?.kind === 'country' ? (
          <section className="mandate-panel__actions" aria-label={`${target.name}可用天意`}>
            <button type="button" disabled={!canAfford(ACTION_COST.legitimacy)} onClick={() => void apply({ kind: 'modify_mandate', polityId: target.id, delta: 3 })} aria-label={`提升${target.name}合法性3点`}>
              <Crown size={17} aria-hidden="true" />
              <span><strong>天命稍振</strong><small>合法性 +3，不改财政、威权与人物意志</small></span>
              <b><ArrowUp size={12} aria-hidden="true" />{ACTION_COST.legitimacy}</b>
            </button>
            <button type="button" disabled={!canAfford(ACTION_COST.legitimacy)} onClick={() => void apply({ kind: 'modify_mandate', polityId: target.id, delta: -3 })} aria-label={`降低${target.name}合法性3点`}>
              <Crown size={17} aria-hidden="true" />
              <span><strong>天命微晦</strong><small>合法性 -3，后果仍由制度与人物承受</small></span>
              <b><ArrowDown size={12} aria-hidden="true" />{ACTION_COST.legitimacy}</b>
            </button>
          </section>
        ) : null}

        {target?.kind === 'person' ? (
          <section className="mandate-panel__actions" aria-label={`${target.name}可用天意`}>
            <button type="button" disabled={!canAfford(ACTION_COST.support)} onClick={() => void apply({ kind: 'support_character', characterId: target.id })} aria-label={`扶持${target.name}`}>
              <UserRound size={17} aria-hidden="true" />
              <span><strong>令其被看见</strong><small>略增声望、影响与功绩，不直接授官</small></span>
              <b>{ACTION_COST.support}</b>
            </button>
            <button type="button" disabled={!canAfford(ACTION_COST.protect)} onClick={() => void apply({ kind: 'protect_character', characterId: target.id, quarters: 4 })} aria-label={`庇护${target.name}四季`}>
              <ShieldCheck size={17} aria-hidden="true" />
              <span><strong>庇护四季</strong><small>只避非必然死亡，不阻止衰老、疾病与失势</small></span>
              <b>{ACTION_COST.protect}</b>
            </button>
          </section>
        ) : null}

        {target?.kind === 'region' ? (
          <section className="mandate-panel__actions" aria-label={`${target.name}可用天意`}>
            {!confirmDisaster ? (
              <button type="button" className="mandate-panel__disaster" disabled={!canAfford(ACTION_COST.disaster)} onClick={() => setConfirmDisaster(true)} aria-label={`准备在${target.name}降下一级灾害`}>
                <CloudLightning size={17} aria-hidden="true" />
                <span><strong>降下一级灾害</strong><small>造成真实人口、粮食与财富损失</small></span>
                <b>{ACTION_COST.disaster}</b>
              </button>
            ) : (
              <div className="mandate-panel__confirmation" role="alert">
                <strong>此举会真实伤害{target.name}</strong>
                <p>死亡、破坏、民怨与难民都会写入世界账本，不能撤回。</p>
                <div>
                  <button type="button" onClick={() => setConfirmDisaster(false)}>暂且收手</button>
                  <button type="button" disabled={!canAfford(ACTION_COST.disaster)} onClick={() => void apply({ kind: 'create_disaster', regionId: target.id, severity: 1 })} aria-label={`确认在${target.name}降下一级灾害`}>确认降灾</button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {message ? <p className="mandate-panel__message" data-tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
        {!message && recentIntervention ? <p className="mandate-panel__recent"><span>最近一次</span><strong>{recentIntervention.title}</strong><small>{recentIntervention.date}</small></p> : null}

        <footer>天意只偏转机会。它会留下分支哈希、成本与状态差量，可从史册追溯。</footer>
      </aside>
    </div>
  );
}
