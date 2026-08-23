import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - plain JavaScript module with no type declarations.
import { RecordingManager } from './recording-manager.mjs';
import { importSpecSource } from '../../flow-import/src/import-spec';

/** Stands in for the codegen process without spawning anything. */
class FakeChild extends EventEmitter {
  pid = 4242;
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal: string) {
    this.killed.push(signal);
    return true;
  }
}

let scratch: string;
let child: FakeChild;
let notify: () => void;

function manager(overrides = {}) {
  return new RecordingManager({
    rootDir: process.cwd(),
    workspaceDir: scratch,
    scratchDir: path.join(scratch, 'recordings'),
    importSource: importSpecSource,
    resolveRunnable: (relative: string) => path.join(process.cwd(), relative),
    spawnProcess: () => {
      child = new FakeChild();
      return child;
    },
    watchFile: (_dir: string, handler: () => void) => {
      notify = handler;
      return { close: () => undefined, on: () => undefined };
    },
    ...overrides,
  });
}

function codegen(actions: string[]): string {
  return [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('test', async ({ page }) => {",
    ...actions.map((action) => `  ${action}`),
    '});',
  ].join('\n');
}

async function writeSource(recording: { id: string }, source: string) {
  const file = path.join(scratch, 'recordings', recording.id, 'recorded.spec.ts');
  await fs.writeFile(file, source);
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('starting', () => {
  it('reports a recording in progress', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    expect(started.status).toBe('recording');
    expect(recorder.active).toBe(true);
  });

  it('refuses a second recording while one runs', async () => {
    const recorder = manager();
    await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await expect(
      recorder.start({ flowId: 'f', startUrl: 'https://example.com' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a start address that is not http', async () => {
    const recorder = manager();

    await expect(
      recorder.start({ flowId: 'f', startUrl: 'file:///etc/passwd' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('snapshots', () => {
  it('turns recorded actions into steps', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await writeSource(
      started,
      codegen([
        "await page.goto('https://example.com/login');",
        "await page.getByRole('button', { name: 'Sign in' }).click();",
      ]),
    );

    notify();
    await vi.waitFor(() => expect(recorder.describe().steps).toHaveLength(2));

    expect(recorder.describe().steps.map((step: { kind: string }) => step.kind)).toEqual([
      'navigate',
      'click',
    ]);
  });

  it('replaces the previous snapshot rather than appending to it', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await writeSource(started, codegen(["await page.getByTestId('a').fill('qa');"]));
    notify();
    await vi.waitFor(() => expect(recorder.describe().steps).toHaveLength(1));

    // Codegen coalesces consecutive fills, so the same action is rewritten.
    await writeSource(started, codegen(["await page.getByTestId('a').fill('qa@example.com');"]));
    notify();

    await vi.waitFor(() => {
      const [step] = recorder.describe().steps;
      expect(step.value.value).toBe('qa@example.com');
    });

    expect(recorder.describe().steps).toHaveLength(1);
  });

  it('ignores a half-written file instead of failing the recording', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await writeSource(started, "import { test } from '@playwright/test'; test('t', asyn");
    notify();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(recorder.describe().status).toBe('recording');
  });

  it('emits a snapshot event the UI can follow', async () => {
    const recorder = manager();
    const events: { type: string }[] = [];
    recorder.on('recording', (event: { type: string }) => events.push(event));

    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });
    await writeSource(started, codegen(["await page.goto('https://example.com');"]));
    notify();

    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'recording:snapshot')).toBe(true),
    );
  });
});

describe('finishing', () => {
  it('interrupts codegen so it can flush, then escalates', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await recorder.stop(started.id);

    expect(child.killed[0]).toBe('SIGINT');
  });

  it('reads a final snapshot when the browser closes', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await writeSource(started, codegen(["await page.getByTestId('late').click();"]));
    child.emit('close', 0);

    await vi.waitFor(() => expect(recorder.describe().status).toBe('review'));
    expect(recorder.describe().steps).toHaveLength(1);
  });

  it('hands the steps over on accept and forgets the session', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await writeSource(started, codegen(["await page.goto('https://example.com');"]));
    notify();
    await vi.waitFor(() => expect(recorder.describe().steps).toHaveLength(1));

    const steps = await recorder.accept(started.id);

    expect(steps).toHaveLength(1);
    expect(recorder.describe()).toBeNull();
  });

  it('discards without handing anything over', async () => {
    const recorder = manager();
    const started = await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await recorder.discard(started.id);

    expect(recorder.describe()).toBeNull();
    await expect(fs.stat(path.join(scratch, 'recordings', started.id))).rejects.toThrow();
  });

  it('stops an in-flight recording on shutdown', async () => {
    const recorder = manager();
    await recorder.start({ flowId: 'f', startUrl: 'https://example.com' });

    await recorder.shutdown();

    expect(recorder.describe()).toBeNull();
  });
});
