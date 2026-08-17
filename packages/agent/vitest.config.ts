import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@pma/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@pma/agent': fileURLToPath(new URL('../agent/src/index.ts', import.meta.url)),
      '@pma/db': fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
