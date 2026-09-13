import { describe, expect, it } from 'vitest';
import {
  isSameDeployment,
  parseRemoteAppVersion,
  resolveAppUpdateCheck,
} from './app-update';

const NOW = 1_788_000_000_000;

describe('app update deployment contract', () => {
  it('parses only a semantic version with a non-empty deployment id', () => {
    expect(parseRemoteAppVersion({ edition: 'personal', version: '1.0.1', buildId: 'abc123' })).toEqual({
      edition: 'personal',
      version: '1.0.1',
      buildId: 'abc123',
    });
    expect(parseRemoteAppVersion({ edition: 'personal', version: 'V1', buildId: 'abc123' })).toBeNull();
    expect(parseRemoteAppVersion({ edition: 'personal', version: '1.0.1', buildId: '' })).toBeNull();
    expect(parseRemoteAppVersion(null)).toBeNull();
  });

  it('requires both the version and build id to identify the current deployment', () => {
    expect(isSameDeployment('1.0.1', 'build-a', { edition: 'personal', version: '1.0.1', buildId: 'build-a' })).toBe(true);
    expect(isSameDeployment('1.0.1', 'build-a', { edition: 'personal', version: '1.0.2', buildId: 'build-a' })).toBe(false);
    expect(isSameDeployment('1.0.1', 'build-a', { edition: 'personal', version: '1.0.1', buildId: 'build-b' })).toBe(false);
  });

  it('does not guess missing editions or accept another edition as an update', async () => {
    expect(parseRemoteAppVersion({ version: '1.0.1', buildId: 'a' })).toBeNull();
    expect(parseRemoteAppVersion({ version: '1.0.1', buildId: 'a', edition: 'preview' })).toBeNull();
    for (const localEdition of ['personal', 'contest'] as const) {
      const edition = localEdition === 'personal' ? 'contest' : 'personal';
      for (const version of ['1.0.1', '99.0.0']) {
        const remote = { version, buildId: 'same-commit', edition } as const;
        expect(isSameDeployment('1.0.1', 'same-commit', remote, localEdition)).toBe(false);
        await expect(resolveAppUpdateCheck({ localEdition, localVersion: '1.0.1',
          localBuildId: 'same-commit', online: true, now: () => NOW, fetchRemote: async () => remote }))
          .resolves.toEqual({ phase: 'mismatch', remote: null, checkedAt: NOW });
      }
    }
  });

  it('distinguishes current, available, offline and failed checks', async () => {
    const base = {
      localEdition: 'personal' as const,
      localVersion: '1.0.1',
      localBuildId: 'build-a',
      online: true,
      now: () => NOW,
    };
    await expect(resolveAppUpdateCheck({
      ...base,
      fetchRemote: async () => ({ edition: 'personal', version: '1.0.1', buildId: 'build-a' }),
    })).resolves.toEqual({
      phase: 'current',
      remote: { edition: 'personal', version: '1.0.1', buildId: 'build-a' },
      checkedAt: NOW,
    });
    await expect(resolveAppUpdateCheck({
      ...base,
      fetchRemote: async () => ({ edition: 'personal', version: '1.0.2', buildId: 'build-b' }),
    })).resolves.toMatchObject({ phase: 'available' });
    await expect(resolveAppUpdateCheck({
      ...base,
      online: false,
      fetchRemote: async () => ({ edition: 'personal', version: '1.0.1', buildId: 'build-a' }),
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
