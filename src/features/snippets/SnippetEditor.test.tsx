import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SnippetItem } from '../../types';

const saveSnippet = vi.fn();

vi.mock('../../lib/workspaceClient', () => ({
  saveSnippet: (...args: unknown[]) => saveSnippet(...args),
}));

const { SnippetEditor } = await import('./SnippetEditor');

function snippet(overrides: Partial<SnippetItem> = {}): SnippetItem {
  return {
    formatVersion: 2,
    id: 'wait-for-dashboard',
    name: 'Wait for dashboard',
    description: 'Confirm the headline.',
    params: [{ name: 'headline', type: 'string', required: true }],
    outputs: [],
    code: 'await expect(page.getByTestId("t")).toContainText(headline);',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSnippet.mockResolvedValue({ snippet: snippet() });
});

describe('with nothing selected', () => {
  it('says so', () => {
    render(<SnippetEditor snippet={null} onSaved={() => undefined} />);

    expect(screen.getByText(/select a snippet/i)).toBeDefined();
  });
});

describe('editing', () => {
  it('shows the snippet and starts clean', () => {
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    expect(screen.getByDisplayValue('Wait for dashboard')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveProperty('disabled', true);
  });

  it('enables saving once something changes', () => {
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.change(screen.getByDisplayValue('Wait for dashboard'), {
      target: { value: 'Wait for the dashboard' },
    });

    expect(screen.getByRole('button', { name: 'Save snippet' })).toHaveProperty('disabled', false);
  });

  it('adds a typed input', () => {
    render(<SnippetEditor snippet={snippet({ params: [] })} onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /input/i }));

    expect(screen.getByLabelText('Input 1 name')).toBeDefined();
    expect(screen.getByLabelText('Input 1 type')).toHaveProperty('value', 'string');
  });

  it('changes an input type', () => {
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Input 1 type'), { target: { value: 'number' } });

    expect(screen.getByLabelText('Input 1 type')).toHaveProperty('value', 'number');
  });

  it('makes an input optional once it has a default', async () => {
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Input 1 default'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

    await waitFor(() => expect(saveSnippet).toHaveBeenCalled());

    expect(saveSnippet.mock.calls[0][0].params[0]).toMatchObject({
      defaultValue: '5000',
      required: false,
    });
  });

  it('adds and removes an output', () => {
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /output/i }));
    expect(screen.getByLabelText('Output 1 name')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /remove output/i }));
    expect(screen.queryByLabelText('Output 1 name')).toBeNull();
  });

  it('removes an input', () => {
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /remove input headline/i }));

    expect(screen.queryByLabelText('Input 1 name')).toBeNull();
  });
});

describe('saving', () => {
  it('sends the edited snippet and reports success', async () => {
    const onSaved = vi.fn();
    render(<SnippetEditor snippet={snippet()} onSaved={onSaved} />);

    fireEvent.change(screen.getByDisplayValue('Confirm the headline.'), {
      target: { value: 'Checks the headline.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(saveSnippet.mock.calls[0][0].description).toBe('Checks the headline.');
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDefined();
  });

  it('reports a failed save and keeps the draft', async () => {
    saveSnippet.mockRejectedValue(new Error('disk full'));
    render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.change(screen.getByDisplayValue('Wait for dashboard'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save failed' })).toBeDefined());
    expect(screen.getByDisplayValue('Renamed')).toBeDefined();
  });
});

describe('a workspace refresh', () => {
  it('keeps a draft the user is still typing', () => {
    const { rerender } = render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.change(screen.getByDisplayValue('Wait for dashboard'), {
      target: { value: 'Half-typed nam' },
    });

    // A refresh hands back an equal but distinct object for the same snippet.
    rerender(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    expect(screen.getByDisplayValue('Half-typed nam')).toBeDefined();
  });

  it('adopts the refresh when nothing is unsaved', () => {
    const { rerender } = render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    rerender(
      <SnippetEditor snippet={snippet({ name: 'Renamed elsewhere' })} onSaved={() => undefined} />,
    );

    expect(screen.getByDisplayValue('Renamed elsewhere')).toBeDefined();
  });

  it('switches to a different snippet even with unsaved changes', () => {
    const { rerender } = render(<SnippetEditor snippet={snippet()} onSaved={() => undefined} />);

    fireEvent.change(screen.getByDisplayValue('Wait for dashboard'), {
      target: { value: 'Half typed' },
    });

    rerender(
      <SnippetEditor
        snippet={snippet({ id: 'other', name: 'Another snippet' })}
        onSaved={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Another snippet')).toBeDefined();
  });
});
