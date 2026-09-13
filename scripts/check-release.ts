import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_RELEASES } from '../src/config/changelog';
import { APP_RELEASES as CONTEST_APP_RELEASES } from '../src/config/changelog.contest';

interface PackageMetadata {
  version?: string;
}

interface PackageLockMetadata extends PackageMetadata {
  packages?: Record<string, PackageMetadata>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as PackageMetadata;
const packageLockMetadata = JSON.parse(
  readFileSync(resolve(root, 'package-lock.json'), 'utf8'),
) as PackageLockMetadata;
const currentVersion = packageMetadata.version;
const latestRelease = APP_RELEASES[0];
const latestContestRelease = CONTEST_APP_RELEASES[0];

if (!currentVersion || !/^\d+\.\d+\.\d+$/.test(currentVersion)) {
  throw new Error('package.json 必须提供有效的 SemVer 版本号。');
}
if (!latestRelease || latestRelease.version !== currentVersion) {
  throw new Error(
    `发布记录与包版本不一致：release=${latestRelease?.version ?? 'missing'} package=${currentVersion}`,
  );
}
if (!latestContestRelease || latestContestRelease.version !== currentVersion) {
  throw new Error(
    `参赛版发布记录与包版本不一致：release=${latestContestRelease?.version ?? 'missing'} package=${currentVersion}`,
  );
}
if (
  packageLockMetadata.version !== currentVersion
  || packageLockMetadata.packages?.['']?.version !== currentVersion
) {
  throw new Error('package-lock.json 根版本必须与 package.json 保持一致。');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(latestRelease.date) || latestRelease.items.length === 0) {
  throw new Error('最新发布记录必须包含 YYYY-MM-DD 日期和至少一条更新内容。');
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error(`无法核验发布差异：git ${args.join(' ')} 查询失败。请补齐 Git 历史（含浅克隆父提交），或提供可解析的 OHS_RELEASE_BASE；不会按纯文档变更放行。`);
  }
}

function changedFiles(...refs: string[]): string[] {
  // Count both sides of renames: moving src/foo into docs still removes production code.
  return git(['diff', '--no-renames', '--name-only', '-z', ...refs, '--']).split('\0').filter(Boolean);
}

function affectsRelease(file: string): boolean {
  return (
    file === 'package.json'
    || file === 'package-lock.json'
    || file === '.npmrc'
    || file === 'vite.config.ts'
    || file === 'vercel.json'
    || file === 'index.html'
    || file.startsWith('tsconfig')
    || file.startsWith('scripts/')
    || file.startsWith('src/')
    || file.startsWith('public/')
    || file.startsWith('.github/workflows/')
  );
}

const requestedBase = process.env.OHS_RELEASE_BASE?.trim() || null;
const productionDeployment = process.env.VERCEL_GIT_COMMIT_REF === 'main'
  || process.env.RELEASE_REQUIRE_VERSION_BUMP === '1';
const workingChanges = [
  ...changedFiles('HEAD'),
  ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean),
];
let committedBase: string | null = null;
if (requestedBase || productionDeployment) {
  const ref = git(['rev-parse', '--verify', '--end-of-options', `${requestedBase || 'HEAD^'}^{commit}`]).trim();
  // Preserve explicit three-dot/PR semantics, but use its actual merge base for BOTH checks.
  committedBase = requestedBase ? git(['merge-base', ref, 'HEAD']).trim() : ref;
  if (committedBase === git(['rev-parse', 'HEAD']).trim()) {
    throw new Error('发布比较基线必须早于 HEAD，不能用 HEAD 自身跳过已提交变更检查。');
  }
}
const comparisons = workingChanges.some(affectsRelease) ? ['HEAD'] : [];
if (committedBase && changedFiles(committedBase, 'HEAD').some(affectsRelease)) comparisons.push(committedBase);

for (const comparisonRef of comparisons) {
  const basePackage = JSON.parse(git(['show', `${comparisonRef}:package.json`])) as PackageMetadata;
  if (!basePackage.version || !/^\d+\.\d+\.\d+$/.test(basePackage.version)) {
    throw new Error(`无法核验发布差异：基线 ${comparisonRef} 的 package.json 没有有效版本。`);
  }
  if (basePackage.version === currentVersion) {
    throw new Error(`生产更新必须提升版本号，当前仍为 v${currentVersion}。`);
  }
}

console.log(`Release metadata OK: v${currentVersion} · ${latestRelease.title} · base ${comparisons.join(',') || 'metadata-only'} · committed range ${committedBase ? `${committedBase}..HEAD` : 'none'}`);
