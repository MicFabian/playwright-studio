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
import { TopBar } from './features/shell/TopBar';
import { useEditorStore } from './stores/editorStore';
import { useRunStore } from './stores/runStore';
import { createTest, loadWorkspace, saveTest } from './lib/workspaceClient';
import type { WorkspaceData } from './types';

type LoadState = 'loading' | 'ready' | 'error';

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [panel, setPanel] = useState<'inspector' | 'code' | 'run'>('inspector');
  const [importing, setImporting] = useState(false);

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
      await saveTest({
        id: activeTest.id,
        name: current.name,
        status: activeTest.status,
        document: current,
      });
      markSaved();
      setSaveState('saved');
      await hydrate(activeTest.id);
    } catch {
      setSaveState('error');
    }
  }, [activeTest, markSaved, hydrate]);

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
        />

        <BlockLibrary />

        <main className="studio__canvas">
          <ReactFlowProvider>
            <FlowCanvas />
          </ReactFlowProvider>
        </main>

        <section className="studio__side">
          <nav className="panel-tabs">
            {(['inspector', 'code', 'run'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={panel === tab ? 'is-active' : ''}
                onClick={() => setPanel(tab)}
              >
                {tab === 'inspector' ? 'Inspector' : tab === 'code' ? 'Code' : 'Run'}
              </button>
            ))}
          </nav>

          {panel === 'inspector' ? <StepInspector /> : null}
          {panel === 'code' ? <CodePreview /> : null}
          {panel === 'run' ? <RunPanel /> : null}
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
