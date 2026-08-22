import { blockRegistry } from '../../lib/flowCore';
import { artifactUrl } from '../../lib/workspaceClient';
import { useEditorStore } from '../../stores/editorStore';
import { useRunStore } from '../../stores/runStore';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  cancelling: 'Stopping',
  timedOut: 'Timed out',
  interrupted: 'Interrupted',
};

export function RunPanel() {
  const run = useRunStore((state) => state.run);
  const stepStatus = useRunStore((state) => state.stepStatus);
  const starting = useRunStore((state) => state.starting);
  const error = useRunStore((state) => state.error);
  const document = useEditorStore((state) => state.document);
  const select = useEditorStore((state) => state.select);

  if (starting) {
    return <div className="run run--empty">Starting the run…</div>;
  }

  if (!run) {
    return <div className="run run--empty">Run the flow to see live step results.</div>;
  }

  const blocking = (run.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 'error');

  const labelFor = (stepId: string) => {
    let label = stepId;

    const walk = (steps: typeof document extends null ? never : NonNullable<typeof document>['root']['steps']) => {
      steps.forEach((step) => {
        if (step.id === stepId) {
          label = step.label?.trim() || blockRegistry[step.kind]?.title || step.kind;
        }

        if (step.kind === 'condition') {
          walk(step.then.steps);
          walk(step.else?.steps ?? []);
        } else if (step.kind === 'loop') {
          walk(step.body.steps);
        } else if (step.kind === 'try') {
          walk(step.body.steps);
          walk(step.catch?.body.steps ?? []);
          walk(step.finally?.steps ?? []);
        }
      });
    };

    if (document) {
      walk(document.root.steps);
    }

    return label;
  };

  return (
    <div className="run">
      <header className={`run__head run__head--${run.status}`}>
        <span className="run__status">{STATUS_LABELS[run.status] ?? run.status}</span>
        <span className="run__meta">{run.liveMode ? 'headed' : 'headless'}</span>
      </header>

      {error ? <p className="run__error">{error}</p> : null}
      {run.error ? <p className="run__error">{run.error}</p> : null}

      {blocking.length > 0 ? (
        <ul className="diagnostics diagnostics--error">
          {blocking.map((diagnostic, index) => (
            <li key={index}>{diagnostic.message}</li>
          ))}
        </ul>
      ) : null}

      <ol className="run__steps">
        {run.steps.map((step) => {
          const status = stepStatus[step.stepId] ?? step.status;

          return (
            <li key={step.stepId} className={`run__step run__step--${status}`}>
              <button type="button" onClick={() => select(step.stepId)}>
                <span className={`run__dot run__dot--${status}`} />
                <span className="run__label">{labelFor(step.stepId)}</span>
                {step.durationMs != null ? (
                  <span className="run__duration">{step.durationMs}ms</span>
                ) : null}
              </button>
              {step.error ? <p className="run__step-error">{step.error}</p> : null}
            </li>
          );
        })}
      </ol>

      {run.artifacts && run.artifacts.length > 0 ? (
        <footer className="run__artifacts">
          <h3>Artifacts</h3>
          <ul>
            {run.artifacts
              .filter((artifact) => artifact.kind !== 'other')
              .map((artifact) => (
                <li key={artifact.relativePath}>
                  <a href={artifactUrl(run.id, artifact.relativePath)} download>
                    {artifact.kind}
                  </a>
                  <span>{Math.round(artifact.sizeBytes / 1024)} KB</span>
                </li>
              ))}
          </ul>
          <p className="run__hint">
            Open a trace with <code>npx playwright show-trace</code> after downloading it.
          </p>
        </footer>
      ) : null}
    </div>
  );
}
