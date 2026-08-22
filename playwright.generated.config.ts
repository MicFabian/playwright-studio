import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/generated',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
