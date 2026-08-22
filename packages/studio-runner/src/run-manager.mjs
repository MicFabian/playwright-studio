import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const RETENTION = {
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxRunsPerTest: 20,
};

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'cancelled', 'timedOut', 'interrupted']);

async function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, contents);
  await fs.rename(temporaryPath, filePath);
}

async function directorySize(directory) {
  let total = 0;

  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      const stats = await fs.stat(entryPath).catch(() => null);
      total += stats?.size ?? 0;
    }
  };

  await walk(directory);
  return total;
}

export class RunManager extends EventEmitter {
  constructor({
    rootDir,
    workspaceDir,
    runsDir,
    compile,
    loadDocument,
    resolveCompileOptions,
    testImport = '@playwright/test',
  }) {
    super();
    this.rootDir = rootDir;
    this.workspaceDir = workspaceDir ?? rootDir;
    this.runsDir = runsDir;
    this.compile = compile;
    this.loadDocument = loadDocument;
    this.testImport = testImport;
    this.resolveCompileOptions = resolveCompileOptions;
    this.active = new Map();
  }

  runDirectory(runId) {
    return path.join(this.runsDir, runId);
  }

  async readManifest(runId) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.runDirectory(runId), 'run.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  async writeManifest(manifest) {
    await writeAtomic(
      path.join(this.runDirectory(manifest.id), 'run.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  async listRuns() {
    const entries = await fs.readdir(this.runsDir, { withFileTypes: true }).catch(() => []);
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readManifest(entry.name)),
    );

