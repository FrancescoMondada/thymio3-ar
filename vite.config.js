import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));

// Which version is this? The short hash of the commit it was built from (the report of a test says it, so that a page kept open from before the last
// publication is not mistaken for the new one).
const build = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim(); } catch { return 'dev'; } })();

// The Thymio 3 API is not vendored: package.json depends on github:Mobsya/thymio3-ts-api#main and we alias
// its TypeScript entry point (the same arrangement as thymio3-cockpit, thymio3-face and the others).
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(`${build} ${new Date().toISOString().slice(0, 16)}Z`) },
  resolve: {
    alias: {
      'thymio-api': resolve(here, 'node_modules/thymio3-ts-api/src/thymio.ts'),
    },
  },
});
