import { useCallback, useEffect, useRef, useState } from 'react';
import { gameAudio, type AudioManagerSnapshot } from '../audio';
import {
  loadObserverInterfaceSettings,
  normalizeObserverInterfaceSettings,
  saveObserverInterfaceSettings,
  type ObserverAudioState,
  type ObserverInterfaceSettings,
} from './observer-interface-settings';

export interface ObserverInterfaceContext {
  seaFocused: boolean;
  dangerFocused: boolean;
  worldWarAmbience: boolean;
}

export interface ObserverInterfaceController {
  settings: ObserverInterfaceSettings;
  audioState: ObserverAudioState;
  fullscreen: boolean;
  commitSettings: (settings: ObserverInterfaceSettings) => void;
  enableSound: () => void;
  dismissSoundInvitation: () => void;
  previewSound: () => Promise<boolean>;
  toggleFullscreen: () => void;
}

function audioStateFor(
  settings: ObserverInterfaceSettings,
  snapshot: AudioManagerSnapshot,
): ObserverAudioState {
  if (!snapshot.supported) return 'unsupported';
  if (!settings.sound.enabled) return 'silent';
  if (snapshot.unlocked && snapshot.contextState === 'running') return 'ready';
  if (snapshot.hidden || snapshot.manuallyPaused) return 'suspended';
  return 'waiting';
}

/** Owns presentation-only settings, audio lifecycle and fullscreen state. */
export function useObserverInterface(context: ObserverInterfaceContext): ObserverInterfaceController {
  const [settings, setSettings] = useState<ObserverInterfaceSettings>(() => (
    loadObserverInterfaceSettings()
  ));
  const [audioSnapshot, setAudioSnapshot] = useState<AudioManagerSnapshot>(() => gameAudio.getSnapshot());
  const [fullscreen, setFullscreen] = useState(() => (
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  ));
  const settingsRef = useRef(settings);

  const commitSettings = useCallback((candidate: ObserverInterfaceSettings) => {
    const next = normalizeObserverInterfaceSettings(candidate);
    const previous = settingsRef.current;
    settingsRef.current = next;
    if (previous.sound.enabled && !next.sound.enabled) gameAudio.play('close', 0.58);
    gameAudio.setSettings({
      muted: !next.sound.enabled,
      masterVolume: next.sound.masterVolume,
      ambienceVolume: next.sound.ambienceVolume,
      effectsVolume: next.sound.effectsVolume,
    });
    if (!previous.sound.enabled && next.sound.enabled) {
      gameAudio.attach();
      void gameAudio.resume().then((ready) => {
        if (!settingsRef.current.sound.enabled) {
          void gameAudio.pause();
        } else if (ready) {
          gameAudio.play('open', 1);
        }
      });
    } else if (previous.sound.enabled && next.sound.enabled && (
      next.mapAtmosphere !== previous.mapAtmosphere
      || next.motion !== previous.motion
      || next.interfaceDensity !== previous.interfaceDensity
    )) {
      gameAudio.play('select', 0.52);
    }
    saveObserverInterfaceSettings(next);
    setSettings(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    gameAudio.play('select', 0.42);
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }, []);

  const enableSound = useCallback(() => {
    const current = settingsRef.current;
    commitSettings({
      ...current,
      sound: { ...current.sound, enabled: true, promptDismissed: true },
    });
  }, [commitSettings]);

  const dismissSoundInvitation = useCallback(() => {
    const current = settingsRef.current;
    commitSettings({
      ...current,
      sound: { ...current.sound, enabled: false, promptDismissed: true },
    });
  }, [commitSettings]);

  const previewSound = useCallback(async () => {
    const ready = await gameAudio.resume();
    if (ready) gameAudio.play('quarter', 1);
    return ready;
  }, []);

  useEffect(() => gameAudio.subscribe(setAudioSnapshot), []);
  useEffect(() => {
    gameAudio.setSettings({
      muted: !settings.sound.enabled,
      masterVolume: settings.sound.masterVolume,
      ambienceVolume: settings.sound.ambienceVolume,
      effectsVolume: settings.sound.effectsVolume,
    });
  }, [settings.sound]);
  useEffect(() => {
    if (!settings.sound.enabled) {
      void gameAudio.pause();
      return undefined;
    }
    return gameAudio.attach();
  }, [settings.sound.enabled]);
  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  useEffect(() => {
    const mix = context.seaFocused && context.dangerFocused
      ? { land: 0.42, sea: 0.34, tension: 0.24 }
      : context.seaFocused
        ? { land: 0.45, sea: 0.5, tension: 0.05 }
        : context.dangerFocused
          ? { land: 0.68, sea: 0.06, tension: 0.26 }
          : context.worldWarAmbience
            ? { land: 0.84, sea: 0.06, tension: 0.1 }
            : { land: 0.95, sea: 0.04, tension: 0.01 };
    gameAudio.setSoundscapeBlend(mix, 1.8);
  }, [context.dangerFocused, context.seaFocused, context.worldWarAmbience]);

  return {
    settings,
    audioState: audioStateFor(settings, audioSnapshot),
    fullscreen,
    commitSettings,
    enableSound,
    dismissSoundInvitation,
    previewSound,
    toggleFullscreen,
  };
}
