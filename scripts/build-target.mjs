import { execFileSync } from 'node:child_process';

// Build-time only. Browser code receives just the selected edition, never this catalog.
export const BUILD_TARGETS = Object.freeze({
  personal: { edition: 'personal', label: '个人版', outDir: 'dist', catalog: 'catalog.ts', changelog: 'changelog.ts' },
  contest: { edition: 'contest', label: '竞赛版', outDir: 'dist-contest', catalog: 'catalog.contest.ts', changelog: 'changelog.contest.ts' },
});

export function resolveBuildTarget(mode, env = {}) {
  const edition = ['development', 'production', 'test'].includes(mode) ? 'personal' : mode;
  if (!Object.hasOwn(BUILD_TARGETS, edition)) throw new Error(`Unknown build edition: ${mode}`);
  const target = BUILD_TARGETS[edition];
  if (env.OHS_EDITION !== undefined && env.OHS_EDITION !== edition) {
    throw new Error('OHS_EDITION conflicts with the build/preview command');
  }
  if (env.OHS_MAP_PROFILE_ALLOWLIST !== undefined
    && (edition !== 'contest' || env.OHS_MAP_PROFILE_ALLOWLIST !== 'contest-v01')) {
    throw new Error('OHS_MAP_PROFILE_ALLOWLIST conflicts with the build edition');
  }
  if (env.OHS_TENCENT_ICP !== undefined && !['0', '1'].includes(env.OHS_TENCENT_ICP)) {
    throw new Error('OHS_TENCENT_ICP must be 0 (default) or 1');
  }
  const icpFooter = env.OHS_TENCENT_ICP === '1';
  return { ...target, icpFooter, outDir: `${target.outDir}${icpFooter ? '-tencent' : ''}` };
}

export function buildMetadata(target, version, commitId, profiles) {
  return {
    version, edition: target.edition, commitId, icpFooter: target.icpFooter ?? false,
    buildId: `${target.edition}${target.icpFooter ? '-tencent' : ''}-${commitId || `local-${version}`}`,
    profiles: profiles.map(({ id, revision, contentVersion }) => ({ id, revision, contentVersion })),
  };
}

export function sourceCommitId(env) {
  const supplied = env.VERCEL_GIT_COMMIT_SHA?.trim() || env.GITHUB_SHA?.trim();
  if (supplied) return supplied;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; } // Source exports can legitimately lack Git metadata.
}

export function assertPreviewArtifact(target, metadata, version) {
  if (metadata.version !== version || metadata.edition !== target.edition
    || (metadata.icpFooter ?? false) !== (target.icpFooter ?? false)) {
    throw new Error(`Wrong or stale ${target.outDir}/version.json; run ${target.icpFooter ? 'OHS_TENCENT_ICP=1 ' : ''}npm run build:${target.edition}`);
  }
}
