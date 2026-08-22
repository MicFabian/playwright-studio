import type {
  FlowDocument,
  SnippetDefinition,
  SnippetOutput,
  SnippetParam,
  SnippetParamType,
} from './lib/flowCore';

export type { FlowDocument, SnippetOutput, SnippetParam, SnippetParamType };

export interface TestTreeItem {
  id: string;
  name: string;
  steps: number;
  status: 'stable' | 'draft' | 'failing';
}

export interface SnippetItem extends SnippetDefinition {
  filePath?: string;
}

export interface StoredTestFlow extends TestTreeItem {
  updatedAt: string;
  filePath: string;
  specPath: string;
  document: FlowDocument;
}

export interface WorkspaceProject {
  formatVersion: number;
  name: string;
  paths: {
    testsDir: string;
    snippetsDir: string;
    generatedTestsDir: string;
  };
  playwright: {
    testImport: string;
  };
}

export interface GitState {
  available: boolean;
  branch: string | null;
  dirty: boolean;
  changedFiles: string[];
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
  lastCommit: string | null;
  root: string | null;
}

export interface PlaywrightConfigInfo {
  configPath: string | null;
  testDir: string | null;
  baseURL: string | null;
  testIdAttribute: string | null;
  projects: { name: string; device?: string }[];
  hasWebServer: boolean;
  diagnostics: { code: string; message: string }[];
}

export interface WorkspaceData {
  project: WorkspaceProject;
  playwrightConfig: PlaywrightConfigInfo;
  tests: StoredTestFlow[];
  snippets: SnippetItem[];
  git: GitState;
}

export type TestRunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'timedOut'
  | 'interrupted';

export type TestRunStepStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface TestRunStep {
  index: number;
  stepId: string;
  status: TestRunStepStatus;
  durationMs: number | null;
  error: string | null;
}

export interface RunArtifact {
  kind: 'trace' | 'video' | 'screenshot' | 'other';
  relativePath: string;
  sizeBytes: number;
}

export interface TestRun {
  id: string;
  testId: string;
  testName: string;
  status: TestRunStatus;
  liveMode: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  steps: TestRunStep[];
  artifacts?: RunArtifact[];
  diagnostics?: { severity: string; code: string; message: string; stepId?: string }[];
}
