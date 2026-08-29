import { describe, expect, it } from 'vitest';
import {
  MAX_OBSERVER_INTERFACE_SETTINGS_CHARS,
  OBSERVER_INTERFACE_SETTINGS_STORAGE_KEY,
  OBSERVER_INTERFACE_SETTINGS_VERSION,
  clearObserverInterfaceSettings,
  createObserverInterfaceSettings,
  loadObserverInterfaceSettings,
  normalizeObserverInterfaceSettings,
  parseObserverInterfaceSettings,
  saveObserverInterfaceSettings,
  serializeObserverInterfaceSettings,
  type ObserverInterfaceSettingsStorage,
} from './observer-interface-settings';

class MemorySettingsStorage implements ObserverInterfaceSettingsStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const blockedStorage: ObserverInterfaceSettingsStorage = {
  getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  setItem: () => { throw new DOMException('blocked', 'QuotaExceededError'); },
  removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
};

describe('observer interface settings', () => {
  it('creates independent, presentation-only defaults', () => {
    const first = createObserverInterfaceSettings();
    const second = createObserverInterfaceSettings();

    first.sound.effectsVolume = 0;

    expect(second).toEqual({
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
    });
  });

  it('normalizes malformed and older records into the current version', () => {
    const callerOwned = {
      version: 0,
      sound: {
        enabled: false,
        masterVolume: 1.8,
        ambienceVolume: -0.2,
        effectsVolume: 0.333_49,
      },
      motion: 'reduced',
      mapAtmosphere: false,
      interfaceDensity: 'compact',
    };
    const normalized = normalizeObserverInterfaceSettings(callerOwned);

    expect(normalized).toEqual({
      version: OBSERVER_INTERFACE_SETTINGS_VERSION,
      sound: {
        enabled: false,
        masterVolume: 1,
        ambienceVolume: 0,
        effectsVolume: 0.333,
      },
      motion: 'reduced',
      mapAtmosphere: false,
      interfaceDensity: 'compact',
    });
    callerOwned.sound.enabled = true;
    expect(normalized.sound.enabled).toBe(false);

    expect(normalizeObserverInterfaceSettings({
      sound: { masterVolume: Number.NaN },
      motion: 'fast',
      interfaceDensity: 'tiny',
    })).toEqual(createObserverInterfaceSettings());

    expect(normalizeObserverInterfaceSettings({ motion: 'normal' }).motion).toBe('full');
  });

  it('round-trips canonical JSON and repairs malformed or oversized input', () => {
    const settings = normalizeObserverInterfaceSettings({
      sound: {
        enabled: false,
        masterVolume: 0.4,
        ambienceVolume: 0.1,
        effectsVolume: 0.9,
      },
      motion: 'reduced',
      mapAtmosphere: false,
      interfaceDensity: 'compact',
    });

    expect(parseObserverInterfaceSettings(serializeObserverInterfaceSettings(settings))).toEqual(settings);
    expect(parseObserverInterfaceSettings('{not-json')).toEqual(createObserverInterfaceSettings());
    expect(parseObserverInterfaceSettings('x'.repeat(MAX_OBSERVER_INTERFACE_SETTINGS_CHARS + 1)))
      .toEqual(createObserverInterfaceSettings());
    expect(parseObserverInterfaceSettings(null)).toEqual(createObserverInterfaceSettings());
  });

  it('loads, saves, and clears through the isolated storage key', () => {
    const storage = new MemorySettingsStorage();
    const settings = normalizeObserverInterfaceSettings({
      sound: { enabled: false },
      motion: 'reduced',
      mapAtmosphere: false,
      interfaceDensity: 'compact',
    });

    expect(loadObserverInterfaceSettings(storage)).toEqual(createObserverInterfaceSettings());
    expect(saveObserverInterfaceSettings(settings, storage)).toBe(true);
    expect(storage.getItem(OBSERVER_INTERFACE_SETTINGS_STORAGE_KEY)).toBe(
      serializeObserverInterfaceSettings(settings),
    );
    expect(loadObserverInterfaceSettings(storage)).toEqual(settings);
    expect(clearObserverInterfaceSettings(storage)).toBe(true);
    expect(loadObserverInterfaceSettings(storage)).toEqual(createObserverInterfaceSettings());
  });

  it('is SSR- and storage-failure-safe', () => {
    expect(loadObserverInterfaceSettings(null)).toEqual(createObserverInterfaceSettings());
    expect(saveObserverInterfaceSettings(createObserverInterfaceSettings(), null)).toBe(false);
    expect(clearObserverInterfaceSettings(null)).toBe(false);

    expect(loadObserverInterfaceSettings(blockedStorage)).toEqual(createObserverInterfaceSettings());
    expect(saveObserverInterfaceSettings(createObserverInterfaceSettings(), blockedStorage)).toBe(false);
    expect(clearObserverInterfaceSettings(blockedStorage)).toBe(false);
  });
});
