import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: [
      {
        // @versatly/clawvault-core/lib/foo.js → ../core/src/lib/foo.ts
        find: /^@versatly\/clawvault-core\/(.+)\.js$/,
        replacement: resolve(__dirname, '../core/src/$1.ts'),
      },
      {
        // @versatly/clawvault-core/lib/foo → ../core/src/lib/foo.ts
        find: /^@versatly\/clawvault-core\/(.+)$/,
        replacement: resolve(__dirname, '../core/src/$1.ts'),
      },
      {
        find: '@versatly/clawvault-core',
        replacement: resolve(__dirname, '../core/src/index.ts'),
      },
    ],
  },
});
