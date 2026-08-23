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

  // Selection is applied separately below: folding it in here would rebuild
  // every node object whenever the selection changes.
  const nodes: Node<StepNodeData>[] = useMemo(
    () =>
      projection.nodes.map((canvasNode: CanvasNode) => ({
        id: canvasNode.id,
        type: 'step',
        position: canvasNode.position,
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
    [projection.nodes],
  );

  const selectedNodes: Node<StepNodeData>[] = useMemo(
    () =>
      nodes.map((node) =>
        node.selected === (node.id === selectedStepId)
          ? node
          : { ...node, selected: node.id === selectedStepId },
      ),
    [nodes, selectedStepId],
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
      nodes={selectedNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      fitView
      // Without a floor, a long flow zooms out until the steps are unreadable
      // and the first one sits far outside the viewport.
      fitViewOptions={{ minZoom: 0.45, maxZoom: 1.2, padding: 0.15 }}
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
