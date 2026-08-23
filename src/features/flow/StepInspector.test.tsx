import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StepInspector } from './StepInspector';
import { useEditorStore } from '../../stores/editorStore';
import { FLOW_FORMAT_VERSION, type FlowDocument, type FlowStep } from '../../lib/flowCore';

function documentWith(step: FlowStep): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id: 'flow',
    name: 'Flow',
    status: 'draft',
    root: { steps: [step] },
    layout: { positions: {} },
  };
}

const target = {
  base: { by: 'testId' as const, value: { source: 'literal' as const, value: 'x' } },
};
const step = () => useEditorStore.getState().document!.root.steps[0];

function open(initial: FlowStep) {
  useEditorStore.setState({
    document: null,
    selectedStepId: null,
    dirty: false,
    past: [],
    future: [],
  });
  useEditorStore.getState().load(documentWith(initial));
  useEditorStore.getState().select(initial.id);
  render(<StepInspector />);
}

beforeEach(() => {
  useEditorStore.setState({
    document: null,
    selectedStepId: null,
    dirty: false,
    past: [],
    future: [],
  });
});

describe('with nothing selected', () => {
  it('says so', () => {
    useEditorStore.getState().load(documentWith({ id: 'a', kind: 'click', target }));
    render(<StepInspector />);

    expect(screen.getByText(/select a step/i)).toBeDefined();
  });
});

describe('the match index', () => {
  it('accepts a valid index', () => {
    open({ id: 'a', kind: 'click', target });

    fireEvent.change(screen.getByLabelText('Match index'), { target: { value: '2' } });

    expect(step()).toMatchObject({ target: { nth: 2 } });
  });

  it('refuses a negative index rather than compiling nth(-1)', () => {
    open({ id: 'a', kind: 'click', target });

    fireEvent.change(screen.getByLabelText('Match index'), { target: { value: '-1' } });

    expect((step() as { target: { nth?: number } }).target.nth).toBeUndefined();
  });

  it('refuses text and clears back to unset', () => {
    open({ id: 'a', kind: 'click', target: { ...target, nth: 3 } });

    fireEvent.change(screen.getByLabelText('Match index'), { target: { value: 'abc' } });

    expect((step() as { target: { nth?: number } }).target.nth).toBeUndefined();
  });
});

describe('changing the assertion type', () => {
  it('carries the expected text across', () => {
    open({
      id: 'a',
      kind: 'assert',
      target,
      assertion: { type: 'containsText', text: { source: 'literal', value: 'Dashboard' } },
    });

    fireEvent.change(screen.getByLabelText('Assertion'), { target: { value: 'hasText' } });

    expect(step()).toMatchObject({
      assertion: { type: 'hasText', text: { source: 'literal', value: 'Dashboard' } },
    });
  });

  it('carries the text into a value matcher and back', () => {
    open({
      id: 'a',
      kind: 'assert',
      target,
      assertion: { type: 'containsText', text: { source: 'literal', value: 'typed' } },
    });

    fireEvent.change(screen.getByLabelText('Assertion'), { target: { value: 'hasValue' } });
    fireEvent.change(screen.getByLabelText('Assertion'), { target: { value: 'containsText' } });

    expect(step()).toMatchObject({
      assertion: { type: 'containsText', text: { source: 'literal', value: 'typed' } },
    });
  });

  it('starts a count from one when the previous type had none to carry', () => {
    open({ id: 'a', kind: 'assert', target, assertion: { type: 'visible' } });

    fireEvent.change(screen.getByLabelText('Assertion'), { target: { value: 'hasCount' } });

    expect(step()).toMatchObject({ assertion: { type: 'hasCount', count: 1 } });
  });
});

describe('the locator strategy', () => {
  it('keeps the value when switching strategy', () => {
    open({ id: 'a', kind: 'click', target });

    fireEvent.change(screen.getByLabelText('Find by'), { target: { value: 'label' } });

    expect(step()).toMatchObject({
      target: { base: { by: 'label', text: { source: 'literal', value: 'x' } } },
    });
  });

  it('switches to role with a default role', () => {
    open({ id: 'a', kind: 'click', target });

    fireEvent.change(screen.getByLabelText('Find by'), { target: { value: 'role' } });

    expect(step()).toMatchObject({ target: { base: { by: 'role', role: 'button' } } });
  });

  it('warns that CSS is the brittle option', () => {
    open({
      id: 'a',
      kind: 'click',
      target: { base: { by: 'css', selector: { source: 'literal', value: '.a' } } },
    });

    expect(screen.getByText(/prefer role, label, or test id/i)).toBeDefined();
  });
});
