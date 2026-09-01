import { Bookmark, BookmarkCheck, ChevronDown, Clock3, ScrollText } from 'lucide-react';
import { useState } from 'react';
import type { ObserverLead } from '../view/observer-leads';
import '../styles/observer-leads.css';

export interface ObserverLeadsProps {
  leads: readonly ObserverLead[];
  watchedKeys: ReadonlySet<string>;
  selectedKey?: string | null;
  situationCount?: number;
  onInspect: (lead: ObserverLead) => void;
  onToggleWatch: (lead: ObserverLead) => void;
  onOpenSituations?: () => void;
}

export function observerLeadTargetKey(lead: ObserverLead): string {
  return `${lead.target.kind}:${lead.target.id}`;
}

export function observerLeadWatchKey(lead: ObserverLead): string {
  if (lead.situationId) return `situation:${lead.situationId}`;
  return observerLeadTargetKey(lead);
}

export function ObserverLeads({
  leads,
  watchedKeys,
  selectedKey = null,
  situationCount = 0,
  onInspect,
  onToggleWatch,
  onOpenSituations,
}: ObserverLeadsProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  if (!leads.length) return null;

  return (
    <aside
      className="observer-leads"
      data-observer-leads="true"
      data-mobile-open={mobileOpen || undefined}
      data-mobile-expanded={mobileExpanded || undefined}
      aria-labelledby="observer-leads-title"
    >
      <header className="observer-leads__header">
        <span className="observer-leads__seal" aria-hidden="true"><ScrollText size={16} strokeWidth={1.6} /></span>
        <div>
          <span>观察线索 · 现在看什么</span>
          <h2 id="observer-leads-title">当世三问</h2>
          <small>一人 · 一国 · 一条矛盾</small>
        </div>
        {onOpenSituations && situationCount > 0 ? (
          <button
            type="button"
            className="observer-leads__situation-shortcut"
            data-situation-workbench-trigger="true"
            data-history-destination="situation"
            aria-label={`查看持续局势，共${situationCount}条可阅局势`}
            onClick={() => onOpenSituations()}
          >
            {situationCount} 条局势
          </button>
        ) : null}
        <button
          type="button"
          className="observer-leads__mobile-toggle"
          data-testid="observer-leads-mobile-toggle"
          data-fully-expanded={mobileExpanded || undefined}
          aria-expanded={mobileOpen}
          aria-label={!mobileOpen ? '展开第一条观察线索' : mobileExpanded ? '收起观察线索' : '展开全部三条观察线索'}
          onClick={() => {
            if (!mobileOpen) {
              setMobileOpen(true);
              return;
            }
            if (!mobileExpanded) {
              setMobileExpanded(true);
              return;
            }
            setMobileExpanded(false);
            setMobileOpen(false);
          }}
        >
          <span>{!mobileOpen ? '看一条' : mobileExpanded ? '收起' : `全部 ${leads.length}`}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </header>

      <ol className="observer-leads__list">
        {leads.map((lead) => {
          const targetKey = observerLeadTargetKey(lead);
          const watchKey = observerLeadWatchKey(lead);
          const watched = watchedKeys.has(watchKey);
          const selected = selectedKey === targetKey;
          return (
            <li
              key={lead.id}
              data-slot={lead.slot}
              data-source={lead.source ?? 'fallback'}
              data-lead-id={lead.id}
              data-situation-id={lead.situationId ?? undefined}
              data-display-mode={lead.displayMode ?? 'fallback'}
              data-selected={selected || undefined}
              data-watched={watched || undefined}
              data-testid="observer-lead"
            >
              <button
                type="button"
                className="observer-leads__inspect"
                aria-label={`${lead.label}：${lead.question}。${lead.evidence.join('；')}。${lead.situationId ? '打开局势卷宗' : '查看对象'}`}
                onClick={() => onInspect(lead)}
              >
                <span className="observer-leads__meta">
                  <span>{lead.label}</span>
                </span>
                <strong data-testid="observer-lead-question">{lead.question}</strong>
                {lead.situationId ? (
                  <span className="observer-leads__continuity" data-testid="observer-lead-change">
                    <Clock3 size={10} aria-hidden="true" />
                    始于{lead.startedLabel} · 延续{lead.trackingTurns ?? 1}季 · {lead.recentChange}
                  </span>
                ) : null}
                <span className="observer-leads__evidence" data-testid="observer-lead-fact">{lead.evidence.join(' · ')}</span>
              </button>
              <button
                type="button"
                className="observer-leads__watch"
                data-testid="observer-lead-watch"
                data-watch-key={watchKey}
                data-watch-kind={lead.situationId ? 'situation' : lead.target.kind}
                data-watched={watched || undefined}
                aria-pressed={watched}
                aria-label={watched
                  ? lead.situationId
                    ? `取消关注局势：${lead.question}`
                    : `取消关注这条线：${lead.question}`
                  : lead.situationId
                    ? `关注局势：${lead.question}`
                    : `关注这条线：${lead.question}`}
                title={watched ? lead.situationId ? '取消关注局势' : '取消关注' : lead.situationId ? '关注此局势' : '关注此线'}
                onClick={() => onToggleWatch(lead)}
              >
                {watched ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
                <span>{watched ? lead.situationId ? '局势已关注' : '已关注' : lead.situationId ? '关注局势' : '关注'}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="observer-leads__footer">
        <p>选一条关注，推进下一季；有动向时会提醒并停下。</p>
      </footer>
    </aside>
  );
}
