import { Bookmark, BookmarkCheck, ChevronDown, ScrollText } from 'lucide-react';
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
          <span>世事正在演变</span>
          <h2 id="observer-leads-title">眼下大事</h2>
          <small>一条主线 · 两则侧闻</small>
        </div>
        {onOpenSituations && situationCount > 0 ? (
          <button
            type="button"
            className="observer-leads__situation-shortcut"
            data-situation-workbench-trigger="true"
            data-history-destination="situation"
            aria-label={`查看战事与朝局，共${situationCount}条`}
            onClick={() => onOpenSituations()}
          >
            {situationCount} 件
          </button>
        ) : null}
        <button
          type="button"
          className="observer-leads__mobile-toggle"
          data-testid="observer-leads-mobile-toggle"
          data-fully-expanded={mobileExpanded || undefined}
          aria-expanded={mobileOpen}
          aria-label={!mobileOpen ? '展开第一条观察线索' : mobileExpanded ? '收起观察线索' : '展开全部观察线索'}
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
        {leads.length === 0 ? (
          <li className="observer-leads__empty">
            眼下暂无值得单列的战事或朝局；推进一季，再看世事如何落笔。
          </li>
        ) : null}
        {leads.map((lead, index) => {
          const targetKey = observerLeadTargetKey(lead);
          const watchKey = observerLeadWatchKey(lead);
          const watched = watchedKeys.has(watchKey);
          const selected = selectedKey === targetKey;
          return (
            <li
              key={lead.id}
              data-source={lead.source}
              data-lead-id={lead.id}
              data-situation-id={lead.situationId ?? undefined}
              data-display-mode={lead.displayMode}
              data-selected={selected || undefined}
              data-watched={watched || undefined}
              data-testid="observer-lead"
              data-story-rank={index === 0 ? 'main' : 'side'}
            >
              <button
                type="button"
                className="observer-leads__inspect"
                aria-label={`${index === 0 ? '主线' : '侧闻'}，${lead.label}：${lead.question}。${lead.evidence.join('；')}。打开详情`}
                onClick={() => {
                  setMobileExpanded(false);
                  setMobileOpen(false);
                  onInspect(lead);
                }}
              >
                <span className="observer-leads__meta">
                  <span>{index === 0 ? '主线' : '侧闻'} · {lead.label}</span>
                </span>
                <strong data-testid="observer-lead-question">{lead.question}</strong>
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
                    ? `取消关注此事：${lead.question}`
                    : `取消关注这条线：${lead.question}`
                  : lead.situationId
                    ? `关注此事：${lead.question}`
                    : `关注这条线：${lead.question}`}
                title={watched ? '取消关注' : '关注此事'}
                onClick={() => onToggleWatch(lead)}
              >
                {watched ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
                <span>{watched ? '已关注' : '关注'}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="observer-leads__footer">
        <p>{leads.length ? '关注一件事，推进下一季；有新动向时会停下。' : '没有值得说的事，就不凑数。'}</p>
      </footer>
    </aside>
  );
}
