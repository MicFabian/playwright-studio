import { useState } from 'react';
import { adoptImport, previewImport, type ImportPreview } from '../../lib/workspaceClient';

interface ImportDialogProps {
  onClose: () => void;
  onAdopted: (firstTestId: string) => void;
}

const FIDELITY_COPY = {
  structured: 'Every statement mapped to a block.',
  mixed: 'Some statements stayed as custom code.',
  opaque: 'Nothing mapped; the whole test stayed as code.',
} as const;

export function ImportDialog({ onClose, onAdopted }: ImportDialogProps) {
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setError(null);

    try {
      const result = await previewImport(source);
      setPreview(result);
      setSelected(new Set(result.tests.map((test) => test.document.id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (!preview) {
      return;
    }

    setBusy(true);

    try {
      const documents = preview.tests
        .filter((test) => selected.has(test.document.id))
        .map((test) => test.document);
      const { tests } = await adoptImport(documents);
      onAdopted(tests[0]?.id ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not adopt these tests.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-label="Import spec">
      <div className="modal__panel">
        <header className="modal__head">
          <h2>Import a Playwright spec</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!preview ? (
          <>
            <p className="modal__hint">
              Paste an existing spec. Studio creates new flows and never overwrites your file.
            </p>
            <textarea
              className="modal__source"
              rows={14}
              value={source}
              placeholder="import { expect, test } from '@playwright/test';"
              onChange={(event) => setSource(event.target.value)}
            />
          </>
        ) : (
          <div className="modal__results">
            {preview.tests.map((test) => (
              <article key={test.document.id} className="import-card">
                <label className="import-card__head">
                  <input
                    type="checkbox"
                    checked={selected.has(test.document.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) {
                        next.add(test.document.id);
                      } else {
                        next.delete(test.document.id);
                      }
                      setSelected(next);
                    }}
                  />
                  <span className="import-card__name">{test.name}</span>
                  <span className={`import-card__badge import-card__badge--${test.fidelity}`}>
                    {test.fidelity}
                  </span>
                </label>

                <p className="import-card__meta">
                  {test.structuredSteps} mapped · {test.opaqueSteps} kept as code.{' '}
                  {FIDELITY_COPY[test.fidelity]}
                </p>

                {test.diagnostics.length > 0 ? (
                  <ul className="import-card__diagnostics">
                    {test.diagnostics.slice(0, 4).map((diagnostic, index) => (
                      <li key={index}>
                        line {diagnostic.line}: {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}

            {preview.diagnostics.length > 0 ? (
              <ul className="diagnostics diagnostics--warning">
                {preview.diagnostics.map((diagnostic, index) => (
                  <li key={index}>{diagnostic.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {error ? <p className="modal__error">{error}</p> : null}

        <footer className="modal__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {!preview ? (
            <button type="button" onClick={analyze} disabled={busy || !source.trim()}>
              {busy ? 'Analyzing…' : 'Analyze'}
            </button>
          ) : (
            <button type="button" onClick={adopt} disabled={busy || selected.size === 0}>
              {busy ? 'Importing…' : `Import ${selected.size} flow(s)`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
