import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';

const runtimeProcess = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process;
const buildId = runtimeProcess?.env?.VERCEL_GIT_COMMIT_SHA?.trim()
  || runtimeProcess?.env?.GITHUB_SHA?.trim()
  || `local-${packageJson.version}`;
const mapProfileAllowlist = runtimeProcess?.env?.OHS_MAP_PROFILE_ALLOWLIST?.trim();
if (mapProfileAllowlist && mapProfileAllowlist !== 'contest-v01') {
  throw new Error(`Unsupported OHS_MAP_PROFILE_ALLOWLIST: ${mapProfileAllowlist}`);
}
const contestBuild = mapProfileAllowlist === 'contest-v01';
const mapCatalogPath = decodeURIComponent(new URL(
  contestBuild
    ? './src/maps/catalog.contest.ts'
    : './src/maps/catalog.ts',
  import.meta.url,
).pathname);
const changelogPath = decodeURIComponent(new URL(
  contestBuild
    ? './src/config/changelog.contest.ts'
    : './src/config/changelog.ts',
  import.meta.url,
).pathname);

function contestIsolation(enabled: boolean): Plugin {
  return {
    name: 'canghai-contest-isolation',
    generateBundle(_options, bundle) {
      if (!enabled) return;
      const forbiddenModules = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const moduleId of Object.keys(output.modules)) {
          const normalized = moduleId.replaceAll('\\', '/');
          if (
            normalized.includes('/src/maps/private-v03/')
            || normalized.endsWith('/src/maps/catalog.ts')
            || normalized.endsWith('/src/config/changelog.ts')
          ) forbiddenModules.add(normalized);
        }
      }
      if (forbiddenModules.size > 0) {
        this.error(`Contest build imported private modules:\n${[...forbiddenModules].join('\n')}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'contest-profile.json',
        source: `${JSON.stringify({
          productVersion: packageJson.version,
          allowlist: ['contest-v01'],
          profiles: [{ id: 'contest-v01', revision: 1, contentVersion: 'contest-v01-68' }],
        })}\n`,
      });
    },
  };
}

function appVersionAsset(version: string, deploymentId: string): Plugin {
  return {
    name: 'canghai-app-version-asset',
    transformIndexHtml(html) {
      return html.split('__APP_VERSION_TEXT__').join(`v${version}`);
    },
    configureServer(server) {
      server.middlewares.use('/version.json', (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.end(`${JSON.stringify({ version, buildId: deploymentId })}\n`);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version, buildId: deploymentId })}\n`,
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@app-changelog': changelogPath,
      '@map-profile-catalog': mapCatalogPath,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [contestIsolation(contestBuild), appVersionAsset(packageJson.version, buildId), react()],
  build: {
    // Keep stable domain boundaries cacheable without changing when modules execute.
    // These are all static chunks: cold-start bytes stay effectively unchanged, while
    // ordinary UI releases no longer invalidate the framework, map, or simulation payloads.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          const normalized = moduleId.replaceAll('\\', '/');
          if (
            normalized.includes('/node_modules/react/')
            || normalized.includes('/node_modules/react-dom/')
            || normalized.includes('/node_modules/scheduler/')
          ) return 'framework';
          if (normalized.includes('/src/maps/')) return 'maps';
          if (normalized.includes('/src/sim/')) return 'simulation';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
