import { Plus, Trash2 } from 'lucide-react';
import type { DataSet } from '../../lib/flowCore';
import { useEditorStore } from '../../stores/editorStore';

const EMPTY: DataSet = { columns: [], cases: [] };

export function DataPanel() {
  const document = useEditorStore((state) => state.document);
  const setDataSet = useEditorStore((state) => state.setDataSet);

  if (!document) {
    return <div className="data data--empty">Select a flow to add test data.</div>;
  }

  const data = document.data ?? EMPTY;
  const hasData = data.cases.length > 0;

  const update = (next: DataSet) => setDataSet(next);

  const mutate = (change: (current: DataSet) => DataSet) => {
    const current = useEditorStore.getState().document?.data ?? EMPTY;
    setDataSet(change(current));
  };

  const addColumn = () =>
    mutate((current) => {
      const existing = new Set(current.columns.map((column) => column.name));
      let index = current.columns.length + 1;
      let name = `column${index}`;

      while (existing.has(name)) {
        index += 1;
        name = `column${index}`;
      }

      return {
        columns: [...current.columns, { name }],
        cases: current.cases.map((row) => ({ ...row, values: { ...row.values, [name]: '' } })),
      };
    });

  const addRow = () =>
    mutate((current) => {
      const columns = current.columns.length > 0 ? current.columns : [{ name: 'value' }];
      const existing = new Set(current.cases.map((row) => row.name));
      let index = current.cases.length + 1;
      let name = `case ${index}`;

      while (existing.has(name)) {
        index += 1;
        name = `case ${index}`;
      }

      return {
        columns,
        cases: [
          ...current.cases,
          { name, values: Object.fromEntries(columns.map((column) => [column.name, ''])) },
        ],
      };
    });

  return (
    <div className="data">
      <header className="data__head">
        <p className="data__hint">
          {hasData
            ? `${data.cases.length} ${data.cases.length === 1 ? 'row generates' : 'rows generate'} ${
                data.cases.length
              } named ${data.cases.length === 1 ? 'test' : 'tests'}.`
            : 'Add rows to run this flow once per case, each as its own test.'}
        </p>
        <div className="data__actions">
          <button type="button" onClick={addColumn} disabled={!hasData}>
            <Plus size={12} aria-hidden /> Column
          </button>
          <button type="button" onClick={addRow}>
            <Plus size={12} aria-hidden /> Row
          </button>
        </div>
      </header>

      {hasData ? (
        <div className="data__scroll">
          <table className="data__table">
            <thead>
              <tr>
                <th>Case name</th>
                {data.columns.map((column, columnIndex) => (
                  <th key={columnIndex}>
                    <input
                      value={column.name}
                      aria-label={`Column ${columnIndex + 1} name`}
                      onChange={(event) => {
                        const previous = column.name;
                        const name = event.target.value;
                        update({
                          columns: data.columns.map((candidate, index) =>
                            index === columnIndex ? { name } : candidate,
                          ),
                          cases: data.cases.map((row) => {
                            const { [previous]: moved, ...rest } = row.values;
                            return { ...row, values: { ...rest, [name]: moved ?? '' } };
                          }),
                        });
                      }}
                    />
                  </th>
                ))}
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {data.cases.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td>
                    <input
                      value={row.name}
                      aria-label={`Case ${rowIndex + 1} name`}
                      onChange={(event) =>
                        update({
                          ...data,
                          cases: data.cases.map((candidate, index) =>
                            index === rowIndex ? { ...candidate, name: event.target.value } : candidate,
                          ),
                        })
                      }
                    />
                  </td>
                  {data.columns.map((column, columnIndex) => (
                    <td key={columnIndex}>
                      <input
                        value={row.values[column.name] ?? ''}
                        aria-label={`${row.name} ${column.name}`}
                        onChange={(event) =>
                          update({
                            ...data,
                            cases: data.cases.map((candidate, index) =>
                              index === rowIndex
                                ? {
                                    ...candidate,
                                    values: { ...candidate.values, [column.name]: event.target.value },
                                  }
                                : candidate,
                            ),
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="data__remove"
                      aria-label={`Remove ${row.name}`}
                      onClick={() =>
                        update({
                          ...data,
                          cases: data.cases.filter((_, index) => index !== rowIndex),
                        })
                      }
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasData ? (
        <p className="data__note">
          Columns are in scope as variables. Bind a step to one with the variable source in the
          inspector.
        </p>
      ) : null}
    </div>
  );
}
