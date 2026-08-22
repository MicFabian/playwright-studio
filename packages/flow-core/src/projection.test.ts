import { describe, expect, it } from 'vitest';
import { createStep } from './block-registry';
import { insertStep, locateStep, moveStep } from './commands';
import { FLOW_FORMAT_VERSION, type FlowDocument } from './ir';
import { projectFlowToCanvas, resolveDropTarget } from './projection';

function sequence(ids: string[]): FlowDocument {
  return ids.reduce<FlowDocument>(
    (document, id, index) =>
      insertStep(document, createStep('click', id), { parentId: null, slot: null, index }),
    {
      formatVersion: FLOW_FORMAT_VERSION,
      id: 'doc',
      name: 'Doc',
      status: 'draft',
      root: { steps: [] },
      layout: { positions: {} },
    },
  );
}

describe('resolveDropTarget', () => {
  it('drops before the nearest step when the pointer is to its left', () => {
    const document = sequence(['a', 'b', 'c']);
    const projection = projectFlowToCanvas(document);
    const b = projection.nodes.find((node) => node.id === 'b')!;

    const target = resolveDropTarget(projection, 'c', { x: b.position.x - 30, y: b.position.y });

    expect(target).toEqual({ parentId: null, slot: null, index: b.index });
  });

  it('drops after the nearest step when the pointer is to its right', () => {
    const document = sequence(['a', 'b', 'c']);
    const projection = projectFlowToCanvas(document);
    const b = projection.nodes.find((node) => node.id === 'b')!;

    const target = resolveDropTarget(projection, 'a', { x: b.position.x + 30, y: b.position.y });

    expect(target).toEqual({ parentId: null, slot: null, index: b.index + 1 });
  });

  it('never targets the dragged step itself', () => {
    const document = sequence(['a', 'b']);
    const projection = projectFlowToCanvas(document);
    const a = projection.nodes.find((node) => node.id === 'a')!;

    const target = resolveDropTarget(projection, 'a', a.position);

    expect(target?.index).not.toBeUndefined();
    expect(projection.nodes.find((node) => node.id === 'a')).toBeDefined();
  });

  it('resolves into a scope when dropped near a nested step', () => {
    let document = sequence(['a']);
    document = insertStep(document, createStep('condition', 'cond'), {
      parentId: null,
      slot: null,
      index: 1,
    });
    document = insertStep(document, createStep('click', 'inner'), {
      parentId: 'cond',
      slot: 'then',
      index: 0,
    });

    const projection = projectFlowToCanvas(document);
    const inner = projection.nodes.find((node) => node.id === 'inner')!;

    const target = resolveDropTarget(projection, 'a', {
      x: inner.position.x - 10,
      y: inner.position.y,
    });

    expect(target).toEqual({ parentId: 'cond', slot: 'then', index: 0 });
  });

  it('produces a move the AST accepts', () => {
    const document = sequence(['a', 'b', 'c']);
    const projection = projectFlowToCanvas(document);
    const a = projection.nodes.find((node) => node.id === 'a')!;

    const target = resolveDropTarget(projection, 'c', { x: a.position.x - 20, y: a.position.y })!;
    const moved = moveStep(document, 'c', target);

    expect(moved.root.steps.map((step) => step.id)).toEqual(['c', 'a', 'b']);
    expect(locateStep(moved, 'c')).toEqual({ parentId: null, slot: null, index: 0 });
  });

  it('handles an empty canvas', () => {
    const empty = projectFlowToCanvas(sequence([]));

    expect(resolveDropTarget(empty, 'anything', { x: 0, y: 0 })).toEqual({
      parentId: null,
      slot: null,
      index: 0,
    });
  });
});
