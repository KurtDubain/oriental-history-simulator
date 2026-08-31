import {
  Activity,
  Anchor,
  BookOpenText,
  ChevronRight,
  GitBranch,
  Landmark,
  MapPin,
  Route,
  Sparkles,
  ScrollText,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useDialogLayer } from './useDialogLayer';
import '../styles/historical-archive.css';

export type ArchiveEntityKind =
  | 'country'
  | 'family'
  | 'person'
  | 'region'
  | 'seaZone'
  | 'fleet'
  | 'tradeCorridor'
  | 'practice'
  | 'outbreak'
  | 'migration';

export interface ArchiveFact {
  label: string;
  value: string;
}

export interface ArchiveChapter {
  id: string;
  title: string;
  paragraphs: string[];
}

export interface ArchiveRecord {
  id: string;
  date: string;
  title: string;
  summary: string;
  importance: number;
  eventId?: string | null;
}

export interface ArchiveLink {
  id: string;
  kind: ArchiveEntityKind;
  label: string;
  detail: string;
}

export interface ArchiveDossier {
  id: string;
  kind: ArchiveEntityKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  lead: string;
  facts: ArchiveFact[];
  chapters: ArchiveChapter[];
  records: ArchiveRecord[];
  links: ArchiveLink[];
}

interface HistoricalArchiveProps {
  open: boolean;
  dossier: ArchiveDossier | null;
  onClose: () => void;
  onSelectEntity?: (kind: ArchiveEntityKind, id: string) => void;
  onSelectEvent?: (eventId: string) => void;
  returnFocusTo?: HTMLElement | null;
  shouldRestoreFocus?: () => boolean;
}

const KIND_ICON = {
  country: Landmark,
  family: UsersRound,
  person: UserRound,
  region: MapPin,
  seaZone: Anchor,
  fleet: Anchor,
  tradeCorridor: Route,
  practice: Sparkles,
  outbreak: Activity,
  migration: Route,
} satisfies Record<ArchiveEntityKind, typeof Landmark>;

const INITIAL_RECORD_COUNT = 36;

export function HistoricalArchive({
  open,
  dossier,
  onClose,
  onSelectEntity,
  onSelectEvent,
  returnFocusTo,
  shouldRestoreFocus,
}: HistoricalArchiveProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [visibleRecordCount, setVisibleRecordCount] = useState(INITIAL_RECORD_COUNT);

  useEffect(() => {
    if (open) setVisibleRecordCount(INITIAL_RECORD_COUNT);
  }, [dossier?.id, open]);

  useDialogLayer({
    open: open && Boolean(dossier),
    containerRef: dialogRef,
    initialFocusRef: closeRef,
    onClose,
    returnFocusTo,
    shouldRestoreFocus,
  });

  if (!open || !dossier) return null;
  const KindIcon = KIND_ICON[dossier.kind];
  const visibleRecords = dossier.records.slice(0, visibleRecordCount);
  const hiddenRecordCount = Math.max(0, dossier.records.length - visibleRecords.length);

  return (
    <div
      className="history-archive-layer"
      data-history-layer="entity"
      data-history-scope={dossier.kind}
      data-history-scope-id={dossier.id}
    >
      <button
        type="button"
        className="history-archive-layer__backdrop observer-dialog-backdrop"
        aria-label="关闭当前史卷"
        tabIndex={-1}
        onClick={onClose}
      />
      <article
        ref={dialogRef}
        className="history-archive observer-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="history-archive__masthead">
          <div className="history-archive__seal" aria-hidden="true"><KindIcon size={21} /></div>
          <div className="history-archive__title">
            <span>{dossier.eyebrow}</span>
            <h2 id={titleId}>{dossier.title}</h2>
            <p>{dossier.subtitle}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={`关闭${dossier.title}`}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="history-archive__facts" aria-label="档案提要">
          {dossier.facts.map((fact) => (
            <div key={`${fact.label}-${fact.value}`}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </div>

        <div className="history-archive__scroll">
          <main className="history-archive__article">
            <section className="history-archive__chronology" aria-labelledby="archive-chronology-title">
              <div className="history-archive__chapter-mark" aria-hidden="true"><ScrollText size={15} /></div>
              <div>
                <h3 id="archive-chronology-title">纪年 · 截至本季</h3>
                {dossier.records.length ? (
                  <>
                    <ol>
                      {visibleRecords.map((record) => (
                        <li key={record.id} data-major={record.importance >= 4 || undefined} data-history-entry-id={record.id}>
                          <span>{record.date}</span>
                          {record.eventId && onSelectEvent ? (
                            <button type="button" data-event-id={record.eventId} onClick={() => onSelectEvent(record.eventId!)}>
                              <strong>{record.title}</strong>
                              <small>{record.summary}</small>
                              <span className="history-archive__cause"><GitBranch size={12} aria-hidden="true" />为何如此</span>
                            </button>
                          ) : (
                            <div>
                              <strong>{record.title}</strong>
                              <small>{record.summary}</small>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                    {hiddenRecordCount > 0 ? (
                      <button
                        type="button"
                        className="history-archive__more-records"
                        onClick={() => setVisibleRecordCount((count) => count + INITIAL_RECORD_COUNT)}
                      >
                        继续展卷 · 尚有 {hiddenRecordCount} 条
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="history-archive__empty">尚无可系于确切年月的记载。</p>
                )}
              </div>
            </section>

            <p className="history-archive__lead">{dossier.lead}</p>

            {dossier.chapters.map((chapter, index) => (
              <section key={chapter.id} aria-labelledby={`archive-chapter-${chapter.id}`}>
                <div className="history-archive__chapter-mark" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div>
                  <h3 id={`archive-chapter-${chapter.id}`}>{chapter.title}</h3>
                  {chapter.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={`${chapter.id}-${paragraphIndex}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </main>

          <aside className="history-archive__index" aria-label="相关人物与势力">
            <span><BookOpenText size={13} aria-hidden="true" />卷中人事</span>
            {dossier.links.length ? (
              <ul>
                {dossier.links.map((link) => (
                  <li key={`${link.kind}-${link.id}`}>
                    <button
                      type="button"
                      data-entity-kind={link.kind}
                      data-entity-id={link.id}
                      onClick={() => onSelectEntity?.(link.kind, link.id)}
                    >
                      <strong>{link.label}</strong>
                      <small>{link.detail}</small>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>此卷暂未牵连其他可查对象。</p>
            )}
          </aside>
        </div>
      </article>
    </div>
  );
}
