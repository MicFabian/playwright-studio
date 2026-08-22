import { FilePlus, FileText } from 'lucide-react';
import type { WorkspaceData } from '../../types';

interface WorkspaceExplorerProps {
  workspace: WorkspaceData | null;
  activeTestId: string | null;
  onSelect: (testId: string) => void;
  onCreate: () => void;
}

export function WorkspaceExplorer({
  workspace,
  activeTestId,
  onSelect,
  onCreate,
}: WorkspaceExplorerProps) {
  return (
    <nav className="explorer" aria-label="Flows">
      <header className="explorer__head">
        <h2>Flows</h2>
        <button type="button" onClick={onCreate} aria-label="New flow">
          <FilePlus size={14} aria-hidden />
        </button>
      </header>

      <ul className="explorer__list">
        {workspace?.tests.map((test) => (
          <li key={test.id}>
            <button
              type="button"
              className={test.id === activeTestId ? 'is-active' : ''}
              onClick={() => onSelect(test.id)}
            >
              <FileText size={13} aria-hidden />
              <span className="explorer__name">{test.name}</span>
              <span className={`explorer__status explorer__status--${test.status}`}>
                {test.steps}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {workspace?.git.available ? (
        <footer className="explorer__git">
          <span className="explorer__branch">{workspace.git.branch ?? 'detached'}</span>
          <span>{workspace.git.dirty ? `${workspace.git.changedFiles.length} changed` : 'clean'}</span>
        </footer>
      ) : null}
    </nav>
  );
}
