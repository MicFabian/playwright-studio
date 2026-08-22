import { FileDown, FilePlus, FileText, Package } from 'lucide-react';
import type { WorkspaceData } from '../../types';
import { ConfigBadge } from './ConfigBadge';

interface WorkspaceExplorerProps {
  workspace: WorkspaceData | null;
  activeTestId: string | null;
  onSelect: (testId: string) => void;
  onCreate: () => void;
  onImport: () => void;
  activeSnippetId: string | null;
  onSelectSnippet: (snippetId: string) => void;
  onCreateSnippet: () => void;
}

export function WorkspaceExplorer({
  workspace,
  activeTestId,
  onSelect,
  onCreate,
  onImport,
  activeSnippetId,
  onSelectSnippet,
  onCreateSnippet,
}: WorkspaceExplorerProps) {
  return (
    <nav className="explorer" aria-label="Flows">
      <header className="explorer__head">
        <h2>Flows</h2>
        <span className="explorer__head-actions">
          <button type="button" onClick={onImport} aria-label="Import spec" title="Import a spec">
            <FileDown size={14} aria-hidden />
          </button>
          <button type="button" onClick={onCreate} aria-label="New flow" title="New flow">
            <FilePlus size={14} aria-hidden />
          </button>
        </span>
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

      <header className="explorer__head">
        <h2>Snippets</h2>
        <button type="button" onClick={onCreateSnippet} aria-label="New snippet" title="New snippet">
          <FilePlus size={14} aria-hidden />
        </button>
      </header>

      <ul className="explorer__list">
        {workspace?.snippets.map((snippet) => (
          <li key={snippet.id}>
            <button
              type="button"
              className={snippet.id === activeSnippetId ? 'is-active' : ''}
              onClick={() => onSelectSnippet(snippet.id)}
            >
              <Package size={13} aria-hidden />
              <span className="explorer__name">{snippet.name}</span>
              <span className="explorer__status">{snippet.params.length}</span>
            </button>
          </li>
        ))}
      </ul>

      <ConfigBadge config={workspace?.playwrightConfig} />

      {workspace?.git.available ? (
        <footer className="explorer__git">
          <span className="explorer__branch">{workspace.git.branch ?? 'detached'}</span>
          <span>{workspace.git.dirty ? `${workspace.git.changedFiles.length} changed` : 'clean'}</span>
        </footer>
      ) : null}
    </nav>
  );
}
