import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    environmentMatchGlobs: [['src/**', 'jsdom']],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Only source we author and can meaningfully test: build output, the
      // packaged app, and config files would otherwise dominate the numbers.
      include: ['packages/*/src/**/*.ts', 'src/**/*.{ts,tsx}', 'server/**/*.mjs', 'server.mjs'],
      exclude: ['**/*.test.{ts,tsx}', 'src/main.tsx', 'src/lib/flowCore.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
