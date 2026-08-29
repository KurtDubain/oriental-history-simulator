import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import '../styles/roster-panel.css';

export interface RosterItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  accent?: string;
  alert?: boolean;
}

export interface RosterSection {
  id: string;
  label: string;
  count: number;
  alertCount?: number;
}

interface RosterPanelProps {
  title: string;
  eyebrow: string;
  items: RosterItem[];
  selectedId?: string | null;
  emptyMessage: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  sections?: readonly RosterSection[];
  activeSection?: string;
  onSectionChange?: (id: string) => void;
  searchPlaceholder?: string;
}

export function RosterPanel({
  title,
  eyebrow,
  items,
  selectedId,
  emptyMessage,
  onSelect,
  onClose,
  sections,
  activeSection,
  onSectionChange,
  searchPlaceholder = '检索名号或身份',
}: RosterPanelProps) {
  const pageSize = 120;
  const titleId = useId();
  const collectionId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return items;
    return items.filter((item) => `${item.title} ${item.subtitle} ${item.meta}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [items, query]);
  const visibleItems = filteredItems.slice(0, visibleCount);
  const activeTabId = sections?.some((section) => section.id === activeSection)
    ? `${collectionId}-${activeSection}`
    : undefined;

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [query]);

  useEffect(() => {
    setQuery('');
    setVisibleCount(pageSize);
    listRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSectionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!sections?.length) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = sections.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextSection = sections[nextIndex];
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]
      ?.focus();
    onSectionChange?.(nextSection.id);
  };

  return (
    <section
      className="roster-panel"
      aria-labelledby={titleId}
      data-has-sections={sections?.length ? 'true' : undefined}
      data-roster-scope={sections?.length ? 'powers' : 'people'}
      data-active-section={activeSection}
      data-roster-title={title}
    >
      <header className="roster-panel__header">
        <div>
          <span>{eyebrow}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={`关闭${title}`}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {sections?.length ? (
        <nav className="roster-panel__sections" role="tablist" aria-label="势力分类">
          {sections.map((section) => {
            const selected = section.id === activeSection;
            return (
              <button
                id={`${collectionId}-${section.id}`}
                key={section.id}
                type="button"
                role="tab"
                aria-controls={collectionId}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-roster-section={section.id}
                data-alert={section.alertCount ? 'true' : undefined}
                onClick={() => onSectionChange?.(section.id)}
                onKeyDown={(event) => handleSectionKeyDown(event, sections.indexOf(section))}
              >
                <span>{section.label}</span>
                <small>{section.count}</small>
                {section.alertCount ? <b aria-label={`${section.alertCount} 条战事消息`}>{section.alertCount > 9 ? '9+' : section.alertCount}</b> : null}
              </button>
            );
          })}
        </nav>
      ) : null}

      <div
        id={collectionId}
        className="roster-panel__collection"
        role={sections?.length ? 'tabpanel' : undefined}
        aria-labelledby={activeTabId}
      >
        <label className="roster-panel__search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`检索${title}`} />
        </label>

        {filteredItems.length ? (
          <ol ref={listRef} className="roster-panel__list">
            {visibleItems.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-selected={selectedId === item.id || undefined}
                  data-roster-id={item.id}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="roster-panel__rank">{String(index + 1).padStart(2, '0')}</span>
                  <span className="roster-panel__accent" style={{ background: item.accent }} aria-hidden="true" />
                  <span className="roster-panel__body">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <span className="roster-panel__meta" data-alert={item.alert || undefined}>{item.meta}</span>
                </button>
              </li>
            ))}
            {visibleCount < filteredItems.length ? (
              <li className="roster-panel__more">
                <button type="button" onClick={() => setVisibleCount((count) => count + pageSize)}>
                  继续展卷 · 尚有 {filteredItems.length - visibleCount} 条
                </button>
              </li>
            ) : null}
          </ol>
        ) : (
          <p className="roster-panel__empty">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
}
