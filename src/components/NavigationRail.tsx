import { BookOpenText, Castle, Map, Network, Swords, UsersRound, type LucideIcon } from 'lucide-react';
import type { MapOverlay } from './WorldMap';
import { LayerPicker } from './LayerPicker';
import '../styles/observer-ui.css';

export type ObserverView = 'world' | 'polities' | 'families' | 'people' | 'military' | 'chronicle';
export type { MapOverlay } from './WorldMap';

export interface NavigationRailProps {
  activeView: ObserverView;
  activeOverlay: MapOverlay;
  onViewChange: (view: ObserverView) => void;
  onOverlayChange: (overlay: MapOverlay) => void;
  militaryAlertCount?: number;
}

interface NavigationItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

const VIEWS: NavigationItem<ObserverView>[] = [
  { id: 'world', label: '世界', icon: Map },
  { id: 'polities', label: '列国', icon: Castle },
  { id: 'families', label: '世家', icon: Network },
  { id: 'people', label: '人物', icon: UsersRound },
  { id: 'military', label: '军旅', icon: Swords },
  { id: 'chronicle', label: '史册', icon: BookOpenText },
];

export function NavigationRail({
  activeView,
  activeOverlay,
  onViewChange,
  onOverlayChange,
  militaryAlertCount = 0,
}: NavigationRailProps) {
  return (
    <aside className="observer-navigation" aria-label="观察导航">
      <nav className="observer-navigation__views" aria-label="观察页面">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const isActive = activeView === id;
          const showAlert = id === 'military' && militaryAlertCount > 0;

          return (
            <button
              type="button"
              className="observer-navigation__item"
              key={id}
              data-observer-view={id}
              data-active={isActive || undefined}
              aria-current={isActive ? 'page' : undefined}
              aria-label={showAlert ? `${label}，${militaryAlertCount} 条战事消息` : label}
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
