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
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [appVersionAsset(packageJson.version, buildId), react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
