import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { resolveBuildTarget, buildMetadata, sourceCommitId } from './scripts/build-target.mjs';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';
import { MAP_PROFILE_CATALOG as FULL_MAP_PROFILE_CATALOG } from './src/maps/catalog';
import { MAP_PROFILE_CATALOG as CONTEST_MAP_PROFILE_CATALOG } from './src/maps/catalog.contest';
import { serializeApplicationJson } from './src/maps/html-payload';
import type { MapProfile } from './src/maps/types';

export default defineConfig(({ mode }) => {
const runtimeProcess = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process;
const env = { ...loadEnv(mode, '.', ''), ...runtimeProcess?.env };
const target = resolveBuildTarget(mode, env);
const commitId = sourceCommitId(env);
const contestBuild = target.edition === 'contest';
const mapCatalogPath = decodeURIComponent(new URL(
  `./src/maps/${target.catalog}`,
  import.meta.url,
).pathname);
const changelogPath = decodeURIComponent(new URL(
  `./src/config/${target.changelog}`,
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
          allowlist: metadata.profiles.map(profile => profile.id),
          profiles: metadata.profiles,
        })}\n`,
      });
    },
  };
}

function appVersionAsset(): Plugin {
  return {
    name: 'canghai-app-version-asset',
    transformIndexHtml(html) {
      return html.split('__APP_VERSION_TEXT__').join(`v${packageJson.version}`);
    },
    configureServer(server) {
      server.middlewares.use('/version.json', (_request, response) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.end(`${JSON.stringify(metadata)}\n`);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(metadata)}\n`,
      });
    },
  };
}

const buildMapProfiles = contestBuild
  ? CONTEST_MAP_PROFILE_CATALOG
  : FULL_MAP_PROFILE_CATALOG;
const metadata = buildMetadata(target, packageJson.version, commitId, buildMapProfiles);

return {
  resolve: {
    alias: {
      '@app-changelog': changelogPath,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_ID__: JSON.stringify(metadata.buildId),
    __APP_EDITION__: JSON.stringify(target.edition),
    __APP_EDITION_LABEL__: JSON.stringify(target.label),
    __APP_ICP_FOOTER__: JSON.stringify(target.icpFooter),
  },
  plugins: [
    mapProfilePayload(buildMapProfiles, mapCatalogPath),
    contestIsolation(contestBuild),
    appVersionAsset(),
    react(),
  ],
  build: {
    outDir: target.outDir,
    minify: 'terser',
    terserOptions: {
      // Vite emits ES modules; declaring that boundary lets Terser remove
      // top-level-only scaffolding consistently across local and Vercel Node.
      module: true,
      // JSON and authenticated world/Facts distinguish booleans from 0/1.
      // Avoid duplicating function bodies: slightly larger raw JS compresses
      // better across these domain chunks. Keep authenticated values unchanged.
      compress: { ecma: 2020, passes: 5, inline: false, reduce_funcs: false, pure_getters: true, booleans_as_integers: false, keep_fargs: false, unsafe_arrows: true, unsafe_comps: true },
      mangle: { toplevel: true },
      format: { ecma: 2020, comments: false },
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
          if (normalized.endsWith('/src/sim/military/personal-forces.ts') || normalized.endsWith('/src/sim/military/orders.ts')) {
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
};
});
