import { useCallback, useEffect, useState } from 'react';
import {
  loadObserverInterfaceSettings,
  normalizeObserverInterfaceSettings,
  saveObserverInterfaceSettings,
  type ObserverInterfaceSettings,
} from './observer-interface-settings';

export interface ObserverInterfaceController {
  settings: ObserverInterfaceSettings;
  fullscreen: boolean;
  commitSettings: (settings: ObserverInterfaceSettings) => void;
  toggleFullscreen: () => void;
}

/** Owns the small set of presentation-only settings and fullscreen state. */
export function useObserverInterface(): ObserverInterfaceController {
  const [settings, setSettings] = useState<ObserverInterfaceSettings>(() => (
    loadObserverInterfaceSettings()
  ));
  const [fullscreen, setFullscreen] = useState(() => (
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  ));

  const commitSettings = useCallback((candidate: ObserverInterfaceSettings) => {
    const next = normalizeObserverInterfaceSettings(candidate);
    saveObserverInterfaceSettings(next);
    setSettings(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }, []);
  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  return {
    settings,
    fullscreen,
    commitSettings,
    toggleFullscreen,
  };
}
