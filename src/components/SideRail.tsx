import { useEffect, useState } from 'react';
import { Code2, GitBranch, Workflow } from 'lucide-react';
import { GitPanel } from './GitPanel';
import type { GitState, SnippetItem, StoredTestFlow } from '../types';

type SideRailSection = 'flows' | 'snippets' | 'git';

interface SideRailProps {
  projectName: string;
  testsDir: string;
  tests: StoredTestFlow[];
  snippets: SnippetItem[];
  snippetQuery: string;
  activeTest?: StoredTestFlow | null;
  activeTestId: string | null;
  activeSnippetId: string | null;
  dirtyTests: Record<string, boolean>;
  dirtySnippets: Record<string, boolean>;
  gitState: GitState;
  gitActionState: 'idle' | 'working' | 'success' | 'error';
  gitActionError: string | null;
  commitMessage: string;
  onCreateTest: () => void;
  onCreateSnippet: () => void;
  onSelectTest: (testId: string) => void;
  onSnippetQueryChange: (value: string) => void;
  onCommitMessageChange: (value: string) => void;
  onAddSnippet: (snippet: SnippetItem) => void;
  onEditSnippet: (snippetId: string) => void;
  onGitRefresh: () => void;
  onGitInit: () => void;
  onGitStage: () => void;
  onGitCommit: () => void;
}

const navPoints = [
  { id: 'flows', label: 'Flows', icon: Workflow },
  { id: 'snippets', label: 'Snippets', icon: Code2 },
  { id: 'git', label: 'Git', icon: GitBranch },
] as const satisfies ReadonlyArray<{
  id: SideRailSection;
  label: string;
  icon: typeof Workflow;
}>;

