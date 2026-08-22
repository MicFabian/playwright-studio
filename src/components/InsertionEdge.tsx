import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { Plus } from 'lucide-react';
import type { CSSProperties, DragEvent as ReactDragEvent } from 'react';
import type { FlowEdge } from '../types';

interface InsertionEdgeProps extends EdgeProps<FlowEdge> {
  insertionVisible?: boolean;
  insertionActive?: boolean;
  onInsertDragOver?: (
    edgeId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
  onInsertDragLeave?: (
    edgeId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
  onInsertDrop?: (
    edgeId: string,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
}

export function InsertionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  insertionVisible = false,
  insertionActive = false,
  onInsertDragOver,
  onInsertDragLeave,
  onInsertDrop,
}: InsertionEdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        className={`flow-insert-edge${insertionVisible ? ' is-inserting' : ''}${insertionActive ? ' is-active' : ''}`}
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={style}
      />
      <EdgeLabelRenderer>
        <div
          className={`flow-insert-slot${insertionVisible ? ' is-visible' : ''}${insertionActive ? ' is-active' : ''} nodrag nopan`}
          aria-label="Drop here to insert between blocks"
          data-testid={`insert-slot-${id}`}
          style={{
            '--insert-x': `${labelX}px`,
            '--insert-y': `${labelY}px`,
          } as CSSProperties}
          title="Drag here to insert between blocks"
          role="button"
          onDragLeave={(event) => onInsertDragLeave?.(id, event)}
          onDragOver={(event) => onInsertDragOver?.(id, event)}
          onDrop={(event) => onInsertDrop?.(id, event)}
        >
          <span className="flow-insert-slot__dot">
            <Plus size={14} strokeWidth={2.4} />
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
