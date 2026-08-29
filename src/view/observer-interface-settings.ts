export const OBSERVER_INTERFACE_SETTINGS_STORAGE_KEY = 'canghai-observer-interface-settings-v1';
export const OBSERVER_INTERFACE_SETTINGS_VERSION = 1 as const;
export const MAX_OBSERVER_INTERFACE_SETTINGS_CHARS = 4_096;

export type ObserverMotionPreference = 'system' | 'full' | 'reduced';
export type ObserverInterfaceDensity = 'comfortable' | 'compact';
export type ObserverAudioState = 'silent' | 'waiting' | 'ready' | 'suspended' | 'unsupported';

export interface ObserverSoundSettings {
  enabled: boolean;
  masterVolume: number;
  ambienceVolume: number;
  effectsVolume: number;
}

/**
 * Local presentation preferences only. This object must never be embedded in
 * WorldState, portable world saves, simulation inputs, or deterministic hashes.
 */
export interface ObserverInterfaceSettings {
  version: typeof OBSERVER_INTERFACE_SETTINGS_VERSION;
  sound: ObserverSoundSettings;
  motion: ObserverMotionPreference;
  mapAtmosphere: boolean;
  interfaceDensity: ObserverInterfaceDensity;
}

/** Minimal localStorage-compatible boundary, kept injectable for SSR and tests. */
export interface ObserverInterfaceSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 1_000) / 1_000;
}

function safeMotion(value: unknown, fallback: ObserverMotionPreference): ObserverMotionPreference {
  if (value === 'normal') return 'full';
  return value === 'system' || value === 'full' || value === 'reduced' ? value : fallback;
}

function safeDensity(value: unknown, fallback: ObserverInterfaceDensity): ObserverInterfaceDensity {
  return value === 'comfortable' || value === 'compact' ? value : fallback;
}

function browserStorage(): ObserverInterfaceSettingsStorage | null {
  try {
    const candidate = globalThis.localStorage as ObserverInterfaceSettingsStorage | undefined;
    if (!candidate
      || typeof candidate.getItem !== 'function'
      || typeof candidate.setItem !== 'function'
      || typeof candidate.removeItem !== 'function') return null;
    return candidate;
  } catch {
    // Access itself may throw in locked-down/private browser contexts.
    return null;
  }
}

export function createObserverInterfaceSettings(): ObserverInterfaceSettings {
  return {
    version: OBSERVER_INTERFACE_SETTINGS_VERSION,
    sound: {
      enabled: false,
      masterVolume: 0.72,
      ambienceVolume: 0.42,
      effectsVolume: 0.68,
    },
    motion: 'system',
    mapAtmosphere: true,
    interfaceDensity: 'comfortable',
  };
}

/** Safely upgrades/repairs unknown records and never retains caller-owned references. */
export function normalizeObserverInterfaceSettings(value: unknown): ObserverInterfaceSettings {
  const defaults = createObserverInterfaceSettings();
  if (!isRecord(value)) return defaults;
  const sound = isRecord(value.sound) ? value.sound : {};
  return {
    version: OBSERVER_INTERFACE_SETTINGS_VERSION,
    sound: {
      enabled: safeBoolean(sound.enabled, defaults.sound.enabled),
      masterVolume: safeVolume(sound.masterVolume, defaults.sound.masterVolume),
      ambienceVolume: safeVolume(sound.ambienceVolume, defaults.sound.ambienceVolume),
      effectsVolume: safeVolume(sound.effectsVolume, defaults.sound.effectsVolume),
    },
    motion: safeMotion(value.motion, defaults.motion),
    mapAtmosphere: safeBoolean(value.mapAtmosphere, defaults.mapAtmosphere),
    interfaceDensity: safeDensity(value.interfaceDensity, defaults.interfaceDensity),
  };
}

/** Accepts localStorage JSON or an already-decoded value and never throws. */
export function parseObserverInterfaceSettings(raw: unknown): ObserverInterfaceSettings {
  if (typeof raw !== 'string') return normalizeObserverInterfaceSettings(raw);
  if (!raw || raw.length > MAX_OBSERVER_INTERFACE_SETTINGS_CHARS) {
    return createObserverInterfaceSettings();
  }
  try {
    return normalizeObserverInterfaceSettings(JSON.parse(raw) as unknown);
  } catch {
    return createObserverInterfaceSettings();
  }
}

export function serializeObserverInterfaceSettings(value: unknown): string {
  return JSON.stringify(normalizeObserverInterfaceSettings(value));
}

/** SSR-, privacy-mode-, and quota-safe read boundary. */
export function loadObserverInterfaceSettings(
  storage: ObserverInterfaceSettingsStorage | null = browserStorage(),
): ObserverInterfaceSettings {
  if (!storage) return createObserverInterfaceSettings();
  try {
    return parseObserverInterfaceSettings(storage.getItem(OBSERVER_INTERFACE_SETTINGS_STORAGE_KEY));
  } catch {
    return createObserverInterfaceSettings();
  }
}

/** Returns false when persistence is unavailable; gameplay should continue normally. */
export function saveObserverInterfaceSettings(
  settings: ObserverInterfaceSettings,
  storage: ObserverInterfaceSettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      OBSERVER_INTERFACE_SETTINGS_STORAGE_KEY,
      serializeObserverInterfaceSettings(settings),
    );
    return true;
  } catch {
    return false;
  }
}

/** Best-effort reset for a future Settings UI. */
export function clearObserverInterfaceSettings(
  storage: ObserverInterfaceSettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(OBSERVER_INTERFACE_SETTINGS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
