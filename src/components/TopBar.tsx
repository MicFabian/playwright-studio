import type { GitState } from '../types';

interface TopBarProps {
  projectName: string;
  testPath?: string;
  selectedLabel?: string;
  nodeCount: number;
  hasActiveTest: boolean;
  isDirty: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  clipboardState: 'idle' | 'copied' | 'error';
  gitState: GitState;
  onCopySpec: () => void;
  onSave: () => void;
  onFocusFlow: () => void;
}

export function TopBar({
  projectName,
  testPath,
  selectedLabel,
  nodeCount,
  hasActiveTest,
  isDirty,
  saveState,
  clipboardState,
  gitState,
  onCopySpec,
  onSave,
  onFocusFlow,
}: TopBarProps) {
  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Retry save'
          : isDirty
            ? 'Save flow'
            : 'Saved';

  const statusLabel = isDirty
    ? 'Unsaved edits'
    : saveState === 'saved'
      ? 'Saved to disk'
      : 'In sync';

  const gitLabel = gitState.available ? gitState.branch || 'detached' : 'Git not initialized';

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__kicker">{projectName}</span>
        <div className="topbar__heading-row">
          <div className="topbar__pills">
            <span className={`topbar__pill${isDirty ? ' is-warn' : ''}`}>{statusLabel}</span>
            <span className="topbar__pill">{gitLabel}</span>
          </div>
        </div>
        <p className="topbar__subline">
          <span>{testPath || 'No flow selected'}</span>
          <span>{nodeCount} blocks</span>
          <span>{selectedLabel ? `Selected: ${selectedLabel}` : 'Nothing selected'}</span>
        </p>
      </div>

      <div className="topbar__actions">
        <button
          className="ghost-button"
          disabled={!hasActiveTest}
          type="button"
          onClick={onFocusFlow}
        >
          Focus flow
        </button>
        <button
          className="ghost-button"
          disabled={!hasActiveTest}
          type="button"
          onClick={onCopySpec}
        >
          {clipboardState === 'copied'
            ? 'Spec copied'
            : clipboardState === 'error'
              ? 'Copy failed'
              : 'Copy spec'}
        </button>
        <button
          className="primary-button"
          disabled={!hasActiveTest || (!isDirty && saveState !== 'error') || saveState === 'saving'}
          type="button"
          onClick={onSave}
        >
          {saveLabel}
        </button>
      </div>
    </header>
  );
}
