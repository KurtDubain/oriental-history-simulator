import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_RELEASES } from '../src/config/changelog';

interface PackageMetadata {
  version?: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as PackageMetadata;
const currentVersion = packageMetadata.version;
const latestRelease = APP_RELEASES[0];

if (!currentVersion || !/^\d+\.\d+\.\d+$/.test(currentVersion)) {
  throw new Error('package.json 必须提供有效的 SemVer 版本号。');
}
if (!latestRelease || latestRelease.version !== currentVersion) {
  throw new Error(
    `发布记录与包版本不一致：release=${latestRelease?.version ?? 'missing'} package=${currentVersion}`,
  );
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(latestRelease.date) || latestRelease.items.length === 0) {
  throw new Error('最新发布记录必须包含 YYYY-MM-DD 日期和至少一条更新内容。');
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const workingChanges = git(['diff', '--name-only', 'HEAD'])?.split('\n').filter(Boolean) ?? [];
const productionFilesChanged = workingChanges.some((file) => (
  file === 'package.json'
  || file === 'vite.config.ts'
  || file === 'vercel.json'
  || file === 'index.html'
  || file.startsWith('src/')
  || file.startsWith('public/')
));
const productionDeployment = process.env.VERCEL_GIT_COMMIT_REF === 'main'
  || process.env.RELEASE_REQUIRE_VERSION_BUMP === '1';

let comparisonRef: string | null = null;
if (productionDeployment) comparisonRef = process.env.OHS_RELEASE_BASE?.trim() || 'HEAD^';
else if (productionFilesChanged) comparisonRef = 'HEAD';

if (comparisonRef) {
  const basePackageText = git(['show', `${comparisonRef}:package.json`]);
  if (basePackageText) {
    const basePackage = JSON.parse(basePackageText) as PackageMetadata;
    if (basePackage.version === currentVersion) {
      throw new Error(`生产更新必须提升版本号，当前仍为 v${currentVersion}。`);
    }
  }
}

console.log(`Release metadata OK: v${currentVersion} · ${latestRelease.title} · base ${comparisonRef ?? 'metadata-only'}`);
