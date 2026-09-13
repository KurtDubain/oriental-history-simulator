import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolveBuildTarget, assertPreviewArtifact } from './build-target.mjs';

const [action, edition, ...args] = process.argv.slice(2);
if (!['build', 'preview'].includes(action) || !['personal', 'contest'].includes(edition)) {
  throw new Error('Usage: build-edition.mjs build|preview personal|contest');
}
const target = resolveBuildTarget(edition, process.env);
// Do not let inherited build assertions accidentally select the catalog for standalone checks.
const env = { ...process.env };
delete env.OHS_EDITION;
delete env.OHS_MAP_PROFILE_ALLOWLIST;
const run = (file, argv) => execFileSync(process.execPath, [file, ...argv], { stdio: 'inherit', env });
const check = file => run('node_modules/vite-node/vite-node.mjs', ['--mode', edition, `scripts/${file}.ts`]);

if (action === 'build') {
  if (args.length) throw new Error('Build edition and output are locked; extra arguments are not supported');
  check('check-release');
  check('validate-map-profiles');
  if (edition === 'contest') {
    run('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.contest.json']);
    run('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.node.json']);
  } else run('node_modules/typescript/bin/tsc', ['-b']);
  run('node_modules/vite/bin/vite.js', ['build', '--mode', edition]);
  if (edition === 'contest') check('verify-contest-bundle');
  run('node_modules/vite-node/vite-node.mjs', ['scripts/verify-bundle-budget.ts', target.outDir]);
  run('--test', ['scripts/verify-media-budget.test.mjs']);
  run('scripts/verify-media-budget.mjs', [target.outDir]);
} else {
  // Network/open options only: no alternate root, config, mode or output directory.
  let port = edition === 'personal' ? 4173 : 4174;
  let host = '127.0.0.1', open = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--open') open = true;
    else if (args[i] === '--host' && args[i + 1]) host = args[++i];
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] ?? '')) port = Number(args[++i]);
    else throw new Error(`Unsupported preview argument: ${args[i]}`);
  }
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  assertPreviewArtifact(target, JSON.parse(await readFile(`${target.outDir}/version.json`, 'utf8')), version);
  const { preview } = await import('vite');
  const server = await preview({ configFile: false, build: { outDir: target.outDir }, preview: { host, port, open, strictPort: true } });
  server.printUrls();
}
