import {
  BookOpenText,
  ChevronDown,
  FileClock,
  GitBranch,
  Landmark,
  ListTree,
  ScrollText,
  ShieldAlert,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ArchiveEntityKind } from './HistoricalArchive';
import type {
  SituationDetailProjection,
  SituationWorkbenchProjection,
} from '../view/situation-detail';
import type { SituationParticipantGroupKey } from '../view/situation-snapshot';
import { useDialogLayer } from './useDialogLayer';
import '../styles/situation-workbench.css';

export interface SituationWorkbenchProps {
  open: boolean;
  projection: SituationWorkbenchProjection | null;
  onClose: () => void;
  onSelectSituation: (situationId: string) => void;
  onSelectEntity: (kind: ArchiveEntityKind, id: string) => void;
  onSelectHistoryEvent: (eventId: string) => void;
  returnFocusTo?: HTMLElement | null;
  shouldRestoreFocus?: () => boolean;
}

const PARTICIPANT_KIND: Partial<Record<SituationParticipantGroupKey, ArchiveEntityKind>> = {
  coreCharacterIds: 'person',
  supportingCharacterIds: 'person',
  opposingCharacterIds: 'person',
  familyIds: 'family',
  polityIds: 'country',
  regionIds: 'region',
  fleetIds: 'fleet',
};

function phaseIndex(phase: SituationDetailProjection['phase']): number {
  return phase === 'critical' ? 3 : phase === 'active' ? 2 : 1;
}

function ParticipantIcon({ kind }: { kind: SituationParticipantGroupKey }) {
  if (kind === 'familyIds') return <UsersRound size={14} aria-hidden="true" />;
  if (kind === 'polityIds' || kind === 'factionIds') return <Landmark size={14} aria-hidden="true" />;
  if (kind === 'coreCharacterIds' || kind === 'supportingCharacterIds' || kind === 'opposingCharacterIds') {
    return <UserRound size={14} aria-hidden="true" />;
  }
  return <ShieldAlert size={14} aria-hidden="true" />;
}

