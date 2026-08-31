import { Search, SlidersHorizontal, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  applyRosterDiscovery,
  createRosterDiscoveryState,
  ROSTER_PAGE_SIZE,
  type RosterDiscoveryDefinition,
  type RosterDiscoveryState,
  type RosterItem,
  type RosterReason,
} from '../view/roster-discovery';
import '../styles/roster-panel.css';

export { applyRosterDiscovery } from '../view/roster-discovery';
export type {
  RosterDiscoveryDefinition,
  RosterDiscoveryResult,
  RosterDiscoveryState,
  RosterFilterDefinition,
  RosterItem,
  RosterOption,
  RosterReason,
  RosterReasonTarget,
  RosterScope,
  RosterSortDefinition,
} from '../view/roster-discovery';

export interface RosterSection {
  id: string;
  label: string;
  count: number;
  alertCount?: number;
}

interface RosterPanelProps {
  title: string;
  eyebrow: string;
  items: readonly RosterItem[];
  definition: RosterDiscoveryDefinition;
  state: RosterDiscoveryState;
  onStateChange: (state: RosterDiscoveryState) => void;
  visibleCount?: number;
  onShowMore?: () => void;
  selectedId?: string | null;
  emptyMessage?: string;
  onSelect: (id: string) => void;
  onReasonSelect: (reason: RosterReason) => void;
  onClose: () => void;
  sections?: readonly RosterSection[];
  activeSection?: string;
  onSectionChange?: (id: string) => void;
  searchPlaceholder?: string;
  suspended?: boolean;
  escapeBlocked?: boolean;
}

