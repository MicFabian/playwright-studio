import { describe, expect, it } from 'vitest';
import { createStep } from './block-registry';
import {
  insertStep,
  isDescendant,
  locateStep,
  moveStep,
  removeStep,
  updateStep,
  wrapInScope,
} from './commands';
import { compileFlow, hasBlockingDiagnostics } from './compiler';
import { FLOW_FORMAT_VERSION, countSteps, type FlowDocument } from './ir';
import { projectFlowToCanvas } from './projection';

function emptyDocument(): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id: 'doc',
    name: 'Doc',
    status: 'draft',
    root: { steps: [] },
    layout: { positions: {} },
  };
}

function documentWithCondition(): FlowDocument {
  let document = insertStep(emptyDocument(), createStep('navigate', 'nav'), {
    parentId: null,
    slot: null,
    index: 0,
  });

  document = insertStep(document, createStep('condition', 'cond'), {
    parentId: null,
    slot: null,
    index: 1,
  });

  return insertStep(document, createStep('click', 'inner'), {
    parentId: 'cond',
    slot: 'then',
    index: 0,
  });
}

describe('insert', () => {
  it('appends into the root sequence', () => {
    const document = insertStep(emptyDocument(), createStep('navigate', 'a'), {
      parentId: null,
      slot: null,
      index: 0,
    });

    expect(document.root.steps.map((step) => step.id)).toEqual(['a']);
  });

  it('inserts into a nested scope slot', () => {
    const document = documentWithCondition();
    const condition = document.root.steps[1];

    expect(condition.kind).toBe('condition');
    expect(countSteps(document.root)).toBe(3);
    expect(locateStep(document, 'inner')).toEqual({ parentId: 'cond', slot: 'then', index: 0 });
  });

  it('creates the else slot on demand', () => {
    const document = insertStep(documentWithCondition(), createStep('comment', 'alt'), {
      parentId: 'cond',
      slot: 'else',
      index: 0,
    });

    expect(locateStep(document, 'alt')).toEqual({ parentId: 'cond', slot: 'else', index: 0 });
  });

  it('does not mutate the source document', () => {
    const before = documentWithCondition();
    const snapshot = JSON.stringify(before);

    insertStep(before, createStep('click', 'new'), { parentId: 'cond', slot: 'then', index: 0 });

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('immutability', () => {
  it('never mutates the source document, even when creating a missing scope slot', () => {
    const document = documentWithCondition();
    const snapshot = JSON.stringify(document);

    locateStep(document, 'missing');
    isDescendant(document, 'cond', 'missing');

    const next = insertStep(document, createStep('comment', 'alt'), {
      parentId: 'cond',
      slot: 'else',
      index: 0,
    });

    expect(JSON.stringify(document)).toBe(snapshot);
    expect(JSON.stringify(document)).not.toContain('"else"');
    expect(JSON.stringify(next)).toContain('"else"');
  });

  it('does not share nested arrays between the source and the result', () => {
    const document = documentWithCondition();
    const next = insertStep(document, createStep('click', 'extra'), {
      parentId: 'cond',
      slot: 'then',
      index: 0,
    });

    const sourceCondition = document.root.steps[1];
    const nextCondition = next.root.steps[1];

    expect(sourceCondition.kind === 'condition' && sourceCondition.then.steps).toHaveLength(1);
    expect(nextCondition.kind === 'condition' && nextCondition.then.steps).toHaveLength(2);
    expect(
      sourceCondition.kind === 'condition' &&
        nextCondition.kind === 'condition' &&
        sourceCondition.then === nextCondition.then,
    ).toBe(false);
  });
});

describe('move', () => {
  it('moves a step into a scope', () => {
    const document = moveStep(documentWithCondition(), 'nav', {
      parentId: 'cond',
      slot: 'then',
      index: 0,
    });

    expect(locateStep(document, 'nav')).toEqual({ parentId: 'cond', slot: 'then', index: 0 });
    expect(document.root.steps.map((step) => step.id)).toEqual(['cond']);
  });

  it('refuses to move a scope into its own descendant', () => {
    const document = documentWithCondition();
    const moved = moveStep(document, 'cond', { parentId: 'cond', slot: 'then', index: 0 });

    expect(moved).toBe(document);
  });

  it('refuses to move a step into itself', () => {
    const document = documentWithCondition();
    expect(moveStep(document, 'cond', { parentId: 'cond', slot: 'then', index: 0 })).toBe(document);
  });

  it('adjusts the index when reordering inside one sequence', () => {
    let document = emptyDocument();
    ['a', 'b', 'c'].forEach((id, index) => {
      document = insertStep(document, createStep('click', id), {
        parentId: null,
        slot: null,
        index,
      });
    });

    const moved = moveStep(document, 'a', { parentId: null, slot: null, index: 2 });

    expect(moved.root.steps.map((step) => step.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('descendants', () => {
  it('detects nesting', () => {
    const document = documentWithCondition();

    expect(isDescendant(document, 'cond', 'inner')).toBe(true);
    expect(isDescendant(document, 'cond', 'nav')).toBe(false);
  });
});

describe('remove and update', () => {
  it('removes a nested step and its layout entry', () => {
    const withPosition: FlowDocument = {
      ...documentWithCondition(),
      layout: { positions: { inner: { x: 10, y: 20 } } },
    };

    const document = removeStep(withPosition, 'inner');

    expect(locateStep(document, 'inner')).toBeNull();
    expect(document.layout.positions.inner).toBeUndefined();
  });

  it('updates a nested step in place', () => {
    const document = updateStep(documentWithCondition(), 'inner', (step) => ({
      ...step,
      label: 'Dismiss the toast',
    }));

    expect(locateStep(document, 'inner')?.parentId).toBe('cond');
    expect(compileFlow(document).source).toContain('Dismiss the toast');
  });
});

describe('wrap', () => {
  it('wraps existing steps into a new scope', () => {
    let document = emptyDocument();
    ['a', 'b'].forEach((id, index) => {
      document = insertStep(document, createStep('click', id), {
        parentId: null,
        slot: null,
        index,
      });
    });

    const wrapped = wrapInScope(document, ['a', 'b'], createStep('loop', 'wrapper'));

    expect(wrapped.root.steps.map((step) => step.id)).toEqual(['wrapper']);
    expect(locateStep(wrapped, 'a')).toEqual({ parentId: 'wrapper', slot: 'body', index: 0 });
    expect(locateStep(wrapped, 'b')).toEqual({ parentId: 'wrapper', slot: 'body', index: 1 });
  });

  it('produces a compilable loop once it has a body', () => {
    let document = insertStep(emptyDocument(), createStep('click', 'a'), {
      parentId: null,
      slot: null,
      index: 0,
    });

    document = wrapInScope(document, ['a'], createStep('loop', 'wrapper'));

    expect(hasBlockingDiagnostics(compileFlow(document))).toBe(false);
  });
});

describe('projection', () => {
  it('emits labeled scope edges and sequence edges', () => {
    const { nodes, edges } = projectFlowToCanvas(documentWithCondition());

    expect(nodes.map((node) => node.id)).toEqual(['nav', 'cond', 'inner']);
    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'nav', target: 'cond', kind: 'sequence' }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'cond', target: 'inner', kind: 'scope', label: 'then' }),
    );
  });

  it('reports depth so the canvas can indent scopes', () => {
    const { nodes } = projectFlowToCanvas(documentWithCondition());

    expect(nodes.find((node) => node.id === 'inner')?.depth).toBe(1);
    expect(nodes.find((node) => node.id === 'nav')?.depth).toBe(0);
  });

  it('honors stored positions and falls back to a layout', () => {
    const document: FlowDocument = {
      ...documentWithCondition(),
      layout: { positions: { nav: { x: 999, y: 42 } } },
    };

    const { nodes } = projectFlowToCanvas(document);

    expect(nodes.find((node) => node.id === 'nav')?.position).toEqual({ x: 999, y: 42 });
    expect(nodes.find((node) => node.id === 'inner')?.position).toBeDefined();
  });

  it('carries presentation from the registry rather than the document', () => {
    const { nodes } = projectFlowToCanvas(documentWithCondition());
    const navigate = nodes.find((node) => node.id === 'nav');

    expect(navigate?.title).toBe('Open page');
    expect(navigate?.accentToken).toBe('var(--block-entry)');
    expect(JSON.stringify(documentWithCondition())).not.toContain('var(--block-entry)');
  });
});

describe('round trip through the compiler', () => {
  it('builds a nested flow that compiles cleanly', () => {
    let document = insertStep(emptyDocument(), createStep('navigate', 'nav'), {
      parentId: null,
      slot: null,
      index: 0,
    });

    document = insertStep(document, createStep('condition', 'cond'), {
      parentId: null,
      slot: null,
      index: 1,
    });

    document = insertStep(document, createStep('click', 'dismiss'), {
      parentId: 'cond',
      slot: 'then',
      index: 0,
    });

    const result = compileFlow(document);

    expect(hasBlockingDiagnostics(result)).toBe(false);
    expect(result.source).toContain('if (await page.getByTestId("toast-error").isVisible()) {');
    expect(result.source).toContain('page.getByTestId("submit").click()');
  });
});