export function SituationWorkbench({
  open,
  projection,
  onClose,
  onSelectSituation,
  onSelectEntity,
  onSelectHistoryEvent,
  returnFocusTo,
  shouldRestoreFocus,
}: SituationWorkbenchProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const [mobileDirectoryOpen, setMobileDirectoryOpen] = useState(false);
  const hasSelectedSituation = Boolean(projection?.selected);

  useDialogLayer({
    open: open && hasSelectedSituation,
    containerRef: dialogRef,
    initialFocusRef: titleRef,
    onClose,
    returnFocusTo,
    shouldRestoreFocus,
  });

  useEffect(() => {
    if (!open || !projection?.selected) return undefined;
    readerRef.current?.scrollTo({ top: 0 });
    setMobileDirectoryOpen(false);
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, projection?.selected?.id]);

  useEffect(() => {
    if (!readerRef.current) return;
    readerRef.current.inert = mobileDirectoryOpen;
  }, [mobileDirectoryOpen]);

  if (!open || !projection?.selected) return null;
  const detail = projection.selected;
  const currentPhase = phaseIndex(detail.phase);
  const directoryItems = [...projection.open, ...projection.recentResolved];

  return (
    <div
      className="situation-workbench-layer"
      data-history-layer="situation"
      data-situation-id={detail.id}
    >
      <button
        type="button"
        className="situation-workbench-layer__backdrop observer-dialog-backdrop"
        tabIndex={-1}
        aria-label="关闭持续局势"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="situation-workbench observer-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-status={detail.status}
        data-mobile-directory={mobileDirectoryOpen || undefined}
      >
        <header className="situation-workbench__masthead">
          <span className="situation-workbench__seal" aria-hidden="true"><ScrollText size={20} /></span>
          <div>
            <span>跨季追踪 · 事实卷宗</span>
            <strong>持续局势</strong>
            <small id={descriptionId}>先看眼下局面，再沿着转折查清前因后果。</small>
          </div>
          <button
            type="button"
            className="situation-workbench__directory-toggle"
            aria-expanded={mobileDirectoryOpen}
            onClick={() => setMobileDirectoryOpen((value) => !value)}
          >
            <ListTree size={16} aria-hidden="true" />切换局势<ChevronDown size={14} aria-hidden="true" />
          </button>
          <button type="button" className="situation-workbench__close" onClick={onClose} aria-label="关闭持续局势">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="situation-workbench__body">
          <aside className="situation-workbench__directory" aria-label="局势目录">
            <div className="situation-workbench__directory-heading">
              <span>发展中</span>
              <strong>{projection.openCount}</strong>
            </div>
            <ol>
              {directoryItems.map((item, index) => (
                <li key={item.id} data-resolved={item.status === 'resolved' || undefined}>
                  {index === projection.open.length && projection.recentResolved.length ? (
                    <div className="situation-workbench__directory-break">
                      <span>近来结案</span><strong>{projection.resolvedCount}</strong>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-situation-id={item.id}
                    data-selected={item.id === projection.selectedId || undefined}
                    aria-current={item.id === projection.selectedId ? 'true' : undefined}
                    onClick={() => onSelectSituation(item.id)}
                  >
                    <span>{item.typeLabel} · {item.status === 'resolved' ? '结案' : item.phaseLabel}</span>
                    <strong>{item.title}</strong>
                    <small>{item.dateLabel}</small>
                  </button>
                </li>
              ))}
            </ol>
            {projection.archivedResolvedCount ? (
              <p>另有 {projection.archivedResolvedCount} 条旧案已折入冷档摘要，不伪造详情。</p>
            ) : null}
          </aside>

          <article
            ref={readerRef}
            className="situation-workbench__reader"
            aria-hidden={mobileDirectoryOpen || undefined}
          >
            <header className="situation-workbench__title-block">
              <div className="situation-workbench__kicker">
                <span>{detail.typeLabel}</span>
                <span>{detail.status === 'resolved' ? '已结案' : `${detail.phaseLabel} · ${detail.momentumLabel}`}</span>
                <span>{detail.startDateLabel}起</span>
              </div>
              <h2 id={titleId} ref={titleRef} tabIndex={-1}>{detail.title}</h2>
              {detail.status === 'resolved' ? <span className="situation-workbench__resolved-stamp" aria-label="已结案">结案</span> : null}
              <div className="situation-workbench__phase" aria-label={`当前为${detail.phaseLabel}阶段`}>
                {['萌芽', '发展', '临界'].map((label, index) => (
                  <span key={label} data-reached={index + 1 <= currentPhase || undefined}>{label}</span>
                ))}
              </div>
            </header>

            <section className="situation-workbench__reading" aria-labelledby={`${titleId}-reading`}>
              <div className="situation-workbench__section-heading">
                <BookOpenText size={15} aria-hidden="true" />
                <h3 id={`${titleId}-reading`}>眼下局面</h3>
              </div>
              {detail.playerSummary.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}

              {detail.outcome ? (
                <div className="situation-workbench__outcome">
                  <span>结案所见</span>
                  <strong>{detail.outcome.label}</strong>
                  <p>{detail.outcome.summary}</p>
                  <small>{detail.startDateLabel} — {detail.endDateLabel} · 历时 {detail.durationLabel}</small>
                </div>
              ) : null}

              <dl className="situation-workbench__now-next">
                <div>
                  <dt>最近转折</dt>
                  <dd>{detail.currentChange}</dd>
                </div>
                <div>
                  <dt>后续看点</dt>
                  <dd>{detail.nextWatch}</dd>
                </div>
              </dl>
            </section>

            {detail.participants.length ? (
              <section className="situation-workbench__participants" aria-labelledby={`${titleId}-participants`}>
                <div className="situation-workbench__section-heading">
                  <UsersRound size={15} aria-hidden="true" />
                  <h3 id={`${titleId}-participants`}>卷中人物与势力</h3>
                </div>
                <dl>
                  {detail.participants.map((group) => {
                    const selectableKind = PARTICIPANT_KIND[group.key];
                    return (
                      <div key={group.key}>
                        <dt><ParticipantIcon kind={group.key} />{group.label}</dt>
                        <dd>
                          {group.entities.map((entity) => selectableKind ? (
                            <button key={entity.id} type="button" onClick={() => onSelectEntity(selectableKind, entity.id)}>
                              {entity.label}
                            </button>
                          ) : <span key={entity.id}>{entity.label}</span>)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ) : null}

            <section className="situation-workbench__timeline" aria-labelledby={`${titleId}-timeline`}>
              <div className="situation-workbench__section-heading">
                <FileClock size={15} aria-hidden="true" />
                <h3 id={`${titleId}-timeline`}>局势沿革</h3>
                <span>保留 {detail.timeline.length} 条</span>
              </div>
              <ol>
                {detail.timeline.map((entry) => (
                  <li key={entry.id} data-kind={entry.kind} data-history-entry-id={entry.id}>
                    <time>{entry.dateLabel}</time>
                    <div>
                      <strong>{entry.label}{entry.phaseLabel ? ` · ${entry.phaseLabel}` : ''}</strong>
                      <p>{entry.summary}</p>
                      {entry.historyEventIds[0] ? (
                        <button type="button" data-event-id={entry.historyEventIds[0]} onClick={() => onSelectHistoryEvent(entry.historyEventIds[0])}>
                          <GitBranch size={13} aria-hidden="true" />为何如此
                        </button>
                      ) : <small>只有事实凭证，尚无独立史册条目</small>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {detail.status === 'resolved' ? (
              <section className="situation-workbench__consequences" aria-labelledby={`${titleId}-consequences`}>
                <div className="situation-workbench__section-heading">
                  <Landmark size={15} aria-hidden="true" />
                  <h3 id={`${titleId}-consequences`}>结案后果</h3>
                </div>
                {detail.consequences.length ? (
                  <dl>
                    {detail.consequences.map((entry) => (
                      <div key={entry.id}>
                        <dt>{entry.entityLabel} · {entry.fieldLabel}</dt>
                        <dd><span>{entry.beforeLabel}</span><i aria-hidden="true">→</i><strong>{entry.afterLabel}</strong></dd>
                      </div>
                    ))}
                  </dl>
                ) : <p>本案没有可展示的直接状态差量。</p>}
                <small>{detail.consequenceCoverage}</small>
              </section>
            ) : null}

            <details className="situation-workbench__evidence">
              <summary><GitBranch size={15} aria-hidden="true" /><span>所据史实</span><small>{detail.evidence.length} 条记录</small></summary>
              <div className="situation-workbench__drivers">
                {detail.publicDrivers.map((driver) => (
                  <p key={driver.key} data-direction={driver.direction}>
                    <span>{driver.direction === 'restrains' ? '约束' : '推动'}</span>
                    <strong>{driver.label}</strong>
                  </p>
                ))}
              </div>
              <ol className="situation-workbench__fact-list">
                {detail.evidence.map((fact) => (
                  <li key={fact.id} data-history-entry-id={fact.id}>
                    <time>{fact.dateLabel}</time>
                    <div>
                      <span>{fact.kindLabel}</span>
                      <strong>{fact.title}</strong>
                      <p>{fact.summary}</p>
                      {fact.stateDeltas.length ? (
                        <dl>
                          {fact.stateDeltas.map((delta) => (
                            <div key={`${delta.entityType}:${delta.entityId}:${delta.field}`}>
                              <dt>{delta.entityLabel} · {delta.fieldLabel}</dt>
                              <dd>{delta.beforeLabel} → {delta.afterLabel}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {fact.historyEventIds[0] ? (
                        <button type="button" data-event-id={fact.historyEventIds[0]} onClick={() => onSelectHistoryEvent(fact.historyEventIds[0])}>
                          <GitBranch size={13} aria-hidden="true" />为何如此
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </details>

            <details className="situation-workbench__audit">
              <summary><ListTree size={15} aria-hidden="true" /><span>推演底账</span><small>演化依据 · 默认收起</small></summary>
              <div>
                <p>{detail.audit.randomness}</p>
                <dl>
                  <div><dt>局势编号</dt><dd>{detail.audit.situationId}</dd></div>
                  <div><dt>类型 / 范围</dt><dd>{detail.audit.situationType} / {detail.audit.scopeKey}</dd></div>
                  <div><dt>当前张力 / 势头</dt><dd>{detail.tension} / {detail.momentum}</dd></div>
                  <div><dt>形成时压力</dt><dd>{detail.audit.startSnapshot.pressure}</dd></div>
                  <div><dt>形成时人物摘要</dt><dd>{detail.audit.startSnapshot.participantDigest}</dd></div>
                  <div><dt>形成时证据摘要</dt><dd>{detail.audit.startSnapshot.evidenceDigest}</dd></div>
                </dl>
                {detail.audit.template ? (
                  <p className="situation-workbench__audit-rule">
                    formation {detail.audit.template.formationThreshold} · active {detail.audit.template.activeEnterThreshold}/{detail.audit.template.activeExitThreshold} · critical {detail.audit.template.criticalEnterThreshold}/{detail.audit.template.criticalExitThreshold} · resolution {detail.audit.template.resolutionThreshold}
                  </p>
                ) : null}
                <ul>
                  {detail.audit.signals.map((signal) => (
                    <li key={signal.key}>
                      <strong>{signal.key}</strong>
                      <span>{signal.role} · contribution {signal.contribution}</span>
                      {signal.refs.map((ref, index) => (
                        <code key={`${signal.key}:${index}`}>{ref.kind === 'fact' ? ref.factId : `${ref.entityType}:${ref.entityId}.${ref.field}=${String(ref.value)}`}</code>
                      ))}
                    </li>
                  ))}
                </ul>
                {detail.audit.coverageNotes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </details>
          </article>
        </div>
      </section>
    </div>
  );
}
