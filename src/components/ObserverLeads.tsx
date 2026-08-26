import { Bookmark, BookmarkCheck, ChevronDown, Crosshair, ScrollText } from 'lucide-react';
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
          <span>现在看什么</span>
          <h2 id="observer-leads-title">当世三问</h2>
          <small>一人 · 一国 · 一条矛盾</small>
        </div>
        {onOpenSituations && situationCount > 0 ? (
          <button
            type="button"
            className="observer-leads__situation-shortcut"
            aria-label={`展开局势全卷，共${situationCount}条可阅局势`}
            onClick={onOpenSituations}
          >
            卷 {situationCount}
          </button>
        ) : null}
        <button
          type="button"
          className="observer-leads__mobile-toggle"
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
          const watched = watchedKeys.has(targetKey);
          const selected = selectedKey === targetKey;
          return (
            <li
              key={lead.id}
              data-slot={lead.slot}
              data-stage={lead.stage}
              data-selected={selected || undefined}
              data-watched={watched || undefined}
              data-testid="observer-lead"
            >
              <button
                type="button"
                className="observer-leads__inspect"
                aria-label={`${lead.label}：${lead.question}。${lead.evidence.join('；')}。下一观察：${lead.nextSignal}。查看对象`}
                onClick={() => onInspect(lead)}
              >
                <span className="observer-leads__meta">
                  <span>{lead.label}</span>
                  <span data-stage={lead.stage}>{lead.stage}</span>
                  <span>张力 {lead.tension}</span>
                </span>
                <strong>{lead.question}</strong>
                <span className="observer-leads__evidence">{lead.evidence.join(' · ')}</span>
                <span className="observer-leads__next"><Crosshair size={11} aria-hidden="true" />接下来 · {lead.nextSignal}</span>
              </button>
              <button
                type="button"
                className="observer-leads__watch"
                data-watched={watched || undefined}
                aria-pressed={watched}
                aria-label={watched ? `取消关注：${lead.question}` : `关注这条线：${lead.question}`}
                title={watched ? '取消关注' : '关注此线'}
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
        {onOpenSituations && situationCount > 0 ? (
          <button type="button" onClick={onOpenSituations}>
            <ScrollText size={13} aria-hidden="true" />
            <span>展开局势全卷</span>
            <strong>{situationCount}</strong>
          </button>
        ) : <p>选一条关注，推进下一季；有动向时会提醒并停下。</p>}
      </footer>
    </aside>
  );
}