export function SideRail({
  projectName,
  testsDir,
  tests,
  snippets,
  snippetQuery,
  activeTest,
  activeTestId,
  activeSnippetId,
  dirtyTests,
  dirtySnippets,
  gitState,
  gitActionState,
  gitActionError,
  commitMessage,
  onCreateTest,
  onCreateSnippet,
  onSelectTest,
  onSnippetQueryChange,
  onCommitMessageChange,
  onAddSnippet,
  onEditSnippet,
  onGitRefresh,
  onGitInit,
  onGitStage,
  onGitCommit,
}: SideRailProps) {
  const fileNameFromPath = (filePath: string) => {
    const normalizedPath = filePath.split('\\').join('/').trim();

    if (!normalizedPath) {
      return filePath;
    }

    const parts = normalizedPath.split('/');
    return parts[parts.length - 1] || normalizedPath;
  };

  const formatFlowPathLabel = (filePath: string) => {
    const normalizedPath = filePath.split('\\').join('/');
    const normalizedTestsDir = testsDir.split('\\').join('/').replace(/\/+$/, '');

    if (
      normalizedTestsDir &&
      (normalizedPath === normalizedTestsDir ||
        normalizedPath.startsWith(`${normalizedTestsDir}/`))
    ) {
      return fileNameFromPath(normalizedPath);
    }

    return fileNameFromPath(normalizedPath);
  };

  const [activeSection, setActiveSection] = useState<SideRailSection>('flows');
  const activeSnippet =
    snippets.find((snippet) => snippet.id === activeSnippetId) ?? null;
  const normalizedSnippetQuery = snippetQuery.trim().toLowerCase();
  const filteredSnippets = normalizedSnippetQuery
    ? snippets.filter((snippet) =>
        [snippet.name, snippet.description, snippet.filePath || '']
          .join(' ')
          .toLowerCase()
          .includes(normalizedSnippetQuery),
      )
    : snippets;
  const gitChanges =
    gitState.stagedFiles.length +
    gitState.unstagedFiles.length +
    gitState.untrackedFiles.length;

  useEffect(() => {
    if (activeSnippetId) {
      setActiveSection('snippets');
    }
  }, [activeSnippetId]);

  const headerCopy =
    activeSection === 'flows'
      ? {
          kicker: projectName,
          title: 'Flow files',
          description: activeTest
            ? `Editing ${activeTest.name}.`
            : 'Select a flow to load it on the canvas.',
        }
      : activeSection === 'snippets'
        ? {
            kicker: projectName,
            title: 'Snippet library',
            description: activeSnippet
              ? `Editing ${activeSnippet.name}.`
              : 'Reusable snippet files for any flow.',
          }
        : {
            kicker: projectName,
            title: 'Git workspace',
            description: gitState.available
              ? 'Stage and commit workspace files.'
              : 'Initialize Git to track flows, snippets, and specs.',
          };

  return (
    <aside className="sidenav panel">
      <nav aria-label="Workspace sections" className="sidenav__nav">
        <div className="sidenav__brand">
          <strong>PW</strong>
          <span>Studio</span>
        </div>

        <div className="sidenav__points">
          {navPoints.map(({ id, label, icon: Icon }) => (
            <button
              className={`sidenav__point${activeSection === id ? ' is-active' : ''}`}
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
            >
              <Icon size={18} strokeWidth={2.1} />
              <span>{label}</span>
              <small>
                {id === 'flows'
                  ? tests.length
                  : id === 'snippets'
                    ? snippets.length
                    : gitState.available
                      ? gitChanges
                      : 'new'}
              </small>
            </button>
          ))}
        </div>
      </nav>

      <div className="sidenav__content">
        <header className="sidenav__header">
          <span className="section-kicker">{headerCopy.kicker}</span>
          <h2>{headerCopy.title}</h2>
          <p>{headerCopy.description}</p>
        </header>

        {activeSection === 'flows' ? (
          <>
            <div className="sidenav__toolbar">
              <div className="sidenav__summary">
                <span>Flow workspace</span>
                <strong>{tests.length} persisted flow files</strong>
                <small>
                  {activeTest
                    ? 'Select another row to switch flows or create a new one.'
                    : 'Choose a file from the list below to load it on canvas.'}
                </small>
              </div>

              <button className="ghost-button side-action" type="button" onClick={onCreateTest}>
                New flow file
              </button>
            </div>

            <div className="sidenav__list">
              {tests.length > 0 ? (
                tests.map((test) => (
                  <button
                    className={`nav-row${test.id === activeTestId ? ' is-active' : ''}`}
                    key={test.id}
                    type="button"
                    onClick={() => {
                      setActiveSection('flows');
                      onSelectTest(test.id);
                    }}
                  >
                    <div className="nav-row__copy">
                      <strong>{test.name}</strong>
                      <span title={test.filePath}>{formatFlowPathLabel(test.filePath)}</span>
                    </div>
                    <div className="nav-row__meta">
                      <small>{test.steps} blocks</small>
                      <div className="nav-row__badges">
                        {dirtyTests[test.id] ? (
                          <span className="nav-badge is-dirty">unsaved</span>
                        ) : null}
                        <span className={`nav-badge is-${test.status}`}>{test.status}</span>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="inline-empty">
                  <p>No persisted flows yet.</p>
                  <p>Create a flow file and it will appear here for Git to track.</p>
                </div>
              )}
            </div>
          </>
        ) : null}

        {activeSection === 'snippets' ? (
          <>
            <div className="sidenav__toolbar">
              <div className="sidenav__summary">
                <span>Selected snippet</span>
                <strong>{activeSnippet?.name || 'No snippet selected'}</strong>
                <small>
                  {activeSnippet?.filePath
                    ? fileNameFromPath(activeSnippet.filePath)
                    : 'Select a snippet to edit its file in the inspector.'}
                </small>
              </div>

              <label className="sidenav__filter">
                <span>Search snippets</span>
                <input
                  aria-label="Search snippets"
                  data-testid="snippet-filter-input"
                  placeholder="Filter by name, file, or description"
                  type="text"
                  value={snippetQuery}
                  onChange={(event) => onSnippetQueryChange(event.target.value)}
                />
              </label>

              <button className="ghost-button side-action" type="button" onClick={onCreateSnippet}>
                New snippet file
              </button>
            </div>

            <div className="sidenav__list">
              {filteredSnippets.length > 0 ? (
                filteredSnippets.map((snippet) => (
                  <div
                    className={`nav-row nav-row--stacked${snippet.id === activeSnippetId ? ' is-active' : ''}`}
                    key={snippet.id}
                  >
                    <button
                      className="nav-row__main"
                      type="button"
                      onClick={() => {
                        setActiveSection('snippets');
                        onEditSnippet(snippet.id);
                      }}
                    >
                      <div className="nav-row__copy">
                        <strong>{snippet.name}</strong>
                        <span>
                          {snippet.filePath
                            ? fileNameFromPath(snippet.filePath)
                            : snippet.description || 'Snippet file'}
                        </span>
                      </div>
                    </button>

                    <div className="nav-row__actions">
                      {dirtySnippets[snippet.id] ? (
                        <span className="nav-badge is-dirty">unsaved</span>
                      ) : null}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => onAddSnippet(snippet)}
                      >
                        Insert
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setActiveSection('snippets');
                          onEditSnippet(snippet.id);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))
              ) : snippets.length > 0 ? (
                <div className="inline-empty">
                  <p>No snippets match this filter.</p>
                  <p>Try another keyword or clear the search input.</p>
                </div>
              ) : (
                <div className="inline-empty">
                  <p>No snippet files yet.</p>
                  <p>Create one and it will be available for any flow in the workspace.</p>
                </div>
              )}
            </div>
          </>
        ) : null}

        {activeSection === 'git' ? (
          <div className="sidenav__git">
            <GitPanel
              gitState={gitState}
              gitActionState={gitActionState}
              gitActionError={gitActionError}
              commitMessage={commitMessage}
              onCommitMessageChange={onCommitMessageChange}
              onRefresh={onGitRefresh}
              onInit={onGitInit}
              onStage={onGitStage}
              onCommit={onGitCommit}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
