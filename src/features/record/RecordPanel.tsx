import { blockRegistry, describeStep } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';
import { useRecordingStore } from '../../stores/recordingStore';

const STATUS_COPY: Record<string, string> = {
  starting: 'Opening a browser…',
  recording: 'Recording — use your app, then stop',
  stopping: 'Finishing up…',
  review: 'Review what was recorded',
  failed: 'The recorder stopped',
  timedOut: 'The recording timed out',
};

export function RecordPanel() {
  const { id, status, steps, error, truncated, stop, accept, discard, removeStep } =
    useRecordingStore();
  const insertRecordedSteps = useEditorStore((state) => state.insertRecordedSteps);

  if (!id && status === 'idle') {
    return (
      <div className="record record--empty">
        <p>Press Record to open a browser and capture what you do as steps.</p>
      </div>
    );
  }

  const reviewing = status === 'review';

  return (
    <div className="record">
      <header className={`record__head record__head--${status}`}>
        <span className={status === 'recording' ? 'record__pulse' : undefined} />
        <span>{STATUS_COPY[status] ?? status}</span>
      </header>

      {error ? <p className="record__error">{error}</p> : null}

      {truncated ? (
        <p className="record__note">
          This recording is very long; only the first thousand actions were kept.
        </p>
      ) : null}

      {steps.length === 0 ? (
        <p className="record__note">Nothing captured yet.</p>
      ) : (
        <ol className="record__steps">
          {steps.map((step) => (
            <li key={step.id} className={step.kind === 'code' ? 'record__step--code' : undefined}>
              <span className="record__kind">{blockRegistry[step.kind]?.title ?? step.kind}</span>
              <span className="record__detail">{describeStep(step)}</span>
              {reviewing ? (
                <button
                  type="button"
                  aria-label={`Remove ${blockRegistry[step.kind]?.title ?? step.kind}`}
                  onClick={() => removeStep(step.id)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {steps.some((step) => step.kind === 'code') ? (
        <p className="record__note record__note--warn">
          Some actions could not be expressed as blocks and were kept as custom code. Read them
          before adding them.
        </p>
      ) : null}

      <footer className="record__actions">
        {reviewing ? (
          <>
            <button
              type="button"
              disabled={steps.length === 0}
              onClick={() => {
                void accept().then((accepted) => insertRecordedSteps(accepted));
              }}
            >
              Add {steps.length} step{steps.length === 1 ? '' : 's'}
            </button>
            <button type="button" className="secondary" onClick={() => void discard()}>
              Discard
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void stop()}>
            Stop recording
          </button>
        )}
      </footer>
    </div>
  );
}
