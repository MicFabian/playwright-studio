import type { FlowEdge, FlowNode, GitState, StoredTestFlow, TestRun, WorkspaceData } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    const body = await response.text();
    let parsedError: string | null = null;

    try {
      const parsed = JSON.parse(body) as { error?: string };
      parsedError = typeof parsed.error === 'string' ? parsed.error : null;
    } catch {
      parsedError = null;
    }

    throw new Error(parsedError || body || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function loadWorkspace() {
  return request<WorkspaceData>('/api/workspace');
}

export function saveTest(test: StoredTestFlow) {
  return request<{ test: StoredTestFlow; git: GitState }>(`/api/tests/${test.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(test),
  });
}

export function createTest(name?: string) {
  return request<{ test: StoredTestFlow; git: GitState }>('/api/tests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
}

export function saveSnippet(snippet: WorkspaceData['snippets'][number]) {
  return request<{
    snippet: WorkspaceData['snippets'][number];
    git: GitState;
  }>(`/api/snippets/${snippet.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(snippet),
  });
}

export function createSnippet(name?: string) {
  return request<{
    snippet: WorkspaceData['snippets'][number];
    git: GitState;
  }>('/api/snippets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
}

export function initGitRepo() {
  return request<{ git: GitState }>('/api/git/init', {
    method: 'POST',
  });
}

export function stageWorkspaceFiles() {
  return request<{ git: GitState }>('/api/git/stage', {
    method: 'POST',
  });
}

export function commitWorkspace(message: string) {
  return request<{ git: GitState }>('/api/git/commit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
}

export function startTestRun(input: {
  testId: string;
  testName: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  liveMode?: boolean;
  slowMoMs?: number;
}) {
  return request<{ run: TestRun }>('/api/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export function getTestRun(runId: string) {
  return request<{ run: TestRun }>(`/api/runs/${encodeURIComponent(runId)}`);
}
