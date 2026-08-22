import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { projectFlowToCanvas, type CanvasNode } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';
import { StepNode, type StepNodeData } from './StepNode';

const nodeTypes = { step: StepNode };

export function FlowCanvas() {
  const document = useEditorStore((state) => state.document);
  const selectedStepId = useEditorStore((state) => state.selectedStepId);
  const select = useEditorStore((state) => state.select);
  const moveNode = useEditorStore((state) => state.moveNode);

  const projection = useMemo(
    () => (document ? projectFlowToCanvas(document) : { nodes: [], edges: [] }),
    [document],
  );

  const nodes: Node<StepNodeData>[] = useMemo(
    () =>
      projection.nodes.map((canvasNode: CanvasNode) => ({
        id: canvasNode.id,
        type: 'step',
        position: canvasNode.position,
        selected: canvasNode.id === selectedStepId,
        data: {
          title: canvasNode.title,
          subtitle: canvasNode.subtitle,
          codeLabel: canvasNode.codeLabel,
          accentToken: canvasNode.accentToken,
          icon: canvasNode.icon,
          scoped: canvasNode.scoped,
          depth: canvasNode.depth,
          slot: canvasNode.slot,
          step: canvasNode.step,
        },
      })),
    [projection.nodes, selectedStepId],
  );

  const edges: Edge[] = useMemo(
    () =>
      projection.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: edge.kind === 'scope',
        label: edge.label ?? undefined,
        className: `flow-edge flow-edge--${edge.kind}`,
      })),
    [projection.edges],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<StepNodeData>>[]) => {
      changes.forEach((change) => {
        if (change.type === 'position' && change.position && !change.dragging) {
          moveNode(change.id, change.position);
        }
      });
    },
    [moveNode],
  );

  if (!document) {
    return (
      <div className="canvas-empty">
        <p>Select a flow to start editing.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      minZoom={0.2}
      maxZoom={1.6}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        nodeStrokeWidth={2}
        bgColor="transparent"
        maskColor="transparent"
        nodeColor="var(--border-strong)"
      />
    </ReactFlow>
  );
}
