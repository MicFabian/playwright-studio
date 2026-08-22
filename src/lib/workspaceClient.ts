import type { FlowDocument, GitState, StoredTestFlow, TestRun, WorkspaceData } from '../types';

type JsonRequestInit = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

let csrfToken: string | null = null;
let sessionReady: Promise<void> | null = null;

function readLaunchToken() {
  const hash = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('token');
}

const CSRF_STORAGE_KEY = 'studio.csrf';

async function exchangeLaunchToken(launchToken: string): Promise<boolean> {
  const response = await fetch(`/api/session?token=${encodeURIComponent(launchToken)}`, {
    method: 'POST',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    return false;
  }

  const { csrfToken: issued } = (await response.json()) as { csrfToken: string };
  csrfToken = issued;
  sessionStorage.setItem(CSRF_STORAGE_KEY, issued);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

async function establishSession(): Promise<void> {
  const launchToken = readLaunchToken();

  if (launchToken && (await exchangeLaunchToken(launchToken))) {
    return;
  }

  const stored = sessionStorage.getItem(CSRF_STORAGE_KEY);

  if (stored) {
    const probe = await fetch('/api/workspace', { credentials: 'same-origin' });

    if (probe.ok) {
      csrfToken = stored;
      return;
    }

    sessionStorage.removeItem(CSRF_STORAGE_KEY);
  }

  throw new Error(
    'Studio was opened without a launch token. Restart the dev server and use the printed URL.',
  );
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

function jsonRequest<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
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

export function saveTest(
  test: Pick<StoredTestFlow, 'id' | 'name' | 'status'> & {
    document: FlowDocument;
  },
) {
  return jsonRequest<{ test: StoredTestFlow; git: GitState }>(`/api/tests/${test.id}`, {
    method: 'PUT',
    body: test,
  });
}

export function renameTest(testId: string, name: string) {
  return jsonRequest<{ test: StoredTestFlow; git: GitState }>(
    `/api/tests/${encodeURIComponent(testId)}/rename`,
    { method: 'POST', body: { name } },
  );
}

export function createTest(name?: string) {
  return jsonRequest<{ test: StoredTestFlow; git: GitState }>('/api/tests', {
    method: 'POST',
    body: { name },
  });
}

export function saveSnippet(snippet: WorkspaceData['snippets'][number]) {
  return jsonRequest<{ snippet: WorkspaceData['snippets'][number]; git: GitState }>(
    `/api/snippets/${snippet.id}`,
    { method: 'PUT', body: snippet },
  );
}

export function createSnippet(name?: string) {
  return jsonRequest<{ snippet: WorkspaceData['snippets'][number]; git: GitState }>(
    '/api/snippets',
    { method: 'POST', body: { name } },
  );
}

export function initGitRepo() {
  return jsonRequest<{ git: GitState }>('/api/git/init', { method: 'POST' });
}

export function stageWorkspaceFiles() {
  return jsonRequest<{ git: GitState }>('/api/git/stage', { method: 'POST' });
}

export function commitWorkspace(message: string) {
  return jsonRequest<{ git: GitState }>('/api/git/commit', {
    method: 'POST',
    body: { message },
  });
}

export function startRun(input: { testId: string; testName: string; liveMode?: boolean }) {
  return jsonRequest<{ run: TestRun }>('/api/runs', { method: 'POST', body: input });
}

export function getRun(runId: string) {
  return request<{ run: TestRun }>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function listRuns() {
  return request<{ runs: TestRun[] }>('/api/runs');
}

export function cancelRun(runId: string) {
  return jsonRequest<{ cancelled: boolean }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    body: {},
  });
}

export function artifactUrl(runId: string, relativePath: string) {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export interface RunEvent {
  type: string;
  stepId?: string;
  error?: string | null;
  status?: string;
  seq: number;
}

export function streamRunEvents(
  runId: string,
  handlers: { onEvent: (event: RunEvent) => void; onError?: () => void },
): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);

  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as RunEvent);
    } catch {
      // A malformed frame must not tear down the stream.
    }
  };

  source.onerror = () => handlers.onError?.();

  return () => source.close();
}

export interface ImportedTestPreview {
  name: string;
  fidelity: 'structured' | 'mixed' | 'opaque';
  structuredSteps: number;
  opaqueSteps: number;
  diagnostics: { severity: string; code: string; message: string; line: number }[];
  document: FlowDocument;
  preview: string;
}

export interface ImportPreview {
  scaffold: string[];
  diagnostics: { severity: string; code: string; message: string; line: number }[];
  tests: ImportedTestPreview[];
}

export function previewImport(source: string, fileName?: string) {
  return jsonRequest<ImportPreview>('/api/import/preview', {
    method: 'POST',
    body: { source, fileName },
  });
}

export function adoptImport(documents: FlowDocument[]) {
  return jsonRequest<{ tests: StoredTestFlow[] }>('/api/import/adopt', {
    method: 'POST',
    body: { documents },
  });
}
