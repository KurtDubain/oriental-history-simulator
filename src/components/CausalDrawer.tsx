import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, GitBranch, Search, UsersRound, X } from 'lucide-react';
import type { ArchiveEntityKind } from './HistoricalArchive';
import { useDialogLayer } from './useDialogLayer';
import '../styles/observer-ui.css';

export type CausalRole = 'structure' | 'condition' | 'trigger' | 'choice' | 'outcome';

export interface CausalFactor {
  id: string;
  role: CausalRole;
  label: string;
  detail?: string;
  actor?: string;
  evidence?: string;
  refs?: CausalReference[];
}

export interface CausalReference {
  id: string;
  kind: ArchiveEntityKind;
  label: string;
  detail: string;
}

export interface CausalEvent {
  id: string;
  date: string;
  title: string;
  summary?: string;
  factors: CausalFactor[];
  consequence?: string;
  subjects?: Array<{
    id: string;
    kind: ArchiveEntityKind;
    label: string;
    detail: string;
  }>;
}

export interface CausalDrawerProps {
  open: boolean;
  event: CausalEvent | null;
  onClose: () => void;
  onInspectEvidence?: (factor: CausalFactor) => void;
  onSelectSubject?: (kind: ArchiveEntityKind, id: string) => void;
  onSelectReference?: (reference: CausalReference) => void;
  returnFocusTo?: HTMLElement | null;
  shouldRestoreFocus?: () => boolean;
}

const ROLE_LABELS: Record<CausalRole, string> = {
  structure: '结构原因',
  condition: '必要条件',
  trigger: '直接诱因',
  choice: '人物选择',
  outcome: '裁决结果',
};

export function CausalDrawer({
  open,
  event,
  onClose,
  onInspectEvidence,
  onSelectSubject,
  onSelectReference,
  returnFocusTo,
  shouldRestoreFocus,
}: CausalDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expandedFactorId, setExpandedFactorId] = useState<string | null>(null);

  useEffect(() => setExpandedFactorId(null), [event?.id]);
  useDialogLayer({
    open: open && Boolean(event),
    containerRef: drawerRef,
    initialFocusRef: closeRef,
    onClose,
    returnFocusTo,
    shouldRestoreFocus,
  });

  if (!open || !event) return null;

  return (
    <div className="observer-causal-layer" data-history-layer="evidence" data-event-id={event.id}>
      <button
        type="button"
        className="observer-causal-layer__backdrop observer-dialog-backdrop"
        aria-label="关闭何故与证据"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        id="observer-causal-drawer"
        ref={drawerRef}
        className="observer-causal-drawer observer-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="observer-causal-drawer__header">
          <div>
            <span className="observer-causal-drawer__kicker"><GitBranch size={14} aria-hidden="true" />何故与证据</span>
            <h2 id={titleId}>{event.title}</h2>
            <p>{event.date}{event.summary ? ` · ${event.summary}` : ''}</p>
          </div>
          <button ref={closeRef} type="button" className="observer-icon-button" aria-label="关闭何故与证据" onClick={onClose}>
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="observer-causal-drawer__body">
          <p className="observer-causal-drawer__question">此事为何发生？</p>
          {event.factors.length ? (
            <ol className="observer-causal-chain">
              {event.factors.map((factor, index) => (
                <li className="observer-causal-chain__factor" key={factor.id} data-role={factor.role}>
                  <span className="observer-causal-chain__index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <span className="observer-causal-chain__role">{ROLE_LABELS[factor.role]}</span>
                    <h3>{factor.label}</h3>
                    {factor.detail ? <p>{factor.detail}</p> : null}
                    {factor.actor ? <small>行动者 · {factor.actor}</small> : null}
                    {factor.evidence ? (
                      onInspectEvidence ? (
                        <button
                          type="button"
                          className="observer-causal-chain__evidence"
                          aria-expanded={factor.refs?.length ? expandedFactorId === factor.id : undefined}
                          onClick={() => {
                            if (factor.refs?.length) setExpandedFactorId((current) => current === factor.id ? null : factor.id);
                            else onInspectEvidence(factor);
                          }}
                        >
                          <Search size={12} aria-hidden="true" />
                          {factor.evidence}
                        </button>
                      ) : (
                        <span className="observer-causal-chain__evidence observer-causal-chain__evidence--static">
                          <Search size={12} aria-hidden="true" />
                          {factor.evidence}
                        </span>
                      )
                    ) : null}
                    {expandedFactorId === factor.id && factor.refs?.length ? (
                      <div className="observer-causal-chain__references" aria-label="结构化因果凭证">
                        <span>凭证所指</span>
                        {factor.refs.map((reference) => (
                          <button key={`${reference.kind}-${reference.id}`} type="button" onClick={() => onSelectReference?.(reference)}>
                            <strong>{reference.label}</strong><small>{reference.detail}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {index < event.factors.length - 1 ? <ArrowDown className="observer-causal-chain__arrow" size={15} aria-hidden="true" /> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="observer-causal-drawer__empty">该史事尚缺可核验的因果凭证。</p>
          )}

          {event.consequence ? (
            <footer className="observer-causal-drawer__consequence">
              <span>后续影响</span>
              <p>{event.consequence}</p>
            </footer>
          ) : null}

          {event.subjects?.length ? (
            <section className="observer-causal-subjects observer-causal-subjects--next" aria-label="接着查看相关人物、家族与政权">
              <span><UsersRound size={13} aria-hidden="true" />接着看这些人</span>
              <p>打开档案可关注后续；人物还可从其处入世。</p>
              <div>
                {event.subjects.map((subject) => (
                  <button key={`${subject.kind}-${subject.id}`} type="button" onClick={() => onSelectSubject?.(subject.kind, subject.id)}>
                    <strong>{subject.label}</strong><small>{subject.detail}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
