import type { ChangeEvent } from 'react';
import {
  blockRegistry,
  type AssertionIR,
  type FlowStep,
  type LocatorRef,
  type LocatorTarget,
  type ValueExpr,
} from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';
import type { SnippetItem } from '../../types';

const LOCATOR_STRATEGIES: { value: LocatorRef['by']; label: string }[] = [
  { value: 'role', label: 'Role' },
  { value: 'testId', label: 'Test ID' },
  { value: 'label', label: 'Label' },
  { value: 'placeholder', label: 'Placeholder' },
  { value: 'text', label: 'Text' },
  { value: 'altText', label: 'Alt text' },
  { value: 'title', label: 'Title' },
  { value: 'css', label: 'CSS (advanced)' },
];

const ROLES = [
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'heading',
  'listitem',
  'row',
  'tab',
  'dialog',
  'alert',
];

const ASSERTIONS: { value: AssertionIR['type']; label: string }[] = [
  { value: 'visible', label: 'is visible' },
  { value: 'hidden', label: 'is hidden' },
  { value: 'enabled', label: 'is enabled' },
  { value: 'checked', label: 'is checked' },
  { value: 'containsText', label: 'contains text' },
  { value: 'hasText', label: 'has exact text' },
  { value: 'hasValue', label: 'has value' },
  { value: 'hasCount', label: 'has count' },
];

function valueText(expr: ValueExpr | undefined): string {
  if (!expr) {
    return '';
  }

  return expr.source === 'literal' ? expr.value : expr.name;
}

function ValueField({
  label,
  value,
  columns,
  hint,
  onChange,
}: {
  label: string;
  value: ValueExpr | undefined;
  columns: string[];
  hint?: string;
  onChange: (next: ValueExpr) => void;
}) {
  const source = value?.source ?? 'literal';

  return (
    <div className="inspector-field">
      <span className="inspector-field__label">{label}</span>

      <div className="inspector-field__row">
        <select
          aria-label={`${label} source`}
          value={source}
          onChange={(event) => {
            const next = event.target.value as ValueExpr['source'];

            if (next === 'literal') {
              onChange({ source: 'literal', value: valueText(value) });
              return;
            }

            if (next === 'variable') {
              onChange({ source: 'variable', name: columns[0] ?? valueText(value) });
              return;
            }

            onChange({ source: 'env', name: valueText(value) || 'APP_PASSWORD' });
          }}
        >
          <option value="literal">Text</option>
          <option value="variable">Variable</option>
          <option value="env">Env</option>
        </select>

        {source === 'variable' && columns.length > 0 ? (
          <select
            aria-label={label}
            value={value?.source === 'variable' ? value.name : ''}
            onChange={(event) => onChange({ source: 'variable', name: event.target.value })}
          >
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={label}
            value={valueText(value)}
            onChange={(event) =>
              onChange(
                source === 'literal'
                  ? { source: 'literal', value: event.target.value }
                  : { source, name: event.target.value },
              )
            }
          />
        )}
      </div>

      {hint ? <span className="inspector-field__hint">{hint}</span> : null}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{label}</span>
      {children}
      {hint ? <span className="inspector-field__hint">{hint}</span> : null}
    </label>
  );
}