export function RosterPanel({
  title,
  eyebrow,
  items,
  definition,
  state,
  onStateChange,
  visibleCount: controlledVisibleCount,
  onShowMore,
  selectedId,
  emptyMessage,
  onSelect,
  onReasonSelect,
  onClose,
  sections,
  activeSection,
  onSectionChange,
  searchPlaceholder = '检索名号或身份',
  suspended = false,
  escapeBlocked = false,
}: RosterPanelProps) {
  const titleId = useId();
  const collectionId = useId();
  const controlsId = useId();
  const resultId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const [localVisibleCount, setLocalVisibleCount] = useState(ROSTER_PAGE_SIZE);
  const [controlsOpen, setControlsOpen] = useState(false);
  const usesControlledPagination = controlledVisibleCount !== undefined;
  const result = useMemo(
    () => applyRosterDiscovery(items, definition, state),
    [definition, items, state],
  );
  const visibleCount = controlledVisibleCount ?? localVisibleCount;
  const visibleItems = result.items.slice(0, visibleCount);
  const activeTabId = sections?.some((section) => section.id === activeSection)
    ? `${collectionId}-${activeSection}`
    : undefined;
  const conditionSignature = [
    activeSection ?? '',
    result.state.query,
    result.state.quickView,
    result.state.sort,
    ...definition.filters.map((filter) => result.state.filters[filter.id] ?? 'all'),
  ].join('\u0000');

  const closeControls = useCallback((restoreFocus: boolean) => {
    setControlsOpen(false);
    if (!restoreFocus) return;
    const focusToggle = () => filterToggleRef.current?.focus();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusToggle);
    else focusToggle();
  }, []);

  useEffect(() => {
    if (!usesControlledPagination) setLocalVisibleCount(ROSTER_PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  }, [conditionSignature, usesControlledPagination]);

  useEffect(() => {
    if (!suspended) return;
    setControlsOpen(false);
  }, [suspended]);

  useEffect(() => {
    if (suspended) return undefined;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (escapeBlocked) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (controlsOpen) {
        closeControls(true);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [closeControls, controlsOpen, escapeBlocked, onClose, suspended]);

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

  const updateState = (patch: Partial<RosterDiscoveryState>) => {
    onStateChange({ ...result.state, ...patch });
  };

  const updateFilter = (id: string, value: string) => {
    updateState({ filters: { ...result.state.filters, [id]: value } });
  };

  const clearConditions = () => {
    onStateChange(createRosterDiscoveryState());
  };

  return (
    <section
      className="roster-panel"
      aria-labelledby={titleId}
      data-has-sections={sections?.length ? 'true' : undefined}
      data-roster-scope={sections?.length ? 'powers' : 'people'}
      data-roster-directory={definition.scope}
      data-active-section={activeSection}
      data-roster-title={title}
      data-roster-state={suspended ? 'suspended' : 'active'}
      aria-hidden={suspended || undefined}
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
          {sections.map((section, index) => {
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
                onKeyDown={(event) => handleSectionKeyDown(event, index)}
              >
                <span>{section.label}</span>
                <small>{section.count}</small>
                {section.alertCount ? <b aria-label={`${section.alertCount} 条军情提醒`}>{section.alertCount > 9 ? '9+' : section.alertCount}</b> : null}
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
        aria-describedby={resultId}
      >
        <div className="roster-panel__discovery">
          <div className="roster-panel__query-row">
            <label className="roster-panel__search">
              <Search size={15} aria-hidden="true" />
              <input
                value={result.state.query}
                onChange={(event) => updateState({ query: event.target.value })}
                placeholder={searchPlaceholder}
                aria-label={`检索${title}`}
              />
            </label>
            <button
              ref={filterToggleRef}
              className="roster-panel__filter-toggle"
              type="button"
              aria-controls={controlsId}
              aria-expanded={controlsOpen}
              data-roster-filter-toggle
              onClick={() => setControlsOpen((open) => !open)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>筛选与排序</span>
              {result.activeFilterCount ? <b aria-label={`${result.activeFilterCount} 项条件`}>{result.activeFilterCount}</b> : null}
            </button>
          </div>

          <div className="roster-panel__result-bar">
            <p id={resultId} role="status" aria-live="polite" aria-atomic="true">
              {result.conditionSummary}
            </p>
            <button
              type="button"
              onClick={clearConditions}
              disabled={!result.activeFilterCount}
            >
              清除条件
            </button>
          </div>

          <div
            id={controlsId}
            className="roster-panel__controls"
            role="group"
            data-open={controlsOpen || undefined}
            data-roster-discovery-controls
            aria-label="筛选与排序"
          >
            {definition.quickViews.length > 1 ? (
              <label>
                <span>速览</span>
                <select
                  value={result.state.quickView}
                  onChange={(event) => updateState({ quickView: event.target.value })}
                >
                  {definition.quickViews.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            {definition.filters.map((filter) => (
              <label key={filter.id}>
                <span>{filter.label}</span>
                <select
                  value={result.state.filters[filter.id] ?? 'all'}
                  onChange={(event) => updateFilter(filter.id, event.target.value)}
                >
                  {filter.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            ))}
            <label>
              <span>排序</span>
              <select
                value={result.state.sort}
                onChange={(event) => updateState({ sort: event.target.value })}
              >
                {definition.sorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {result.matchedCount ? (
          <ol ref={listRef} className="roster-panel__list">
            {visibleItems.map((item, index) => (
              <li key={item.id}>
                <div className="roster-panel__entry">
                  <button
                    className="roster-panel__item"
                    type="button"
                    data-selected={selectedId === item.id || undefined}
                    aria-current={selectedId === item.id ? 'true' : undefined}
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
                  {item.reason ? (
                    <button
                      className="roster-panel__reason"
                      type="button"
                      data-roster-reason={item.reason.kind}
                      onClick={() => onReasonSelect(item.reason as RosterReason)}
                      aria-label={`查看${item.title}的关注缘由：${item.reason.label}`}
                    >
                      <span aria-hidden="true">因</span>
                      <strong>{item.reason.label}</strong>
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
            {visibleCount < result.matchedCount ? (
              <li className="roster-panel__more">
                <button type="button" onClick={() => {
                  if (onShowMore) onShowMore();
                  else setLocalVisibleCount((count) => count + ROSTER_PAGE_SIZE);
                }}>
                  继续展卷 · 尚有 {result.matchedCount - visibleCount} 条
                </button>
              </li>
            ) : null}
          </ol>
        ) : (
          <p className="roster-panel__empty">
            {result.totalCount === 0 && emptyMessage ? emptyMessage : result.emptyMessage}
          </p>
        )}
      </div>
    </section>
  );
}
