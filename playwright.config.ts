import { defineConfig, devices } from 'playwright/test';

const port = 5310;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 6_000,
  },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: `PORT=${port} npm run dev`,
    url: `${baseURL}/api/workspace`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
