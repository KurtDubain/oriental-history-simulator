import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const checker = readFileSync(join(project, 'scripts/check-release.ts'), 'utf8');
const runner = join(project, 'node_modules/vite-node/vite-node.mjs');
const editions = ['personal', 'contest'];

function fixture(t, { initialCommit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'history-release-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  // Isolate test fixtures from the host's CI variables, not the actual build process.
  for (const key of ['OHS_RELEASE_BASE', 'VERCEL_GIT_COMMIT_REF', 'RELEASE_REQUIRE_VERSION_BUMP', 'OHS_EDITION', 'OHS_MAP_PROFILE_ALLOWLIST', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file, text) => { mkdirSync(resolve(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), text); };
  const version = value => {
    put('package.json', JSON.stringify({ type: 'module', version: value }));
    put('package-lock.json', JSON.stringify({ version: value, packages: { '': { version: value } } }));
    for (const file of ['changelog.ts', 'changelog.contest.ts']) {
      put(`src/config/${file}`, `export const APP_RELEASES = [{version:'${value}',date:'2026-09-13',title:'Fixture',items:['test']}];`);
    }
  };
  const commit = message => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.name', 'Release Contract Test'); git('config', 'user.email', 'release@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  version('1.0.0'); put('src/app.ts', 'export const value = 0;');
  put('scripts/check-release.ts', checker); put('vite.config.mjs', 'export default {};');
  if (initialCommit) commit('initial release');
  const check = (edition, vars = { VERCEL_GIT_COMMIT_REF: 'main' }, cwd = dir) => {
    const result = spawnSync(process.execPath, [runner, '--root', cwd, '--config', join(cwd, 'vite.config.mjs'), '--mode', edition, join(cwd, 'scripts/check-release.ts')], {
      cwd, env: { ...env, ...vars }, encoding: 'utf8',
    });
    assert.equal(result.error, undefined);
    return { status: result.status, text: result.stdout + result.stderr };
  };
  const expect = (passes, pattern, vars, cwd) => {
    for (const edition of editions) {
      const result = check(edition, vars, cwd);
      assert.equal(result.status === 0, passes, `${edition}: ${result.text}`);
      assert.match(result.text, pattern);
    }
  };
  return { dir, env, git, put, version, commit, expect };
}

test('a production release followed by documentation-only commits builds without another bump', t => {
  const f = fixture(t);
  f.put('src/app.ts', 'export const value = 1;'); f.version('1.0.1');
  f.commit('production release');
  f.expect(true, /Release metadata OK/);
  for (const file of ['progress.md', 'README.md', 'docs/notes.md']) {
    f.put(file, 'Review notes.'); f.commit(`document ${file}`);
    f.expect(true, /Release metadata OK/);
  }
});

test('clean committed production changes still require a version change', t => {
  for (const file of ['src/app.ts', 'scripts/task.mjs', 'vite.config.ts', '.github/workflows/build.yml']) {
    const f = fixture(t);
    f.put(file, 'export const value = 1;'); f.commit('production without bump');
    f.expect(false, /生产更新必须提升版本号/);
    f.version('1.0.1'); f.commit('release metadata');
    f.expect(true, /Release metadata OK/);
  }
});

test('working-tree, staged and untracked production changes are checked against HEAD', t => {
  const f = fixture(t);
  f.version('1.0.1'); f.commit('previous release already bumped');
  f.put('src/app.ts', 'export const value = 2;');
  f.expect(false, /生产更新必须提升版本号/, {});
  f.expect(false, /生产更新必须提升版本号/);
  f.git('add', 'src/app.ts');
  f.expect(false, /生产更新必须提升版本号/, {});
  f.put('scripts/new.mjs', 'export {};');
  f.expect(false, /生产更新必须提升版本号/, {});
  f.version('1.0.2'); f.expect(true, /Release metadata OK/, {});
  const untracked = fixture(t); untracked.put('scripts/new.mjs', 'export {};');
  untracked.expect(false, /生产更新必须提升版本号/, {});
});

test('metadata mismatches fail even when the only commit is documentation', t => {
  const f = fixture(t); f.put('progress.md', 'notes'); f.commit('docs');
  for (const [file, content, message] of [
    ['package.json', JSON.stringify({ type: 'module', version: '1.0.2' }), /发布记录与包版本不一致/],
    ['package-lock.json', JSON.stringify({ version: '1.0.2', packages: { '': { version: '1.0.0' } } }), /package-lock.json 根版本/],
    ['package-lock.json', JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.2' } } }), /package-lock.json 根版本/],
    ['src/config/changelog.ts', "export const APP_RELEASES=[{version:'1.0.2'}];", /发布记录与包版本不一致/],
    ['src/config/changelog.contest.ts', "export const APP_RELEASES=[{version:'1.0.2'}];", /参赛版发布记录与包版本不一致/],
  ]) {
    f.version('1.0.0'); f.put(file, content); f.expect(false, message);
  }
});

test('an explicit multi-commit range cannot hide production changes behind the final docs commit', t => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('src/app.ts', 'export const value = 1;'); f.commit('unreleased production');
  f.put('README.md', 'notes'); f.commit('docs');
  f.expect(true, /Release metadata OK/); // Default scope is the last commit only.
  for (const vars of [{ OHS_RELEASE_BASE: base }, { OHS_RELEASE_BASE: base, VERCEL_GIT_COMMIT_REF: 'main' }]) {
    f.expect(false, /生产更新必须提升版本号/, vars);
  }
  f.version('1.0.1'); f.expect(true, /Release metadata OK/, { OHS_RELEASE_BASE: base, VERCEL_GIT_COMMIT_REF: 'main' });
});

test('a divergent explicit ref uses the same merge base for files and package version', t => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('src/app.ts', 'export const value = 1;'); f.commit('unreleased branch');
  f.git('checkout', '-qb', 'upstream', base); f.version('1.0.1'); f.commit('upstream release');
  f.git('checkout', '-q', 'main');
  f.expect(false, /生产更新必须提升版本号/, { OHS_RELEASE_BASE: 'upstream', VERCEL_GIT_COMMIT_REF: 'main' });
});

test('moving production files into docs is still a production removal', t => {
  const f = fixture(t); f.git('mv', 'src/app.ts', 'README.md'); f.commit('move source out');
  f.expect(false, /生产更新必须提升版本号/);
});

test('invalid, self and unavailable shallow baselines fail explicitly instead of looking like docs', t => {
  const f = fixture(t); f.put('README.md', 'notes'); f.commit('docs');
  for (const base of ['missing-ref', 'HEAD']) {
    f.expect(false, /无法核验发布差异|基线必须早于 HEAD/, { OHS_RELEASE_BASE: base, VERCEL_GIT_COMMIT_REF: 'main' });
  }
  const shallow = join(f.dir, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth=1', `file://${f.dir}`, shallow], { env: f.env });
  f.expect(false, /无法核验发布差异/, { VERCEL_GIT_COMMIT_REF: 'main' }, shallow);
  execFileSync('git', ['fetch', '-q', '--depth=2', 'origin'], { cwd: shallow, env: f.env });
  f.expect(true, /Release metadata OK/, { VERCEL_GIT_COMMIT_REF: 'main' }, shallow);
});

test('a root commit, missing Git or missing baseline package is not a verified docs-only change', t => {
  const f = fixture(t);
  f.expect(false, /无法核验发布差异/); // HEAD^ is absent.
  const untracked = join(f.dir, 'source-export');
  mkdirSync(untracked);
  // Remove Git only from a dedicated fixture copy; never touch the actual repository.
  execFileSync('git', ['clone', '-q', f.dir, join(untracked, 'copy')], { env: f.env });
  rmSync(join(untracked, 'copy', '.git'), { recursive: true, force: true });
  f.expect(false, /无法核验发布差异/, { VERCEL_GIT_COMMIT_REF: 'main', GIT_CEILING_DIRECTORIES: untracked }, join(untracked, 'copy'));
  const missing = fixture(t, { initialCommit: false });
  missing.put('README.md', 'before project'); missing.git('add', 'README.md'); missing.git('commit', '-qm', 'before package');
  missing.commit('introduce project');
  missing.expect(false, /无法核验发布差异/);
});
