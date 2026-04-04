import type { Edge, Node } from '@xyflow/react';

export type FlowBlockKind =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'assert'
  | 'extract'
  | 'condition'
  | 'loop'
  | 'snippet';

export type FlowBlockCategory =
  | 'entry'
  | 'action'
  | 'assertion'
  | 'logic'
  | 'snippet';

export interface BlockField {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
}

export interface FlowBlockData extends Record<string, unknown> {
  kind: FlowBlockKind;
  category: FlowBlockCategory;
  title: string;
  description: string;
  accent: string;
  codeLabel: string;
  status: 'ready' | 'draft';
  fields: BlockField[];
  snippetCode?: string;
  snippetRef?: string;
  snippetStep?: boolean;
  snippetStepIndex?: number;
}

export type FlowNode = Node<FlowBlockData, 'flow'>;
export type FlowEdge = Edge<Record<string, unknown>, string>;

export interface TestTreeItem {
  id: string;
  name: string;
  steps: number;
  status: 'stable' | 'draft' | 'failing';
}

export interface SnippetItem {
  id: string;
  name: string;
  description: string;
  params: string[];
  code: string;
  updatedAt?: string;
  filePath?: string;
}

export interface StoredTestFlow extends TestTreeItem {
  updatedAt: string;
  filePath: string;
  specPath: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface WorkspaceProject {
  formatVersion: number;
  name: string;
  paths: {
    testsDir: string;
    snippetsDir: string;
    generatedTestsDir: string;
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

export interface WorkspaceData {
  project: WorkspaceProject;
  tests: StoredTestFlow[];
  snippets: SnippetItem[];
  git: GitState;
}

export type TestRunStatus = 'queued' | 'running' | 'passed' | 'failed';
export type TestRunStepStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface TestRunStep {
  index: number;
  nodeId: string;
  title: string;
  kind: FlowBlockKind;
  status: TestRunStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  screenshotUrl: string | null;
}

export interface TestRun {
  id: string;
  testId: string;
  testName: string;
  status: TestRunStatus;
  liveMode: boolean;
  slowMoMs: number;
  startedAt: string | null;
  finishedAt: string | null;
  currentStepIndex: number | null;
  totalSteps: number;
  error: string | null;
  stepResults: TestRunStep[];
}
