import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import * as icons from 'lucide-react';
import { emptyScopeSlots, type FlowStep, type ScopeSlot } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';
import { useRunStore } from '../../stores/runStore';

export interface StepNodeData extends Record<string, unknown> {
  title: string;
  subtitle: string;
  codeLabel: string;
  accentToken: string;
  icon: string;
  scoped: boolean;
  depth: number;
  slot: ScopeSlot | null;
  step: FlowStep;
}

function Icon({ name }: { name: string }) {
  const Component = (icons as unknown as Record<string, icons.LucideIcon>)[name];
  return Component ? <Component size={14} aria-hidden /> : null;
}

function StepNodeComponent({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const addStep = useEditorStore((state) => state.addStep);
  const stepStatus = useRunStore((state) => state.stepStatus[id]);
  const slots = emptyScopeSlots(data.step);

  return (
    <div
      className={[
        'step-node',
        selected ? 'step-node--selected' : '',
        data.scoped ? 'step-node--scope' : '',
        stepStatus ? `step-node--${stepStatus}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--step-accent': data.accentToken } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} />

      <header className="step-node__head">
        <span className="step-node__icon">
          <Icon name={data.icon} />
        </span>
        <span className="step-node__title">{data.title}</span>
        {stepStatus ? <span className={`step-node__status step-node__status--${stepStatus}`} /> : null}
      </header>

      <p className="step-node__subtitle">{data.subtitle}</p>
      <code className="step-node__code">{data.codeLabel}</code>

      {slots.length > 0 ? (
        <div className="step-node__slots">
          {slots.map((slot) => (
            <button
              key={slot.slot}
              type="button"
              className="step-node__slot"
              onClick={(event) => {
                event.stopPropagation();
                addStep('click', { parentId: id, slot: slot.slot, index: 0 });
              }}
            >
              + {slot.label}
            </button>
          ))}
        </div>
      ) : null}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const StepNode = memo(StepNodeComponent);
