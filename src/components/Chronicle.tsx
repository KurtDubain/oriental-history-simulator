import { BookOpenText, ChevronRight, GitBranch, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import '../styles/observer-ui.css';

export type ChronicleTone = 'neutral' | 'prosperity' | 'conflict' | 'crisis' | 'succession';

export interface ChronicleEvent {
  id: string;
  date: string;
  category: string;
  title: string;
  summary?: string;
  location?: string;
  actors?: string[];
  tone?: ChronicleTone;
  isMajor?: boolean;
  causeCount?: number;
}

export interface ChronicleProps {
  events: ChronicleEvent[];
  selectedEventId?: string | null;
  onSelectEvent: (event: ChronicleEvent) => void;
  heading?: string;
  emptyMessage?: string;
}

export function Chronicle({
  events,
  selectedEventId,
  onSelectEvent,
  heading = '近期史事',
  emptyMessage = '本季尚无足以记入史册之事。',
}: ChronicleProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !events.length) return;
    list.scrollTo({ left: list.scrollWidth, behavior: 'auto' });
  }, [events]);

  return (
    <section className="observer-chronicle" aria-labelledby="chronicle-heading">
      <header className="observer-chronicle__header">
        <div>
          <span className="observer-chronicle__kicker"><BookOpenText size={14} aria-hidden="true" />季度简史</span>
          <h2 id="chronicle-heading">{heading}</h2>
        </div>
        <p>{events.length ? `${events.length} 件可追溯史事` : '等待新的记载'}</p>
      </header>

      {events.length ? (
        <ol ref={listRef} className="observer-chronicle__list">
          {events.map((event) => {
            const selected = event.id === selectedEventId;
            return (
              <li key={event.id} className="observer-chronicle__entry" data-tone={event.tone ?? 'neutral'}>
                <button
                  type="button"
                  className="observer-chronicle__event"
                  data-selected={selected || undefined}
                  aria-haspopup="dialog"
                  aria-expanded={selected}
                  aria-controls={selected ? 'observer-causal-drawer' : undefined}
                  aria-label={`${event.date}，${event.title}。查看发生原因`}
                  onClick={() => onSelectEvent(event)}
                >
                  <span className="observer-chronicle__date">{event.date}</span>
                  <span className="observer-chronicle__mark" aria-hidden="true" />
                  <span className="observer-chronicle__body">
                    <span className="observer-chronicle__meta">
                      <span>{event.category}</span>
                      {event.location ? <span><MapPin size={11} aria-hidden="true" />{event.location}</span> : null}
                    </span>
                    <strong>{event.title}</strong>
                    {event.summary ? <small>{event.summary}</small> : null}
                  </span>
                  <span className="observer-chronicle__cause" aria-hidden="true">
                    <GitBranch size={13} />
                    {event.causeCount ? `${event.causeCount} 条因由` : '何故'}
                    <ChevronRight size={14} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="observer-chronicle__empty">{emptyMessage}</p>
      )}
    </section>
  );
}
