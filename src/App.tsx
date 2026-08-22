import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlowCanvas } from './features/flow/FlowCanvas';
import { StepInspector } from './features/flow/StepInspector';
import { BlockLibrary } from './features/flow/BlockLibrary';
import { WorkspaceExplorer } from './features/workspace/WorkspaceExplorer';
import { RunPanel } from './features/run/RunPanel';
import { ImportDialog } from './features/import/ImportDialog';
import { CodePreview } from './features/flow/CodePreview';
import { DataPanel } from './features/flow/DataPanel';
import { SnippetEditor } from './features/snippets/SnippetEditor';
import { TopBar } from './features/shell/TopBar';
import { ErrorBoundary } from './features/shell/ErrorBoundary';
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

type LoadState = 'loading' | 'ready' | 'error';

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [panel, setPanel] = useState<'inspector' | 'data' | 'code' | 'run' | 'snippet'>('inspector');
  const [importing, setImporting] = useState(false);
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
    void hydrate();
  }, []);

  const activeTest = useMemo(
    () => workspace?.tests.find((test) => test.id === activeTestId) ?? null,
    [workspace, activeTestId],
  );

  const handleSelectTest = useCallback(
    (testId: string) => {
      const test = workspace?.tests.find((candidate) => candidate.id === testId);

      if (test) {
        setActiveTestId(test.id);
        load(test.document);
        useRunStore.getState().reset();
      }
    },
    [workspace, load],
  );

  const handleSave = useCallback(async () => {
    const current = useEditorStore.getState().document;

    if (!current || !activeTest) {
      return;
    }

    setSaveState('saving');

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
  }, [activeTest, markSaved]);

  const handleRename = useCallback(
    async (name: string) => {
      if (!activeTest || !name.trim() || name.trim() === activeTest.name) {
        return;
      }

      try {
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
      await handleSave();
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

    const timer = window.setTimeout(() => {
      void handleSave();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [dirty, activeTest, handleSave]);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      if (event.key === 's') {
        event.preventDefault();
        void handleSave();
      }

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, undo, redo]);

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
          onSelect={handleSelectTest}
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
            <ReactFlowProvider>
              <FlowCanvas />
            </ReactFlowProvider>
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
