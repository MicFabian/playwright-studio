import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '../lib/workspaceClient';

const startRun = vi.fn();
const getRun = vi.fn();
const cancelRun = vi.fn();
const streamRunEvents = vi.fn();

vi.mock('../lib/workspaceClient', () => ({
  startRun: (...args: unknown[]) => startRun(...args),
  getRun: (...args: unknown[]) => getRun(...args),
  cancelRun: (...args: unknown[]) => cancelRun(...args),
  streamRunEvents: (...args: unknown[]) => streamRunEvents(...args),
}));

const { useRunStore } = await import('./runStore');

const store = () => useRunStore.getState();

function run(overrides = {}) {
  return {
    id: 'r1',
    testId: 'login',
    testName: 'Login',
    status: 'running',
    liveMode: false,
    startedAt: null,
    finishedAt: null,
    error: null,
    steps: [
      { index: 0, stepId: 's1', status: 'queued', durationMs: null, error: null },
      { index: 1, stepId: 's2', status: 'queued', durationMs: null, error: null },
    ],
    ...overrides,
  };
}

/** Captures the handlers the store passes to the event stream. */
let emit: (event: RunEvent) => void;
let fail: () => void;
let closed = false;

beforeEach(() => {
  vi.clearAllMocks();
  closed = false;
  store().reset();

  startRun.mockResolvedValue({ run: run() });
  getRun.mockResolvedValue({ run: run({ status: 'passed' }) });
  cancelRun.mockResolvedValue({ cancelled: true });
  streamRunEvents.mockImplementation((_id: string, handlers: Record<string, () => void>) => {
    emit = handlers.onEvent as unknown as (event: RunEvent) => void;
    fail = handlers.onError as () => void;
    return () => {
      closed = true;
    };
  });
});

afterEach(() => {
  store().reset();
});

describe('starting a run', () => {
  it('stores the run and subscribes to its events', async () => {
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });

    expect(store().run?.id).toBe('r1');
    expect(store().starting).toBe(false);
    expect(streamRunEvents).toHaveBeenCalledWith('r1', expect.anything());
  });

  it('reports a failure to start instead of hanging', async () => {
    startRun.mockRejectedValue(new Error('Flow does not exist.'));

    await store().start({ testId: 'gone', testName: 'Gone', liveMode: false });

    expect(store().error).toBe('Flow does not exist.');
    expect(store().starting).toBe(false);
  });

  it('does not subscribe when the run failed before it began', async () => {
    startRun.mockResolvedValue({ run: run({ status: 'failed', steps: [] }) });

    await store().start({ testId: 'bad', testName: 'Bad', liveMode: false });

    expect(streamRunEvents).not.toHaveBeenCalled();
  });

  it('closes a previous stream before opening another', async () => {
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });

    expect(closed).toBe(true);
    expect(streamRunEvents).toHaveBeenCalledTimes(2);
  });
});

describe('step events', () => {
  beforeEach(async () => {
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });
  });

  it('marks a step running and then passed', () => {
    emit({ type: 'step:started', stepId: 's1', seq: 1 });
    expect(store().stepStatus.s1).toBe('running');

    emit({ type: 'step:finished', stepId: 's1', error: null, seq: 2 });
    expect(store().stepStatus.s1).toBe('passed');
  });

  it('marks a step failed when the event carries an error', () => {
    emit({ type: 'step:finished', stepId: 's2', error: 'locator not found', seq: 3 });

    expect(store().stepStatus.s2).toBe('failed');
  });

  it('ignores an event with no step id', () => {
    emit({ type: 'step:started', seq: 4 });

    expect(store().stepStatus).toEqual({});
  });

  it('refetches the run and closes the stream when it finishes', async () => {
    emit({ type: 'run:finished', status: 'passed', seq: 5 });
    await vi.waitFor(() => expect(store().run?.status).toBe('passed'));

    expect(getRun).toHaveBeenCalledWith('r1');
    expect(closed).toBe(true);
  });

  it('surfaces a broken stream', () => {
    fail();

    expect(store().error).toMatch(/stream/i);
  });
});

describe('cancelling and resetting', () => {
  it('cancels the active run', async () => {
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });
    await store().cancel();

    expect(cancelRun).toHaveBeenCalledWith('r1');
  });

  it('does nothing when there is no run', async () => {
    await store().cancel();

    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('swallows a cancel that the server refuses', async () => {
    cancelRun.mockRejectedValue(new Error('already finished'));
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });

    await expect(store().cancel()).resolves.toBeUndefined();
  });

  it('clears everything and closes the stream on reset', async () => {
    await store().start({ testId: 'login', testName: 'Login', liveMode: false });
    emit({ type: 'step:started', stepId: 's1', seq: 1 });

    store().reset();

    expect(store().run).toBeNull();
    expect(store().stepStatus).toEqual({});
    expect(closed).toBe(true);
  });
});
