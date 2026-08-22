import type { GitState, StoredTestFlow, TestRun, WorkspaceData } from '../types';

type JsonRequestInit = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

let csrfToken: string | null = null;
let sessionReady: Promise<void> | null = null;

function readLaunchToken() {
  const hash = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('token');
}

async function establishSession(): Promise<void> {
  const launchToken = readLaunchToken();

  if (!launchToken) {
    throw new Error(
      'Studio was opened without a launch token. Restart the dev server and use the printed URL.',
    );
  }

  const response = await fetch(`/api/session?token=${encodeURIComponent(launchToken)}`, {
    method: 'POST',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Studio session could not be established.');
  }

  const { csrfToken: issued } = (await response.json()) as { csrfToken: string };
  csrfToken = issued;

  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function ensureSession(): Promise<void> {
  if (!sessionReady) {
    sessionReady = establishSession().catch((error) => {
      sessionReady = null;
      throw error;
    });
  }

  return sessionReady;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureSession();

  const headers = new Headers(init?.headers);

  if (csrfToken && init?.method && init.method !== 'GET') {
    headers.set('x-studio-csrf', csrfToken);
  }

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });

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

function jsonRequest<T>(
  path: string,
  init: JsonRequestInit = {},
): Promise<T> {
  const { body, headers, ...rest } = init;
  const mergedHeaders = new Headers(headers);
  const jsonBody = body === undefined ? undefined : JSON.stringify(body);

  if (body !== undefined && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json');
  }

  return request<T>(path, {
    ...rest,
    headers: mergedHeaders,
    body: jsonBody as BodyInit | undefined,
  });
}

export function loadWorkspace() {
  return request<WorkspaceData>('/api/workspace');
}

export function saveTest(test: StoredTestFlow) {
  return jsonRequest<{ test: StoredTestFlow; git: GitState }>(`/api/tests/${test.id}`, {
    method: 'PUT',
    body: test,
  });
}

export function createTest(name?: string) {
  return jsonRequest<{ test: StoredTestFlow; git: GitState }>('/api/tests', {
    method: 'POST',
    body: { name },
  });
}

export function saveSnippet(snippet: WorkspaceData['snippets'][number]) {
  return jsonRequest<{
    snippet: WorkspaceData['snippets'][number];
    git: GitState;
  }>(`/api/snippets/${snippet.id}`, {
    method: 'PUT',
    body: snippet,
  });
}

export function createSnippet(name?: string) {
  return jsonRequest<{
    snippet: WorkspaceData['snippets'][number];
    git: GitState;
  }>('/api/snippets', {
    method: 'POST',
    body: { name },
  });
}

export function initGitRepo() {
  return jsonRequest<{ git: GitState }>('/api/git/init', {
    method: 'POST',
  });
}

export function stageWorkspaceFiles() {
  return jsonRequest<{ git: GitState }>('/api/git/stage', {
    method: 'POST',
  });
}

export function commitWorkspace(message: string) {
  return jsonRequest<{ git: GitState }>('/api/git/commit', {
    method: 'POST',
    body: { message },
  });
}

export function startTestRun(input: {
  testId: string;
  testName: string;
  liveMode?: boolean;
  slowMoMs?: number;
}) {
  return jsonRequest<{ run: TestRun }>('/api/runs', {
    method: 'POST',
    body: input,
  });
}

export function getTestRun(runId: string) {
  return request<{ run: TestRun }>(`/api/runs/${encodeURIComponent(runId)}`);
}
