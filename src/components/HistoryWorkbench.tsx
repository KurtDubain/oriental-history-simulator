import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  GitBranch,
  MapPinned,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { EventCategory, HistoryEvent, WorldState } from '../sim/types';
import {
  HISTORY_EVENT_CATEGORIES,
  buildHistoryRelatedEntities,
  clampHistoryTurn,
  decodeHistoryRelatedEntity,
  encodeHistoryRelatedEntity,
  filterHistoryEvents,
  historyTurnDate,
  reconstructHistoricalTerritory,
  type HistoricalTerritoryView,
  type HistoryRelatedEntityRef,
  type HistoryRelatedKind,
} from '../view/v1-history';
import '../styles/history-workbench.css';
import { APP_VERSION } from '../version';

const PAGE_SIZE = 72;

const ENTITY_GROUPS: ReadonlyArray<{ kind: HistoryRelatedKind; label: string }> = [
  { kind: 'character', label: '人物' },
  { kind: 'polity', label: '政权' },
  { kind: 'region', label: '州域' },
];

export interface HistoryWorkbenchProps {
  open: boolean;
  world: WorldState;
  /** Supplying this makes the timeline turn controlled by the parent. */
  turn?: number;
  initialRelatedEntity?: HistoryRelatedEntityRef | null;
  onSelectEvent: (eventId: string) => void;
  onTurnChange: (turn: number, view: HistoricalTerritoryView) => void;
  onClose: () => void;
  /** Called by “归还当下”; the parent can clear its map territory overlay. */
  onReset: () => void;
  returnFocusTo?: HTMLElement | null;
}

function eventSubjectNames(world: WorldState, event: HistoryEvent): string[] {
  const characterNames = new Map(world.characters.map((character) => [character.id, character.name]));
  const polityNames = new Map(world.polities.map((polity) => [polity.id, polity.shortName || polity.name]));
  const regionNames = new Map(world.regions.map((region) => [region.id, region.name]));
  return [
    ...event.actorIds.map((id) => characterNames.get(id)),
    ...event.polityIds.map((id) => polityNames.get(id)),
    ...event.regionIds.map((id) => regionNames.get(id)),
  ].filter((name): name is string => Boolean(name)).filter((name, index, names) => names.indexOf(name) === index);
}

