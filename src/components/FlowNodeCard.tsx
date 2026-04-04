import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import {
  Braces,
  ChevronDown,
  ChevronUp,
  DatabaseZap,
  GitBranch,
  Globe2,
  MousePointer2,
  Repeat,
  ShieldCheck,
  Type,
} from 'lucide-react';
import { splitSnippetCodeIntoSteps } from '../lib/flow';
import type { FlowBlockKind, FlowNode } from '../types';

const iconMap: Record<FlowBlockKind, typeof Globe2> = {
  navigate: Globe2,
  click: MousePointer2,
  fill: Type,
  assert: ShieldCheck,
  extract: DatabaseZap,
  condition: GitBranch,
  loop: Repeat,
  snippet: Braces,
};

interface FlowNodeCardProps extends NodeProps<FlowNode> {
  onUpdateTitle?: (nodeId: string, value: string) => void;
  onUpdateField?: (nodeId: string, fieldKey: string, value: string) => void;
  onUpdateSnippetCode?: (nodeId: string, value: string) => void;
  onInsertSnippetStep?: (nodeId: string, position: 'before' | 'after') => void;
  onRemoveSnippetStep?: (nodeId: string) => void;
}

export function FlowNodeCard({
  id,
  data,
  selected,
  onUpdateTitle,
  onUpdateField,
  onUpdateSnippetCode,
  onInsertSnippetStep,
  onRemoveSnippetStep,
}: FlowNodeCardProps) {
  const Icon = iconMap[data.kind];
  const isSnippet = data.kind === 'snippet';
  const isSnippetStep = isSnippet && Boolean(data.snippetStep);
  const [snippetExpanded, setSnippetExpanded] = useState(false);
  const [snippetEditMode, setSnippetEditMode] = useState(false);
  const snippetActions = useMemo(
    () => splitSnippetCodeIntoSteps(data.snippetCode),
    [data.snippetCode],
  );
  const snippetInputs = data.fields.filter((field) => field.value);
  const previewFields = data.fields.filter((field) => field.value).slice(0, 2);
  const snippetStepCode = data.fields.find((field) => field.key === 'code')?.value || '';
  const snippetStepIndex =
    typeof data.snippetStepIndex === 'number' ? data.snippetStepIndex : 0;

  function toggleSnippetExpanded() {
    setSnippetExpanded((current) => {
      const next = !current;

      if (!next) {
        setSnippetEditMode(false);
      }

      return next;
    });
  }

  function toggleSnippetEditMode() {
    setSnippetExpanded(true);
    setSnippetEditMode((current) => !current);
  }

  function updateSnippetActions(nextActions: string[]) {
    onUpdateSnippetCode?.(id, nextActions.join('\n\n'));
  }

  function handleSnippetActionChange(index: number, value: string) {
    const nextActions = snippetActions.slice();
    nextActions[index] = value;
    updateSnippetActions(nextActions);
  }

  function handleSnippetActionAdd(afterIndex: number) {
    const nextActions = snippetActions.slice();
    nextActions.splice(afterIndex + 1, 0, '');
    updateSnippetActions(nextActions);
  }

  function handleSnippetActionRemove(index: number) {
    if (snippetActions.length === 1) {
      updateSnippetActions(['']);
      return;
    }

    const nextActions = snippetActions.filter((_, actionIndex) => actionIndex !== index);
    updateSnippetActions(nextActions);
  }

  return (
    <div
      className={`flow-node-card${selected ? ' is-selected' : ''}${isSnippet && !isSnippetStep && snippetExpanded ? ' is-expanded' : ''}${isSnippetStep ? ' is-step-card' : ''}`}
      data-testid={`flow-node-${id}`}
      style={{ '--node-accent': data.accent } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-card__header">
        <span className="flow-node-card__icon">
          <Icon size={16} />
        </span>
        <div>
          <div className="flow-node-card__eyebrow">{data.codeLabel}</div>
          <div className="flow-node-card__title">{data.title}</div>
        </div>
        <span className={`flow-node-card__status ${data.status}`}>
          {data.status}
        </span>
      </div>

      <p className="flow-node-card__description">{data.description}</p>

      {isSnippetStep ? (
        <div className="flow-node-card__step-content">
          <div className="flow-node-card__step-toolbar">
            <span className="flow-node-card__step-label">{`Step ${snippetStepIndex + 1}`}</span>
            <div className="flow-node-card__step-toolbar-actions">
              <button
                aria-label={`Add snippet step after ${snippetStepIndex + 1}`}
                className="flow-node-card__step-toolbar-button nodrag nopan"
                type="button"
                onClick={() => onInsertSnippetStep?.(id, 'after')}
              >
                + Step
              </button>
              <button
                aria-label={`Remove snippet step ${snippetStepIndex + 1}`}
                className="flow-node-card__step-toolbar-button is-danger nodrag nopan"
                type="button"
                onClick={() => onRemoveSnippetStep?.(id)}
              >
                Remove
              </button>
            </div>
          </div>
          <label className="flow-node-card__step-field">
            <span>Code</span>
            <textarea
              className="flow-node-card__step-input nowheel nodrag nopan"
              data-testid={`snippet-step-card-input-${id}`}
              placeholder={`await page.locator('[data-testid="target"]').click();`}
              value={snippetStepCode}
              onChange={(event) => onUpdateField?.(id, 'code', event.target.value)}
            />
          </label>
        </div>
      ) : isSnippet ? (
        <div className="flow-node-card__snippet">
          <div className="flow-node-card__snippet-toolbar">
            <button
              aria-expanded={snippetExpanded}
              className="flow-node-card__toggle nodrag nopan"
              type="button"
              onClick={toggleSnippetExpanded}
            >
              {snippetExpanded ? (
                <>
                  <ChevronUp size={14} />
                  Hide actions
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  Show actions
                </>
              )}
            </button>

            <button
              className="flow-node-card__inline-edit-button nodrag nopan"
              type="button"
              onClick={toggleSnippetEditMode}
            >
              {snippetEditMode ? 'Stop editing' : 'Edit in canvas'}
            </button>
          </div>

          {snippetInputs.length > 0 ? (
            <p className="flow-node-card__snippet-inputs">
              Inputs: {snippetInputs.map((field) => field.label).join(', ')}
            </p>
          ) : null}

          {snippetExpanded ? (
            <>
              <div
                className="flow-node-card__snippet-step-canvas nodrag nopan nowheel"
                data-testid={`snippet-step-canvas-${id}`}
              >
                {snippetActions.map((action, index) => (
                  <article
                    className="flow-node-card__snippet-step"
                    key={`${id}-action-${index}`}
                  >
                    <div className="flow-node-card__snippet-step-header">
                      <span>{`Step ${index + 1}`}</span>
                      <div className="flow-node-card__snippet-step-actions">
                        <button
                          aria-label={`Add snippet step after ${index + 1}`}
                          className="flow-node-card__snippet-step-button nodrag nopan"
                          type="button"
                          onClick={() => handleSnippetActionAdd(index)}
                        >
                          + Step
                        </button>
                        <button
                          aria-label={`Remove snippet step ${index + 1}`}
                          className="flow-node-card__snippet-step-button is-danger nodrag nopan"
                          type="button"
                          onClick={() => handleSnippetActionRemove(index)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="flow-node-card__snippet-step-input nowheel"
                      data-testid={`snippet-step-input-${id}-${index}`}
                      placeholder={`await page.locator('[data-testid="target"]').click();`}
                      value={action}
                      onChange={(event) =>
                        handleSnippetActionChange(index, event.target.value)
                      }
                    />
                  </article>
                ))}
              </div>
              {snippetEditMode ? (
                <div className="flow-node-card__snippet-edit nodrag nopan nowheel">
                  <label>
                    <span>Title</span>
                    <input
                      data-testid={`snippet-inline-title-${id}`}
                      type="text"
                      value={data.title}
                      onChange={(event) => onUpdateTitle?.(id, event.target.value)}
                    />
                  </label>

                  {data.fields.map((field) => (
                    <label key={`${id}-${field.key}`}>
                      <span>{field.label}</span>
                      <input
                        data-testid={`snippet-inline-field-${id}-${field.key}`}
                        type="text"
                        value={field.value}
                        onChange={(event) =>
                          onUpdateField?.(id, field.key, event.target.value)
                        }
                      />
                    </label>
                  ))}

                  <label>
                    <span>Snippet code</span>
                    <textarea
                      className="nowheel"
                      data-testid={`snippet-inline-code-${id}`}
                      value={data.snippetCode || ''}
                      onChange={(event) =>
                        onUpdateSnippetCode?.(id, event.target.value)
                      }
                    />
                  </label>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flow-node-card__fields">
              {previewFields.length > 0 ? (
                previewFields.map((field) => (
                  <div className="flow-node-card__field" key={field.key}>
                    <span>{field.label}</span>
                    <strong>{field.value}</strong>
                  </div>
                ))
              ) : (
                <div className="flow-node-card__field is-empty">
                  <span>Snippet actions</span>
                  <strong>Expand this card to review code steps</strong>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flow-node-card__fields">
          {previewFields.length > 0 ? (
            previewFields.map((field) => (
              <div className="flow-node-card__field" key={field.key}>
                <span>{field.label}</span>
                <strong>{field.value}</strong>
              </div>
            ))
          ) : (
            <div className="flow-node-card__field is-empty">
              <span>Custom code</span>
              <strong>Open inspector to define inputs</strong>
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
