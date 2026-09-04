import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';
import { MAP_PROFILE_CATALOG as FULL_MAP_PROFILE_CATALOG } from './src/maps/catalog';
import { MAP_PROFILE_CATALOG as CONTEST_MAP_PROFILE_CATALOG } from './src/maps/catalog.contest';
import { serializeApplicationJson } from './src/maps/html-payload';
import type { MapProfile } from './src/maps/types';

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

const MAP_PROFILE_CATALOG_MODULE_ID = '@map-profile-catalog';
const MAP_PROFILE_DATA_ELEMENT_ID = 'canghai-map-profile-data';
const VIRTUAL_BROWSER_CATALOG_ID = '\0virtual:canghai-browser-map-profile-catalog';

function mapProfilePayload(
  profiles: readonly MapProfile[],
  serverCatalogPath: string,
): Plugin {
  const serializedProfiles = serializeApplicationJson(profiles);
  return {
    name: 'canghai-map-profile-payload',
    enforce: 'pre',
    resolveId(source, _importer, options) {
      if (source !== MAP_PROFILE_CATALOG_MODULE_ID) return null;
      // Tests and vite-node audits run as SSR and retain the source catalog.
      // Browser modules receive only a marker and load the payload from HTML.
      return options?.ssr ? serverCatalogPath : VIRTUAL_BROWSER_CATALOG_ID;
    },
    load(moduleId) {
      if (moduleId !== VIRTUAL_BROWSER_CATALOG_ID) return null;
      return 'export const MAP_PROFILE_CATALOG = undefined;';
    },
    transformIndexHtml() {
      return [{
        tag: 'script',
        attrs: {
          id: MAP_PROFILE_DATA_ELEMENT_ID,
          type: 'application/json',
        },
        children: serializedProfiles,
        injectTo: 'body-prepend',
      }];
    },
  };
}

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

const buildMapProfiles = contestBuild
  ? CONTEST_MAP_PROFILE_CATALOG
  : FULL_MAP_PROFILE_CATALOG;

export default defineConfig({
  resolve: {
    alias: {
      '@app-changelog': changelogPath,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    mapProfilePayload(buildMapProfiles, mapCatalogPath),
    contestIsolation(contestBuild),
    appVersionAsset(packageJson.version, buildId),
    react(),
  ],
  build: {
    minify: 'terser',
    terserOptions: {
      compress: { passes: 5, pure_getters: true },
      mangle: { toplevel: true },
      format: { comments: false },
    },
    // Keep stable domain boundaries cacheable without changing when modules execute.
    // Archive/fact primitives form an acyclic base chunk; the rest of the simulation
    // depends on it in one direction, so releases stay inside the original size budgets.
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
          if (normalized.includes('/node_modules/fflate/')) return 'framework';
          if (normalized.includes('/src/maps/')) return 'maps';
          if (normalized.endsWith('/src/sim/military/personal-forces.ts')) {
            return 'simulation-support';
          }
          if (
            normalized.includes('/src/sim/archive/')
            || normalized.includes('/src/sim/facts/')
            || normalized.endsWith('/src/sim/random.ts')
            || normalized.endsWith('/src/sim/world-hash.ts')
          ) return 'simulation-support';
          if (normalized.includes('/src/sim/politics/')) return 'simulation-support';
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
