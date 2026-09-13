import { useCallback, useEffect, useState } from 'react';
import { ObserverMedia } from './observer-media';
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
  media: ObserverMedia;
}

/** Owns the small set of presentation-only settings and fullscreen state. */
export function useObserverInterface(): ObserverInterfaceController {
  const [media] = useState(() => new ObserverMedia());
  const [settings, setSettings] = useState<ObserverInterfaceSettings>(() => (
    loadObserverInterfaceSettings()
  ));
  const [fullscreen, setFullscreen] = useState(() => (
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  ));

  const commitSettings = useCallback((candidate: ObserverInterfaceSettings) => {
    const next = normalizeObserverInterfaceSettings(candidate);
    media.configure(next);
    media.unlock();
    saveObserverInterfaceSettings(next);
    setSettings(next);
  }, [media]);

  useEffect(() => {
    media.configure(settings);
    document.documentElement.dataset.illustrations = String(settings.illustrations);
  }, [media, settings]);
  useEffect(() => {
    const gesture = () => media.unlock();
    const hidden = () => { if (document.hidden) media.stop(); };
    const leave = () => media.stop();
    document.addEventListener('pointerdown', gesture);
    document.addEventListener('keydown', gesture);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('pointerdown', gesture);
      document.removeEventListener('keydown', gesture);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      media.dispose();
    };
  }, [media]);

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
    media,
  };
}
