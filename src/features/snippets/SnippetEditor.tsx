import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { SnippetItem, SnippetParamType } from '../../types';
import { saveSnippet } from '../../lib/workspaceClient';

const TYPES: SnippetParamType[] = ['string', 'number', 'boolean'];

interface SnippetEditorProps {
  snippet: SnippetItem | null;
  onSaved: () => void;
}

export function SnippetEditor({ snippet, onSaved }: SnippetEditorProps) {
  const [draft, setDraft] = useState<SnippetItem | null>(snippet);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraft(snippet);
    setState('idle');
  }, [snippet]);

  if (!draft) {
    return <div className="snippets snippets--empty">Select a snippet to edit it.</div>;
  }

  const update = (next: Partial<SnippetItem>) => {
    setDraft({ ...draft, ...next });
    setState('idle');
  };

  const save = async () => {
    setState('saving');

    try {
      await saveSnippet(draft);
      setState('saved');
      onSaved();
    } catch {
      setState('error');
    }
  };

  return (
    <div className="snippets">
      <label className="inspector-field">
        <span className="inspector-field__label">Name</span>
        <input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
      </label>

      <label className="inspector-field">
        <span className="inspector-field__label">Description</span>
        <input
          value={draft.description}
          placeholder="What this snippet does"
          onChange={(event) => update({ description: event.target.value })}
        />
      </label>

      <section className="snippets__section">
        <header>
          <h3>Inputs</h3>
          <button
            type="button"
            onClick={() =>
              update({
                params: [
                  ...draft.params,
                  { name: `input${draft.params.length + 1}`, type: 'string', required: true },
                ],
              })
            }
          >
            <Plus size={12} aria-hidden /> Input
          </button>
        </header>

        {draft.params.map((param, index) => (
          <div className="snippets__row" key={index}>
            <input
              aria-label={`Input ${index + 1} name`}
              value={param.name}
              onChange={(event) =>
                update({
                  params: draft.params.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, name: event.target.value }
                      : candidate,
                  ),
                })
              }
            />
            <select
              aria-label={`Input ${index + 1} type`}
              value={param.type}
              onChange={(event) =>
                update({
                  params: draft.params.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, type: event.target.value as SnippetParamType }
                      : candidate,
                  ),
                })
              }
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              aria-label={`Input ${index + 1} default`}
              placeholder="default"
              value={param.defaultValue ?? ''}
              onChange={(event) =>
                update({
                  params: draft.params.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? {
                          ...candidate,
                          defaultValue: event.target.value || undefined,
                          required: event.target.value ? false : candidate.required,
                        }
                      : candidate,
                  ),
                })
              }
            />
            <button
              type="button"
              className="data__remove"
              aria-label={`Remove input ${param.name}`}
              onClick={() =>
                update({ params: draft.params.filter((_, candidate) => candidate !== index) })
              }
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </div>
        ))}
      </section>

      <section className="snippets__section">
        <header>
          <h3>Outputs</h3>
          <button
            type="button"
            onClick={() =>
              update({
                outputs: [
                  ...draft.outputs,
                  { name: `output${draft.outputs.length + 1}`, type: 'string' },
                ],
              })
            }
          >
            <Plus size={12} aria-hidden /> Output
          </button>
        </header>

        {draft.outputs.map((output, index) => (
          <div className="snippets__row" key={index}>
            <input
              aria-label={`Output ${index + 1} name`}
              value={output.name}
              onChange={(event) =>
                update({
                  outputs: draft.outputs.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, name: event.target.value }
                      : candidate,
                  ),
                })
              }
            />
            <select
              aria-label={`Output ${index + 1} type`}
              value={output.type}
              onChange={(event) =>
                update({
                  outputs: draft.outputs.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, type: event.target.value as SnippetParamType }
                      : candidate,
                  ),
                })
              }
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="data__remove"
              aria-label={`Remove output ${output.name}`}
              onClick={() =>
                update({ outputs: draft.outputs.filter((_, candidate) => candidate !== index) })
              }
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </div>
        ))}
      </section>

      <label className="inspector-field">
        <span className="inspector-field__label">Code</span>
        <textarea
          rows={10}
          value={draft.code}
          onChange={(event) => update({ code: event.target.value })}
        />
        <span className="inspector-field__hint">
          Inputs and outputs are in scope by name. Assign an output to return it.
        </span>
      </label>

      <footer className="snippets__actions">
        <button type="button" onClick={save} disabled={state === 'saving'}>
          {state === 'saving'
            ? 'Saving…'
            : state === 'saved'
              ? 'Saved'
              : state === 'error'
                ? 'Save failed'
                : 'Save snippet'}
        </button>
      </footer>
    </div>
  );
}
