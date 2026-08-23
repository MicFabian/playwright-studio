import { describe, expect, it } from 'vitest';
// @ts-expect-error - the runner is plain JavaScript with no type declarations.
import { RunManager } from './run-manager.mjs';

function manager(rootDir: string, overrides = {}) {
  return new RunManager({
    rootDir,
    workspaceDir: '/work',
    runsDir: '/work/runs',
    compile: () => ({ source: '', diagnostics: [], stepLocations: {} }),
    ...overrides,
  });
}

describe('resolving files a spawned process must read', () => {
  it('uses the install directory when running from source', () => {
    const runner = manager('/app');

    expect(runner.resolveRunnable('node_modules/@playwright/test/cli.js')).toBe(
      '/app/node_modules/@playwright/test/cli.js',
    );
  });

  it('redirects into the unpacked directory when running from an archive', () => {
    const runner = manager('/Apps/Studio.app/Contents/Resources/app.asar');

    expect(runner.resolveRunnable('node_modules/@playwright/test/cli.js')).toBe(
      '/Apps/Studio.app/Contents/Resources/app.asar.unpacked/node_modules/@playwright/test/cli.js',
    );
  });

  it('writes run configs beside a resolvable node_modules, not inside the archive', () => {
    const packaged = manager('/Apps/Studio.app/Contents/Resources/app.asar');

    // The generated config imports '@playwright/test' by bare specifier, which
    // ESM resolves relative to the config file itself.
    expect(packaged.scratchDir).toBe(
      '/Apps/Studio.app/Contents/Resources/app.asar.unpacked/.studio-runs',
    );
    expect(packaged.scratchDir).not.toContain('app.asar/');
  });

  it('honours an explicit scratch directory', () => {
    expect(manager('/app', { scratchDir: '/tmp/custom' }).scratchDir).toBe('/tmp/custom');
  });
});
