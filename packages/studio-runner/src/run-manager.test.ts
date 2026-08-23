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

describe('the run queue', () => {
  it('drains every queued run and never leaves the counter stuck', async () => {
    const runner = manager('/app', { maxConcurrentRuns: 2 });
    const rejections: unknown[] = [];
    const onRejection = (error: unknown) => rejections.push(error);

    process.on('unhandledRejection', onRejection);

    let calls = 0;
    runner.execute = async () => {
      calls += 1;
      throw new Error('boom');
    };
    runner.writeManifest = async () => undefined;
    runner.readManifest = async () => null;

    for (let index = 0; index < 5; index += 1) {
      runner.queue.push({ runId: `r${index}`, configPath: '/tmp/x', manifest: {} });
    }

    runner.drainQueue();
    await new Promise((resolve) => setTimeout(resolve, 200));
    process.off('unhandledRejection', onRejection);

    expect(calls).toBe(5);
    expect(runner.running).toBe(0);
    expect(runner.queue).toHaveLength(0);
    expect(rejections).toHaveLength(0);
  });

  it('records a terminal status when a run fails to start', async () => {
    const runner = manager('/app');
    const written: { status?: string; error?: string }[] = [];

    runner.execute = async () => {
      throw new Error('could not spawn');
    };
    runner.readManifest = async () => ({ id: 'r1', status: 'running' });
    runner.writeManifest = async (manifest: { status?: string; error?: string }) => {
      written.push(manifest);
    };

    runner.queue.push({ runId: 'r1', configPath: '/tmp/x', manifest: {} });
    runner.drainQueue();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(written.at(-1)?.status).toBe('failed');
    expect(written.at(-1)?.error).toContain('could not spawn');
  });
});

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
