import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlowCanvas } from './features/flow/FlowCanvas';
import { StepInspector } from './features/flow/StepInspector';
import { BlockLibrary } from './features/flow/BlockLibrary';
import { WorkspaceExplorer } from './features/workspace/WorkspaceExplorer';
import { EmptyWorkspace } from './features/workspace/EmptyWorkspace';
import { RunPanel } from './features/run/RunPanel';
import { ImportDialog } from './features/import/ImportDialog';
import { CodePreview } from './features/flow/CodePreview';
import { DataPanel } from './features/flow/DataPanel';
import { SnippetEditor } from './features/snippets/SnippetEditor';
import { TopBar } from './features/shell/TopBar';
import { ErrorBoundary } from './features/shell/ErrorBoundary';
import { CommandPalette } from './features/shell/CommandPalette';
import { useEditorStore } from './stores/editorStore';
import { useRunStore } from './stores/runStore';
import {
  createSnippet,
  createTest,
  loadWorkspace,
  renameTest,
  saveTest,
} from './lib/workspaceClient';
import type { WorkspaceData } from './types';
import { desktop, type DesktopCommand } from './lib/desktop';

type LoadState = 'loading' | 'ready' | 'error';

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [panel, setPanel] = useState<'inspector' | 'data' | 'code' | 'run' | 'snippet'>(
    'inspector',
  );
  const [importing, setImporting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);

  const document = useEditorStore((state) => state.document);
  const dirty = useEditorStore((state) => state.dirty);
  const load = useEditorStore((state) => state.load);
  const markSaved = useEditorStore((state) => state.markSaved);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  const runStore = useRunStore();

  const hydrate = useCallback(
    async (selectId?: string) => {
      try {
        const data = await loadWorkspace();
        setWorkspace(data);
        setLoadState('ready');

        const next = selectId
          ? data.tests.find((test) => test.id === selectId)
          : (data.tests.find((test) => test.id === activeTestId) ?? data.tests[0]);

        if (next) {
          setActiveTestId(next.id);
          load(next.document);
        }
      } catch (error) {
        setLoadState('error');
        setLoadError(error instanceof Error ? error.message : 'Failed to load the workspace.');
      }
    },
    [activeTestId, load],
  );

  useEffect(() => {
    // Intentionally runs once: hydrate is recreated whenever the active flow
    // changes, and re-running it here would reload the workspace on every switch.
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTest = useMemo(
    () => workspace?.tests.find((test) => test.id === activeTestId) ?? null,
    [workspace, activeTestId],
  );

  const handleSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const handleSelectTest = useCallback(
    async (testId: string) => {
      const test = workspace?.tests.find((candidate) => candidate.id === testId);

      if (!test || test.id === activeTestId) {
        return;
      }

      // Switching away must not drop edits the autosave debounce has not
      // flushed yet, so write them before loading the other flow.
      if (useEditorStore.getState().dirty) {
        await handleSaveRef.current?.();
      }

      setActiveTestId(test.id);
      load(test.document);
      useRunStore.getState().reset();
    },
    [workspace, activeTestId, load],
  );

  const handleSave = useCallback(async (): Promise<boolean> => {
    const current = useEditorStore.getState().document;

    if (!current || !activeTest) {
      return true;
    }

    setSaveState('saving');
    let saved = false;

    try {
      const { test } = await saveTest({
        id: activeTest.id,
        name: current.name,
        status: activeTest.status,
        document: current,
      });

      // Only clear the dirty flag if nothing changed while the write was in
      // flight; otherwise the newer edits would be treated as already saved.
      if (useEditorStore.getState().document === current) {
        markSaved();
      }

      setSaveState('saved');
      saved = true;
      setWorkspace((previous) =>
        previous
          ? {
              ...previous,
              tests: previous.tests.map((candidate) =>
                candidate.id === test.id ? test : candidate,
              ),
            }
          : previous,
      );
    } catch (error) {
      setSaveState('error');
      setLoadError(error instanceof Error ? error.message : 'Save failed.');
    }

    return saved;
  }, [activeTest, markSaved]);

  handleSaveRef.current = handleSave;

  const handleRename = useCallback(
    async (name: string) => {
      if (!activeTest || !name.trim() || name.trim() === activeTest.name) {
        return;
      }

      try {
        if (useEditorStore.getState().dirty) {
          const saved = await handleSaveRef.current?.();

          if (saved === false) {
            return;
          }
        }

        const { test } = await renameTest(activeTest.id, name.trim());
        setActiveTestId(test.id);
        await hydrate(test.id);
      } catch (error) {
        setSaveState('error');
        setLoadError(error instanceof Error ? error.message : 'Rename failed.');
      }
    },
    [activeTest, hydrate],
  );

  const handleCreateTest = useCallback(async () => {
    const { test } = await createTest('Untitled flow');
    await hydrate(test.id);
  }, [hydrate]);

  const handleRun = useCallback(
    async (liveMode: boolean) => {
      const current = useEditorStore.getState().document;

      if (!activeTest || !current) {
        return;
      }

      setPanel('run');

      if ((await handleSave()) === false) {
        return;
      }

      await useRunStore
        .getState()
        .start({ testId: activeTest.id, testName: current.name, liveMode });
    },
    [activeTest, handleSave],
  );

  useEffect(() => {
    if (!dirty || !activeTest) {
      return;
    }

    // Keyed on the document too: a drag emits a change per frame, and without
    // that dependency the debounce timer is only ever cleared, never fired.
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [dirty, document, activeTest, handleSave]);

  useEffect(() => {
    // The desktop shell asks about unsaved work before relaunching, which
    // bypasses beforeunload entirely.
    window.__studioHasUnsavedWork = () => useEditorStore.getState().dirty;
    window.__studioSaveNow = () => handleSaveRef.current?.() ?? Promise.resolve(true);

    return () => {
      delete window.__studioHasUnsavedWork;
      delete window.__studioSaveNow;
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const host = desktop();

    if (!host) {
      return;
    }

    const commands: Record<DesktopCommand, () => void> = {
      'new-flow': () => void handleCreateTest(),
      save: () => void handleSave(),
      import: () => setImporting(true),
      undo,
      redo,
      palette: () => setPaletteOpen((open) => !open),
      run: () => void handleRun(false),
      'run-headed': () => void handleRun(true),
      cancel: () => void useRunStore.getState().cancel(),
    };

    return host.onCommand((command) => commands[command]?.());
  }, [handleCreateTest, handleSave, handleRun, undo, redo]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      const tag = element?.tagName;
      return (
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (meta && event.key === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }

      if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (meta && ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key === 'y')) {
        event.preventDefault();
        redo();
        return;
      }

      if (meta && event.key === 'Enter') {
        event.preventDefault();
        void handleRun(event.shiftKey);
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      const selected = useEditorStore.getState().selectedStepId;

      if ((event.key === 'Backspace' || event.key === 'Delete') && selected) {
        event.preventDefault();
        useEditorStore.getState().deleteStep(selected);
        return;
      }

      if (event.key === 'Escape') {
        useEditorStore.getState().select(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, handleRun, undo, redo]);

  if (loadState === 'loading') {
    return <div className="boot">Loading workspace…</div>;
  }

  if (loadState === 'error') {
    return (
      <div className="boot boot--error">
        <h1>Studio could not start</h1>
        <p>{loadError}</p>
      </div>
    );
  }

  return (
    <div className="studio">
      <TopBar
        flowName={document?.name ?? ''}
        dirty={dirty}
        saveState={saveState}
        onSave={handleSave}
        onRun={handleRun}
        onRename={(name) => useEditorStore.getState().renameFlow(name)}
        onRenameCommitted={handleRename}
        running={runStore.run?.status === 'running' || runStore.starting}
        onCancel={() => void useRunStore.getState().cancel()}
      />

      <div className="studio__body">
        <WorkspaceExplorer
          workspace={workspace}
          activeTestId={activeTestId}
          onSelect={(testId) => void handleSelectTest(testId)}
          onCreate={handleCreateTest}
          onImport={() => setImporting(true)}
          activeSnippetId={activeSnippetId}
          onSelectSnippet={(snippetId) => {
            setActiveSnippetId(snippetId);
            setPanel('snippet');
          }}
          onCreateSnippet={async () => {
            const { snippet } = await createSnippet('Untitled snippet');
            await hydrate(activeTestId ?? undefined);
            setActiveSnippetId(snippet.id);
            setPanel('snippet');
          }}
        />

        <BlockLibrary />

        <main className="studio__canvas">
          <ErrorBoundary label="The canvas" onReset={() => void hydrate(activeTestId ?? undefined)}>
            {workspace && workspace.tests.length === 0 ? (
              <EmptyWorkspace
                workspaceName={workspace.project.name}
                onCreate={() => void handleCreateTest()}
                onImport={() => setImporting(true)}
              />
            ) : (
              <ReactFlowProvider>
                <FlowCanvas />
              </ReactFlowProvider>
            )}
          </ErrorBoundary>
        </main>

        <section className="studio__side">
          <nav className="panel-tabs">
            {(
              [
                'inspector',
                'data',
                ...(activeSnippetId ? (['snippet'] as const) : []),
                'code',
                'run',
              ] as const
            ).map((tab) => (
              <button
                key={tab}
                type="button"
                className={panel === tab ? 'is-active' : ''}
                onClick={() => setPanel(tab)}
              >
                {tab === 'inspector'
                  ? 'Inspector'
                  : tab === 'data'
                    ? 'Data'
                    : tab === 'snippet'
                      ? 'Snippet'
                      : tab === 'code'
                        ? 'Code'
                        : 'Run'}
              </button>
            ))}
          </nav>

          <ErrorBoundary label="This panel">
            {panel === 'inspector' ? <StepInspector snippets={workspace?.snippets ?? []} /> : null}
            {panel === 'data' ? <DataPanel /> : null}
            {panel === 'snippet' ? (
              <SnippetEditor
                snippet={workspace?.snippets.find((item) => item.id === activeSnippetId) ?? null}
                onSaved={() => void hydrate(activeTestId ?? undefined)}
              />
            ) : null}
            {panel === 'code' ? (
              <CodePreview
                snippets={workspace?.snippets ?? []}
                playwrightConfig={workspace?.playwrightConfig}
              />
            ) : null}
            {panel === 'run' ? <RunPanel /> : null}
          </ErrorBoundary>
        </section>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tests={workspace?.tests ?? []}
        onOpenTest={(testId) => void handleSelectTest(testId)}
        actions={[
          { label: 'Save flow', hint: 'Ctrl/Cmd S', run: () => void handleSave() },
          { label: 'Run flow', hint: 'Ctrl/Cmd Enter', run: () => void handleRun(false) },
          { label: 'Run headed', hint: 'Ctrl/Cmd Shift Enter', run: () => void handleRun(true) },
          { label: 'New flow', run: () => void handleCreateTest() },
          { label: 'Import a spec', run: () => setImporting(true) },
          { label: 'Undo', hint: 'Ctrl/Cmd Z', run: undo },
          { label: 'Redo', hint: 'Ctrl/Cmd Shift Z', run: redo },
          { label: 'Show generated code', run: () => setPanel('code') },
          { label: 'Show test data', run: () => setPanel('data') },
          { label: 'Show run results', run: () => setPanel('run') },
        ]}
      />

      {importing ? (
        <ImportDialog
          onClose={() => setImporting(false)}
          onAdopted={(testId) => {
            setImporting(false);
            void hydrate(testId);
          }}
        />
      ) : null}
    </div>
  );
}
