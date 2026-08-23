import { create } from 'zustand';
import type { FlowStep } from '../lib/flowCore';
import {
  acceptRecording,
  discardRecording,
  startRecording,
  stopRecording,
  streamRecordingEvents,
  type RecordingState,
} from '../lib/workspaceClient';

type Status = RecordingState['status'] | 'idle';

interface RecordingStore {
  id: string | null;
  status: Status;
  steps: FlowStep[];
  error: string | null;
  truncated: boolean;
  close: (() => void) | null;

  start: (testId: string, startUrl?: string) => Promise<void>;
  stop: () => Promise<void>;
  accept: () => Promise<FlowStep[]>;
  discard: () => Promise<void>;
  removeStep: (stepId: string) => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  id: null,
  status: 'idle',
  steps: [],
  error: null,
  truncated: false,
  close: null,

  start: async (testId, startUrl) => {
    get().close?.();
    set({ status: 'starting', steps: [], error: null, truncated: false, close: null });

    try {
      const { recording } = await startRecording({ testId, startUrl });

      const close = streamRecordingEvents(recording.id, {
        onEvent: (event) => {
          if (event.type === 'recording:snapshot') {
            set({
              steps: (event.steps as FlowStep[]) ?? [],
              truncated: Boolean(event.truncated),
            });
          }

          if (event.type === 'recording:status') {
            set({
              status: event.status as Status,
              error: (event.error as string | null) ?? null,
            });
          }
        },
        onError: () => set({ error: 'Lost contact with the recorder.' }),
      });

      set({ id: recording.id, status: recording.status, close });
    } catch (error) {
      set({
        status: 'failed',
        error: error instanceof Error ? error.message : 'The recorder could not start.',
      });
    }
  },

  stop: async () => {
    const { id } = get();

    if (id) {
      await stopRecording(id).catch(() => undefined);
    }
  },

  accept: async () => {
    const { id } = get();

    if (!id) {
      return [];
    }

    // Steps the user removed during review must not come back from the server.
    const kept = new Set(get().steps.map((step) => step.id));
    const { steps } = await acceptRecording(id);

    get().reset();

    return steps.filter((step) => kept.has(step.id));
  },

  discard: async () => {
    const { id } = get();

    if (id) {
      await discardRecording(id).catch(() => undefined);
    }

    get().reset();
  },

  removeStep: (stepId) => set({ steps: get().steps.filter((step) => step.id !== stepId) }),

  reset: () => {
    get().close?.();
    set({ id: null, status: 'idle', steps: [], error: null, truncated: false, close: null });
  },
}));
