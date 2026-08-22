import { blockRegistry, describeStep } from './block-registry';
import type { ScopeSlot } from './commands';
import type { FlowDocument, FlowStep, Sequence } from './ir';

export interface CanvasNode {
  id: string;
  parentId: string | null;
  slot: ScopeSlot | null;
  index: number;
  depth: number;
  step: FlowStep;
  title: string;
  subtitle: string;
  codeLabel: string;
  accentToken: string;
  icon: string;
  scoped: boolean;
  position: { x: number; y: number };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
  kind: 'sequence' | 'scope';
}

export interface CanvasProjection {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const HORIZONTAL_STEP = 280;
const VERTICAL_STEP = 150;
const SLOT_LABELS: Record<ScopeSlot, string> = {
  then: 'then',
  else: 'else',
  body: 'body',
  catch: 'catch',
  finally: 'finally',
};

export function projectFlowToCanvas(document: FlowDocument): CanvasProjection {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  let cursor = 0;

  const visit = (
    sequence: Sequence,
    parentId: string | null,
    slot: ScopeSlot | null,
    depth: number,
  ) => {
    let previousId: string | null = null;

    sequence.steps.forEach((step, index) => {
      const definition = blockRegistry[step.kind];
      const stored = document.layout.positions[step.id];
      const position = stored ?? {
        x: cursor * HORIZONTAL_STEP,
        y: depth * VERTICAL_STEP,
      };

      cursor += 1;

      nodes.push({
        id: step.id,
        parentId,
        slot,
        index,
        depth,
        step,
        title: step.label?.trim() || definition?.title || step.kind,
        subtitle: describeStep(step),
        codeLabel: definition?.codeLabel ?? step.kind,
        accentToken: definition?.accentToken ?? 'var(--block-action)',
        icon: definition?.icon ?? 'Square',
        scoped: definition?.scoped ?? false,
        position,
      });

      if (previousId) {
        edges.push({
          id: `${previousId}->${step.id}`,
          source: previousId,
          target: step.id,
          label: null,
          kind: 'sequence',
        });
      } else if (parentId && slot) {
        edges.push({
          id: `${parentId}:${slot}->${step.id}`,
          source: parentId,
          target: step.id,
          label: SLOT_LABELS[slot],
          kind: 'scope',
        });
      }

      previousId = step.id;

      if (step.kind === 'condition') {
        visit(step.then, step.id, 'then', depth + 1);

        if (step.else) {
          visit(step.else, step.id, 'else', depth + 1);
        }
      } else if (step.kind === 'loop') {
        visit(step.body, step.id, 'body', depth + 1);
      } else if (step.kind === 'try') {
        visit(step.body, step.id, 'body', depth + 1);

        if (step.catch) {
          visit(step.catch.body, step.id, 'catch', depth + 1);
        }

        if (step.finally) {
          visit(step.finally, step.id, 'finally', depth + 1);
        }
      }
    });
  };

  visit(document.root, null, null, 0);

  return { nodes, edges };
}

export function emptyScopeSlots(step: FlowStep): { slot: ScopeSlot; label: string }[] {
  if (step.kind === 'condition') {
    const slots: { slot: ScopeSlot; label: string }[] = [];

    if (step.then.steps.length === 0) {
      slots.push({ slot: 'then', label: 'then' });
    }

    if (!step.else || step.else.steps.length === 0) {
      slots.push({ slot: 'else', label: 'else' });
    }

    return slots;
  }

  if (step.kind === 'loop') {
    return step.body.steps.length === 0 ? [{ slot: 'body', label: 'body' }] : [];
  }

  if (step.kind === 'try') {
    const slots: { slot: ScopeSlot; label: string }[] = [];

    if (step.body.steps.length === 0) {
      slots.push({ slot: 'body', label: 'body' });
    }

    if (step.catch && step.catch.body.steps.length === 0) {
      slots.push({ slot: 'catch', label: 'catch' });
    }

    if (step.finally && step.finally.steps.length === 0) {
      slots.push({ slot: 'finally', label: 'finally' });
    }

    return slots;
  }

  return [];
}
