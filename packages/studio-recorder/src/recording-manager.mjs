import { spawn } from 'node:child_process';
import { promises as fs, watch } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const SNAPSHOT_DEBOUNCE_MS = 250;
const MAX_RECORDING_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_RECORDING_STEPS = 1000;
const MAX_LIFETIME_MS = 60 * 60 * 1000;
const KILL_ESCALATION_MS = 5000;

/**
 * Drives `playwright codegen` and turns what it writes into flow steps.
 *
 * Codegen rewrites its whole output file rather than appending, so every
 * snapshot is parsed as an authoritative replacement: it coalesces consecutive
 * fills and can revise the action it wrote a moment ago.
 */
export class RecordingManager extends EventEmitter {
  constructor({
    rootDir,
    workspaceDir,
    scratchDir,
    importSource,
    resolveRunnable,
    spawnProcess = spawn,
    watchFile = watch,
  }) {
    super();
    this.rootDir = rootDir;
    this.workspaceDir = workspaceDir;
    this.scratchDir = scratchDir;
    this.importSource = importSource;
    this.resolveRunnable = resolveRunnable ?? ((relative) => path.join(rootDir, relative));
    this.spawnProcess = spawnProcess;
    this.watchFile = watchFile;
    this.session = null;
  }

  get active() {
    return this.session != null && this.session.status !== 'review';
  }

  describe() {
    if (!this.session) {
      return null;
    }

    const { id, flowId, status, steps, diagnostics, error } = this.session;

    return { id, flowId, status, steps, diagnostics, error: error ?? null };
  }

  async start({ flowId, startUrl, testIdAttribute = 'data-testid' }) {
    if (this.session && this.session.status !== 'review') {
      const conflict = new Error('A recording is already in progress.');
      conflict.statusCode = 409;
      conflict.recordingId = this.session.id;
      throw conflict;
    }

    if (!/^https?:\/\//.test(startUrl) && startUrl !== 'about:blank') {
      const invalid = new Error('A recording can only start at an http or https address.');
      invalid.statusCode = 400;
      throw invalid;
    }

    const id = randomUUID();
    const directory = path.join(this.scratchDir, id);
    const sourcePath = path.join(directory, 'recorded.spec.ts');

    await fs.mkdir(directory, { recursive: true, mode: 0o700 });

    const child = this.spawnProcess(
      process.execPath,
      [
        this.resolveRunnable('node_modules/@playwright/test/cli.js'),
        'codegen',
        '--target=playwright-test',
        `--output=${sourcePath}`,
        `--test-id-attribute=${testIdAttribute}`,
        startUrl,
      ],
      {
        cwd: this.workspaceDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '0' },
      },
    );

    this.session = {
      id,
      flowId,
      status: 'starting',
      directory,
      sourcePath,
      child,
      steps: [],
      diagnostics: [],
      error: null,
      revision: 0,
      pendingRead: null,
      lifetime: setTimeout(() => void this.stop(id, 'timedOut'), MAX_LIFETIME_MS),
    };

    this.session.lifetime.unref?.();

    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);

      // Codegen writes progress to stderr; only a hard failure matters here.
      if (/Error|error:|not found/.test(text) && this.session?.id === id) {
        this.session.error = text.split('\n')[0].slice(0, 200);
      }
    });

    child.on('close', () => {
      if (this.session?.id === id) {
        void this.finish(id);
      }
    });

    this.startWatching(id);
    this.setStatus(id, 'recording');

    return this.describe();
  }

  startWatching(id) {
    const session = this.session;

    if (!session || session.id !== id) {
      return;
    }

    const schedule = () => {
      clearTimeout(session.pendingRead);
      session.pendingRead = setTimeout(() => void this.readSnapshot(id), SNAPSHOT_DEBOUNCE_MS);
      session.pendingRead.unref?.();
    };

    try {
      session.watcher = this.watchFile(session.directory, schedule);
      session.watcher.on?.('error', () => undefined);
    } catch {
      // Without a watcher the recording still works; it reconciles on stop.
      session.watcher = null;
    }

    schedule();
  }

  async readSnapshot(id) {
    const session = this.session;

    if (!session || session.id !== id) {
      return;
    }

    let source;

    try {
      const stats = await fs.stat(session.sourcePath);

      if (stats.size > MAX_RECORDING_SOURCE_BYTES) {
        session.error = 'This recording grew too large to import.';
        await this.stop(id, 'failed');
        return;
      }

      source = await fs.readFile(session.sourcePath, 'utf8');
    } catch {
      // The file appears only once codegen has something to write.
      return;
    }

    if (source === session.lastSource) {
      return;
    }

    session.lastSource = source;

    let imported;

    try {
      imported = this.importSource(source, 'recorded.spec.ts');
    } catch {
      // A half-written file is expected; the next snapshot supersedes it.
      return;
    }

    const test = imported.tests[0];

    if (!test) {
      return;
    }

    const steps = test.document.root.steps.slice(0, MAX_RECORDING_STEPS);

    session.revision += 1;
    session.steps = steps;
    session.diagnostics = test.diagnostics;

    this.emit('recording', {
      type: 'recording:snapshot',
      id,
      revision: session.revision,
      steps,
      diagnostics: test.diagnostics,
      truncated: test.document.root.steps.length > MAX_RECORDING_STEPS,
    });
  }

  setStatus(id, status) {
    if (this.session?.id !== id) {
      return;
    }

    this.session.status = status;
    this.emit('recording', { type: 'recording:status', id, status, error: this.session.error });
  }

  async stop(id, status = 'review') {
    const session = this.session;

    if (!session || session.id !== id || session.status === 'review') {
      return this.describe();
    }

    const { child } = session;

    if (child?.pid) {
      // SIGINT first so codegen can flush its final source.
      try {
        process.kill(-child.pid, 'SIGINT');
      } catch {
        child.kill('SIGINT');
      }

      session.killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, KILL_ESCALATION_MS);

      session.killTimer.unref?.();
    }

    session.status = status === 'review' ? 'stopping' : status;

    return this.describe();
  }

  async finish(id) {
    const session = this.session;

    if (!session || session.id !== id) {
      return;
    }

    clearTimeout(session.killTimer);
    clearTimeout(session.lifetime);
    clearTimeout(session.pendingRead);
    session.watcher?.close?.();

    // One last read: codegen flushes on the way out.
    await this.readSnapshot(id);

    this.setStatus(
      id,
      session.status === 'recording' || session.status === 'stopping' ? 'review' : session.status,
    );
  }

  async discard(id) {
    const session = this.session;

    if (!session || session.id !== id) {
      return false;
    }

    await this.stop(id, 'discarded');
    await this.finish(id);
    await fs.rm(session.directory, { recursive: true, force: true }).catch(() => undefined);

    this.session = null;
    this.emit('recording', { type: 'recording:discarded', id });

    return true;
  }

  async accept(id) {
    const session = this.session;

    if (!session || session.id !== id) {
      return null;
    }

    const steps = session.steps;

    await fs.rm(session.directory, { recursive: true, force: true }).catch(() => undefined);
    this.session = null;
    this.emit('recording', { type: 'recording:accepted', id });

    return steps;
  }

  async shutdown() {
    if (this.session) {
      await this.discard(this.session.id).catch(() => undefined);
    }

    await fs.rm(this.scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
