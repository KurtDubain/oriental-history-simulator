import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import '../styles/roster-panel.css';

export interface RosterItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  accent?: string;
  alert?: boolean;
}

interface RosterPanelProps {
  title: string;
  eyebrow: string;
  items: RosterItem[];
  selectedId?: string | null;
  emptyMessage: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function RosterPanel({
  title,
  eyebrow,
  items,
  selectedId,
  emptyMessage,
  onSelect,
  onClose,
}: RosterPanelProps) {
  const pageSize = 120;
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return items;
    return items.filter((item) => `${item.title} ${item.subtitle} ${item.meta}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [items, query]);
  const visibleItems = filteredItems.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [query]);

  return (
    <section className="roster-panel" aria-labelledby="roster-panel-title" data-roster-title={title}>
      <header className="roster-panel__header">
        <div>
          <span>{eyebrow}</span>
          <h2 id="roster-panel-title">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={`关闭${title}`}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <label className="roster-panel__search">
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索名号或身份" aria-label={`检索${title}`} />
      </label>

      {filteredItems.length ? (
        <ol className="roster-panel__list">
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
    </section>
  );
}
