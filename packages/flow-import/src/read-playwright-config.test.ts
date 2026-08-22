import { describe, expect, it } from 'vitest';
import { findFixtureModules, readPlaywrightConfig } from './read-playwright-config';

describe('reading a Playwright config', () => {
  it('reads the settings Studio needs from a defineConfig call', () => {
    const info = readPlaywrightConfig(`
      import { defineConfig, devices } from '@playwright/test';

      export default defineConfig({
        testDir: './tests/e2e',
        use: {
          baseURL: 'https://staging.example.com',
          testIdAttribute: 'data-qa',
        },
        webServer: { command: 'npm run dev', url: 'http://localhost:3000' },
        projects: [
          { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
          { name: 'mobile', use: { ...devices['iPhone 14'] } },
        ],
      });
    `);

    expect(info.testDir).toBe('./tests/e2e');
    expect(info.baseURL).toBe('https://staging.example.com');
    expect(info.testIdAttribute).toBe('data-qa');
    expect(info.hasWebServer).toBe(true);
    expect(info.projects).toEqual([
      { name: 'chromium', device: 'Desktop Chrome' },
      { name: 'mobile', device: 'iPhone 14' },
    ]);
  });

  it('reads a plain exported object without defineConfig', () => {
    const info = readPlaywrightConfig(`
      export default {
        testDir: './e2e',
        use: { baseURL: 'http://localhost:4000' },
      };
    `);

    expect(info.testDir).toBe('./e2e');
    expect(info.baseURL).toBe('http://localhost:4000');
  });

  it('reports a computed baseURL instead of guessing at it', () => {
    const info = readPlaywrightConfig(`
      import { defineConfig } from '@playwright/test';

      export default defineConfig({
        use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000' },
      });
    `);

    expect(info.baseURL).toBeNull();
    expect(info.diagnostics.map((diagnostic) => diagnostic.code)).toContain('dynamic-base-url');
  });

  it('reports a config it cannot understand rather than throwing', () => {
    const info = readPlaywrightConfig('const config = buildConfig(); export default config;');

    expect(info.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'config-not-understood',
    );
    expect(info.projects).toEqual([]);
  });

  it('survives a config with no use block', () => {
    const info = readPlaywrightConfig(`
      import { defineConfig } from '@playwright/test';
      export default defineConfig({ testDir: './e2e' });
    `);

    expect(info.baseURL).toBeNull();
    expect(info.testIdAttribute).toBeNull();
    expect(info.hasWebServer).toBe(false);
  });
});

describe('finding fixture modules', () => {
  it('detects an extended test export', () => {
    const exports = findFixtureModules(`
      import { test as base } from '@playwright/test';

      export const test = base.extend<{ signedIn: void }>({
        signedIn: async ({ page }, use) => { await use(); },
      });

      export { expect } from '@playwright/test';
    `);

    expect(exports).toContain('test');
    expect(exports).toContain('expect');
  });

  it('detects merged fixtures', () => {
    const exports = findFixtureModules(`
      import { mergeTests } from '@playwright/test';
      export const test = mergeTests(authTest, dataTest);
    `);

    expect(exports).toContain('test');
  });

  it('ignores a module with no fixtures', () => {
    expect(findFixtureModules('export const helper = () => {};')).toEqual([]);
  });
});