    return manifests
      .filter(Boolean)
      .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
  }

  async reconcile() {
    const runs = await this.listRuns();

    for (const manifest of runs) {
      if (TERMINAL_STATUSES.has(manifest.status) || this.active.has(manifest.id)) {
        continue;
      }

      await this.writeManifest({
        ...manifest,
        status: 'interrupted',
        error: 'The Studio server stopped while this run was in progress.',
        finishedAt: manifest.finishedAt ?? new Date().toISOString(),
      });
    }
  }

  async collectGarbage() {
    const runs = await this.listRuns();
    const now = Date.now();
    const perTest = new Map();
    const removals = new Set();

    for (const manifest of runs) {
      if (this.active.has(manifest.id) || manifest.pinned) {
        continue;
      }

      const startedAt = Date.parse(manifest.startedAt ?? '') || 0;

      if (startedAt && now - startedAt > RETENTION.maxAgeMs) {
        removals.add(manifest.id);
        continue;
      }

      const seen = perTest.get(manifest.testId) ?? [];
      seen.push(manifest);
      perTest.set(manifest.testId, seen);
    }

    perTest.forEach((manifests) => {
      manifests
        .slice(RETENTION.maxRunsPerTest)
        .forEach((manifest) => removals.add(manifest.id));
    });

    const survivors = runs.filter(
      (manifest) => !removals.has(manifest.id) && !manifest.pinned && !this.active.has(manifest.id),
    );

    let totalBytes = 0;
    const sized = [];

    for (const manifest of survivors) {
      const bytes = await directorySize(this.runDirectory(manifest.id));
      totalBytes += bytes;
      sized.push({ manifest, bytes });
    }

    const failedFirst = [...sized].sort((left, right) => {
      const leftPassed = left.manifest.status === 'passed' ? 0 : 1;
      const rightPassed = right.manifest.status === 'passed' ? 0 : 1;

      if (leftPassed !== rightPassed) {
        return leftPassed - rightPassed;
      }

      return String(left.manifest.startedAt).localeCompare(String(right.manifest.startedAt));
    });

    for (const entry of failedFirst) {
      if (totalBytes <= RETENTION.maxTotalBytes) {
        break;
      }

      removals.add(entry.manifest.id);
      totalBytes -= entry.bytes;
    }

    for (const runId of removals) {
      await fs.rm(this.runDirectory(runId), { recursive: true, force: true });
    }

    return removals.size;
  }

  async appendEvent(runId, event) {
    const record = { ...event, seq: (this.active.get(runId)?.seq ?? 0) + 1 };
    const state = this.active.get(runId);

    if (state) {
      state.seq = record.seq;
      state.events.push(record);
    }

    await fs.appendFile(
      path.join(this.runDirectory(runId), 'events.ndjson'),
      `${JSON.stringify(record)}\n`,
    );

    this.emit('event', runId, record);
    return record;
  }

  async readEvents(runId, afterSeq = 0) {
    try {
      const raw = await fs.readFile(path.join(this.runDirectory(runId), 'events.ndjson'), 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((event) => (event.seq ?? 0) > afterSeq);
    } catch {
      return [];
    }
  }

  async start({ testId, testName, liveMode = false, document }) {
    const runId = randomUUID();
    const runDir = this.runDirectory(runId);
    const artifactsDir = path.join(runDir, 'artifacts');

    await fs.mkdir(artifactsDir, { recursive: true });

    const resolved = (await this.resolveCompileOptions?.()) ?? {};
    const compiled = this.compile(document, {
      testImport: this.testImport,
      ...resolved,
      profile: 'studio-run',
    });

    const blocking = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

    if (blocking.length > 0) {
      const manifest = {
        id: runId,
        testId,
        testName,
        status: 'failed',
        liveMode,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: blocking[0].message,
        diagnostics: compiled.diagnostics,
        steps: [],
      };

      await this.writeManifest(manifest);
      return manifest;
    }

    const specPath = path.join(runDir, 'generated.spec.ts');
    await fs.writeFile(specPath, compiled.source);
    await writeAtomic(
      path.join(runDir, 'node-map.json'),
      `${JSON.stringify(compiled.stepLocations, null, 2)}\n`,
    );

    const steps = Object.keys(compiled.stepLocations).map((stepId, index) => ({
      index,
      stepId,
      status: 'queued',
      durationMs: null,
      error: null,
    }));

    const manifest = {
      id: runId,
      testId,
      testName,
      status: 'running',
      liveMode,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      diagnostics: compiled.diagnostics,
      steps,
    };

    await this.writeManifest(manifest);

    const configDir = path.join(this.rootDir, '.studio-runs');
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, `${runId}.config.mjs`);
    await fs.writeFile(
      configPath,
      [
        "import { defineConfig, devices } from '@playwright/test';",
        '',
        'export default defineConfig({',
        `  testDir: ${JSON.stringify(runDir)},`,
        '  timeout: 60000,',
        '  workers: 1,',
        '  retries: 0,',
        `  reporter: [[${JSON.stringify(
          path.join(this.rootDir, 'packages/studio-runner/src/reporter.mjs'),
        )}]],`,
        '  use: {',
        '    trace: "on",',
        '    video: "retain-on-failure",',
        '    screenshot: "only-on-failure",',
        `    headless: ${!liveMode},`,
        '    ...devices["Desktop Chrome"],',
        '  },',
        `  outputDir: ${JSON.stringify(artifactsDir)},`,
        '});',
        '',
      ].join('\n'),
    );

    this.active.set(runId, { seq: 0, events: [], manifest });

    await this.appendEvent(runId, { type: 'run:queued', runId, testId, at: Date.now() });

    void this.execute(runId, configPath, manifest);

    return manifest;
  }

  async execute(runId, configPath, initialManifest) {
    const runDir = this.runDirectory(runId);
    const logStream = createWriteStream(path.join(runDir, 'output.log'));
    let manifest = { ...initialManifest };

    const child = spawn(
      process.execPath,
      [
        path.join(this.rootDir, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        configPath,
      ],
      {
        cwd: this.workspaceDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NODE_PATH: path.join(this.rootDir, 'node_modules'),
        },
      },
    );

    const state = this.active.get(runId);

    if (state) {
      state.child = child;
    }

    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    let buffer = '';

    child.stdio[3].on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        let event;

        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === 'step:started' && event.stepId) {
          manifest = {
            ...manifest,
            steps: manifest.steps.map((step) =>
              step.stepId === event.stepId ? { ...step, status: 'running' } : step,
            ),
          };
        }

        if (event.type === 'step:finished' && event.stepId) {
          manifest = {
            ...manifest,
            steps: manifest.steps.map((step) =>
              step.stepId === event.stepId
                ? {
                    ...step,
                    status: event.error ? 'failed' : 'passed',
                    durationMs: event.durationMs ?? null,
                    error: event.error ?? null,
                  }
                : step,
            ),
          };
        }

        void this.appendEvent(runId, event);
      }
    });

    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(1));
    });

    logStream.end();

    const finalState = this.active.get(runId);

    if (finalState?.killTimer) {
      clearTimeout(finalState.killTimer);
    }

    const cancelled = finalState?.cancelled === true;
    const artifacts = await this.collectArtifacts(runId);

    manifest = {
      ...manifest,
      status: cancelled ? 'cancelled' : exitCode === 0 ? 'passed' : 'failed',
      finishedAt: new Date().toISOString(),
      error:
        cancelled || exitCode === 0
          ? null
          : manifest.steps.find((step) => step.error)?.error || 'The test run failed.',
      artifacts,
    };

    await fs
      .rm(path.join(this.rootDir, '.studio-runs', `${runId}.config.mjs`), { force: true })
      .catch(() => undefined);

    await this.writeManifest(manifest);
    await this.appendEvent(runId, {
      type: 'run:finished',
      status: manifest.status,
      at: Date.now(),
    });

    this.active.delete(runId);
    void this.collectGarbage();
  }

  async collectArtifacts(runId) {
    const artifactsDir = path.join(this.runDirectory(runId), 'artifacts');
    const found = [];

    const walk = async (current, prefix) => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await walk(entryPath, relative);
          continue;
        }

        const stats = await fs.stat(entryPath).catch(() => null);
        const kind = entry.name.endsWith('.zip')
          ? 'trace'
          : entry.name.endsWith('.webm')
            ? 'video'
            : entry.name.endsWith('.png')
              ? 'screenshot'
              : 'other';

        found.push({ kind, relativePath: relative, sizeBytes: stats?.size ?? 0 });
      }
    };

    await walk(artifactsDir, '');
    return found;
  }

  async cancel(runId) {
    const state = this.active.get(runId);

    if (!state?.child) {
      return false;
    }

    state.cancelled = true;

    const { pid } = state.child;

    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      state.child.kill('SIGTERM');
    }

    state.killTimer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        state.child.kill('SIGKILL');
      }
    }, 5000);

    state.killTimer.unref?.();

    return true;
  }
}
