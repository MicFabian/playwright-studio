import { Circle, Play, Save, Square, Zap } from 'lucide-react';

interface TopBarProps {
  flowName: string;
  dirty: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  running: boolean;
  onSave: () => void;
  onRun: (liveMode: boolean) => void;
  onRename: (name: string) => void;
  onRenameCommitted: (name: string) => void;
  onCancel: () => void;
  onRecord: () => void;
  recording: boolean;
}

const SAVE_LABELS = {
  idle: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
} as const;

export function TopBar({
  flowName,
  dirty,
  saveState,
  running,
  onSave,
  onRun,
  onRename,
  onRenameCommitted,
  onCancel,
  onRecord,
  recording,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__identity">
        <span className="topbar__product">Playwright Studio</span>
        <input
          className="topbar__name"
          value={flowName}
          aria-label="Flow name"
          placeholder="No flow open"
          disabled={!flowName}
          onChange={(event) => onRename(event.target.value)}
          onBlur={(event) => onRenameCommitted(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        {dirty ? <span className="topbar__badge">Unsaved</span> : null}
      </div>

      <div className="topbar__actions">
        <button type="button" onClick={onSave} disabled={saveState === 'saving' || !flowName}>
          <Save size={14} aria-hidden /> {SAVE_LABELS[saveState]}
        </button>

        {!flowName ? null : running ? (
          <button type="button" className="danger" onClick={onCancel}>
            <Square size={14} aria-hidden /> Stop
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onRun(false)}>
              <Play size={14} aria-hidden /> Run
            </button>
            <button type="button" onClick={() => onRun(true)}>
              <Zap size={14} aria-hidden /> Run headed
            </button>
            <button type="button" onClick={onRecord} disabled={recording}>
              <Circle size={14} aria-hidden /> {recording ? 'Recording' : 'Record'}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
