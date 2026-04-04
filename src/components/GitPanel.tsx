import type { GitState } from '../types';

interface GitPanelProps {
  gitState: GitState;
  gitActionState: 'idle' | 'working' | 'success' | 'error';
  gitActionError: string | null;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onRefresh: () => void;
  onInit: () => void;
  onStage: () => void;
  onCommit: () => void;
}

export function GitPanel({
  gitState,
  gitActionState,
  gitActionError,
  commitMessage,
  onCommitMessageChange,
  onRefresh,
  onInit,
  onStage,
  onCommit,
}: GitPanelProps) {
  const working = gitActionState === 'working';

  return (
    <div className="git-panel">
      {!gitState.available ? (
        <div className="inline-empty">
          <p>This folder is not a Git repository yet.</p>
          <button className="primary-button" type="button" onClick={onInit}>
            Initialize Git repo
          </button>
        </div>
      ) : (
        <>
          <div className="git-list">
            <div className="git-list__row">
              <span>Branch</span>
              <strong>{gitState.branch || 'detached'}</strong>
            </div>
            <div className="git-list__row">
              <span>Staged files</span>
              <strong>{gitState.stagedFiles.length}</strong>
            </div>
            <div className="git-list__row">
              <span>Modified files</span>
              <strong>{gitState.unstagedFiles.length}</strong>
            </div>
            <div className="git-list__row">
              <span>Untracked files</span>
              <strong>{gitState.untrackedFiles.length}</strong>
            </div>
          </div>

          <p className="muted-copy">
            {gitState.lastCommit ? `Last commit: ${gitState.lastCommit}` : 'No commits recorded yet.'}
          </p>

          <div className="button-row">
            <button className="ghost-button" disabled={working} type="button" onClick={onRefresh}>
              Refresh
            </button>
            <button className="ghost-button" disabled={working} type="button" onClick={onStage}>
              Stage workspace files
            </button>
          </div>

          <label className="field">
            <span>Commit message</span>
            <input
              type="text"
              value={commitMessage}
              placeholder="Describe the saved low-code change"
              onChange={(event) => onCommitMessageChange(event.target.value)}
            />
          </label>

          <button
            className="primary-button"
            disabled={working || gitState.stagedFiles.length === 0 || !commitMessage.trim()}
            type="button"
            onClick={onCommit}
          >
            {working ? 'Running Git action…' : 'Commit staged changes'}
          </button>
        </>
      )}

      {gitActionError ? <p className="feedback error">{gitActionError}</p> : null}
      {gitActionState === 'success' ? (
        <p className="feedback success">Git action completed.</p>
      ) : null}
    </div>
  );
}
