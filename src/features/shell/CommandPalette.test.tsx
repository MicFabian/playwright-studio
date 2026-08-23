import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { useEditorStore } from '../../stores/editorStore';
import { FLOW_FORMAT_VERSION, type FlowDocument } from '../../lib/flowCore';
import type { StoredTestFlow } from '../../types';

function flow(id: string, name: string): StoredTestFlow {
  const document: FlowDocument = {
    formatVersion: FLOW_FORMAT_VERSION,
    id,
    name,
    status: 'draft',
    root: { steps: [] },
    layout: { positions: {} },
  };

  return {
    id,
    name,
    status: 'draft',
    steps: 0,
    updatedAt: '',
    filePath: '',
    specPath: '',
    document,
  };
}

const onClose = vi.fn();
const onOpenTest = vi.fn();
const action = vi.fn();

function open(query?: string) {
  render(
    <CommandPalette
      open
      onClose={onClose}
      tests={[flow('login-path', 'Login path'), flow('checkout', 'Checkout totals')]}
      onOpenTest={onOpenTest}
      actions={[{ label: 'Save flow', hint: 'Ctrl S', run: action }]}
    />,
  );

  if (query != null) {
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: query } });
  }

  return screen.getByLabelText('Command');
}

const labels = () =>
  Array.from(document.querySelectorAll('.palette__label')).map((node) => node.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    document: {
      formatVersion: FLOW_FORMAT_VERSION,
      id: 'f',
      name: 'F',
      status: 'draft',
      root: { steps: [] },
      layout: { positions: {} },
    },
    selectedStepId: null,
    dirty: false,
    past: [],
    future: [],
  });
});

describe('when closed', () => {
  it('renders nothing', () => {
    const { container } = render(
      <CommandPalette
        open={false}
        onClose={onClose}
        tests={[]}
        onOpenTest={onOpenTest}
        actions={[]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('searching', () => {
  it('lists actions, blocks, and flows with no query', () => {
    open();

    expect(labels()).toContain('Save flow');
    expect(labels()).toContain('Add Condition');
    expect(labels()).toContain('Login path');
  });

  it('filters to a matching command', () => {
    open('condition');

    expect(labels()).toEqual(['Add Condition']);
  });

  it('matches a subsequence, so "opg" finds "Open page"', () => {
    open('opg');

    expect(labels()).toContain('Add Open page');
  });

  it('says when nothing matches', () => {
    open('zzzzzz');

    expect(screen.getByText('No matches')).toBeDefined();
    expect(labels()).toEqual([]);
  });
});

describe('keyboard', () => {
  it('runs the highlighted command and closes', () => {
    const input = open('save flow');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opens a flow', () => {
    const input = open('checkout');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onOpenTest).toHaveBeenCalledWith('checkout');
  });

  it('adds a block', () => {
    const input = open('add condition');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useEditorStore.getState().document?.root.steps[0].kind).toBe('condition');
  });

  it('closes on escape', () => {
    fireEvent.keyDown(open(), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does nothing on enter when nothing matches', () => {
    const input = open('zzzzzz');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('survives arrowing past the ends of an empty list', () => {
    const input = open('zzzzzz');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    // The highlight must come back once results reappear; a negative index
    // would leave nothing selected.
    fireEvent.change(input, { target: { value: 'condition' } });

    expect(document.querySelector('.palette__list button.is-active')).not.toBeNull();
  });

  it('moves the highlight with the arrow keys', () => {
    const input = open('add');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const active = document.querySelectorAll('.palette__list button');
    expect(active[1].className).toContain('is-active');
  });
});