function LocatorEditor({
  target,
  onChange,
}: {
  target: LocatorTarget;
  onChange: (next: LocatorTarget) => void;
}) {
  const base = target.base;

  const setStrategy = (by: LocatorRef['by']) => {
    const current = valueText(
      'value' in base ? base.value : 'text' in base ? base.text : 'selector' in base ? base.selector : undefined,
    );
    const literal: ValueExpr = { source: 'literal', value: current };

    const textual = (kind: 'label' | 'placeholder' | 'text' | 'altText' | 'title'): LocatorRef => ({
      by: kind,
      text: literal,
    });

    const next: LocatorRef =
      by === 'role'
        ? { by: 'role', role: 'button', name: literal }
        : by === 'testId'
          ? { by: 'testId', value: literal }
          : by === 'css' || by === 'xpath'
            ? { by, selector: literal }
            : textual(by);

    onChange({ ...target, base: next });
  };

  const setValue = (raw: string) => {
    const literal: ValueExpr = { source: 'literal', value: raw };

    const next: LocatorRef =
      base.by === 'role'
        ? { ...base, name: literal }
        : base.by === 'testId'
          ? { by: 'testId', value: literal }
          : base.by === 'css' || base.by === 'xpath'
            ? { ...base, selector: literal }
            : { ...base, text: literal };

    onChange({ ...target, base: next });
  };

  const currentValue = valueText(
    base.by === 'role'
      ? base.name
      : base.by === 'testId'
        ? base.value
        : base.by === 'css' || base.by === 'xpath'
          ? base.selector
          : base.text,
  );

  return (
    <>
      <Field label="Find by">
        <select
          value={base.by}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setStrategy(event.target.value as LocatorRef['by'])
          }
        >
          {LOCATOR_STRATEGIES.map((strategy) => (
            <option key={strategy.value} value={strategy.value}>
              {strategy.label}
            </option>
          ))}
        </select>
      </Field>

      {base.by === 'role' ? (
        <Field label="Role">
          <select
            value={base.role}
            onChange={(event) =>
              onChange({ ...target, base: { ...base, role: event.target.value as typeof base.role } })
            }
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field
        label={base.by === 'role' ? 'Accessible name' : base.by === 'css' ? 'Selector' : 'Value'}
        hint={base.by === 'css' ? 'CSS is brittle. Prefer role, label, or test ID.' : undefined}
      >
        <input value={currentValue} onChange={(event) => setValue(event.target.value)} />
      </Field>

      <Field label="Match index" hint="Leave empty to require a unique match.">
        <input
          type="number"
          value={target.nth ?? ''}
          onChange={(event) =>
            onChange({
              ...target,
              nth: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        />
      </Field>
    </>
  );
}

export function StepInspector({ snippets = [] }: { snippets?: SnippetItem[] }) {
  const document = useEditorStore((state) => state.document);
  const selectedStepId = useEditorStore((state) => state.selectedStepId);
  const editStep = useEditorStore((state) => state.editStep);
  const deleteStep = useEditorStore((state) => state.deleteStep);
  const wrapStep = useEditorStore((state) => state.wrapStep);

  const step = selectedStepId
    ? (function find(steps: FlowStep[]): FlowStep | null {
        for (const candidate of steps) {
          if (candidate.id === selectedStepId) {
            return candidate;
          }

          const children =
            candidate.kind === 'condition'
              ? [...candidate.then.steps, ...(candidate.else?.steps ?? [])]
              : candidate.kind === 'loop'
                ? candidate.body.steps
                : candidate.kind === 'try'
                  ? [
                      ...candidate.body.steps,
                      ...(candidate.catch?.body.steps ?? []),
                      ...(candidate.finally?.steps ?? []),
                    ]
                  : [];

          const nested = find(children);

          if (nested) {
            return nested;
          }
        }

        return null;
      })(document?.root.steps ?? [])
    : null;

  if (!step) {
    return (
      <aside className="inspector">
        <p className="inspector__empty">Select a step to edit its properties.</p>
      </aside>
    );
  }

  const definition = blockRegistry[step.kind];
  const dataColumns = (document?.data?.columns ?? []).map((column) => column.name);
  const update = (next: Partial<FlowStep>) =>
    editStep(step.id, (current) => ({ ...current, ...next }) as FlowStep);

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>{definition?.title ?? step.kind}</h2>
        <p>{definition?.description}</p>
      </header>

      <Field label="Step label" hint="Shown on the canvas and in the trace.">
        <input
          value={step.label ?? ''}
          placeholder={definition?.title}
          onChange={(event) => update({ label: event.target.value || undefined })}
        />
      </Field>

      {step.kind !== 'call' && 'target' in step && step.target ? (
        <LocatorEditor
          target={step.target}
          onChange={(target) => update({ target } as Partial<FlowStep>)}
        />
      ) : null}

      {step.kind === 'navigate' ? (
        <ValueField
          label="URL"
          value={step.url}
          columns={dataColumns}
          onChange={(url) => update({ url } as Partial<FlowStep>)}
        />
      ) : null}

      {step.kind === 'fill' || step.kind === 'selectOption' ? (
        <ValueField
          label="Value"
          value={step.value}
          columns={dataColumns}
          hint={dataColumns.length > 0 ? 'Pick a data column to run this per row.' : undefined}
          onChange={(value) => update({ value } as Partial<FlowStep>)}
        />
      ) : null}

      {step.kind === 'press' ? (
        <Field label="Key">
          <input value={step.key} onChange={(event) => update({ key: event.target.value } as Partial<FlowStep>)} />
        </Field>
      ) : null}

      {step.kind === 'extract' ? (
        <Field label="Variable" hint="Later steps can reference this name.">
          <input
            value={step.variable}
            onChange={(event) => update({ variable: event.target.value } as Partial<FlowStep>)}
          />
        </Field>
      ) : null}

      {step.kind === 'assert' ? (
        <>
          <Field label="Assertion">
            <select
              value={step.assertion.type}
              onChange={(event) => {
                const type = event.target.value as AssertionIR['type'];
                const assertion: AssertionIR =
                  type === 'containsText' || type === 'hasText'
                    ? { type, text: { source: 'literal', value: '' } }
                    : type === 'hasValue'
                      ? { type, value: { source: 'literal', value: '' } }
                      : type === 'hasCount'
                        ? { type, count: 1 }
                        : { type };

                update({ assertion } as Partial<FlowStep>);
              }}
            >
              {ASSERTIONS.map((assertion) => (
                <option key={assertion.value} value={assertion.value}>
                  {assertion.label}
                </option>
              ))}
            </select>
          </Field>

          {'text' in step.assertion ? (
            <ValueField
              label="Expected text"
              value={step.assertion.text}
              columns={dataColumns}
              onChange={(text) =>
                update({ assertion: { ...step.assertion, text } } as Partial<FlowStep>)
              }
            />
          ) : null}

          {'count' in step.assertion ? (
            <Field label="Expected count">
              <input
                type="number"
                value={step.assertion.count}
                onChange={(event) =>
                  update({
                    assertion: { ...step.assertion, count: Number(event.target.value) },
                  } as Partial<FlowStep>)
                }
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {step.kind === 'loop' ? (
        <>
          <Field label="Collection">
            <input
              value={valueText(step.source)}
              onChange={(event) =>
                update({
                  source: { source: 'literal', value: event.target.value },
                } as Partial<FlowStep>)
              }
            />
          </Field>
          <Field label="Item name">
            <input
              value={step.itemName}
              onChange={(event) => update({ itemName: event.target.value } as Partial<FlowStep>)}
            />
          </Field>
        </>
      ) : null}

      {step.kind === 'code' ? (
        <Field label="Code" hint="Runs as-is inside the generated spec.">
          <textarea
            rows={6}
            value={step.code}
            onChange={(event) => update({ code: event.target.value } as Partial<FlowStep>)}
          />
        </Field>
      ) : null}

      {step.kind === 'comment' ? (
        <Field label="Comment">
          <textarea
            rows={3}
            value={step.text}
            onChange={(event) => update({ text: event.target.value } as Partial<FlowStep>)}
          />
        </Field>
      ) : null}

      {step.kind === 'useSnippet' ? (
        <>
          <Field label="Snippet">
            <select
              value={step.snippetId}
              onChange={(event) =>
                editStep(step.id, (current) =>
                  current.kind === 'useSnippet'
                    ? { ...current, snippetId: event.target.value, args: {}, assign: {} }
                    : current,
                )
              }
            >
              <option value="">Pick a snippet…</option>
              {snippets.map((snippet) => (
                <option key={snippet.id} value={snippet.id}>
                  {snippet.name}
                </option>
              ))}
            </select>
          </Field>

          {(snippets.find((snippet) => snippet.id === step.snippetId)?.params ?? []).map(
            (param) => (
              <ValueField
                key={param.name}
                label={`${param.name} (${param.type})`}
                value={step.args[param.name]}
                columns={dataColumns}
                hint={param.description}
                onChange={(value) =>
                  editStep(step.id, (current) =>
                    current.kind === 'useSnippet'
                      ? { ...current, args: { ...current.args, [param.name]: value } }
                      : current,
                  )
                }
              />
            ),
          )}

          {(snippets.find((snippet) => snippet.id === step.snippetId)?.outputs ?? []).map(
            (output) => (
              <Field
                key={output.name}
                label={`Capture ${output.name}`}
                hint="Later steps can use this variable name."
              >
                <input
                  value={step.assign?.[output.name] ?? ''}
                  placeholder={output.name}
                  onChange={(event) =>
                    editStep(step.id, (current) =>
                      current.kind === 'useSnippet'
                        ? {
                            ...current,
                            assign: event.target.value
                              ? { ...current.assign, [output.name]: event.target.value }
                              : Object.fromEntries(
                                  Object.entries(current.assign ?? {}).filter(
                                    ([key]) => key !== output.name,
                                  ),
                                ),
                          }
                        : current,
                    )
                  }
                />
              </Field>
            ),
          )}
        </>
      ) : null}

      {step.kind === 'call' ? (
        <Field label="Helper" hint="A fixture, helper, or page object method in your repo.">
          <input
            value={step.target}
            onChange={(event) =>
              editStep(step.id, (current) =>
                current.kind === 'call' ? { ...current, target: event.target.value } : current,
              )
            }
          />
        </Field>
      ) : null}

      <footer className="inspector__actions">
        {!definition?.scoped ? (
          <>
            <button type="button" onClick={() => wrapStep(step.id, 'condition')}>
              Wrap in condition
            </button>
            <button type="button" onClick={() => wrapStep(step.id, 'loop')}>
              Wrap in loop
            </button>
            <button type="button" onClick={() => wrapStep(step.id, 'try')}>
              Wrap in try
            </button>
          </>
        ) : null}
        <button type="button" className="danger" onClick={() => deleteStep(step.id)}>
          Delete step
        </button>
      </footer>
    </aside>
  );
}
