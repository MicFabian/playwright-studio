import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    environmentMatchGlobs: [['src/**', 'jsdom']],
    setupFiles: ['src/test-setup.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Only source we author and can meaningfully test: build output, the
      // packaged app, and config files would otherwise dominate the numbers.
      include: ['packages/*/src/**/*.ts', 'src/**/*.{ts,tsx}', 'server/**/*.mjs', 'server.mjs'],
      exclude: ['**/*.test.{ts,tsx}', 'src/main.tsx', 'src/lib/flowCore.ts'],
      reporter: ['text-summary', 'json-summary'],
      // A floor, not a target: set just below today's numbers so a real drop
      // fails the build without the threshold needing constant edits.
      thresholds: {
        statements: 45,
        branches: 70,
        functions: 75,
      },
    },
  },
});
