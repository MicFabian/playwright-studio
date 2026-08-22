import { create } from 'zustand';
import type { TestRun, TestRunStepStatus } from '../types';
import { cancelRun, getRun, startRun, streamRunEvents } from '../lib/workspaceClient';

interface RunState {
  run: TestRun | null;
  stepStatus: Record<string, TestRunStepStatus>;
  starting: boolean;
  error: string | null;
  close: (() => void) | null;

  start: (input: { testId: string; testName: string; liveMode: boolean }) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export const useRunStore = create<RunState>((set, get) => ({
  run: null,
  stepStatus: {},
  starting: false,
  error: null,
  close: null,

  start: async ({ testId, testName, liveMode }) => {
    get().close?.();
    set({ starting: true, error: null, stepStatus: {}, run: null, close: null });

    try {
      const { run } = await startRun({ testId, testName, liveMode });
      set({ run, starting: false });

      if (run.status === 'failed' && run.steps.length === 0) {
        return;
      }

      const close = streamRunEvents(run.id, {
        onEvent: (event) => {
          if (event.type === 'step:started' && event.stepId) {
            set((state) => ({
              stepStatus: { ...state.stepStatus, [event.stepId as string]: 'running' },
            }));
          }

          if (event.type === 'step:finished' && event.stepId) {
            set((state) => ({
              stepStatus: {
                ...state.stepStatus,
                [event.stepId as string]: event.error ? 'failed' : 'passed',
              },
            }));
          }

          if (event.type === 'run:finished') {
            void getRun(run.id).then(({ run: finished }) => set({ run: finished }));
            get().close?.();
            set({ close: null });
          }
        },
        onError: () => {
          set({ error: 'Lost the run event stream.' });
        },
      });

      set({ close });
    } catch (error) {
      set({
        starting: false,
        error: error instanceof Error ? error.message : 'Failed to start the run.',
      });
    }
  },

  cancel: async () => {
    const { run } = get();

    if (!run) {
      return;
    }

    await cancelRun(run.id).catch(() => undefined);
  },

  reset: () => {
    get().close?.();
    set({ run: null, stepStatus: {}, starting: false, error: null, close: null });
  },
}));
