import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/**', 'jsdom']],
    environment: 'node',
  },
});
