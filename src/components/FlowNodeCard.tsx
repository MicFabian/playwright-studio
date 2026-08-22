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
import {
  createSnippetStepNode,
  serializeNodeToCode,
  splitSnippetCodeIntoSteps,
} from '../lib/flow';
import type { FlowBlockKind, FlowNode } from '../types';

const iconMap: Record<FlowBlockKind, typeof Globe2> = {
  navigate: Globe2,
  click: MousePointer2,
  fill: Type,
  assert: ShieldCheck,
  extract: DatabaseZap,
  condition: GitBranch,
  loop: Repeat,
  code: Braces,
  freetext: Braces,
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
  const isSnippetStep = Boolean(data.snippetStep);
  const isSnippet = data.kind === 'snippet' && !isSnippetStep;
  const Icon = iconMap[data.kind];
  const [snippetExpanded, setSnippetExpanded] = useState(false);
  const [snippetEditMode, setSnippetEditMode] = useState(false);
  const snippetActions = useMemo(
    () => splitSnippetCodeIntoSteps(data.snippetCode),
    [data.snippetCode],
  );
  const snippetInputs = data.fields.filter((field) => field.value);
  const previewFields = data.fields.filter((field) => field.value).slice(0, 3);
  const snippetActionSummary = {
    key: 'snippet-actions',
    label: 'Actions',
    value: `${snippetActions.length} ${snippetActions.length === 1 ? 'block' : 'blocks'}`,
  };
  const collapsedFields =
    isSnippet && previewFields.length > 0
      ? [...previewFields.slice(0, 2), snippetActionSummary]
      : previewFields.length > 0
        ? previewFields
        : [
            {
              key: 'snippet-inputs',
              label: 'Inputs',
              value:
                snippetInputs.length > 0
                  ? snippetInputs.map((field) => field.label).join(', ')
                  : 'No inputs',
            },
            snippetActionSummary,
          ];
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

  function renderFields(
    editable: boolean,
    fields = editable ? data.fields : previewFields,
    onFieldChange: ((fieldKey: string, value: string) => void) | undefined =
      editable ? (fieldKey, value) => onUpdateField?.(id, fieldKey, value) : undefined,
    testIdPrefix = editable ? `canvas-inline-field-${id}` : undefined,
  ) {
    if (fields.length === 0) {
      return null;
    }

    return fields.map((field) =>
      editable ? (
        <label
          className="flow-node-card__field is-editable"
          key={field.key}
        >
          <span>{field.label}</span>
          {field.control === 'select' && field.options ? (
            <select
              className="flow-node-card__field-input nodrag nopan"
              data-testid={testIdPrefix ? `${testIdPrefix}-${field.key}` : undefined}
              value={field.value}
              onChange={(event) => onFieldChange?.(field.key, event.target.value)}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.multiline ? (
            <textarea
              className="flow-node-card__field-input nowheel nodrag nopan"
              data-testid={testIdPrefix ? `${testIdPrefix}-${field.key}` : undefined}
              placeholder={field.placeholder}
              value={field.value}
              onChange={(event) => onFieldChange?.(field.key, event.target.value)}
            />
          ) : (
            <input
              className="flow-node-card__field-input nodrag nopan"
              data-testid={testIdPrefix ? `${testIdPrefix}-${field.key}` : undefined}
              placeholder={field.placeholder}
              type="text"
              value={field.value}
              onChange={(event) => onFieldChange?.(field.key, event.target.value)}
            />
          )}
        </label>
      ) : (
        <div className="flow-node-card__field" key={field.key}>
          <span>{field.label}</span>
          <strong
            className={field.key === 'code' || field.multiline ? 'flow-node-card__field-value--code' : undefined}
          >
            {field.value || field.placeholder || 'Unset'}
          </strong>
        </div>
      ),
    );
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

      {isSnippet ? (
        <div className="flow-node-card__snippet">
          <div className="flow-node-card__fields">
            {selected && data.fields.length > 0
              ? renderFields(true)
              : renderFields(false, collapsedFields)}
          </div>

          <div className="flow-node-card__inline-actions">
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

          {snippetExpanded ? (
            <>
              <div
                className="flow-node-card__snippet-step-canvas nodrag nopan nowheel"
                data-testid={`snippet-step-canvas-${id}`}
              >
                {snippetActions.map((action, index) => (
                  (() => {
                    const actionNode = createSnippetStepNode(action, { x: 0, y: 0 });
                    const NestedIcon = iconMap[actionNode.data.kind];

                    return (
                      <article
                        className="flow-node-card flow-node-card--nested-step is-step-card"
                        key={`${id}-action-${index}`}
                        style={{ '--node-accent': actionNode.data.accent } as CSSProperties}
                      >
                        <div className="flow-node-card__header">
                          <span className="flow-node-card__icon">
                            <NestedIcon size={16} />
                          </span>
                          <div>
                            <div className="flow-node-card__eyebrow">{actionNode.data.codeLabel}</div>
                            <div className="flow-node-card__title">{actionNode.data.title}</div>
                          </div>
                          <span className="flow-node-card__status ready">ready</span>
                        </div>
                        <p className="flow-node-card__description">
                          {actionNode.data.description}
                        </p>
                        <div className="flow-node-card__fields">
                          {renderFields(
                            true,
                            actionNode.data.fields,
                            (fieldKey, value) => {
                              const nextNode: FlowNode = {
                                ...actionNode,
                                data: {
                                  ...actionNode.data,
                                  fields: actionNode.data.fields.map((field) =>
                                    field.key === fieldKey ? { ...field, value } : field,
                                  ),
                                },
                              };
                              handleSnippetActionChange(index, serializeNodeToCode(nextNode));
                            },
                            actionNode.data.kind === 'code'
                              ? `snippet-step-input-${id}-${index}`
                              : `snippet-step-field-${id}-${index}`,
                          )}
                        </div>
                        <div className="flow-node-card__inline-actions is-end-aligned">
                          <div className="flow-node-card__step-toolbar-actions">
                            <button
                              aria-label={`Add block after ${index + 1}`}
                              className="flow-node-card__step-toolbar-button nodrag nopan"
                              type="button"
                              onClick={() => handleSnippetActionAdd(index)}
                            >
                              + Block
                            </button>
                            <button
                              aria-label={`Remove block ${index + 1}`}
                              className="flow-node-card__step-toolbar-button is-danger nodrag nopan"
                              type="button"
                              onClick={() => handleSnippetActionRemove(index)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })()
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
          ) : null}
        </div>
      ) : (
        <>
          <div className="flow-node-card__fields">
            {selected && data.fields.length > 0 ? (
              renderFields(true)
            ) : previewFields.length > 0 ? (
              renderFields(false)
            ) : (
              <div className="flow-node-card__field is-empty">
                <span>Custom code</span>
                <strong>Open inspector to define inputs</strong>
              </div>
            )}
          </div>
          {isSnippetStep ? (
            <div className="flow-node-card__inline-actions is-end-aligned">
              <div className="flow-node-card__step-toolbar-actions">
                <button
                  aria-label={`Add block after ${snippetStepIndex + 1}`}
                  className="flow-node-card__step-toolbar-button nodrag nopan"
                  type="button"
                  onClick={() => onInsertSnippetStep?.(id, 'after')}
                >
                  + Block
                </button>
                <button
                  aria-label={`Remove block ${snippetStepIndex + 1}`}
                  className="flow-node-card__step-toolbar-button is-danger nodrag nopan"
                  type="button"
                  onClick={() => onRemoveSnippetStep?.(id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
