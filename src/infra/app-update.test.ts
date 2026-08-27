import { describe, expect, it } from 'vitest';
import {
  isSameDeployment,
  parseRemoteAppVersion,
  resolveAppUpdateCheck,
} from './app-update';

const NOW = 1_788_000_000_000;

describe('app update deployment contract', () => {
  it('parses only a semantic version with a non-empty deployment id', () => {
    expect(parseRemoteAppVersion({ version: '1.0.1', buildId: 'abc123' })).toEqual({
      version: '1.0.1',
      buildId: 'abc123',
    });
    expect(parseRemoteAppVersion({ version: 'V1', buildId: 'abc123' })).toBeNull();
    expect(parseRemoteAppVersion({ version: '1.0.1', buildId: '' })).toBeNull();
    expect(parseRemoteAppVersion(null)).toBeNull();
  });

  it('requires both the version and build id to identify the current deployment', () => {
    expect(isSameDeployment('1.0.1', 'build-a', { version: '1.0.1', buildId: 'build-a' })).toBe(true);
    expect(isSameDeployment('1.0.1', 'build-a', { version: '1.0.2', buildId: 'build-a' })).toBe(false);
    expect(isSameDeployment('1.0.1', 'build-a', { version: '1.0.1', buildId: 'build-b' })).toBe(false);
  });

  it('distinguishes current, available, offline and failed checks', async () => {
    const base = {
      localVersion: '1.0.1',
      localBuildId: 'build-a',
      online: true,
      now: () => NOW,
    };
    await expect(resolveAppUpdateCheck({
      ...base,
      fetchRemote: async () => ({ version: '1.0.1', buildId: 'build-a' }),
    })).resolves.toEqual({
      phase: 'current',
      remote: { version: '1.0.1', buildId: 'build-a' },
      checkedAt: NOW,
    });
    await expect(resolveAppUpdateCheck({
      ...base,
      fetchRemote: async () => ({ version: '1.0.2', buildId: 'build-b' }),
    })).resolves.toMatchObject({ phase: 'available' });
    await expect(resolveAppUpdateCheck({
      ...base,
      online: false,
      fetchRemote: async () => ({ version: '1.0.1', buildId: 'build-a' }),
    })).resolves.toEqual({ phase: 'offline', remote: null, checkedAt: NOW });
    await expect(resolveAppUpdateCheck({
      ...base,
      fetchRemote: async () => {
        throw new Error('network');
      },
    })).resolves.toEqual({ phase: 'error', remote: null, checkedAt: NOW });
    await expect(resolveAppUpdateCheck({
      ...base,
      fetchRemote: async () => ({ unexpected: true }),
    })).resolves.toEqual({ phase: 'error', remote: null, checkedAt: NOW });
  });
});
