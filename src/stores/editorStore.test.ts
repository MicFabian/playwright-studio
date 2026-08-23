import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';
import { FLOW_FORMAT_VERSION, countSteps, type FlowDocument } from '../lib/flowCore';

function document(id = 'flow', steps: FlowDocument['root']['steps'] = []): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id,
    name: 'Flow',
    status: 'draft',
    root: { steps },
    layout: { positions: {} },
  };
}

const store = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.setState({
    document: null,
    selectedStepId: null,
    dirty: false,
    past: [],
    future: [],
  });
});

describe('loading', () => {
  it('starts clean with no history', () => {
    store().load(document());

    expect(store().dirty).toBe(false);
    expect(store().past).toHaveLength(0);
  });

  it('keeps unsaved edits when the same flow is reloaded', () => {
    store().load(document('a'));
    store().appendStep('click');

    const edited = store().document;
    store().load(document('a'));

    expect(store().document).toBe(edited);
    expect(store().dirty).toBe(true);
  });

  it('adopts a reload once the edits are saved', () => {
    store().load(document('a'));
    store().appendStep('click');
    store().markSaved();
    store().load(document('a'));

    expect(countSteps(store().document!.root)).toBe(0);
  });

  it('always adopts a different flow', () => {
    store().load(document('a'));
    store().appendStep('click');
    store().load(document('b'));

    expect(store().document?.id).toBe('b');
    expect(store().selectedStepId).toBeNull();
  });
});

describe('editing', () => {
  it('appends a step, selects it, and marks the flow dirty', () => {
    store().load(document());
    store().appendStep('navigate');

    expect(countSteps(store().document!.root)).toBe(1);
    expect(store().selectedStepId).toBe(store().document!.root.steps[0].id);
    expect(store().dirty).toBe(true);
  });

  it('edits a step in place', () => {
    store().load(document());
    store().appendStep('click');

    const id = store().document!.root.steps[0].id;
    store().editStep(id, (step) => ({ ...step, label: 'Press the button' }));

    expect(store().document!.root.steps[0].label).toBe('Press the button');
  });

  it('clears the selection when the selected step is deleted', () => {
    store().load(document());
    store().appendStep('click');

    store().deleteStep(store().selectedStepId!);

    expect(store().selectedStepId).toBeNull();
    expect(countSteps(store().document!.root)).toBe(0);
  });

  it('wraps a step into a scope and selects the scope', () => {
    store().load(document());
    store().appendStep('click');

    const clickId = store().selectedStepId!;
    store().wrapStep(clickId, 'condition');

    const [scope] = store().document!.root.steps;

    expect(scope.kind).toBe('condition');
    expect(store().selectedStepId).toBe(scope.id);
    expect(countSteps(store().document!.root)).toBe(2);
  });
});

describe('undo and redo', () => {
  it('reverses and reapplies an edit', () => {
    store().load(document());
    store().appendStep('click');
    store().appendStep('fill');

    expect(countSteps(store().document!.root)).toBe(2);

    store().undo();
    expect(countSteps(store().document!.root)).toBe(1);

    store().redo();
    expect(countSteps(store().document!.root)).toBe(2);
  });

  it('does nothing when there is no history', () => {
    store().load(document());

    expect(() => store().undo()).not.toThrow();
    expect(countSteps(store().document!.root)).toBe(0);
  });

  it('drops the redo stack once a new edit lands', () => {
    store().load(document());
    store().appendStep('click');
    store().undo();
    store().appendStep('fill');

    expect(store().future).toHaveLength(0);

    store().redo();
    expect(countSteps(store().document!.root)).toBe(1);
  });

  it('clears history when a different flow loads', () => {
    store().load(document('a'));
    store().appendStep('click');
    store().markSaved();
    store().load(document('b'));

    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(0);
  });
});

describe('recorded steps', () => {
  it('appends a whole recording that one undo removes', () => {
    store().load(document());
    store().appendStep('navigate');
    store().markSaved();

    store().insertRecordedSteps([
      {
        id: 'r1',
        kind: 'click',
        target: { base: { by: 'testId', value: { source: 'literal', value: 'a' } } },
      },
      {
        id: 'r2',
        kind: 'fill',
        target: { base: { by: 'testId', value: { source: 'literal', value: 'b' } } },
        value: { source: 'literal', value: 'x' },
      },
    ]);

    expect(countSteps(store().document!.root)).toBe(3);
    expect(
      store()
        .document!.root.steps.slice(1)
        .map((step) => step.id),
    ).toEqual(['r1', 'r2']);

    store().undo();

    expect(countSteps(store().document!.root)).toBe(1);
  });

  it('keeps the recorded order and selects the first step', () => {
    store().load(document());
    store().insertRecordedSteps([
      { id: 'r1', kind: 'comment', text: 'first' },
      { id: 'r2', kind: 'comment', text: 'second' },
    ]);

    expect(store().document!.root.steps.map((step) => step.id)).toEqual(['r1', 'r2']);
    expect(store().selectedStepId).toBe('r1');
  });

  it('does nothing when a recording captured no steps', () => {
    store().load(document());
    store().insertRecordedSteps([]);

    expect(store().dirty).toBe(false);
  });
});

describe('data tables', () => {
  it('stores a data set and removes it when the rows go', () => {
    store().load(document());
    store().setDataSet({
      columns: [{ name: 'email' }],
      cases: [{ name: 'row', values: { email: 'qa@example.com' } }],
    });

    expect(store().document?.data?.cases).toHaveLength(1);

    store().setDataSet({ columns: [{ name: 'email' }], cases: [] });

    expect(store().document?.data).toBeUndefined();
  });
});

describe('compiling', () => {
  it('compiles the current document', () => {
    store().load(document());
    store().appendStep('navigate');

    expect(store().compile()?.source).toContain('await page.goto(');
  });

  it('returns nothing when no flow is open', () => {
    expect(store().compile()).toBeNull();
  });
});

describe('moving a node', () => {
  it('reorders the flow when a node is dropped past its neighbour', () => {
    store().load(document());
    store().appendStep('navigate');
    store().appendStep('click');

    const [first, second] = store().document!.root.steps.map((step) => step.id);
    const target = store().document!.layout.positions[second] ?? { x: 280, y: 0 };

    store().moveNode(first, { x: target.x + 40, y: target.y });

    expect(store().document!.root.steps.map((step) => step.id)).toEqual([second, first]);
  });

  it('only repositions when the order does not change', () => {
    store().load(document());
    store().appendStep('navigate');
    store().appendStep('click');

    const [first] = store().document!.root.steps.map((step) => step.id);
    store().moveNode(first, { x: -50, y: 12 });

    expect(store().document!.root.steps[0].id).toBe(first);
    expect(store().document!.layout.positions[first]).toEqual({ x: -50, y: 12 });
  });
});
