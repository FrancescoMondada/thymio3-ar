import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

// The Thymio 3 API is not vendored: package.json depends on github:Mobsya/thymio3-ts-api#main and we alias
// its TypeScript entry point (the same arrangement as thymio3-cockpit, thymio3-face and the others).
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      'thymio-api': resolve(here, 'node_modules/thymio3-ts-api/src/thymio.ts'),
    },
  },
});
