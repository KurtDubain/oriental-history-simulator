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
    throw new Error(`无法核验发布差异：git ${args[0]} 查询失败。请补齐 Git 历史（含浅克隆父提交），或提供可解析的 OHS_RELEASE_BASE；不会按纯文档变更放行。`);
  }
}

function changedFiles(...refs: string[]): string[] {
  // Count both sides of renames: moving src/foo into docs still removes production code.
  return git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', ...refs, '--']).split('\0').filter(Boolean);
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
const head = git(['rev-parse', '--verify', 'HEAD']).trim();
// Build provenance assertions, not CI detection. Never log environment/configuration values.
const hostedGit = process.env.VERCEL === '1'
  && ['production', 'preview'].includes(process.env.VERCEL_ENV ?? '')
  && /^dpl_[a-zA-Z0-9]+$/.test(process.env.VERCEL_DEPLOYMENT_ID ?? '')
  && ['github', 'gitlab', 'bitbucket'].includes(process.env.VERCEL_GIT_PROVIDER ?? '')
  && ['VERCEL_GIT_REPO_OWNER', 'VERCEL_GIT_REPO_SLUG', 'VERCEL_GIT_COMMIT_REF']
    .every((key) => Boolean(process.env[key]?.trim()))
  && process.env.VERCEL_GIT_COMMIT_SHA === head;
const staged = changedFiles('--cached', 'HEAD');
const platformPaths = new Set<string>();
if (hostedGit) {
  // Only the two observed unstaged regular-file content rewrites; not modes, types or renames.
  const records = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--raw', '-z', '--', '.npmrc', 'vercel.json']).split('\0');
  for (let i = 0; i + 1 < records.length; i += 2) {
    if (/^:100644 100644 [0-9a-f]+ [0-9a-f]+ M$/.test(records[i]) && !staged.includes(records[i + 1])) {
      platformPaths.add(records[i + 1]);
    }
  }
}
const workingChanges = [
  ...staged,
  ...changedFiles().filter((file) => !platformPaths.has(file)),
  ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean),
];
let committedBase: string | null = null;
if (requestedBase || productionDeployment || hostedGit) {
  const ref = git(['rev-parse', '--verify', '--end-of-options', `${requestedBase || 'HEAD^'}^{commit}`]).trim();
  // Preserve explicit three-dot/PR semantics, but use its actual merge base for BOTH checks.
  committedBase = requestedBase ? git(['merge-base', ref, 'HEAD']).trim() : ref;
  if (committedBase === head) {
    throw new Error('发布比较基线必须早于 HEAD，不能用 HEAD 自身跳过已提交变更检查。');
  }
}
const comparisons = [
  { scope: '工作区', ref: 'HEAD', files: [...new Set(workingChanges)].filter(affectsRelease) },
  { scope: '已提交', ref: committedBase, files: committedBase ? changedFiles(committedBase, 'HEAD').filter(affectsRelease) : [] },
].filter((comparison) => comparison.files.length > 0);

for (const { scope, ref: comparisonRef, files } of comparisons) {
  const basePackage = JSON.parse(git(['show', `${comparisonRef}:package.json`])) as PackageMetadata;
  if (!basePackage.version || !/^\d+\.\d+\.\d+$/.test(basePackage.version)) {
    throw new Error(`无法核验发布差异：基线 ${comparisonRef} 的 package.json 没有有效版本。`);
  }
  if (basePackage.version === currentVersion) {
    throw new Error(`生产更新必须提升版本号，当前仍为 v${currentVersion}。${scope}变更；比较基线 ${comparisonRef}；触发路径 ${JSON.stringify(files)}；托管来源${hostedGit ? '已核验' : '未核验（来源信息不完整、不适用或 SHA 不符）'}。`);
  }
}

console.log(`Release metadata OK: v${currentVersion} · ${latestRelease.title} · base ${comparisons.map(({ ref }) => ref).join(',') || 'metadata-only'} · committed range ${committedBase ? `${committedBase}..HEAD` : 'none'} · 托管配置 ${JSON.stringify([...platformPaths])}`);
