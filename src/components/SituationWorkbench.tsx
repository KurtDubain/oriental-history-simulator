import {
  BookOpenText,
  ChevronDown,
  FileClock,
  GitBranch,
  Landmark,
  ListTree,
  ScrollText,
  ShieldAlert,
  Star,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ArchiveEntityKind } from './HistoricalArchive';
import type {
  SituationWorkbenchProjection,
} from '../view/situation-detail';
import type { CourtFactionTarget } from '../view/observer-navigation';
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
  onSelectCourtFaction?: (target: CourtFactionTarget) => void;
  isWatched?: boolean;
  onToggleWatch?: () => void;
  onShowWarMap?: () => void;
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
  onSelectCourtFaction,
  isWatched = false,
  onToggleWatch,
  onShowWarMap,
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
            <small id={descriptionId}>先看发生过什么，再沿着人物与史实查清前因后果。</small>
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
              <span>未结案</span>
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
                    <span>{item.typeLabel} · {item.status === 'resolved' ? '已结案' : '未结案'}</span>
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
                <span>{detail.status === 'resolved' ? '已结案' : '未结案'}</span>
                <span>{detail.startDateLabel}起</span>
              </div>
              <h2 id={titleId} ref={titleRef} tabIndex={-1}>{detail.title}</h2>
              {detail.status === 'resolved' ? <span className="situation-workbench__resolved-stamp" aria-label="已结案">结案</span> : null}
              <div className="situation-workbench__progress-row">
                {detail.type === 'war_progress' && onShowWarMap ? (
                  <button type="button" className="situation-workbench__war-map" onClick={onShowWarMap}>
                    <ShieldAlert size={14} aria-hidden="true" />回到舆图看战线
                  </button>
                ) : null}
                {detail.status === 'open' && onToggleWatch ? (
                  <button
                    type="button"
                    className="situation-workbench__watch"
                    data-watched={isWatched || undefined}
                    aria-pressed={isWatched}
                    aria-label={isWatched ? `取消关注局势：${detail.title}` : `关注局势：${detail.title}`}
                    onClick={onToggleWatch}
                  >
                    <Star size={14} fill={isWatched ? 'currentColor' : 'none'} aria-hidden="true" />
                    {isWatched ? '已关注' : '关注局势'}
                  </button>
                ) : null}
              </div>
            </header>

            <section className="situation-workbench__reading" aria-labelledby={`${titleId}-reading`}>
              <div className="situation-workbench__section-heading">
                <BookOpenText size={15} aria-hidden="true" />
                <h3 id={`${titleId}-reading`}>最近实事</h3>
              </div>
              <p
                className="situation-workbench__current-action"
                data-testid="situation-current-action"
                data-narrative-scene-id={detail.scenes[0]?.id}
              >
                {detail.currentChange}
              </p>
              {detail.coreImpact ? (
                <div className="situation-workbench__core-impact" data-testid="situation-core-impact">
                  <strong>军政牵动</strong><p>{detail.coreImpact.summary}</p>
                  {detail.coreImpact.sourceEventId ? <button type="button" onClick={() => onSelectHistoryEvent(detail.coreImpact!.sourceEventId!)}>查看实据</button> : null}
                </div>
              ) : null}
              {detail.playerSummary.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}

              {detail.recentDeltas.length ? (
                <div className="situation-workbench__direct-change" data-testid="situation-direct-change">
                  <span>直接变化</span>
                  <dl>
                    {detail.recentDeltas.map((delta) => (
                      <div key={`${delta.factId}:${delta.entityType}:${delta.entityId}:${delta.field}`}>
                        <dt>{delta.entityLabel} · {delta.fieldLabel}</dt>
                        <dd aria-label={`由${delta.beforeLabel}变为${delta.afterLabel}`}>
                          <span>{delta.beforeLabel}</span><i aria-hidden="true">→</i><strong>{delta.afterLabel}</strong>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {detail.outcome ? (
                <div className="situation-workbench__outcome">
                  <span>结案所见</span>
                  <strong>{detail.outcome.label}</strong>
                  <p>{detail.outcome.summary}</p>
                  <small>{detail.startDateLabel} — {detail.endDateLabel} · 历时 {detail.durationLabel}</small>
                </div>
              ) : null}

            </section>

            {detail.participants.length ? (
              <details
                className="situation-workbench__participants"
                data-testid="situation-participants-disclosure"
              >
                <summary id={`${titleId}-participants`}>
                  <UsersRound size={15} aria-hidden="true" />
                  <span>相关各方</span>
                  <small>
                    <span className="situation-workbench__participants-collapsed">
                      {detail.participants.reduce((count, group) => count + group.entities.length, 0)} 项 · 点开查看
                    </span>
                    <span className="situation-workbench__participants-expanded">
                      {detail.participants.reduce((count, group) => count + group.entities.length, 0)} 项 · 收起
                    </span>
                  </small>
                </summary>
                <dl>
                  {detail.participants.map((group) => {
                    const selectableKind = PARTICIPANT_KIND[group.key];
                    return (
                      <div key={group.key}>
                        <dt><ParticipantIcon kind={group.key} />{group.label}</dt>
                        <dd>
                          {group.entities.map((entity) => {
                            const courtLink = group.key === 'factionIds'
                              ? detail.politicalFocus.find((link) => link.factionId === entity.id)
                              : undefined;
                            if (courtLink) {
                              return (
                                <button
                                  key={entity.id}
                                  type="button"
                                  className="situation-workbench__court-link"
                                  data-court-focus-polity={courtLink.polityId}
                                  data-court-focus-faction={courtLink.factionId}
                                  disabled={!courtLink.active || !onSelectCourtFaction}
                                  title={courtLink.detail}
                                  onClick={() => onSelectCourtFaction?.(courtLink)}
                                >
                                  <strong>{entity.label}</strong>
                                  <small>{courtLink.active ? '看其朝局' : '已退场'}</small>
                                </button>
                              );
                            }
                            if (selectableKind) {
                              return (
                                <button key={entity.id} type="button" onClick={() => onSelectEntity(selectableKind, entity.id)}>
                                  {entity.label}
                                </button>
                              );
                            }
                            return <span key={entity.id}>{entity.label}</span>;
                          })}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </details>
            ) : null}

            <section className="situation-workbench__timeline" aria-labelledby={`${titleId}-timeline`}>
              <div className="situation-workbench__section-heading">
                <FileClock size={15} aria-hidden="true" />
                <h3 id={`${titleId}-timeline`}>此前实事</h3>
                <span>{Math.max(0, detail.scenes.length - 1)} 件</span>
              </div>
              {detail.scenes.length > 1 ? (
                <ol>
                  {detail.scenes.slice(1).map((scene) => (
                    <li
                      key={scene.id}
                      data-kind="fact"
                      data-history-entry-id={scene.id}
                      data-narrative-scene-id={scene.id}
                    >
                      <time>{scene.dateLabel}</time>
                      <div>
                        <strong>{scene.title}</strong>
                        <p>{scene.summary}</p>
                        {scene.result ? <small>{scene.result}</small> : null}
                        {scene.historyEventIds[0] ? (
                          <button type="button" data-event-id={scene.historyEventIds[0]} onClick={() => onSelectHistoryEvent(scene.historyEventIds[0])}>
                            <GitBranch size={13} aria-hidden="true" />为何如此
                          </button>
                        ) : <small>事实已经入卷，尚无独立史册条目</small>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <p className="situation-workbench__empty-facts">尚无更早的具名行动或明确结果。</p>}
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
          </article>
        </div>
      </section>
    </div>
  );
}
