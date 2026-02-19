import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@versatly/clawvault-core': resolve(__dirname, '../core/src'),
    },
  },
});
