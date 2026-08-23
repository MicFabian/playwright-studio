import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataPanel } from './DataPanel';
import { useEditorStore } from '../../stores/editorStore';
import { FLOW_FORMAT_VERSION, type FlowDocument } from '../../lib/flowCore';

function document(data?: FlowDocument['data']): FlowDocument {
  return {
    formatVersion: FLOW_FORMAT_VERSION,
    id: 'flow',
    name: 'Flow',
    status: 'draft',
    root: { steps: [] },
    layout: { positions: {} },
    ...(data ? { data } : {}),
  };
}

const data = () => useEditorStore.getState().document?.data;

function cellsOf(rowIndex: number): HTMLInputElement[] {
  const row = screen.getAllByRole('row').slice(1)[rowIndex];
  return within(row).getAllByRole('textbox') as HTMLInputElement[];
}

/** Cell labels repeat the column name, so headers are looked up in their row. */
function columnHeader(index: number): HTMLElement {
  const header = screen.getAllByRole('row')[0];
  return within(header).getByLabelText(`Column ${index} name`);
}

beforeEach(() => {
  useEditorStore.setState({ document: null, dirty: false, past: [], future: [] });
});

describe('an empty data table', () => {
  it('explains what rows do', () => {
    useEditorStore.getState().load(document());
    render(<DataPanel />);

    expect(screen.getByText(/once per case/i)).toBeDefined();
  });

  it('adds a first row with a default column', () => {
    useEditorStore.getState().load(document());
    render(<DataPanel />);

    fireEvent.click(screen.getByRole('button', { name: /row/i }));

    expect(data()?.cases).toHaveLength(1);
    expect(data()?.columns.map((column) => column.name)).toEqual(['value']);
  });

  it('cannot add a column before there are rows', () => {
    useEditorStore.getState().load(document());
    render(<DataPanel />);

    expect(screen.getByRole('button', { name: /column/i })).toHaveProperty('disabled', true);
  });
});

describe('editing rows and columns', () => {
  beforeEach(() => {
    useEditorStore.getState().load(
      document({
        columns: [{ name: 'email' }, { name: 'expected' }],
        cases: [
          { name: 'valid', values: { email: 'qa@example.com', expected: 'Dashboard' } },
          { name: 'blocked', values: { email: 'blocked@example.com', expected: 'Suspended' } },
        ],
      }),
    );
  });

  it('counts the tests the rows will produce', () => {
    render(<DataPanel />);

    expect(screen.getByText(/2 rows generate 2 named tests/i)).toBeDefined();
  });

  it('renames a column and carries its values across', () => {
    render(<DataPanel />);

    fireEvent.change(columnHeader(1), { target: { value: 'username' } });

    expect(data()?.columns.map((column) => column.name)).toEqual(['username', 'expected']);
    expect(data()?.cases[0].values.username).toBe('qa@example.com');
    expect(data()?.cases[0].values.email).toBeUndefined();
  });

  it('does not destroy another column when a rename collides', () => {
    render(<DataPanel />);

    fireEvent.change(columnHeader(1), { target: { value: 'expected' } });

    // The values must stay put; only the header changed.
    expect(data()?.cases[0].values.expected).toBe('Dashboard');
    expect(data()?.cases[0].values.email).toBe('qa@example.com');
  });

  it('reports the duplicate so the flow cannot silently break', () => {
    render(<DataPanel />);

    fireEvent.change(columnHeader(1), { target: { value: 'expected' } });

    expect(screen.getByText(/two columns are named/i)).toBeDefined();
    expect(columnHeader(1).getAttribute('aria-invalid')).toBe('true');
  });

  it('edits a cell', () => {
    render(<DataPanel />);

    fireEvent.change(cellsOf(0)[1], { target: { value: 'someone@else.test' } });

    expect(data()?.cases[0].values.email).toBe('someone@else.test');
  });

  it('renames a case', () => {
    render(<DataPanel />);

    fireEvent.change(screen.getByLabelText('Case 1 name'), { target: { value: 'happy path' } });

    expect(data()?.cases[0].name).toBe('happy path');
  });

  it('removes a row', () => {
    render(<DataPanel />);

    fireEvent.click(screen.getByRole('button', { name: /remove valid/i }));

    expect(data()?.cases.map((row) => row.name)).toEqual(['blocked']);
  });

  it('drops the whole table when the last row goes', () => {
    useEditorStore
      .getState()
      .load(document({ columns: [{ name: 'a' }], cases: [{ name: 'only', values: { a: '1' } }] }));
    render(<DataPanel />);

    fireEvent.click(screen.getByRole('button', { name: /remove only/i }));

    expect(data()).toBeUndefined();
  });

  it('gives each added column a name of its own', () => {
    render(<DataPanel />);

    fireEvent.click(screen.getByRole('button', { name: /column/i }));
    fireEvent.click(screen.getByRole('button', { name: /column/i }));

    const names = data()!.columns.map((column) => column.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
