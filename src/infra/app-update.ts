import { APP_BUILD_ID, APP_VERSION } from '../version';

const VERSION_ENDPOINT = '/version.json';
const VERSION_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type AppUpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'offline' | 'error';

export interface RemoteAppVersion {
  version: string;
  buildId: string;
}

export interface AppUpdateState {
  phase: AppUpdatePhase;
  localVersion: string;
  localBuildId: string;
  remoteVersion: string | null;
  remoteBuildId: string | null;
  checkedAt: number | null;
}

export interface AppUpdateCheckOptions {
  localVersion: string;
  localBuildId: string;
  online: boolean;
  now: () => number;
  fetchRemote: () => Promise<unknown>;
}

export interface AppUpdateCheckResult {
  phase: Exclude<AppUpdatePhase, 'idle' | 'checking'>;
  remote: RemoteAppVersion | null;
  checkedAt: number;
}

const initialState: AppUpdateState = {
  phase: 'idle',
  localVersion: APP_VERSION,
  localBuildId: APP_BUILD_ID,
  remoteVersion: null,
  remoteBuildId: null,
  checkedAt: null,
};

let state = initialState;
let checkPromise: Promise<AppUpdateCheckResult> | null = null;
const listeners = new Set<() => void>();

function publish(patch: Partial<AppUpdateState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function parseRemoteAppVersion(value: unknown): RemoteAppVersion | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(record.version)) return null;
  if (typeof record.buildId !== 'string' || record.buildId.trim().length === 0) return null;
  return { version: record.version, buildId: record.buildId.trim() };
}

export function isSameDeployment(
  localVersion: string,
  localBuildId: string,
  remote: RemoteAppVersion,
): boolean {
  return remote.version === localVersion && remote.buildId === localBuildId;
}

export async function resolveAppUpdateCheck(
  options: AppUpdateCheckOptions,
): Promise<AppUpdateCheckResult> {
  const checkedAt = options.now();
  if (!options.online) return { phase: 'offline', remote: null, checkedAt };
  try {
    const remote = parseRemoteAppVersion(await options.fetchRemote());
    if (!remote) return { phase: 'error', remote: null, checkedAt };
    return {
      phase: isSameDeployment(options.localVersion, options.localBuildId, remote) ? 'current' : 'available',
      remote,
      checkedAt,
    };
  } catch {
    return { phase: 'error', remote: null, checkedAt };
  }
}

async function fetchRemoteVersion(): Promise<unknown> {
  const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`version.json returned ${response.status}`);
  return response.json();
}

export function getAppUpdateState(): AppUpdateState {
  return state;
}

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function checkForAppUpdate(manual = true): Promise<AppUpdateCheckResult> {
  if (checkPromise) return checkPromise;
  if (manual) publish({ phase: 'checking' });
  checkPromise = resolveAppUpdateCheck({
    localVersion: APP_VERSION,
    localBuildId: APP_BUILD_ID,
    online: typeof navigator !== 'undefined' ? navigator.onLine : false,
    now: () => Date.now(),
    fetchRemote: fetchRemoteVersion,
  }).then((result) => {
    publish({
      phase: result.phase,
      remoteVersion: result.remote?.version ?? null,
      remoteBuildId: result.remote?.buildId ?? null,
      checkedAt: result.checkedAt,
    });
    return result;
  }).finally(() => {
    checkPromise = null;
  });
  return checkPromise;
}

export function startAppUpdateMonitor(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const checkQuietly = () => {
    if (document.visibilityState !== 'visible') return;
    void checkForAppUpdate(false);
  };
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') checkQuietly();
  };
  const timer = window.setInterval(checkQuietly, VERSION_CHECK_INTERVAL_MS);
  window.addEventListener('focus', checkQuietly);
  window.addEventListener('online', checkQuietly);
  document.addEventListener('visibilitychange', handleVisibility);
  checkQuietly();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', checkQuietly);
    window.removeEventListener('online', checkQuietly);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

export function appUpdateStatusText(update: AppUpdateState): string {
  if (update.phase === 'checking') return '正在核对最新版本';
  if (update.phase === 'available') return `发现 v${update.remoteVersion ?? '新版本'}`;
  if (update.phase === 'offline') return '当前离线，稍后再试';
  if (update.phase === 'error') return '暂时无法检查更新';
  if (update.phase === 'current') return '已是最新';
  return '尚未检查';
}
