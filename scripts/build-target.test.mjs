import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveBuildTarget, buildMetadata, assertPreviewArtifact } from './build-target.mjs';

test('commands own the edition; deployment environment is independent', () => {
  for (const mode of ['development', 'production', 'test', 'personal']) {
    assert.equal(resolveBuildTarget(mode).outDir, 'dist');
  }
  for (const VERCEL_ENV of ['production', 'preview', 'development']) {
    assert.equal(resolveBuildTarget('contest', { VERCEL_ENV }).outDir, 'dist-contest');
  }
  assert.equal(resolveBuildTarget('contest', { OHS_EDITION: 'contest', OHS_MAP_PROFILE_ALLOWLIST: 'contest-v01' }).edition, 'contest');
  for (const mode of ['preview', 'staging', '', 'toString']) assert.throws(() => resolveBuildTarget(mode));
  for (const env of [{ OHS_EDITION: 'contest' }, { OHS_EDITION: 'unknown' }, { OHS_MAP_PROFILE_ALLOWLIST: 'contest-v01' }]) {
    assert.throws(() => resolveBuildTarget('personal', env));
  }
  assert.throws(() => resolveBuildTarget('contest', { OHS_MAP_PROFILE_ALLOWLIST: 'private-v03' }));
});

test('same version/commit remain distinguishable; preview rejects other or stale artifacts', () => {
  const profiles = [{ id: 'contest-v01', revision: 1, contentVersion: 'contest-v01-68', extra: 'not metadata' }];
  const personal = resolveBuildTarget('personal'), contest = resolveBuildTarget('contest');
  const a = buildMetadata(personal, '1.2.3', 'abcdef', profiles), b = buildMetadata(contest, '1.2.3', 'abcdef', profiles);
  assert.notEqual(a.buildId, b.buildId);
  assert.equal(a.commitId, b.commitId);
  assert.deepEqual(b.profiles, [{ id: 'contest-v01', revision: 1, contentVersion: 'contest-v01-68' }]);
  assertPreviewArtifact(contest, b, '1.2.3');
  assert.throws(() => assertPreviewArtifact(contest, a, '1.2.3'));
  assert.throws(() => assertPreviewArtifact(contest, b, '1.2.4'));
  assert.match(buildMetadata(contest, '1.2.3', null, profiles).buildId, /^contest-local-/);
});

test('CLI rejects conflicts and output/mode overrides before build/preview', () => {
  const env = { ...process.env, OHS_EDITION: 'contest' };
  const conflict = spawnSync(process.execPath, ['scripts/build-edition.mjs', 'build', 'personal'], { env, encoding: 'utf8' });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /conflicts/);
  delete env.OHS_EDITION; delete env.OHS_MAP_PROFILE_ALLOWLIST;
  for (const action of ['build', 'preview']) for (const flag of ['--outDir', '--mode', '--config']) {
    const result = spawnSync(process.execPath, ['scripts/build-edition.mjs', action, 'contest', flag, 'dist'], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /locked|Unsupported/);
  }
});

test('shared hosting config leaves build/output to projects and preserves static routes', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(config.buildCommand, undefined); assert.equal(config.outputDirectory, undefined);
  const fallback = new RegExp(`^${config.rewrites[0].source}$`);
  for (const path of ['/assets/app-hash.js', '/media/sfx/paper.mp3', '/version.json', '/contest-profile.json']) {
    assert.equal(fallback.test(path), false, path);
  }
  assert.equal(fallback.test('/history'), true);
  const cache = path => config.headers.find(h => h.source === path).headers.find(h => h.key === 'Cache-Control').value;
  assert.match(cache('/version.json'), /no-store/);
  assert.match(cache('/contest-profile.json'), /no-store/);
  assert.doesNotMatch(cache('/media/(.*)'), /immutable/);
  assert.match(cache('/assets/(.*)'), /immutable/);
});
