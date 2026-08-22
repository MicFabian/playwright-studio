import { useEffect, useRef, useState } from 'react';
import type { FlowNode, SnippetItem, StoredTestFlow, TestRun } from '../types';

interface InspectorProps {
  activeTest?: StoredTestFlow | null;
  selectedNode?: FlowNode;
  selectedSnippet?: SnippetItem | null;
  snippetDirty: boolean;
  snippetSaveState: 'idle' | 'saving' | 'saved' | 'error';
  generatedSpec: string;
  runState: TestRun | null;
  runStartState: 'idle' | 'starting' | 'error';
  runError: string | null;
  liveRunMode: boolean;
  hasRunnableSteps: boolean;
  onUpdateTitle: (nodeId: string, value: string) => void;
  onUpdateField: (nodeId: string, fieldKey: string, value: string) => void;
  onUpdateSnippetCode: (id: string, value: string) => void;
  onUpdateSnippetName: (snippetId: string, value: string) => void;
  onUpdateSnippetDescription: (snippetId: string, value: string) => void;
  onUpdateSnippetParams: (snippetId: string, value: string) => void;
  onSaveSnippet: () => void;
  onRunTest: () => void;
  onLiveRunModeChange: (value: boolean) => void;
}

export function Inspector({
  activeTest,
  selectedNode,
  selectedSnippet,
  snippetDirty,
  snippetSaveState,
  generatedSpec,
  runState,
  runStartState,
  runError,
  liveRunMode,
  hasRunnableSteps,
  onUpdateTitle,
  onUpdateField,
  onUpdateSnippetCode,
  onUpdateSnippetName,
  onUpdateSnippetDescription,
  onUpdateSnippetParams,
  onSaveSnippet,
  onRunTest,
  onLiveRunModeChange,
}: InspectorProps) {
  const runStepsRef = useRef<HTMLDivElement | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<{
    title: string;
    url: string;
    alt: string;
  } | null>(null);

  function renderFieldInput(
    nodeId: string,
    field: FlowNode['data']['fields'][number],
  ) {
    if (field.control === 'select' && field.options) {
      return (
        <select
          value={field.value}
          onChange={(event) => onUpdateField(nodeId, field.key, event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.multiline) {
      return (
        <textarea
          value={field.value}
          placeholder={field.placeholder}
          onChange={(event) => onUpdateField(nodeId, field.key, event.target.value)}
        />
      );
    }

    return (
      <input
        type="text"
        value={field.value}
        placeholder={field.placeholder}
        onChange={(event) => onUpdateField(nodeId, field.key, event.target.value)}
      />
    );
  }

  const snippetSaveLabel =
    snippetSaveState === 'saving'
      ? 'Saving…'
      : snippetSaveState === 'saved'
        ? 'Snippet saved'
        : snippetSaveState === 'error'
          ? 'Save failed'
          : snippetDirty
            ? 'Save snippet file'
            : 'No snippet changes';
  const runInFlight =
    runStartState === 'starting' ||
    runState?.status === 'queued' ||
    runState?.status === 'running';
  const runButtonLabel =
    !activeTest
      ? 'Select a flow'
      : !hasRunnableSteps
        ? 'Add a step first'
      : runStartState === 'starting'
      ? 'Starting run…'
      : runInFlight
        ? 'Running…'
      : liveRunMode
        ? 'Run live'
        : 'Run headless';
  const currentStepLabel =
    runState && runState.currentStepIndex != null
      ? `Step ${runState.currentStepIndex + 1} of ${runState.totalSteps}`
      : runState?.totalSteps
        ? `${runState.stepResults.filter((step) => step.status === 'passed' || step.status === 'failed').length} / ${runState.totalSteps} complete`
        : 'No steps';
  const runFailureMessage = runError || runState?.error || null;
  const passedSteps =
    runState?.stepResults.filter((step) => step.status === 'passed').length ?? 0;
  const failedSteps =
    runState?.stepResults.filter((step) => step.status === 'failed').length ?? 0;
  const pendingSteps =
    runState?.stepResults.filter(
      (step) => step.status === 'queued' || step.status === 'running',
    ).length ?? 0;
  const selectedNodeVisibleFields =
    selectedNode?.data.fields.filter((field) => field.value).length ?? 0;
  const selectedSnippetCodeLines = selectedSnippet
    ? selectedSnippet.code
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean).length
    : 0;

  useEffect(() => {
    if (!runStepsRef.current || !runState || runState.currentStepIndex == null) {
      return;
    }

    const activeStep = runStepsRef.current.querySelector<HTMLElement>(
      `[data-step-index="${runState.currentStepIndex}"]`,
    );
    activeStep?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [runState?.id, runState?.currentStepIndex, runState?.status]);

  useEffect(() => {
    if (!screenshotPreview) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setScreenshotPreview(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screenshotPreview]);

  useEffect(() => {
    if (!screenshotPreview) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [screenshotPreview]);

  return (
    <aside className="inspector panel">
      <section className="panel-section inspector__editor">
        <div className="panel-section__header">
          <span className="section-kicker">Inspector</span>
          <h2>
            {selectedNode
              ? selectedNode.data.title
              : selectedSnippet
                ? selectedSnippet.name
                : 'Select a block or snippet'}
          </h2>
        </div>

        {selectedNode ? (
          <>
            <div className="run-summary">
              <div>
                <span>Kind</span>
                <strong>{selectedNode.data.codeLabel}</strong>
              </div>
              <div>
                <span>Visible fields</span>
                <strong>{selectedNodeVisibleFields}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>
                  {selectedNode.data.kind === 'snippet' ? 'Snippet node' : 'Flow block'}
                </strong>
              </div>
            </div>

            <div className="form-stack">
              <label className="field">
                <span>Block title</span>
                <input
                  type="text"
                  value={selectedNode.data.title}
                  onChange={(event) =>
                    onUpdateTitle(selectedNode.id, event.target.value)
                  }
                />
              </label>

              {selectedNode.data.fields.map((field) => (
                <label className="field" key={field.key}>
                  <span>{field.label}</span>
                  {renderFieldInput(selectedNode.id, field)}
                </label>
              ))}

              {selectedNode.data.kind === 'snippet' ? (
                <label className="field">
                  <span>Snippet code</span>
                  <textarea
                    className="code-area"
                    value={selectedNode.data.snippetCode || ''}
                    onChange={(event) =>
                      onUpdateSnippetCode(selectedNode.id, event.target.value)
                    }
                  />
                </label>
              ) : null}
            </div>
          </>
        ) : selectedSnippet ? (
          <>
            <div className="run-summary">
              <div>
                <span>Params</span>
                <strong>{selectedSnippet.params.length}</strong>
              </div>
              <div>
                <span>Code lines</span>
                <strong>{selectedSnippetCodeLines}</strong>
              </div>
              <div>
                <span>File</span>
                <strong>{selectedSnippet.filePath || 'Unsaved'}</strong>
              </div>
            </div>

            <div className="form-stack">
              <label className="field">
                <span>Snippet name</span>
                <input
                  type="text"
                  value={selectedSnippet.name}
                  onChange={(event) =>
                    onUpdateSnippetName(selectedSnippet.id, event.target.value)
                  }
                />
              </label>

              <label className="field">
                <span>Description</span>
                <textarea
                  value={selectedSnippet.description}
                  onChange={(event) =>
                    onUpdateSnippetDescription(selectedSnippet.id, event.target.value)
                  }
                />
              </label>

              <label className="field">
                <span>Params</span>
                <input
                  type="text"
                  value={selectedSnippet.params.join(', ')}
                  placeholder="headline, tenantName"
                  onChange={(event) =>
                    onUpdateSnippetParams(selectedSnippet.id, event.target.value)
                  }
                />
              </label>

              <label className="field">
                <span>Snippet code</span>
                <textarea
                  className="code-area"
                  value={selectedSnippet.code}
                  onChange={(event) =>
                    onUpdateSnippetCode(selectedSnippet.id, event.target.value)
                  }
                />
              </label>

              <div className="button-row">
                <button
                  className="primary-button"
                  disabled={!snippetDirty && snippetSaveState !== 'error'}
                  type="button"
                  onClick={onSaveSnippet}
                >
                  {snippetSaveLabel}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>Select a block or snippet to edit it.</p>
            <p>Use the library to add new steps to this flow.</p>
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section__header">
          <span className="section-kicker">Run</span>
          <h2>Execution</h2>
        </div>

        <div className="run-controls">
          <label className="toggle-field">
            <input
              checked={liveRunMode}
              type="checkbox"
              onChange={(event) => onLiveRunModeChange(event.target.checked)}
            />
            <span>Live browser actions</span>
          </label>

          <button
            className="primary-button"
            data-testid="run-test-button"
            disabled={runInFlight || !activeTest || !hasRunnableSteps}
            type="button"
            onClick={onRunTest}
          >
            {runButtonLabel}
          </button>
        </div>

        {runFailureMessage ? <p className="feedback error">{runFailureMessage}</p> : null}

        {runState ? (
          <div className="run-panel">
            <div className="run-summary">
              <div>
                <span>Status</span>
                <strong className={`run-status is-${runState.status}`}>{runState.status}</strong>
              </div>
              <div>
                <span>Progress</span>
                <strong>{currentStepLabel}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>{runState.liveMode ? 'Live browser' : 'Headless'}</strong>
              </div>
            </div>
            <p className="run-metrics">
              <span>{passedSteps} passed</span>
              <span>{failedSteps} failed</span>
              <span>{pendingSteps} pending</span>
            </p>

            <div className="run-steps" ref={runStepsRef}>
              {runState.stepResults.map((step) => (
                <article
                  className={`run-step is-${step.status}${runState.currentStepIndex === step.index ? ' is-current' : ''}`}
                  data-step-index={step.index}
                  key={`${runState.id}-${step.index}`}
                >
                  <div className="run-step__meta">
                    <strong>{`${step.index + 1}. ${step.title}`}</strong>
                    <span>{step.kind}</span>
                  </div>
                  <p className="run-step__status">{step.status}</p>
                  {step.error ? <p className="feedback error">{step.error}</p> : null}
                  {step.screenshotUrl ? (
                    <button
                      aria-haspopup="dialog"
                      aria-label={`Expand screenshot for step ${step.index + 1}`}
                      title="Open larger screenshot"
                      className="run-step__screenshot-trigger"
                      type="button"
                      onClick={() =>
                        setScreenshotPreview({
                          title: `${step.index + 1}. ${step.title}`,
                          url: step.screenshotUrl || '',
                          alt: `Step ${step.index + 1} screenshot`,
                        })
                      }
                    >
                      <img
                        alt={`Step ${step.index + 1} screenshot`}
                        className="run-step__screenshot"
                        decoding="async"
                        loading="lazy"
                        src={step.screenshotUrl}
                      />
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="inline-empty">
            <p>Run the active flow to track execution step-by-step.</p>
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section__header">
          <span className="section-kicker">Filesystem</span>
          <h2>Tracked files</h2>
        </div>

        {activeTest ? (
          <div className="file-details">
            <div className="file-detail">
              <span>Flow graph</span>
              <strong>{activeTest.filePath}</strong>
            </div>
            <div className="file-detail">
              <span>Generated spec</span>
              <strong>{activeTest.specPath}</strong>
            </div>
            <div className="file-detail">
              <span>Updated</span>
              <strong>{activeTest.updatedAt || 'Not saved yet'}</strong>
            </div>
            {selectedSnippet?.filePath ? (
              <div className="file-detail">
                <span>Snippet file</span>
                <strong>{selectedSnippet.filePath}</strong>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="inline-empty">
            <p>Select a flow to inspect its on-disk files.</p>
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section__header">
          <span className="section-kicker">Code preview</span>
          <h2>Generated Playwright</h2>
        </div>

        <pre className="code-preview">
          <code>{generatedSpec}</code>
        </pre>
      </section>

      {screenshotPreview ? (
        <div
          aria-label={`Screenshot preview ${screenshotPreview.title}`}
          aria-modal="true"
          className="run-screenshot-popover"
          data-testid="run-screenshot-popover"
          role="dialog"
          onClick={() => setScreenshotPreview(null)}
        >
          <div
            className="run-screenshot-popover__card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="run-screenshot-popover__header">
              <strong>{screenshotPreview.title}</strong>
              <button
                aria-label="Close screenshot preview"
                className="run-screenshot-popover__close"
                type="button"
                onClick={() => setScreenshotPreview(null)}
              >
                Close
              </button>
            </div>
            <img
              alt={screenshotPreview.alt}
              className="run-screenshot-popover__image"
              data-testid="run-screenshot-popover-image"
              decoding="async"
              loading="eager"
              src={screenshotPreview.url}
            />
          </div>
        </div>
      ) : null}
    </aside>
  );
}
