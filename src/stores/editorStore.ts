import { create } from 'zustand';
import {
  compileFlow,
  countSteps,
  createStep,
  insertStep,
  locateStep,
  moveStep,
  removeStep,
  setPosition,
  updateStep,
  wrapInScope,
  type CompileResult,
  type FlowDocument,
  type FlowStep,
  type FlowStepKind,
  type ScopeSlot,
  type StepPath,
} from '../lib/flowCore';

interface EditorState {
  document: FlowDocument | null;
  selectedStepId: string | null;
  dirty: boolean;
  past: FlowDocument[];
  future: FlowDocument[];

  load: (document: FlowDocument) => void;
  markSaved: () => void;
  select: (stepId: string | null) => void;

  addStep: (kind: FlowStepKind, at: StepPath) => void;
  appendStep: (kind: FlowStepKind) => void;
  editStep: (stepId: string, update: (step: FlowStep) => FlowStep) => void;
  deleteStep: (stepId: string) => void;
  relocateStep: (stepId: string, to: StepPath) => void;
  wrapStep: (stepId: string, kind: Extract<FlowStepKind, 'condition' | 'loop' | 'try'>) => void;
  moveNode: (stepId: string, position: { x: number; y: number }) => void;
  renameFlow: (name: string) => void;
  setDataSet: (data: FlowDocument['data']) => void;

  undo: () => void;
  redo: () => void;

  compile: () => CompileResult | null;
  pathOf: (stepId: string) => StepPath | null;
}

const HISTORY_LIMIT = 50;

function nextId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `step-${Math.random().toString(36).slice(2, 10)}`;
}

declare global {
  interface Window {
    __studioStepCount?: () => number;
  }
}

export const useEditorStore = create<EditorState>((set, get) => {
  const commit = (next: FlowDocument) => {
    const current = get().document;

    set((state) => ({
      document: next,
      dirty: true,
      past: current ? [...state.past, current].slice(-HISTORY_LIMIT) : state.past,
      future: [],
    }));
  };

  return {
    document: null,
    selectedStepId: null,
    dirty: false,
    past: [],
    future: [],

    load: (document) => {
      const current = get().document;

      // A refresh that arrives after the user has started editing must not
      // discard their work; only adopt it when nothing is unsaved.
      if (current && current.id === document.id && get().dirty) {
        return;
      }

      set({ document, dirty: false, past: [], future: [], selectedStepId: null });
    },

    markSaved: () => set({ dirty: false }),

    select: (stepId) => set({ selectedStepId: stepId }),

    addStep: (kind, at) => {
      const { document } = get();

      if (!document) {
        return;
      }

      const step = createStep(kind, nextId());
      commit(insertStep(document, step, at));
      set({ selectedStepId: step.id });
    },

    appendStep: (kind) => {
      const { document } = get();

      if (!document) {
        return;
      }

      get().addStep(kind, { parentId: null, slot: null, index: document.root.steps.length });
    },

    editStep: (stepId, update) => {
      const { document } = get();

      if (document) {
        commit(updateStep(document, stepId, update));
      }
    },

    deleteStep: (stepId) => {
      const { document, selectedStepId } = get();

      if (!document) {
        return;
      }

      commit(removeStep(document, stepId));

      if (selectedStepId === stepId) {
        set({ selectedStepId: null });
      }
    },

    relocateStep: (stepId, to) => {
      const { document } = get();

      if (document) {
        commit(moveStep(document, stepId, to));
      }
    },

    wrapStep: (stepId, kind) => {
      const { document } = get();

      if (!document) {
        return;
      }

      const scope = createStep(kind, nextId());
      commit(wrapInScope(document, [stepId], scope));
      set({ selectedStepId: scope.id });
    },

    moveNode: (stepId, position) => {
      const { document } = get();

      if (!document) {
        return;
      }

      set({ document: setPosition(document, stepId, position), dirty: true });
    },

    renameFlow: (name) => {
      const { document } = get();

      if (document) {
        commit({ ...document, name });
      }
    },

    setDataSet: (data) => {
      const { document } = get();

      if (!document) {
        return;
      }

      if (!data || data.cases.length === 0) {
        const { data: _discarded, ...rest } = document;
        commit(rest);
        return;
      }

      commit({ ...document, data });
    },

    undo: () => {
      const { past, document, future } = get();
      const previous = past[past.length - 1];

      if (!previous || !document) {
        return;
      }

      set({
        document: previous,
        past: past.slice(0, -1),
        future: [document, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const { future, document, past } = get();
      const [next, ...rest] = future;

      if (!next || !document) {
        return;
      }

      set({
        document: next,
        past: [...past, document].slice(-HISTORY_LIMIT),
        future: rest,
        dirty: true,
      });
    },

    compile: () => {
      const { document } = get();
      return document ? compileFlow(document) : null;
    },

    pathOf: (stepId) => {
      const { document } = get();
      return document ? locateStep(document, stepId) : null;
    },
  };
});

if (typeof window !== 'undefined') {
  window.__studioStepCount = () => {
    const document = useEditorStore.getState().document;
    return document ? countSteps(document.root) : 0;
  };
}

export type { ScopeSlot, StepPath };
