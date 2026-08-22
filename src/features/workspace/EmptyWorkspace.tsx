import { FileDown, FilePlus, Sparkles } from 'lucide-react';

interface EmptyWorkspaceProps {
  onCreate: () => void;
  onImport: () => void;
  workspaceName: string;
}

export function EmptyWorkspace({ onCreate, onImport, workspaceName }: EmptyWorkspaceProps) {
  return (
    <div className="empty-workspace">
      <div className="empty-workspace__card">
        <Sparkles size={22} aria-hidden className="empty-workspace__icon" />

        <h1>No flows yet</h1>
        <p>
          Studio keeps flows in <code>playwright-lowcode/</code> and writes the Playwright specs it
          generates to <code>tests/generated/</code>, both inside <strong>{workspaceName}</strong>.
        </p>

        <div className="empty-workspace__actions">
          <button type="button" onClick={onCreate}>
            <FilePlus size={14} aria-hidden />
            Start a flow
          </button>
          <button type="button" className="secondary" onClick={onImport}>
            <FileDown size={14} aria-hidden />
            Import an existing spec
          </button>
        </div>

        <ul className="empty-workspace__hints">
          <li>
            Press <kbd>⌘</kbd>
            <kbd>K</kbd> for the command palette.
          </li>
          <li>Everything you build stays as readable files you can commit.</li>
        </ul>
      </div>
    </div>
  );
}