export function HistoryWorkbench({
  open,
  world,
  turn: controlledTurn,
  initialRelatedEntity = null,
  onSelectEvent,
  onTurnChange,
  onClose,
  onReset,
  returnFocusTo,
}: HistoryWorkbenchProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const eventButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onCloseRef = useRef(onClose);
  const previousWorldTurnRef = useRef(world.turn);
  const [internalTurn, setInternalTurn] = useState(() => clampHistoryTurn(world, controlledTurn ?? world.turn));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [minimumImportance, setMinimumImportance] = useState(1);
  const [relatedValue, setRelatedValue] = useState(
    initialRelatedEntity ? encodeHistoryRelatedEntity(initialRelatedEntity) : '',
  );
  const [page, setPage] = useState(0);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  onCloseRef.current = onClose;

  const selectedTurn = clampHistoryTurn(world, controlledTurn ?? internalTurn);
  const date = historyTurnDate(selectedTurn);
  const snapshot = useMemo(
    () => open ? reconstructHistoricalTerritory(world, selectedTurn) : null,
    [open, selectedTurn, world],
  );
  const relatedOptions = useMemo(() => open ? buildHistoryRelatedEntities(world) : [], [open, world]);
  const relatedEntity = useMemo(() => decodeHistoryRelatedEntity(relatedValue), [relatedValue]);
  const filteredEvents = useMemo(() => open ? filterHistoryEvents(world, {
      query: deferredQuery,
      categories: category === 'all' ? [] : [category],
      minimumImportance,
      relatedEntity,
      throughTurn: selectedTurn,
    }) : [],
  [category, deferredQuery, minimumImportance, open, relatedEntity, selectedTurn, world]);
  const pageCount = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleEvents = filteredEvents.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const subjectNamesByEvent = useMemo(() => new Map(
    visibleEvents.map((event) => [event.id, eventSubjectNames(world, event)]),
  ), [visibleEvents, world]);
  const currentCategoryStats = useMemo(() => snapshot ? HISTORY_EVENT_CATEGORIES
    .map((item) => ({ category: item, count: snapshot.historyStats.categoryCountsAtTurn[item] }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count) : [], [snapshot]);

  useEffect(() => {
    if (controlledTurn === undefined) {
      const previousWorldTurn = previousWorldTurnRef.current;
      setInternalTurn((current) => current >= previousWorldTurn ? world.turn : Math.min(current, world.turn));
    }
    previousWorldTurnRef.current = world.turn;
  }, [controlledTurn, world.turn]);

  useEffect(() => {
    if (!open || !initialRelatedEntity) return;
    setRelatedValue(encodeHistoryRelatedEntity(initialRelatedEntity));
  }, [initialRelatedEntity?.id, initialRelatedEntity?.kind, open]);

  useEffect(() => {
    setPage(0);
    setActiveEventIndex(0);
    eventButtonRefs.current = [];
  }, [category, minimumImportance, query, relatedValue, selectedTurn]);

  useEffect(() => {
    setActiveEventIndex(0);
    eventButtonRefs.current = [];
  }, [safePage]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = returnFocusTo ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
    const frame = requestAnimationFrame(() => searchRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, returnFocusTo]);

  const changeTurn = useCallback((nextTurn: number) => {
    const next = clampHistoryTurn(world, nextTurn);
    if (controlledTurn === undefined) setInternalTurn(next);
    onTurnChange(next, reconstructHistoricalTerritory(world, next));
  }, [controlledTurn, onTurnChange, world]);

  const resetToPresent = useCallback(() => {
    if (controlledTurn === undefined) setInternalTurn(world.turn);
    onReset();
  }, [controlledTurn, onReset, world.turn]);

  const clearFilters = useCallback(() => {
    setQuery('');
    setCategory('all');
    setMinimumImportance(1);
    setRelatedValue('');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const handleEventKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = Math.min(visibleEvents.length - 1, index + 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = visibleEvents.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveEventIndex(nextIndex);
    eventButtonRefs.current[nextIndex]?.focus();
  };

  if (!open || !snapshot) return null;

  const hasFilters = Boolean(query || category !== 'all' || minimumImportance > 1 || relatedValue);
  const isHistorical = selectedTurn !== world.turn;

  return (
    <div className="history-workbench-layer">
      <button
        type="button"
        className="history-workbench-layer__backdrop"
        tabIndex={-1}
        aria-label="关闭历史工作台"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="history-workbench"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-historical={isHistorical || undefined}
      >
        <header className="history-workbench__masthead">
          <div className="history-workbench__seal" aria-hidden="true"><Archive size={21} /></div>
          <div>
            <span>v{APP_VERSION} · 可检索世界史</span>
            <h2 id={titleId}>历史工作台</h2>
            <p id={descriptionId}>检索史事、核验因果，并把舆图回拨到任一已记录季度。</p>
          </div>
          <button type="button" className="history-workbench__close" onClick={onClose} aria-label="关闭历史工作台">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="history-workbench__timeline">
          <div className="history-workbench__timeline-heading">
            <span><Clock3 size={14} aria-hidden="true" />舆图纪年</span>
            <strong>{date.label}</strong>
            <small>{isHistorical ? `距今 ${world.turn - selectedTurn} 季` : '此刻'}</small>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, world.turn)}
            step={1}
            value={selectedTurn}
            aria-label="选择历史季度"
            aria-valuetext={date.label}
            onChange={(event) => changeTurn(Number(event.currentTarget.value))}
          />
          <div className="history-workbench__timeline-bounds" aria-hidden="true">
            <span>{historyTurnDate(0).label}</span>
            <span>{historyTurnDate(world.turn).label}</span>
          </div>
          <button type="button" disabled={!isHistorical} onClick={resetToPresent}>
            <RotateCcw size={13} aria-hidden="true" />归还当下
          </button>
        </div>

        <div className="history-workbench__body">
          <aside className="history-workbench__filters" aria-label="史事筛选">
            <div className="history-workbench__section-title"><Filter size={13} aria-hidden="true" />筛选史册</div>
            <label className="history-workbench__search">
              <span>全文检索</span>
              <span>
                <Search size={14} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder="人名、地点、因由……"
                  autoComplete="off"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </span>
            </label>

            <label>
              <span>史事类别</span>
              <select value={category} onChange={(event) => setCategory(event.currentTarget.value as EventCategory | 'all')}>
                <option value="all">全部类别</option>
                {HISTORY_EVENT_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label>
              <span>最低重要度</span>
              <select value={minimumImportance} onChange={(event) => setMinimumImportance(Number(event.currentTarget.value))}>
                <option value={1}>全部记载</option>
                <option value={2}>二等以上</option>
                <option value={3}>三等以上</option>
                <option value={4}>重大史事</option>
                <option value={5}>天下大事</option>
              </select>
            </label>

            <label>
              <span>相关对象</span>
              <select value={relatedValue} onChange={(event) => setRelatedValue(event.currentTarget.value)}>
                <option value="">全部人物与地域</option>
                {ENTITY_GROUPS.map((group) => {
                  const options = relatedOptions.filter((option) => option.kind === group.kind);
                  return options.length ? (
                    <optgroup key={group.kind} label={group.label}>
                      {options.map((option) => (
                        <option key={encodeHistoryRelatedEntity(option)} value={encodeHistoryRelatedEntity(option)}>
                          {option.label} · {option.eventCount}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>

            <button type="button" className="history-workbench__clear" disabled={!hasFilters} onClick={clearFilters}>
              清除筛选
            </button>
          </aside>

          <main
            className="history-workbench__records"
            aria-labelledby="history-workbench-results"
            aria-busy={query !== deferredQuery || undefined}
          >
            <header>
              <div>
                <span>截至 {date.label}</span>
                <h3 id="history-workbench-results">{filteredEvents.length} 件匹配史事</h3>
              </div>
              {pageCount > 1 ? <small>第 {safePage + 1} / {pageCount} 页</small> : null}
            </header>

            <p className="history-workbench__result-status" role="status" aria-live="polite">
              {query !== deferredQuery ? '正在检索史册。' : `${filteredEvents.length} 件结果；按上下方向键可逐条阅读。`}
            </p>

            {visibleEvents.length ? (
              <ol className="history-workbench__event-list" aria-label="历史事件检索结果">
                {visibleEvents.map((event, index) => {
                  const names = subjectNamesByEvent.get(event.id) ?? [];
                  return (
                    <li key={event.id} data-major={event.importance >= 4 || undefined}>
                      <button
                        ref={(node) => { eventButtonRefs.current[index] = node; }}
                        type="button"
                        tabIndex={index === activeEventIndex ? 0 : -1}
                        aria-haspopup="dialog"
                        aria-label={`${event.year}年${event.season}季，${event.title}，查看因果`}
                        onFocus={() => setActiveEventIndex(index)}
                        onKeyDown={(keyboardEvent) => handleEventKeyDown(keyboardEvent, index)}
                        onClick={() => onSelectEvent(event.id)}
                      >
                        <span className="history-workbench__event-date">{event.year}年<br />{event.season}季</span>
                        <span className="history-workbench__event-mark" aria-hidden="true" />
                        <span className="history-workbench__event-copy">
                          <span className="history-workbench__event-meta">
                            <span>{event.category}</span>
                            <span aria-label={`重要度 ${event.importance} 等`}>{'◆'.repeat(event.importance)}</span>
                          </span>
                          <strong>{event.title}</strong>
                          <small>{event.summary}</small>
                          {names.length ? <em>{names.slice(0, 4).join(' · ')}</em> : null}
                        </span>
                        <span className="history-workbench__event-action" aria-hidden="true">
                          <GitBranch size={13} />查明因果<ChevronRight size={13} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="history-workbench__empty">
                <Search size={24} aria-hidden="true" />
                <strong>史卷中未找到相合记载</strong>
                <p>尝试缩短关键词、降低重要度，或回到更晚的季度。</p>
              </div>
            )}

            {pageCount > 1 ? (
              <nav className="history-workbench__pagination" aria-label="史事结果翻页">
                <button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                  <ChevronLeft size={14} aria-hidden="true" />较新一页
                </button>
                <span>{safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredEvents.length)} / {filteredEvents.length}</span>
                <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>
                  较早一页<ChevronRight size={14} aria-hidden="true" />
                </button>
              </nav>
            ) : null}
          </main>

          <aside className="history-workbench__snapshot" aria-label={`${date.label}天下形势`}>
            <div className="history-workbench__section-title"><MapPinned size={13} aria-hidden="true" />当季天下</div>
            <dl className="history-workbench__snapshot-counts">
              <div><dt>政权</dt><dd>{snapshot.extantPolities.length}</dd></div>
              <div><dt>本季史事</dt><dd>{snapshot.historyStats.eventsAtTurn}</dd></div>
              <div><dt>本季大事</dt><dd>{snapshot.historyStats.majorEventsAtTurn}</dd></div>
              <div><dt>累计易帜</dt><dd>{snapshot.historyStats.controllerChangesThroughTurn}</dd></div>
            </dl>

            <section className="history-workbench__polities" aria-labelledby="history-workbench-polities">
              <h3 id="history-workbench-polities">时存行政权</h3>
              {snapshot.extantPolities.length ? (
                <ol>
                  {snapshot.extantPolities.map((polity) => (
                    <li key={polity.id}>
                      <span style={{ '--history-polity-color': polity.color } as CSSProperties} aria-hidden="true" />
                      <strong>{polity.shortName || polity.name}</strong>
                      <small>{polity.regionCount} 州域</small>
                    </li>
                  ))}
                </ol>
              ) : <p>此季没有可核验的存续政权。</p>}
            </section>

            <section className="history-workbench__quarter-categories" aria-labelledby="history-workbench-categories">
              <h3 id="history-workbench-categories">本季载录</h3>
              {currentCategoryStats.length ? currentCategoryStats.map((item) => (
                <div key={item.category}><span>{item.category}</span><strong>{item.count}</strong></div>
              )) : <p>这一季度尚无史事。</p>}
            </section>

            <footer data-confidence={snapshot.confidence}>
              <span>{snapshot.confidence === 'complete' ? '差量链完整' : '差量链有缺页'}</span>
              <small>已倒推 {snapshot.reversedControllerChanges} 次易帜</small>
            </footer>
          </aside>
        </div>
      </section>
    </div>
  );
}
