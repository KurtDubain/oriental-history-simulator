import { BookOpenText, Castle, Map, UsersRound, type LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import type { MapOverlay } from './WorldMap';
import { LayerPicker } from './LayerPicker';
import '../styles/observer-ui.css';

export type ObserverView = 'world' | 'powers' | 'people' | 'chronicle';
export type { MapOverlay } from './WorldMap';

export interface NavigationRailProps {
  activeView: ObserverView;
  activeOverlay: MapOverlay;
  onViewChange: (view: ObserverView) => void;
  onOverlayChange: (overlay: MapOverlay) => void;
  militaryAlertCount?: number;
  powersTriggerRef?: Ref<HTMLButtonElement>;
  peopleTriggerRef?: Ref<HTMLButtonElement>;
  historyTriggerRef?: Ref<HTMLButtonElement>;
}

interface NavigationItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

const VIEWS: NavigationItem<ObserverView>[] = [
  { id: 'world', label: '世界', icon: Map },
  { id: 'powers', label: '势力', icon: Castle },
  { id: 'people', label: '人物', icon: UsersRound },
  { id: 'chronicle', label: '史册', icon: BookOpenText },
];

export function NavigationRail({
  activeView,
  activeOverlay,
  onViewChange,
  onOverlayChange,
  militaryAlertCount = 0,
  powersTriggerRef,
  peopleTriggerRef,
  historyTriggerRef,
}: NavigationRailProps) {
  return (
    <aside className="observer-navigation" aria-label="观察导航">
      <nav className="observer-navigation__views" aria-label="观察页面">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const isActive = activeView === id;
          const showAlert = id === 'powers' && militaryAlertCount > 0;

          return (
            <button
              ref={id === 'powers'
                ? powersTriggerRef
                : id === 'people'
                  ? peopleTriggerRef
                  : id === 'chronicle'
                    ? historyTriggerRef
                    : undefined}
              type="button"
              className="observer-navigation__item"
              key={id}
              data-observer-view={id}
              data-navigation-entry={id}
              data-history-workbench-trigger={id === 'chronicle' ? 'true' : undefined}
              data-active={isActive || undefined}
              aria-current={isActive ? 'page' : undefined}
              aria-label={id === 'chronicle'
                ? '史册，快捷键 H'
                : showAlert
                  ? `${label}，军旅有 ${militaryAlertCount} 条战事消息`
                  : label}
              onClick={() => onViewChange(id)}
            >
              <span className="observer-navigation__glyph">
                <Icon size={20} strokeWidth={1.55} aria-hidden="true" />
                {showAlert ? (
                  <span className="observer-navigation__badge" aria-hidden="true">
                    {militaryAlertCount > 9 ? '9+' : militaryAlertCount}
                  </span>
                ) : null}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="observer-navigation__rule" />
      <LayerPicker value={activeOverlay} onChange={onOverlayChange} />
    </aside>
  );
}
