import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createIsolatedWorkspace() {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'));

  mkdirSync(path.join(workspace, 'playwright-lowcode', 'tests'), { recursive: true });
  mkdirSync(path.join(workspace, 'playwright-lowcode', 'snippets'), { recursive: true });
  mkdirSync(path.join(workspace, 'tests', 'generated'), { recursive: true });
  copyFileSync(
    'playwright-lowcode/project.json',
    path.join(workspace, 'playwright-lowcode', 'project.json'),
  );

  for (const file of readdirSync('playwright-lowcode/tests')) {
    copyFileSync(
      path.join('playwright-lowcode/tests', file),
      path.join(workspace, 'playwright-lowcode', 'tests', file),
    );
  }

  return workspace;
}

const seedRoot = createIsolatedWorkspace();

const workspaceRoot = createIsolatedWorkspace();

const port = 5310;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PORT=${port} STUDIO_E2E=1 STUDIO_WORKSPACE_ROOT=${workspaceRoot} STUDIO_SEED_ROOT=${seedRoot} node server.mjs`,
    url: `${baseURL}/api/launch-token`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
